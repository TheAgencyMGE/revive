import path from 'node:path';
import fs from 'node:fs/promises';
import { config } from '@/engine/config';
import { cleanupWorkspace } from '@/engine/artifacts';

/**
 * Disk housekeeping.
 *
 * Workspaces are removed as soon as a job finishes; artifacts outlive the job
 * so downloads keep working, and are only removed when the job itself is
 * deleted or when the retention sweep runs.
 */

export async function cleanupArtifacts(jobId: string): Promise<void> {
  if (!/^[a-z0-9]{1,40}$/i.test(jobId)) return;
  const dir = path.join(config.artifactRoot, jobId);
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }).catch(() => {
    // A locked file must never fail the request that triggered cleanup.
  });
  await cleanupWorkspace(jobId).catch(() => undefined);
}

/** Remove workspaces left behind by a crash. Called once at startup. */
export async function sweepOrphanedWorkspaces(activeJobIds: Set<string>): Promise<number> {
  let removed = 0;
  let entries: string[];
  try {
    entries = await fs.readdir(config.workspaceRoot);
  } catch {
    return 0;
  }

  for (const entry of entries) {
    if (activeJobIds.has(entry)) continue;
    await fs
      .rm(path.join(config.workspaceRoot, entry), { recursive: true, force: true })
      .then(() => {
        removed++;
      })
      .catch(() => undefined);
  }
  return removed;
}
