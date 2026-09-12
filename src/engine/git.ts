import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import { config } from './config';
import { sanitizeOutput } from './safety';
import { killProcessTree } from './sandbox/local';
import type { ChangedFile } from './types';

/**
 * Git operations.
 *
 * Git is always invoked with an argv array (never a shell string), so a
 * repository URL or branch name can never be interpreted as a command. Clones
 * run with credential prompting disabled and all local config ignored, so a
 * hostile repo cannot reach host credentials or execute config-driven hooks.
 */

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/** Environment that prevents git from prompting for or leaking credentials. */
function gitEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    SYSTEMROOT: process.env.SYSTEMROOT,
    ComSpec: process.env.ComSpec,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    // Never prompt, never reuse host credential helpers.
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: 'echo',
    GCM_INTERACTIVE: 'never',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: config.isWindows ? 'NUL' : '/dev/null',
    // Deterministic identity for commits Revive creates itself.
    GIT_AUTHOR_NAME: 'Revive',
    GIT_AUTHOR_EMAIL: 'revive@localhost',
    GIT_COMMITTER_NAME: 'Revive',
    GIT_COMMITTER_EMAIL: 'revive@localhost',
    LC_ALL: 'C',
  } as unknown as NodeJS.ProcessEnv;
}

export async function git(
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<GitResult> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  return new Promise((resolve) => {
    const child = spawn('git', args, {
      cwd: opts.cwd,
      env: gitEnv(),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let bytes = 0;
    const cap = 8_000_000;

    child.stdout?.on('data', (c: Buffer) => {
      bytes += c.length;
      if (bytes < cap) stdout += c.toString('utf8');
    });
    child.stderr?.on('data', (c: Buffer) => {
      if (stderr.length < 200_000) stderr += c.toString('utf8');
    });

    const timer = setTimeout(() => {
      killProcessTree(child.pid);
      stderr += `\n[revive] git timed out after ${Math.round(timeoutMs / 1000)}s\n`;
    }, timeoutMs);

    const onAbort = () => killProcessTree(child.pid);
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    child.on('error', (err) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve({ ok: false, stdout, stderr: `${stderr}\n${err.message}`, exitCode: 127 });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve({
        ok: code === 0,
        stdout: sanitizeOutput(stdout),
        stderr: sanitizeOutput(stderr),
        exitCode: code,
      });
    });
  });
}

export interface CloneOptions {
  url: string;
  dest: string;
  ref?: string;
  /** Shallow by default: far faster, and we only need history for metadata. */
  depth?: number;
  signal?: AbortSignal;
  onProgress?: (line: string) => void;
}

export async function cloneRepository(opts: CloneOptions): Promise<GitResult> {
  const args = [
    '-c',
    'core.symlinks=false', // symlinks in a hostile repo must not materialise
    '-c',
    'core.longpaths=true',
    '-c',
    'protocol.ext.allow=never', // blocks ext:: remote command execution
    '-c',
    'protocol.file.allow=always',
    'clone',
    '--no-hardlinks',
    '--progress',
  ];

  // Fixtures are local paths and need full history for accurate metadata.
  const isLocal = !/^https?:\/\//i.test(opts.url);
  if (!isLocal) {
    args.push('--depth', String(opts.depth ?? 50));
  }
  if (opts.ref) {
    args.push('--branch', opts.ref);
  }
  args.push('--', opts.url, opts.dest);

  return git(args, { timeoutMs: config.cloneTimeoutMs, signal: opts.signal });
}

export async function getHeadSha(repoDir: string): Promise<string> {
  const res = await git(['rev-parse', 'HEAD'], { cwd: repoDir });
  return res.stdout.trim();
}

export async function getDefaultBranch(repoDir: string): Promise<string> {
  const res = await git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoDir });
  const branch = res.stdout.trim();
  return branch && branch !== 'HEAD' ? branch : 'main';
}

export async function getLastCommitDate(repoDir: string): Promise<string | null> {
  const res = await git(['log', '-1', '--format=%cI'], { cwd: repoDir });
  const value = res.stdout.trim();
  return value || null;
}

