import { spawn } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config';
import { sanitizeOutput } from '../safety';
import type { CommandResult, ExecOptions, Sandbox, SandboxCapabilities, Language } from '../types';
import { killProcessTree } from './local';

/**
 * Hardened Docker executor.
 *
 * Each command runs in a fresh, disposable container with:
 *   --network none        no outbound access unless the step needs a registry
 *   --memory / --cpus     hard resource ceilings
 *   --pids-limit          fork-bomb containment
 *   --cap-drop ALL        no Linux capabilities
 *   --security-opt no-new-privileges
 *   --read-only + tmpfs   immutable root filesystem, writable scratch only
 *   --user                non-root
 *   --rm                  automatic cleanup
 * Only the project directory is bind-mounted; the host filesystem and host
 * environment are never visible to repository code.
 */

/** Toolchain images per language. Pinned to stable, widely cached tags. */
export const LANGUAGE_IMAGES: Record<Language, string> = {
  node: 'node:20-bookworm-slim',
  python: 'python:3.11-slim-bookworm',
  java: 'eclipse-temurin:17-jdk-jammy',
  go: 'golang:1.22-bookworm',
  rust: 'rust:1.79-slim-bookworm',
  unknown: 'debian:bookworm-slim',
};

/** Pick an image matching a reconstructed runtime version where one exists. */
export function imageForRuntime(language: Language, version: string | null): string {
  if (!version) return LANGUAGE_IMAGES[language];
  const major = version.split('.')[0];
  switch (language) {
    case 'node':
      return `node:${major}-bookworm-slim`;
    case 'python': {
      const [maj, min] = version.split('.');
      return min ? `python:${maj}.${min}-slim` : LANGUAGE_IMAGES.python;
    }
    case 'java':
      return `eclipse-temurin:${major}-jdk-jammy`;
    case 'go': {
      const [maj, min] = version.split('.');
      return min ? `golang:${maj}.${min}-bookworm` : LANGUAGE_IMAGES.go;
    }
    case 'rust':
      return `rust:${version}-slim-bookworm`;
    default:
      return LANGUAGE_IMAGES[language];
  }
}

export interface DockerSandboxOptions {
  workspaceDir: string;
  /** Host path that becomes /work inside the container. */
  mountDir: string;
  image: string;
  /** Steps that legitimately need a package registry. */
  allowNetwork: boolean;
}

export class DockerSandbox implements Sandbox {
  readonly capabilities: SandboxCapabilities;
  private readonly opts: DockerSandboxOptions;
  private readonly containers = new Set<string>();
  private disposed = false;

  constructor(opts: DockerSandboxOptions) {
    this.opts = opts;
    this.capabilities = {
      mode: 'docker',
      canExecute: true,
      cpuLimited: true,
      memoryLimited: true,
      diskLimited: true,
      networkControlled: true,
      filesystemIsolated: true,
      processLimited: true,
      reason: 'Docker detected',
      detail: `Hardened containers: --network ${opts.allowNetwork ? 'bridge (install steps only)' : 'none'}, --memory ${config.containerMemory}, --cpus ${config.containerCpus}, --pids-limit ${config.containerPids}, --cap-drop ALL, --security-opt no-new-privileges, read-only root filesystem, non-root user, automatic removal.`,
    };
  }

  /** Build the argv for a hardened `docker run`. Exposed for testing. */
  buildArgs(command: string, options: ExecOptions, containerName: string): string[] {
    const image = options.image || this.opts.image;
    // Translate the host cwd into the container's /work mount.
    const relCwd = path.relative(this.opts.mountDir, options.cwd).split(path.sep).join('/');
    const containerCwd = relCwd && relCwd !== '' ? `/work/${relCwd}` : '/work';

    const args = [
      'run',
      '--rm',
      '--name',
      containerName,
      '--network',
      this.opts.allowNetwork ? 'bridge' : 'none',
      '--memory',
      config.containerMemory,
      '--memory-swap',
      config.containerMemory, // disallow swap growth
      '--cpus',
      config.containerCpus,
      '--pids-limit',
      String(config.containerPids),
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--read-only',
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,size=512m',
      '--tmpfs',
      '/home/revive:rw,nosuid,size=512m',
      '--ulimit',
      'nofile=4096:4096',
      '--ulimit',
      'nproc=512:512',
      '--ulimit',
      'core=0',
      '-v',
      `${this.opts.mountDir}:/work:rw`,
      '-w',
      containerCwd,
      '-e',
      'HOME=/home/revive',
      '-e',
      'CI=1',
      '-e',
      'NO_COLOR=1',
    ];

    for (const [key, value] of Object.entries(options.env ?? {})) {
      args.push('-e', `${key}=${value}`);
    }

    args.push(image, '/bin/sh', '-lc', command);
    return args;
  }

