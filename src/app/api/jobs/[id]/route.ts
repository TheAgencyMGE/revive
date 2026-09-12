import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { ok, fail, notFound, withErrorHandling } from '@/lib/api';
import { parseJobId } from '@/lib/validation';
import { getJobAttempts, getJobLogs, getJobView } from '@/server/store';
import { queue } from '@/server/queue';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET /api/jobs/:id — full job state, optionally with logs and attempts. */
export const GET = withErrorHandling(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params;

    let jobId: string;
    try {
      jobId = parseJobId(id);
    } catch {
      return fail('Invalid job id.', 'BAD_JOB_ID', 400);
    }

    const job = await getJobView(jobId);
    if (!job) return notFound('Job');

    const params = request.nextUrl.searchParams;
    const includeLogs = params.get('logs') !== 'false';
    const afterSeq = Number.parseInt(params.get('afterSeq') ?? '-1', 10);

    const [logs, attempts] = await Promise.all([
      includeLogs ? getJobLogs(jobId, Number.isFinite(afterSeq) ? afterSeq : -1) : [],
      getJobAttempts(jobId),
    ]);

    return ok({
      job,
      logs: logs.map((l) => ({ ...l, ts: l.ts.toISOString() })),
      attempts,
      isRunning: queue.isRunning(jobId),
    });
  },
);

/** DELETE /api/jobs/:id — remove a job and its artifacts from history. */
export const DELETE = withErrorHandling(
  async (_request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params;

    let jobId: string;
    try {
      jobId = parseJobId(id);
    } catch {
      return fail('Invalid job id.', 'BAD_JOB_ID', 400);
    }

    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) return notFound('Job');

    // Stop it first so nothing keeps writing after the row is gone.
    if (queue.isRunning(jobId)) {
      await prisma.job.update({ where: { id: jobId }, data: { cancelRequested: true } });
      queue.cancel(jobId);
    }

    // Cascades to logs and attempts via the schema.
    await prisma.job.delete({ where: { id: jobId } });

    const { cleanupArtifacts } = await import('@/server/cleanup');
    await cleanupArtifacts(jobId);

    return ok({ deleted: true });
  },
);
