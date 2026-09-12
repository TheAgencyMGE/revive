import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { ok, fail, notFound, withErrorHandling } from '@/lib/api';
import { parseJobId } from '@/lib/validation';
import { clientKey, rateLimit } from '@/lib/ratelimit';
import { ensureQueueStarted, queue } from '@/server/queue';
import { config } from '@/engine/config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/jobs/:id/retry
 *
 * Creates a NEW job rather than resetting the old one. The original run stays
 * in history with its logs and report intact, which matters when comparing why
 * a second attempt behaved differently — a retry after a registry outage, for
 * instance, should not erase the evidence of the outage.
 */
export const POST = withErrorHandling(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    await ensureQueueStarted();

    const limited = rateLimit(clientKey(request));
    if (!limited.allowed) {
      return fail(
        `Too many revivals started. Try again in ${Math.ceil(limited.resetMs / 1000)}s.`,
        'RATE_LIMITED',
        429,
      );
    }

    const { id } = await context.params;

    let jobId: string;
    try {
      jobId = parseJobId(id);
    } catch {
      return fail('Invalid job id.', 'BAD_JOB_ID', 400);
    }

    const original = await prisma.job.findUnique({ where: { id: jobId } });
    if (!original) return notFound('Job');

    if (original.status === 'running' || original.status === 'queued') {
      return fail('That job is still running.', 'STILL_RUNNING', 409);
    }

    const retry = await prisma.job.create({
      data: {
        repoUrl: original.repoUrl,
        source: original.source,
        fixtureId: original.fixtureId,
        ref: original.ref,
        maxAttempts: config.maxAttempts,
        parentJobId: original.id,
      },
    });

    await queue.enqueue(retry.id);

    return ok({ id: retry.id, parentJobId: original.id }, { status: 201 });
  },
);
