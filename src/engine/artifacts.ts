import path from 'node:path';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import archiver from 'archiver';
import { config } from './config';
import { IGNORED_DIRS } from './fsutil';

/**
 * Downloadable artifacts: the repaired repository as a ZIP, the changes as a
 * .patch, and REVIVAL_REPORT.md.
 *
 * The ZIP deliberately excludes installed dependency trees — shipping a
 * node_modules or target directory would produce a multi-hundred-megabyte
 * download of machine-specific binaries that the recipient would delete anyway.
 */

export interface WriteArtifactsInput {
  jobId: string;
  repoDir: string;
  patch: string;
  report: string;
  repoName: string;
}

export interface ArtifactPaths {
  patchPath: string;
  zipPath: string;
  reportPath: string;
}

/** Directories excluded from the ZIP — build output and dependency trees. */
const ZIP_EXCLUDE = new Set([
  ...IGNORED_DIRS,
  'node_modules',
  '.venv',
  'venv',
  'target',
  'build',
  'dist',
  '.gradle',
  '.next',
  '__pycache__',
]);

export async function writeArtifacts(input: WriteArtifactsInput): Promise<ArtifactPaths> {
  const dir = path.join(config.artifactRoot, input.jobId);
  await fs.mkdir(dir, { recursive: true });

  const safeName = sanitizeFilename(input.repoName) || 'repository';

  // The report ships both as a standalone download and inside the ZIP.
  const reportPath = path.join(dir, 'REVIVAL_REPORT.md');
  await fs.writeFile(reportPath, input.report, 'utf8');
  await fs.writeFile(path.join(input.repoDir, 'REVIVAL_REPORT.md'), input.report, 'utf8');

  const patchPath = path.join(dir, `${safeName}-revive.patch`);
  await fs.writeFile(
    patchPath,
    input.patch.trim()
      ? input.patch
      : '# Revive made no changes to this repository.\n',
    'utf8',
  );

  const zipPath = path.join(dir, `${safeName}-revived.zip`);
  await createZip(input.repoDir, zipPath, safeName);

  return { patchPath, zipPath, reportPath };
}

export async function createZip(
  sourceDir: string,
  destPath: string,
  rootName: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(destPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
    };

    output.on('close', () => finish());
    output.on('error', finish);
    archive.on('error', finish);
    // A warning about a vanished file must not abort the whole archive.
    archive.on('warning', (err) => {
      if (err.code !== 'ENOENT') finish(err);
    });

    archive.pipe(output);

    archive.glob('**/*', {
      cwd: sourceDir,
      dot: true,
      // Never ship dependency trees, build output, or the internal git history
      // Revive created for diffing.
      ignore: [
        '.git/**',
        ...[...ZIP_EXCLUDE].flatMap((dirName) => [`${dirName}/**`, `**/${dirName}/**`]),
      ],
      // Symlinks in an untrusted repo must not be followed out of the tree.
      follow: false,
    }, { prefix: rootName });

    void archive.finalize();
  });
}

/** Strip anything that could produce a path or a header injection. */
export function sanitizeFilename(name: string): string {
  return name
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/^[-.]+/, '')
    .slice(0, 80);
}

/** Resolve an artifact path, refusing anything outside the artifact root. */
export function resolveArtifact(jobId: string, filename: string): string {
  const root = path.resolve(config.artifactRoot, jobId);
  const resolved = path.resolve(root, filename);
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Artifact path escapes the artifact directory');
  }
  return resolved;
}

/** Remove a job's workspace but keep its artifacts for later download. */
export async function cleanupWorkspace(jobId: string): Promise<void> {
  const dir = path.join(config.workspaceRoot, jobId);
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
}
