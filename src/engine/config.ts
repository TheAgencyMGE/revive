import path from 'node:path';
import os from 'node:os';

/**
 * Central configuration with safe defaults.
 *
 * Every value has a working default so Revive runs with an empty environment.
 * Environment variables only ever narrow or widen limits — they are never
 * required, and none of them are secrets.
 */

function intFromEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

const dataDir = process.env.REVIVE_DATA_DIR
  ? path.resolve(process.env.REVIVE_DATA_DIR)
  : path.resolve(process.cwd(), '.revive');

export const config = {
  dataDir,
  workspaceRoot: path.join(dataDir, 'workspaces'),
  artifactRoot: path.join(dataDir, 'artifacts'),
  cacheRoot: path.join(dataDir, 'cache'),

  /** Reject repositories larger than this after clone. */
  maxRepoBytes: intFromEnv('REVIVE_MAX_REPO_MB', 512, 16, 4096) * 1024 * 1024,
  /** Reject repositories with more files than this (decompression-bomb guard). */
  maxRepoFiles: intFromEnv('REVIVE_MAX_REPO_FILES', 60_000, 1000, 500_000),

  /** Per-command wall clock ceiling. */
  stepTimeoutMs: intFromEnv('REVIVE_STEP_TIMEOUT_MS', 300_000, 5_000, 1_800_000),
  /** Whole-job wall clock ceiling. */
  jobTimeoutMs: intFromEnv('REVIVE_JOB_TIMEOUT_MS', 1_800_000, 30_000, 7_200_000),
  /** Clone-specific timeout. */
  cloneTimeoutMs: intFromEnv('REVIVE_CLONE_TIMEOUT_MS', 180_000, 5_000, 900_000),
  /** How long a "start" command is allowed to run before we call it healthy. */
  startProbeMs: intFromEnv('REVIVE_START_PROBE_MS', 20_000, 2_000, 120_000),

  /** Captured output cap per command — protects against infinite log spew. */
  maxOutputBytes: intFromEnv('REVIVE_MAX_OUTPUT_BYTES', 2_000_000, 10_000, 50_000_000),
  /** Output persisted per step in the database. */
  maxStoredStepOutput: intFromEnv('REVIVE_MAX_STORED_STEP_OUTPUT', 60_000, 1_000, 1_000_000),

  maxAttempts: intFromEnv('REVIVE_MAX_ATTEMPTS', 4, 1, 10),
  maxConcurrentJobs: intFromEnv('REVIVE_MAX_CONCURRENT_JOBS', 2, 1, 8),

  containerMemory: process.env.REVIVE_CONTAINER_MEMORY || '2g',
  containerCpus: process.env.REVIVE_CONTAINER_CPUS || '2',
  containerPids: intFromEnv('REVIVE_CONTAINER_PIDS', 256, 32, 4096),

  sandboxMode: (process.env.REVIVE_SANDBOX_MODE || 'auto') as
    | 'auto'
    | 'docker'
    | 'restricted'
    | 'analysis-only',

  /** Rate limit for job creation, per IP. */
  rateLimitWindowMs: intFromEnv('REVIVE_RATE_WINDOW_MS', 60_000, 1_000, 3_600_000),
  rateLimitMax: intFromEnv('REVIVE_RATE_MAX', 10, 1, 1000),

  isWindows: os.platform() === 'win32',
} as const;

export type ReviveConfig = typeof config;
