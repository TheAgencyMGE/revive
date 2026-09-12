import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { ok, fail, withErrorHandling } from '@/lib/api';
import { clientKey, rateLimit } from '@/lib/ratelimit';
import { createJobSchema, parseRepoUrl, RepoUrlError } from '@/lib/validation';
import { getFixture, fixtureUrl } from '@/lib/fixtures';
import { listJobs } from '@/server/store';
import { ensureQueueStarted, queue } from '@/server/queue';
import { config } from '@/engine/config';
import { looksLikeValidKey } from '@/engine/ai/provider';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET /api/jobs — job history. */
export const GET = withErrorHandling(async (request: NextRequest) => {
  await ensureQueueStarted();
  const limitParam = request.nextUrl.searchParams.get('limit');
  const limit = Math.min(Math.max(Number.parseInt(limitParam ?? '50', 10) || 50, 1), 200);
  const jobs = await listJobs(limit);
  return ok({ jobs, queue: queue.stats() });
});

/** POST /api/jobs — start a revival. */
export const POST = withErrorHandling(async (request: NextRequest) => {
  await ensureQueueStarted();

  const limited = rateLimit(clientKey(request));
  if (!limited.allowed) {
    return fail(
      `Too many revivals started. Try again in ${Math.ceil(limited.resetMs / 1000)}s.`,
      'RATE_LIMITED',
      429,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail('Request body must be JSON.', 'BAD_JSON');
  }

  const parsed = createJobSchema.safeParse(body);
  if (!parsed.success) {
    return fail(
      parsed.error.issues[0]?.message ?? 'Invalid request.',
      'VALIDATION_FAILED',
      400,
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }

  const { repoUrl, fixtureId, ai } = parsed.data;

  // The AI key never touches the database or the filesystem — it is held in
  // memory by the queue for the lifetime of this run only.
  if (ai && !looksLikeValidKey(ai.provider, ai.apiKey)) {
    return fail(
      `That does not look like a valid ${ai.provider} API key.`,
      'INVALID_API_KEY',
      400,
    );
  }

  let job;

  if (fixtureId) {
    const fixture = await getFixture(fixtureId);
    if (!fixture) return fail(`Unknown demo repository "${fixtureId}".`, 'FIXTURE_NOT_FOUND', 404);
    if (!fixture.built) {
      return fail(
        'The demo repositories have not been built yet. Run `npm run fixtures:build`.',
        'FIXTURE_NOT_BUILT',
        503,
      );
    }
    job = await prisma.job.create({
      data: {
        repoUrl: fixtureUrl(fixture),
        source: 'fixture',
        fixtureId: fixture.id,
        maxAttempts: config.maxAttempts,
      },
    });
  } else {
    let repo;
    try {
      repo = parseRepoUrl(repoUrl!);
    } catch (err) {
      if (err instanceof RepoUrlError) return fail(err.message, err.code, 400);
      throw err;
    }
    job = await prisma.job.create({
      data: {
        repoUrl: repo.webUrl,
        source: 'github',
        ref: repo.ref,
        maxAttempts: config.maxAttempts,
      },
    });
  }

  await queue.enqueue(job.id, ai);

  return ok({ id: job.id, status: job.status }, { status: 201 });
});
