import { prisma } from '@/lib/db';
import { bus } from './bus';
import { PrismaJobSink } from './store';
import { config } from '@/engine/config';
import { runJob, JobError, type AiConfig } from '@/engine/orchestrator';
import { cleanupWorkspace } from '@/engine/artifacts';
import { getFixture } from '@/lib/fixtures';

/**
 * In-process job queue.
 *
 * A persistent worker loop with bounded concurrency, backed by the same SQLite
 * database that stores results. No Redis, no separate worker process, no broker
 * — which is what lets Revive run from a single `npm run dev`.
 *
 * Jobs are claimed with a status transition, so a crash mid-run leaves a row in
 * `running` that the startup sweep reconciles rather than silently losing.
 */

interface RunningJob {
  jobId: string;
  controller: AbortController;
  startedAt: number;
}

class JobQueue {
  private readonly running = new Map<string, RunningJob>();
  private pumping = false;
  private started = false;
  /** AI config is held in memory for the life of the run only — never persisted. */
  private readonly aiConfigs = new Map<string, AiConfig>();

  /** Reconcile rows left `running` by a previous process, then start pumping. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    const orphaned = await prisma.job.updateMany({
      where: { status: 'running' },
      data: {
        status: 'failed',
        phase: 'failed',
        errorMessage: 'The server restarted while this job was running.',
        errorCode: 'SERVER_RESTART',
        finishedAt: new Date(),
      },
    });

    if (orphaned.count > 0) {
      console.warn(`[revive] marked ${orphaned.count} interrupted job(s) as failed on startup`);
    }

    void this.pump();
  }

  async enqueue(jobId: string, ai?: AiConfig): Promise<void> {
    if (ai) this.aiConfigs.set(jobId, ai);
    void this.pump();
  }

  /** Claim and run queued jobs up to the concurrency ceiling. */
  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;

    try {
      while (this.running.size < config.maxConcurrentJobs) {
        const next = await prisma.job.findFirst({
          where: { status: 'queued', cancelRequested: false },
          orderBy: { createdAt: 'asc' },
        });
        if (!next) break;

        // Claim it. The conditional where-clause makes this safe even if two
        // pumps race.
        const claimed = await prisma.job.updateMany({
          where: { id: next.id, status: 'queued' },
          data: { status: 'running', startedAt: new Date(), phase: 'analyze' },
        });
        if (claimed.count === 0) continue;

        void this.execute(next.id);
      }
    } finally {
      this.pumping = false;
    }
  }

  private async execute(jobId: string): Promise<void> {
    const controller = new AbortController();
    this.running.set(jobId, { jobId, controller, startedAt: Date.now() });

    const sink = new PrismaJobSink(jobId);
    bus.publish(jobId, { type: 'status', data: { status: 'running' } });

    // Whole-job timeout, independent of any individual step's timeout.
    const jobTimer = setTimeout(() => {
      controller.abort(new Error('Job timeout'));
    }, config.jobTimeoutMs);

    let timedOut = false;
    controller.signal.addEventListener('abort', () => {
      if (controller.signal.reason instanceof Error && controller.signal.reason.message === 'Job timeout') {
        timedOut = true;
      }
    });

    try {
      const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });

      let localPath: string | undefined;
      if (job.source === 'fixture' && job.fixtureId) {
        const fixture = await getFixture(job.fixtureId);
        if (!fixture) throw new JobError(`Unknown fixture "${job.fixtureId}".`, 'FIXTURE_NOT_FOUND');
        localPath = fixture.repoPath;
      }

      const result = await runJob({
        jobId,
        repoUrl: job.repoUrl,
        localPath,
        ref: job.ref ?? undefined,
        sink,
        signal: controller.signal,
        ai: this.aiConfigs.get(jobId),
      });

      await sink.flush();
      const startedAt = this.running.get(jobId)?.startedAt ?? Date.now();

      await prisma.job.update({
        where: { id: jobId },
        data: {
          status: result.status,
          phase: result.status === 'cancelled' ? 'cancelled' : 'complete',
          summary: result.summary,
          confidence: result.confidence,
          finishedAt: new Date(),
          durationMs: Date.now() - startedAt,
        },
      });

      bus.publish(jobId, { type: 'status', data: { status: result.status } });
      bus.publish(jobId, { type: 'done', data: { status: result.status } });
    } catch (err) {
      await sink.flush();
      const cancelled = controller.signal.aborted && !timedOut;

      const message = timedOut
        ? `This job exceeded the ${Math.round(config.jobTimeoutMs / 60000)}-minute limit and was stopped.`
        : err instanceof JobError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'An unexpected error occurred.';

      const code = timedOut
        ? 'JOB_TIMEOUT'
        : err instanceof JobError
          ? err.code
          : 'INTERNAL_ERROR';

      const status = cancelled ? 'cancelled' : 'failed';

      if (!(err instanceof JobError) && !cancelled && !timedOut) {
        console.error(`[revive] job ${jobId} failed:`, err);
      }

      await sink.log('error', message).catch(() => undefined);
      await sink.flush().catch(() => undefined);

      const startedAt = this.running.get(jobId)?.startedAt ?? Date.now();
      await prisma.job
        .update({
          where: { id: jobId },
          data: {
            status,
            phase: cancelled ? 'cancelled' : 'failed',
            errorMessage: message,
            errorCode: code,
            summary: cancelled ? 'Cancelled before completion.' : message,
            finishedAt: new Date(),
            durationMs: Date.now() - startedAt,
          },
        })
        .catch(() => undefined);

      bus.publish(jobId, { type: 'status', data: { status } });
      bus.publish(jobId, { type: 'done', data: { status } });
    } finally {
      clearTimeout(jobTimer);
      this.running.delete(jobId);
      this.aiConfigs.delete(jobId);

      // Artifacts were already written; the working tree is no longer needed.
      await cleanupWorkspace(jobId).catch(() => undefined);

      void this.pump();
    }
  }

  cancel(jobId: string): boolean {
    const running = this.running.get(jobId);
    if (!running) return false;
    running.controller.abort();
    return true;
  }

  isRunning(jobId: string): boolean {
    return this.running.has(jobId);
  }

  stats() {
    return {
      running: this.running.size,
      capacity: config.maxConcurrentJobs,
      jobs: [...this.running.values()].map((j) => ({
        jobId: j.jobId,
        runningMs: Date.now() - j.startedAt,
      })),
    };
  }
}

const globalForQueue = globalThis as unknown as { reviveQueue?: JobQueue };

export const queue = globalForQueue.reviveQueue ?? new JobQueue();
if (process.env.NODE_ENV !== 'production') globalForQueue.reviveQueue = queue;

/** Idempotent startup — safe to call from any route handler. */
let startPromise: Promise<void> | null = null;
export function ensureQueueStarted(): Promise<void> {
  startPromise ??= queue.start().catch((err) => {
    console.error('[revive] queue failed to start:', err);
    startPromise = null;
  });
  return startPromise;
}