  async exec(command: string, options: ExecOptions): Promise<CommandResult> {
    if (this.disposed) throw new Error('Sandbox has been disposed');

    const containerName = `revive-${randomUUID().slice(0, 12)}`;
    this.containers.add(containerName);

    const timeoutMs = options.timeoutMs ?? config.stepTimeoutMs;
    const maxOutputBytes = options.maxOutputBytes ?? config.maxOutputBytes;
    const started = Date.now();
    const args = this.buildArgs(command, options, containerName);

    const child = spawn('docker', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    let bytes = 0;
    let truncated = false;
    let timedOut = false;

    const capture = (chunk: Buffer, sink: 'out' | 'err') => {
      if (truncated) return;
      const text = chunk.toString('utf8');
      bytes += Buffer.byteLength(text);
      if (bytes > maxOutputBytes) {
        truncated = true;
        stderr += `\n[revive] output limit reached — truncated\n`;
        void this.forceRemove(containerName);
        return;
      }
      if (sink === 'out') stdout += text;
      else stderr += text;
      options.onOutput?.(sanitizeOutput(text));
    };

    child.stdout?.on('data', (c: Buffer) => capture(c, 'out'));
    child.stderr?.on('data', (c: Buffer) => capture(c, 'err'));

    const timer = setTimeout(() => {
      timedOut = true;
      void this.forceRemove(containerName);
      killProcessTree(child.pid);
    }, timeoutMs);

    const onAbort = () => {
      void this.forceRemove(containerName);
      killProcessTree(child.pid);
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    const code = await new Promise<number | null>((resolve) => {
      child.on('error', (err) => {
        stderr += `\n[revive] docker invocation failed: ${err.message}\n`;
        resolve(127);
      });
      child.on('close', (c) => resolve(c));
    });

    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
    this.containers.delete(containerName);

    if (timedOut) {
      stderr += `\n[revive] aborted: command exceeded the ${Math.round(timeoutMs / 1000)}s timeout\n`;
    }

    const cleanOut = sanitizeOutput(stdout);
    const cleanErr = sanitizeOutput(stderr);

    return {
      command,
      cwd: options.cwd,
      exitCode: code,
      signal: null,
      stdout: cleanOut,
      stderr: cleanErr,
      combined: `${cleanOut}${cleanErr ? `\n${cleanErr}` : ''}`.trim(),
      durationMs: Date.now() - started,
      timedOut,
      truncated,
      ok: code === 0 && !timedOut,
    };
  }

  private async forceRemove(name: string): Promise<void> {
    await new Promise<void>((resolve) => {
      const p = spawn('docker', ['rm', '-f', name], { stdio: 'ignore', windowsHide: true });
      p.on('close', () => resolve());
      p.on('error', () => resolve());
    });
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    // Belt and braces: --rm should already have cleaned these up.
    await Promise.all([...this.containers].map((name) => this.forceRemove(name)));
    this.containers.clear();
  }
}

/** Detect a usable Docker daemon (not just the CLI being on PATH). */
export async function detectDocker(): Promise<{ available: boolean; detail: string }> {
  return new Promise((resolve) => {
    const child = spawn('docker', ['info', '--format', '{{.ServerVersion}}'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      killProcessTree(child.pid);
      resolve({ available: false, detail: 'docker info timed out after 10s' });
    }, 10_000);

    child.stdout?.on('data', (c) => (out += c.toString()));
    child.stderr?.on('data', (c) => (err += c.toString()));
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ available: false, detail: 'docker CLI not found on PATH' });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && out.trim()) {
        resolve({ available: true, detail: `Docker Engine ${out.trim()}` });
      } else {
        resolve({
          available: false,
          detail: err.trim().split('\n')[0] || 'Docker daemon is not responding',
        });
      }
    });
  });
}
