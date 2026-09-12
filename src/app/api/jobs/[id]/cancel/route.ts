import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { ok, fail, notFound, withErrorHandling } from '@/lib/api';
import { parseJobId } from '@/lib/validation';
import { queue } from '@/server/queue';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/jobs/:id/cancel
 *
 * Cancellation is cooperative and persisted: the flag is written first so a
 * job that is between steps stops at its next checkpoint even if the in-memory
 * abort is missed, and the running process tree is killed immediately.
 */
export const POST = withErrorHandling(
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

    if (['succeeded', 'partial', 'failed', 'cancelled'].includes(job.status)) {
      return fail('That job has already finished.', 'ALREADY_FINISHED', 409);
    }

    await prisma.job.update({ where: { id: jobId }, data: { cancelRequested: true } });
    const wasRunning = queue.cancel(jobId);

    // A queued job never starts, so it can be marked cancelled immediately.
    if (!wasRunning) {
      await prisma.job.updateMany({
        where: { id: jobId, status: 'queued' },
        data: {
          status: 'cancelled',
          phase: 'cancelled',
          summary: 'Cancelled before it started.',
          finishedAt: new Date(),
        },
      });
    }

    return ok({ cancelled: true, wasRunning });
  },
);