export async function getCommitCount(repoDir: string): Promise<number> {
  const res = await git(['rev-list', '--count', 'HEAD'], { cwd: repoDir });
  return Number.parseInt(res.stdout.trim(), 10) || 0;
}

/**
 * Snapshot the pristine clone as a git commit so every later change is
 * diffable and any failed attempt can be rolled back precisely.
 */
export async function initBaselineSnapshot(repoDir: string): Promise<void> {
  // Remove the upstream history so diffs show only what Revive changed and no
  // upstream remote/hook configuration survives into the work tree.
  await fs.rm(path.join(repoDir, '.git'), { recursive: true, force: true });

  await git(['init', '-q'], { cwd: repoDir });
  await git(['config', 'user.name', 'Revive'], { cwd: repoDir });
  await git(['config', 'user.email', 'revive@localhost'], { cwd: repoDir });
  await git(['config', 'core.autocrlf', 'false'], { cwd: repoDir });
  await git(['config', 'core.safecrlf', 'false'], { cwd: repoDir });
  // Never run repository-supplied hooks.
  await git(['config', 'core.hooksPath', config.isWindows ? 'NUL' : '/dev/null'], { cwd: repoDir });

  await writeEngineIgnore(repoDir);
  await git(['add', '-A'], { cwd: repoDir, timeoutMs: 120_000 });
  await git(
    ['commit', '-q', '--no-verify', '--allow-empty', '-m', 'revive: pristine baseline'],
    { cwd: repoDir, timeoutMs: 120_000 },
  );
}

/**
 * Keep dependency trees and build output out of the diff. Written as
 * `.git/info/exclude` so the repository's own .gitignore is left untouched —
 * Revive must not show a .gitignore edit it did not intend to make.
 */
async function writeEngineIgnore(repoDir: string): Promise<void> {
  const excludePath = path.join(repoDir, '.git', 'info', 'exclude');
  const patterns = [
    'node_modules/',
    '.venv/',
    'venv/',
    '__pycache__/',
    '*.pyc',
    'target/',
    '.gradle/',
    'build/',
    'dist/',
    '.next/',
    '.sandbox-home/',
    '.sandbox-tmp/',
    '*.log',
    '.revive-baseline/',
  ];
  await fs.mkdir(path.dirname(excludePath), { recursive: true });
  await fs.writeFile(excludePath, `${patterns.join('\n')}\n`, 'utf8');
}

/** Commit the current working tree state as one attempt checkpoint. */
export async function commitAttempt(repoDir: string, message: string): Promise<boolean> {
  await git(['add', '-A'], { cwd: repoDir, timeoutMs: 120_000 });
  const status = await git(['status', '--porcelain'], { cwd: repoDir });
  const res = await git(['commit', '-q', '--no-verify', '--allow-empty', '-m', message], {
    cwd: repoDir,
    timeoutMs: 120_000,
  });
  return res.ok && status.stdout.trim().length > 0;
}

/**
 * Revert every change since `baseline` that is not in `allowed`.
 *
 * Running a project's own install and build commands has side effects — npm
 * writes a package-lock.json, cargo writes Cargo.lock, formatters touch files.
 * Those are consequences of verification, not repairs, and shipping them in the
 * patch would misrepresent what Revive changed. Returns the discarded paths.
 */
export async function revertUnattributedChanges(
  repoDir: string,
  baseline: string,
  allowed: Set<string>,
): Promise<string[]> {
  await git(['add', '-A'], { cwd: repoDir, timeoutMs: 120_000 });
  const res = await git(['diff', '--cached', '--name-status', '--no-renames', baseline], {
    cwd: repoDir,
    timeoutMs: 120_000,
  });

  const discarded: string[] = [];
  for (const line of res.stdout.split('\n')) {
    const [code, file] = line.trim().split('\t');
    if (!code || !file || allowed.has(file)) continue;
    if (code.startsWith('A')) {
      // New file that did not exist in the pristine clone.
      await git(['rm', '-q', '-f', '--', file], { cwd: repoDir });
    } else {
      // Modified or deleted: restore the pristine version.
      await git(['checkout', baseline, '--', file], { cwd: repoDir });
    }
    discarded.push(file);
  }
  return discarded;
}

