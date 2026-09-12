import { prisma, parseJson, stringifyJson } from '@/lib/db';
import { bus } from './bus';
import { sanitizeOutput } from '@/engine/safety';
import type { JobSink } from '@/engine/orchestrator';
import type {
  AppliedRepair,
  ChangedFile,
  DependencyChange,
  DetectionResult,
  Diagnosis,
  EnvironmentSpec,
  JobStatus,
  JobView,
  LogLevel,
  Phase,
  RepoMetadata,
  SandboxMode,
  VerificationResult,
} from '@/engine/types';

/**
 * Database-backed implementation of the engine's JobSink.
 *
 * Every state change is written to SQLite (so a run survives a restart and can
 * be revisited later) and published to the event bus (so open browsers update
 * live). The engine itself knows nothing about either.
 */

/** JSON columns on the Job model — kept in one place so reads and writes agree. */
const JSON_FIELDS = new Set([
  'metadata',
  'detection',
  'originalEnv',
  'finalEnv',
  'baseline',
  'finalResult',
  'diagnosis',
  'repairs',
  'changedFiles',
  'dependencyDiff',
]);

export class PrismaJobSink implements JobSink {
  private seq = 0;
  private pendingLogs: {
    jobId: string;
    seq: number;
    phase: string;
    level: string;
    message: string;
  }[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private currentPhase: Phase = 'queued';

  constructor(private readonly jobId: string) {}

  async log(level: LogLevel, message: string): Promise<void> {
    // Repository output reaches this path, so it is scrubbed and bounded here
    // regardless of what the caller did.
    const clean = sanitizeOutput(String(message)).slice(0, 8000);
    if (!clean.trim()) return;

    const seq = this.seq++;
    const event = {
      jobId: this.jobId,
      seq,
      ts: new Date().toISOString(),
      phase: this.currentPhase,
      level,
      message: clean,
    };

    bus.publish(this.jobId, { type: 'log', data: event });

    // Writing every debug line individually would make SQLite the bottleneck
    // during a noisy npm install, so writes are batched.
    this.pendingLogs.push({
      jobId: this.jobId,
      seq,
      phase: this.currentPhase,
      level,
      message: clean,
    });

    if (this.pendingLogs.length >= 50) {
      await this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => void this.flush(), 400);
    }
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.pendingLogs.length) return;
    const batch = this.pendingLogs;
    this.pendingLogs = [];
    try {
      await prisma.logLine.createMany({ data: batch });
    } catch {
      // Losing a log line must never fail a revival.
    }
  }

  async setPhase(phase: Phase, phaseIdx: number, attempt: number): Promise<void> {
    this.currentPhase = phase;
    await prisma.job.update({
      where: { id: this.jobId },
      data: { phase, phaseIdx, attempt },
    });
    bus.publish(this.jobId, { type: 'phase', data: { phase, phaseIdx, attempt } });
  }

  async setState(patch: Record<string, unknown>): Promise<void> {
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      data[key] = JSON_FIELDS.has(key) ? stringifyJson(value) : value;
    }
    await prisma.job.update({ where: { id: this.jobId }, data });
    bus.publish(this.jobId, { type: 'state', data: patch });
  }

  async recordAttempt(attempt: {
    number: number;
    strategy: string;
    repairs: AppliedRepair[];
    result: VerificationResult | null;
    outcome: string;
    notes?: string;
  }): Promise<void> {
    await prisma.attempt.create({
      data: {
        jobId: this.jobId,
        number: attempt.number,
        strategy: attempt.strategy,
        repairs: stringifyJson(attempt.repairs),
        result: stringifyJson(attempt.result),
        outcome: attempt.outcome,
        notes: attempt.notes,
      },
    });
    bus.publish(this.jobId, { type: 'state', data: { lastAttempt: attempt.number } });
  }

  async isCancelled(): Promise<boolean> {
    const job = await prisma.job.findUnique({
      where: { id: this.jobId },
      select: { cancelRequested: true },
    });
    return job?.cancelRequested ?? false;
  }

  async setStatus(status: JobStatus): Promise<void> {
    await prisma.job.update({ where: { id: this.jobId }, data: { status } });
    bus.publish(this.jobId, { type: 'status', data: { status } });
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

type JobRow = Awaited<ReturnType<typeof prisma.job.findUnique>>;

export function toJobView(job: NonNullable<JobRow>): JobView {
  return {
    id: job.id,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    repoUrl: job.repoUrl,
    source: job.source,
    fixtureId: job.fixtureId,
    status: job.status as JobStatus,
    phase: job.phase as Phase,
    phaseIdx: job.phaseIdx,
    attempt: job.attempt,
    maxAttempts: job.maxAttempts,
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    durationMs: job.durationMs,
    metadata: parseJson<RepoMetadata | null>(job.metadata, null),
    detection: parseJson<DetectionResult | null>(job.detection, null),
    originalEnv: parseJson<EnvironmentSpec | null>(job.originalEnv, null),
    finalEnv: parseJson<EnvironmentSpec | null>(job.finalEnv, null),
    baseline: parseJson<VerificationResult | null>(job.baseline, null),
    finalResult: parseJson<VerificationResult | null>(job.finalResult, null),
    diagnosis: parseJson<Diagnosis[]>(job.diagnosis, []),
    repairs: parseJson<AppliedRepair[]>(job.repairs, []),
    changedFiles: parseJson<ChangedFile[]>(job.changedFiles, []),
    dependencyDiff: parseJson<DependencyChange[]>(job.dependencyDiff, []),
    confidence: job.confidence,
    summary: job.summary,
    errorMessage: job.errorMessage,
    errorCode: job.errorCode,
    sandboxMode: job.sandboxMode as SandboxMode | null,
    hasPatch: Boolean(job.patchPath),
    hasZip: Boolean(job.zipPath),
    hasReport: Boolean(job.reportPath),
    parentJobId: job.parentJobId,
  };
}

export async function getJobView(jobId: string): Promise<JobView | null> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  return job ? toJobView(job) : null;
}

export async function getJobLogs(jobId: string, afterSeq = -1) {
  return prisma.logLine.findMany({
    where: { jobId, seq: { gt: afterSeq } },
    orderBy: { seq: 'asc' },
    take: 5000,
    select: { seq: true, ts: true, phase: true, level: true, message: true },
  });
}

export async function getJobAttempts(jobId: string) {
  const attempts = await prisma.attempt.findMany({
    where: { jobId },
    orderBy: { number: 'asc' },
  });
  return attempts.map((a) => ({
    id: a.id,
    number: a.number,
    createdAt: a.createdAt.toISOString(),
    strategy: a.strategy,
    outcome: a.outcome,
    notes: a.notes,
    repairs: parseJson<AppliedRepair[]>(a.repairs, []),
    result: parseJson<VerificationResult | null>(a.result, null),
  }));
}

export async function listJobs(limit = 50) {
  const jobs = await prisma.job.findMany({
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 200),
  });
  return jobs.map(toJobView);
}

export async function getDiffText(jobId: string): Promise<string | null> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { diffText: true },
  });
  return job?.diffText ?? null;
}
