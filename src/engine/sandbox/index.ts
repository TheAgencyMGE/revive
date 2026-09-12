import { config } from '../config';
import type { Language, Sandbox, SandboxCapabilities } from '../types';
import { DockerSandbox, detectDocker, imageForRuntime } from './docker';
import { LocalSandbox } from './local';

/**
 * Sandbox selection.
 *
 * Docker is preferred when a responding daemon exists. Otherwise Revive falls
 * back to restricted local execution automatically — the user is never asked to
 * configure anything. Analysis-only mode keeps every non-executing capability
 * (detection, environment inference, static diagnosis, reporting) available.
 */

let cachedProbe: { available: boolean; detail: string } | null = null;

export async function probeDocker(force = false) {
  if (!cachedProbe || force) cachedProbe = await detectDocker();
  return cachedProbe;
}

export const ANALYSIS_ONLY_CAPABILITIES: SandboxCapabilities = {
  mode: 'analysis-only',
  canExecute: false,
  cpuLimited: false,
  memoryLimited: false,
  diskLimited: false,
  networkControlled: false,
  filesystemIsolated: false,
  processLimited: false,
  reason: 'Execution disabled',
  detail:
    'Repository code is never executed in this mode. Revive still performs full static analysis: runtime detection, environment reconstruction, dependency auditing and deterministic diagnosis.',
};

/** A no-op sandbox used in analysis-only mode. */
export class NullSandbox implements Sandbox {
  readonly capabilities = ANALYSIS_ONLY_CAPABILITIES;
  async exec(): Promise<never> {
    throw new Error('Execution is disabled in analysis-only mode');
  }
  async dispose(): Promise<void> {}
}

export interface CreateSandboxOptions {
  workspaceDir: string;
  mountDir: string;
  language: Language;
  runtimeVersion: string | null;
  allowNetwork: boolean;
}

export async function createSandbox(opts: CreateSandboxOptions): Promise<Sandbox> {
  const mode = config.sandboxMode;

  if (mode === 'analysis-only') return new NullSandbox();

  if (mode === 'docker' || mode === 'auto') {
    const probe = await probeDocker();
    if (probe.available) {
      return new DockerSandbox({
        workspaceDir: opts.workspaceDir,
        mountDir: opts.mountDir,
        image: imageForRuntime(opts.language, opts.runtimeVersion),
        allowNetwork: opts.allowNetwork,
      });
    }
    if (mode === 'docker') {
      throw new Error(
        `REVIVE_SANDBOX_MODE=docker was requested but Docker is unavailable: ${probe.detail}`,
      );
    }
    return new LocalSandbox({
      workspaceDir: opts.workspaceDir,
      reason: `Docker unavailable (${probe.detail}) — using restricted local execution`,
    });
  }

  return new LocalSandbox({
    workspaceDir: opts.workspaceDir,
    reason: 'REVIVE_SANDBOX_MODE=restricted',
  });
}

/** Capability summary for the UI / health endpoint, without creating a sandbox. */
export async function describeSandbox(): Promise<SandboxCapabilities> {
  if (config.sandboxMode === 'analysis-only') return ANALYSIS_ONLY_CAPABILITIES;
  if (config.sandboxMode === 'restricted') {
    return new LocalSandbox({ workspaceDir: config.workspaceRoot, reason: 'Configured' })
      .capabilities;
  }
  const probe = await probeDocker();
  if (probe.available) {
    return new DockerSandbox({
      workspaceDir: config.workspaceRoot,
      mountDir: config.workspaceRoot,
      image: 'node:20-bookworm-slim',
      allowNetwork: true,
    }).capabilities;
  }
  if (config.sandboxMode === 'docker') {
    return { ...ANALYSIS_ONLY_CAPABILITIES, reason: 'Docker requested but unavailable' };
  }
  return new LocalSandbox({
    workspaceDir: config.workspaceRoot,
    reason: `Docker unavailable (${probe.detail})`,
  }).capabilities;
}

export { DockerSandbox, imageForRuntime, LANGUAGE_IMAGES, detectDocker } from './docker';
export { LocalSandbox, killProcessTree } from './local';
