import fs from 'node:fs/promises';
import path from 'node:path';

/** Directories never worth walking when sizing or hashing a repository. */
export const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  '.venv',
  'venv',
  '__pycache__',
  '.mypy_cache',
  '.pytest_cache',
  'target',
  'build',
  'dist',
  '.next',
  '.gradle',
  '.idea',
  '.vscode',
  'vendor',
  '.sandbox-home',
  '.sandbox-tmp',
  '.revive-baseline',
]);

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function readFileSafe(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, 'utf8');
  } catch {
    return null;
  }
}

export async function readJson<T = unknown>(p: string): Promise<T | null> {
  const text = await readFileSafe(p);
  if (text === null) return null;
  try {
    return JSON.parse(stripBom(text)) as T;
  } catch {
    return null;
  }
}

export async function writeJson(p: string, value: unknown): Promise<void> {
  await fs.writeFile(p, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Compute the on-disk size of a directory, bailing out early once `limit` is
 * exceeded. Early exit is what makes this safe to call on a hostile repo.
 */
export async function directorySize(dir: string, limit = Number.POSITIVE_INFINITY): Promise<number> {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue; // never follow symlinks
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        try {
          const stat = await fs.stat(full);
          total += stat.size;
          if (total > limit) return total;
        } catch {
          /* vanished mid-walk */
        }
      }
    }
  }
  return total;
}

export interface WalkResult {
  files: string[];
  truncated: boolean;
}

/**
 * List repository files (relative paths, POSIX separators), skipping build
 * output and refusing to follow symlinks. Capped to protect against repos with
 * pathological file counts.
 */
export async function walkRepo(
  root: string,
  opts: { maxFiles?: number; includeIgnored?: boolean } = {},
): Promise<WalkResult> {
  const maxFiles = opts.maxFiles ?? 60_000;
  const files: string[] = [];
  const stack = [root];
  let truncated = false;

  while (stack.length) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (files.length >= maxFiles) {
        truncated = true;
        return { files, truncated };
      }
      if (entry.isSymbolicLink()) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!opts.includeIgnored && IGNORED_DIRS.has(entry.name)) continue;
        stack.push(full);
      } else if (entry.isFile()) {
        files.push(path.relative(root, full).split(path.sep).join('/'));
      }
    }
  }
  return { files, truncated };
}

export async function countFiles(root: string, limit: number): Promise<number> {
  const { files } = await walkRepo(root, { maxFiles: limit + 1, includeIgnored: true });
  return files.length;
}

/** Recursive copy that never follows symlinks and skips heavy build output. */
export async function copyTree(
  src: string,
  dest: string,
  opts: { skip?: Set<string> } = {},
): Promise<void> {
  const skip = opts.skip ?? new Set(['node_modules', '.venv', 'venv', 'target', '.git']);
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (skip.has(entry.name)) continue;
    if (entry.isSymbolicLink()) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyTree(from, to, opts);
    } else if (entry.isFile()) {
      await fs.copyFile(from, to);
    }
  }
}

/** Remove a tree, tolerating Windows file locks with a short retry. */
export async function removeTree(target: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await fs.rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      return;
    } catch (err) {
      if (attempt === 2) {
        // Cleanup failure must never fail a job — log upstream and move on.
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to remove ${target}: ${message}`);
      }
      await new Promise((r) => setTimeout(r, 400));
    }
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}
