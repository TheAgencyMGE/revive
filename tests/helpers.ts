import path from 'node:path';
import { onTestFailed } from 'vitest';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { JobSink } from '../src/engine/orchestrator';
import type { AppliedRepair, LogLevel, Phase, VerificationResult } from '../src/engine/types';

/**
 * Test doubles and helpers.
 *
 * The engine's only coupling to the application is the JobSink interface, so an
 * in-memory implementation is enough to drive the full pipeline in tests
 * without a database, a server, or the UI.
 */

export interface CapturedAttempt {
  number: number;
  strategy: string;
  repairs: AppliedRepair[];
  result: VerificationResult | null;
  outcome: string;
  notes?: string;
}

export class MemoryJobSink implements JobSink {
  readonly logs: { level: LogLevel; message: string; phase: string }[] = [];
  readonly phases: Phase[] = [];
  readonly attempts: CapturedAttempt[] = [];
  state: Record<string, unknown> = {};
  cancelled = false;

  private currentPhase: Phase = 'queued';

  async log(level: LogLevel, message: string): Promise<void> {
    this.logs.push({ level, message, phase: this.currentPhase });
  }

  async setPhase(phase: Phase): Promise<void> {
    this.currentPhase = phase;
    this.phases.push(phase);
  }

  async setState(patch: Record<string, unknown>): Promise<void> {
    this.state = { ...this.state, ...patch };
  }

  async recordAttempt(attempt: CapturedAttempt): Promise<void> {
    this.attempts.push(attempt);
  }

  async isCancelled(): Promise<boolean> {
    return this.cancelled;
  }

  /** All log text joined, for assertions about what the user was told. */
  text(): string {
    return this.logs.map((l) => l.message).join('\n');
  }

  errors(): string[] {
    return this.logs.filter((l) => l.level === 'error').map((l) => l.message);
  }
}

/**
 * When a test fails, print what each build step actually output. Integration
 * failures on another OS are otherwise unexplainable from an assertion alone.
 */
export function dumpOnFailure(sink: MemoryJobSink): void {
  onTestFailed(() => {
    const report = (label: string, result: unknown) => {
      const steps =
        (result as { steps?: { step: string; status: string; command: string; output: string }[] })
          ?.steps ?? [];
      console.log(`\n===== ${label} =====`);
      for (const s of steps) {
        console.log(`--- ${s.step} [${s.status}] $ ${s.command}\n${String(s.output).slice(-2500)}`);
      }
    };
    report('BASELINE', sink.state.baseline);
    report('FINAL', sink.state.finalResult);
    const diagnoses = (sink.state.diagnosis as { category: string; title: string }[]) ?? [];
    console.log(
      `\n===== DIAGNOSES =====\n${diagnoses.map((d) => `${d.category}: ${d.title}`).join('\n')}`,
    );
    console.log(`\n===== ERRORS =====\n${sink.errors().join('\n')}`);
  });
}

const FIXTURE_BUILT = path.resolve(__dirname, '..', 'fixtures', '.built');

export function fixtureRepoPath(id: string): string {
  return path.join(FIXTURE_BUILT, id);
}

export async function fixtureExists(id: string): Promise<boolean> {
  try {
    await fs.access(path.join(fixtureRepoPath(id), 'HEAD'));
    return true;
  } catch {
    return false;
  }
}

export function newJobId(): string {
  // Matches the cuid-ish shape the API validates.
  return `t${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

/** Point the engine at a scratch data directory for the duration of a test. */
export async function useTempDataDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = path.resolve(__dirname, '..', '.revive-test', randomUUID().slice(0, 8));
  await fs.mkdir(dir, { recursive: true });
  process.env.REVIVE_DATA_DIR = dir;
  return {
    dir,
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    },
  };
}
