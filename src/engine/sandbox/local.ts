import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { config } from '../config';
import { buildSandboxEnv, sanitizeOutput } from '../safety';
import type { CommandResult, ExecOptions, Sandbox, SandboxCapabilities } from '../types';
import { directorySize } from '../fsutil';

/**
 * Restricted local executor.
 *
 * Used when Docker is unavailable. It is a genuine defence-in-depth layer, but
 * it is NOT a security boundary equivalent to a container, and Revive says so
 * plainly in the UI rather than pretending otherwise.
 *
 * What it does enforce:
 *  - no inherited host environment (secrets cannot be read from env)
 *  - HOME/TMP redirected into the disposable workspace
 *  - wall-clock timeouts with whole-process-tree kill
 *  - captured-output ceiling (infinite log spew cannot exhaust memory/disk)
 *  - disk growth watchdog (decompression bombs / runaway builds)
 *  - POSIX: address-space, file-size, process-count rlimits via ulimit
 *  - detached process groups so no orphan survives a job
 */
export class LocalSandbox implements Sandbox {
  readonly capabilities: SandboxCapabilities;
  private readonly homeDir: string;
  private readonly tmpDir: string;
  private readonly watchDir: string;
  private disposed = false;

  constructor(opts: { workspaceDir: string; reason: string }) {
    this.homeDir = path.join(opts.workspaceDir, '.sandbox-home');
    this.tmpDir = path.join(opts.workspaceDir, '.sandbox-tmp');
    this.watchDir = opts.workspaceDir;

    const posix = !config.isWindows;
    this.capabilities = {
      mode: 'restricted',
      canExecute: true,
      cpuLimited: false,
      memoryLimited: posix,
      diskLimited: true,
      networkControlled: false,
      filesystemIsolated: false,
      processLimited: posix,
      reason: opts.reason,
      detail: posix
        ? 'Restricted local execution: scrubbed environment, rlimits (memory/processes/file size), timeouts, process-tree kill and a disk watchdog. Weaker isolation than a container — repository code runs as the current OS user.'
        : 'Restricted local execution: scrubbed environment, redirected HOME/TMP, timeouts, process-tree kill and a disk watchdog. Windows cannot apply POSIX rlimits, so CPU/memory are bounded by timeout and watchdog only. Install Docker Desktop for full container isolation.',
    };
  }

  private async ensureDirs(): Promise<void> {
    await fs.mkdir(this.homeDir, { recursive: true });
    await fs.mkdir(this.tmpDir, { recursive: true });
  }

  async exec(command: string, options: ExecOptions): Promise<CommandResult> {
    if (this.disposed) throw new Error('Sandbox has been disposed');
    await this.ensureDirs();

    const timeoutMs = options.timeoutMs ?? config.stepTimeoutMs;
    const maxOutputBytes = options.maxOutputBytes ?? config.maxOutputBytes;
    const env = buildSandboxEnv(options.env ?? {}, { home: this.homeDir, tmpDir: this.tmpDir });
    const started = Date.now();

    // On POSIX, wrap the command in ulimits. These are inherited by every
    // descendant process, so a fork bomb or a runaway compiler hits a hard wall.
    //   -v : virtual memory KB   -u : max user processes
    //   -f : max file size (blocks)   -c : no core dumps
    const posixPrologue = [
      'ulimit -c 0',
      'ulimit -v 4194304 2>/dev/null || true',
      'ulimit -u 512 2>/dev/null || true',
      'ulimit -f 4194304 2>/dev/null || true',
    ].join('; ');

    const shell = config.isWindows
      ? process.env.ComSpec || 'cmd.exe'
      : '/bin/bash';
    const args = config.isWindows
      ? ['/d', '/s', '/c', command]
      : ['-lc', `${posixPrologue}; ${command}`];

    const child = spawn(shell, args, {
      cwd: options.cwd,
      env: env as NodeJS.ProcessEnv,
      windowsHide: true,
      // Detached gives the child its own process group on POSIX so we can kill
      // the whole tree with a negative PID rather than orphaning grandchildren.
      detached: !config.isWindows,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let bytes = 0;
    let truncated = false;
    let timedOut = false;
    let diskAborted = false;

    const capture = (chunk: Buffer, sink: 'out' | 'err') => {
      if (truncated) return;
      const text = chunk.toString('utf8');
      bytes += Buffer.byteLength(text);
      if (bytes > maxOutputBytes) {
        truncated = true;
        const notice = `\n[revive] output limit of ${maxOutputBytes} bytes reached — command output truncated\n`;
        if (sink === 'out') stdout += notice;
        else stderr += notice;
        kill('output-limit');
        return;
      }
      if (sink === 'out') stdout += text;
      else stderr += text;
      options.onOutput?.(sanitizeOutput(text));
    };

    child.stdout?.on('data', (c: Buffer) => capture(c, 'out'));
    child.stderr?.on('data', (c: Buffer) => capture(c, 'err'));

    let killed = false;
    const kill = (_why: string) => {
      if (killed) return;
      killed = true;
      killProcessTree(child.pid);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      kill('timeout');
    }, timeoutMs);

    // Disk watchdog — guards against decompression bombs and runaway artifacts.
    const diskTimer = setInterval(() => {
      void directorySize(this.watchDir, config.maxRepoBytes * 4)
        .then((size) => {
          if (size > config.maxRepoBytes * 4) {
            diskAborted = true;
            kill('disk-limit');
          }
        })
        .catch(() => undefined);
    }, 10_000);

    const onAbort = () => kill('cancelled');
    options.signal?.addEventListener('abort', onAbort, { once: true });

    const { code, signal } = await new Promise<{ code: number | null; signal: string | null }>(
      (resolve) => {
        child.on('error', (err) => {
          stderr += `\n[revive] failed to spawn command: ${err.message}\n`;
          resolve({ code: 127, signal: null });
        });
        child.on('close', (c, s) => resolve({ code: c, signal: s }));
      },
    );

    clearTimeout(timer);
    clearInterval(diskTimer);
    options.signal?.removeEventListener('abort', onAbort);

    if (diskAborted) {
      stderr += `\n[revive] aborted: workspace exceeded the disk ceiling (${Math.round((config.maxRepoBytes * 4) / 1024 / 1024)} MB)\n`;
    }
    if (timedOut) {
      stderr += `\n[revive] aborted: command exceeded the ${Math.round(timeoutMs / 1000)}s timeout\n`;
    }

    const cleanOut = sanitizeOutput(stdout);
    const cleanErr = sanitizeOutput(stderr);

    return {
      command,
      cwd: options.cwd,
      exitCode: code,
      signal,
      stdout: cleanOut,
      stderr: cleanErr,
      combined: `${cleanOut}${cleanErr ? `\n${cleanErr}` : ''}`.trim(),
      durationMs: Date.now() - started,
      timedOut,
      truncated,
      ok: code === 0 && !timedOut && !diskAborted,
    };
  }

  async dispose(): Promise<void> {
    this.disposed = true;
  }
}

/**
 * Kill a process and every descendant.
 *
 * Windows has no process groups, so we shell out to taskkill /T which walks the
 * child tree. POSIX kills the negative PID (the detached process group).
 */
export function killProcessTree(pid: number | undefined): void {
  if (!pid) return;
  if (os.platform() === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      }).unref();
    } catch {
      /* process already gone */
    }
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
  // Escalate if it ignores SIGTERM.
  setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }, 5_000).unref();
}
