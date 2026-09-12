import { ok, withErrorHandling } from '@/lib/api';
import { listFixtures } from '@/lib/fixtures';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET /api/fixtures — the demo repositories available for one-click runs. */
export const GET = withErrorHandling(async () => {
  const fixtures = await listFixtures(true);
  return ok({
    fixtures: fixtures.map((f) => ({
      id: f.id,
      name: f.name,
      title: f.title,
      language: f.language,
      blurb: f.blurb,
      expectedFailure: f.expectedFailure,
      expectedRepair: f.expectedRepair,
      requiresNetwork: f.requiresNetwork,
      lastCommit: f.lastCommit,
      built: f.built,
    })),
  });
});