/** Discard every change since the given commit — the rollback primitive. */
export async function rollbackTo(repoDir: string, ref: string): Promise<void> {
  await git(['reset', '--hard', ref], { cwd: repoDir, timeoutMs: 120_000 });
  // Remove new untracked files too, but never touch ignored dependency trees
  // (re-installing node_modules for every rollback would be ruinously slow).
  await git(['clean', '-fdq'], { cwd: repoDir, timeoutMs: 120_000 });
}

export async function currentCommit(repoDir: string): Promise<string> {
  const res = await git(['rev-parse', 'HEAD'], { cwd: repoDir });
  return res.stdout.trim();
}

/** Unified diff between two commits — powers the diff viewer and the .patch file. */
export async function diffText(repoDir: string, from: string, to = 'HEAD'): Promise<string> {
  const res = await git(
    ['diff', '--no-color', '--no-ext-diff', '--unified=3', '--find-renames', from, to],
    { cwd: repoDir, timeoutMs: 120_000 },
  );
  return res.stdout;
}

/** Patch file suitable for `git apply`. */
export async function formatPatch(repoDir: string, from: string, to = 'HEAD'): Promise<string> {
  const res = await git(
    ['diff', '--no-color', '--no-ext-diff', '--binary', '--find-renames', from, to],
    { cwd: repoDir, timeoutMs: 120_000 },
  );
  return res.stdout;
}

export async function changedFiles(
  repoDir: string,
  from: string,
  to = 'HEAD',
): Promise<ChangedFile[]> {
  const nameStatus = await git(['diff', '--name-status', '--find-renames', from, to], {
    cwd: repoDir,
    timeoutMs: 120_000,
  });
  const numStat = await git(['diff', '--numstat', '--find-renames', from, to], {
    cwd: repoDir,
    timeoutMs: 120_000,
  });

  const counts = new Map<string, { additions: number; deletions: number }>();
  for (const line of numStat.stdout.split('\n')) {
    const parts = line.trim().split('\t');
    if (parts.length < 3) continue;
    const [add, del, ...rest] = parts;
    const file = rest[rest.length - 1];
    counts.set(file, {
      additions: add === '-' ? 0 : Number.parseInt(add, 10) || 0,
      deletions: del === '-' ? 0 : Number.parseInt(del, 10) || 0,
    });
  }

  const result: ChangedFile[] = [];
  for (const line of nameStatus.stdout.split('\n')) {
    const parts = line.trim().split('\t');
    if (parts.length < 2) continue;
    const code = parts[0];
    const file = parts[parts.length - 1];
    const status: ChangedFile['status'] =
      code.startsWith('A')
        ? 'added'
        : code.startsWith('D')
          ? 'deleted'
          : code.startsWith('R')
            ? 'renamed'
            : 'modified';
    const count = counts.get(file) ?? { additions: 0, deletions: 0 };
    result.push({ path: file, status, ...count });
  }
  return result.sort((a, b) => a.path.localeCompare(b.path));
}

/** Detect the primary language mix from tracked file extensions. */
export async function languageBreakdown(
  repoDir: string,
): Promise<{ name: string; files: number }[]> {
  const res = await git(['ls-files'], { cwd: repoDir, timeoutMs: 60_000 });
  const counts = new Map<string, number>();
  const extMap: Record<string, string> = {
    '.js': 'JavaScript',
    '.jsx': 'JavaScript',
    '.mjs': 'JavaScript',
    '.cjs': 'JavaScript',
    '.ts': 'TypeScript',
    '.tsx': 'TypeScript',
    '.py': 'Python',
    '.java': 'Java',
    '.kt': 'Kotlin',
    '.go': 'Go',
    '.rs': 'Rust',
    '.rb': 'Ruby',
    '.php': 'PHP',
    '.cs': 'C#',
    '.c': 'C',
    '.h': 'C',
    '.cpp': 'C++',
    '.scss': 'SCSS',
    '.css': 'CSS',
    '.html': 'HTML',
    '.vue': 'Vue',
    '.svelte': 'Svelte',
  };
  for (const file of res.stdout.split('\n')) {
    const ext = path.extname(file.trim()).toLowerCase();
    const name = extMap[ext];
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, files]) => ({ name, files }))
    .sort((a, b) => b.files - a.files)
    .slice(0, 6);
}
