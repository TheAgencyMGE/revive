import type { NextRequest } from 'next/server';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@/lib/db';
import { fail, notFound, withErrorHandling } from '@/lib/api';
import { parseJobId } from '@/lib/validation';
import { sanitizeFilename } from '@/engine/artifacts';
import { config } from '@/engine/config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/jobs/:id/download/:kind  where kind is zip | patch | report
 *
 * The stored path is validated against the artifact root before anything is
 * read, so even a corrupted database row cannot be used to serve a file from
 * elsewhere on disk.
 */
const KINDS = {
  zip: { column: 'zipPath', type: 'application/zip', ext: 'zip' },
  patch: { column: 'patchPath', type: 'text/x-patch; charset=utf-8', ext: 'patch' },
  report: { column: 'reportPath', type: 'text/markdown; charset=utf-8', ext: 'md' },
} as const;

type Kind = keyof typeof KINDS;

export const GET = withErrorHandling(
  async (_request: NextRequest, context: { params: Promise<{ id: string; kind: string }> }) => {
    const { id, kind } = await context.params;

    if (!(kind in KINDS)) {
      return fail('Unknown download type.', 'BAD_DOWNLOAD_KIND', 400);
    }
    const spec = KINDS[kind as Kind];

    let jobId: string;
    try {
      jobId = parseJobId(id);
    } catch {
      return fail('Invalid job id.', 'BAD_JOB_ID', 400);
    }

    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) return notFound('Job');

    const stored = job[spec.column as 'zipPath' | 'patchPath' | 'reportPath'];
    if (!stored) {
      return fail(
        'That artifact has not been generated. It is created when a revival finishes.',
        'ARTIFACT_NOT_READY',
        409,
      );
    }

    // Containment check: the resolved path must sit inside this job's artifact
    // directory. Never trust a stored path blindly.
    const root = path.resolve(config.artifactRoot, jobId);
    const resolved = path.resolve(stored);
    const relative = path.relative(root, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      console.error(`[revive] refusing out-of-root artifact for job ${jobId}: ${stored}`);
      return fail('Artifact path is invalid.', 'ARTIFACT_PATH_INVALID', 500);
    }

    let stat;
    try {
      stat = await fsp.stat(resolved);
    } catch {
      return fail(
        'That artifact is no longer on disk. Re-run the revival to regenerate it.',
        'ARTIFACT_MISSING',
        410,
      );
    }

    const repoName = sanitizeFilename(
      (() => {
        try {
          const parsed = JSON.parse(job.metadata ?? '{}') as { name?: string };
          return parsed.name ?? 'repository';
        } catch {
          return 'repository';
        }
      })(),
    );
    const filename =
      kind === 'report' ? 'REVIVAL_REPORT.md' : `${repoName || 'repository'}-revive.${spec.ext}`;

    const stream = fs.createReadStream(resolved);

    return new Response(stream as unknown as ReadableStream, {
      headers: {
        'content-type': spec.type,
        'content-length': String(stat.size),
        // The filename is sanitised above, so it cannot break out of the header.
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  },
);
