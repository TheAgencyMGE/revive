import type { NextRequest } from 'next/server';
import { ok, fail, notFound, withErrorHandling } from '@/lib/api';
import { parseJobId } from '@/lib/validation';
import { getDiffText } from '@/server/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET /api/jobs/:id/diff — the unified diff powering the diff viewer. */
export const GET = withErrorHandling(
  async (_request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params;

    let jobId: string;
    try {
      jobId = parseJobId(id);
    } catch {
      return fail('Invalid job id.', 'BAD_JOB_ID', 400);
    }

    const diff = await getDiffText(jobId);
    if (diff === null) return notFound('Diff');

    return ok({ diff });
  },
);
