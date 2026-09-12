import { prisma } from '@/lib/db';
import { ok, withErrorHandling } from '@/lib/api';
import { describeSandbox } from '@/engine/sandbox';
import { ensureQueueStarted, queue } from '@/server/queue';
import { listFixtures } from '@/lib/fixtures';
import { config } from '@/engine/config';
import { probeTool } from '@/engine/toolchain';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/health
 *
 * Reports what this installation can actually do: which sandbox is in use,
 * which toolchains are present, whether the demo fixtures are built. The UI
 * uses it to tell the user up front which languages it can execute, rather
 * than letting them discover it after a failed run.
 */
export const GET = withErrorHandling(async () => {
  await ensureQueueStarted();

  const started = Date.now();

  const [dbOk, sandbox, fixtures, node, python, java, go, cargo, npm] = await Promise.all([
    prisma.job
      .count()
      .then(() => true)
      .catch(() => false),
    describeSandbox(),
    listFixtures(true).catch(() => []),
    probeTool('node'),
    probeTool('python', ['--version']),
    probeTool('java', ['-version']),
    probeTool('go', ['version']),
    probeTool('cargo'),
    probeTool('npm'),
  ]);

  const toolchains = {
    node: { available: node.available, version: node.version },
    npm: { available: npm.available, version: npm.version },
    python: { available: python.available, version: python.version },
    java: { available: java.available, version: java.version },
    go: { available: go.available, version: go.version },
    rust: { available: cargo.available, version: cargo.version },
  };

  const healthy = dbOk;

  return ok(
    {
      status: healthy ? 'ok' : 'degraded',
      version: '1.0.0',
      uptimeSeconds: Math.round(process.uptime()),
      checkDurationMs: Date.now() - started,
      database: { ok: dbOk, provider: 'sqlite' },
      sandbox,
      toolchains,
      queue: queue.stats(),
      fixtures: {
        total: fixtures.length,
        built: fixtures.filter((f) => f.built).length,
        offline: fixtures.filter((f) => !f.requiresNetwork && f.built).length,
      },
      limits: {
        maxRepoMB: Math.round(config.maxRepoBytes / 1024 / 1024),
        stepTimeoutMs: config.stepTimeoutMs,
        jobTimeoutMs: config.jobTimeoutMs,
        maxAttempts: config.maxAttempts,
        maxConcurrentJobs: config.maxConcurrentJobs,
      },
      ai: {
        // Reports only whether a key is configured — never the key itself.
        serverConfigured: Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY),
        required: false,
      },
    },
    { status: healthy ? 200 : 503 },
  );
});
