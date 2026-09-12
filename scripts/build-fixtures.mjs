#!/usr/bin/env node
/**
 * Build the demo fixtures into real bare git repositories.
 *
 * Each fixture becomes a genuine repo with a backdated commit, so when Revive
 * clones it the metadata (last commit date, age, commit count) reads exactly
 * like a real abandoned project. Fixtures then flow through the identical
 * clone -> analyze -> repair pipeline as any GitHub URL.
 *
 * Run: npm run fixtures:build
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const fixturesDir = path.join(root, 'fixtures');
const builtDir = path.join(fixturesDir, '.built');

function git(args, cwd, env = {}) {
  return execFileSync('git', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      SYSTEMROOT: process.env.SYSTEMROOT,
      ComSpec: process.env.ComSpec,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      HOME: process.env.HOME ?? os.homedir(),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
      GIT_TERMINAL_PROMPT: '0',
      ...env,
    },
  });
}

function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}

function buildFixture(id) {
  const fixtureDir = path.join(fixturesDir, id);
  const manifestPath = path.join(fixtureDir, 'fixture.json');
  const filesDir = path.join(fixtureDir, 'files');

  if (!fs.existsSync(manifestPath) || !fs.existsSync(filesDir)) return null;

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const target = path.join(builtDir, id);

  // Always rebuild so edits to fixture sources take effect.
  fs.rmSync(target, { recursive: true, force: true });

  // Stage the working tree in a temp dir, commit, then produce a bare repo
  // that Revive can clone from by path.
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), `revive-fixture-${id}-`));
  try {
    copyTree(filesDir, staging);

    git(['init', '-q', '-b', 'main'], staging);
    git(['config', 'user.name', 'Original Author'], staging);
    git(['config', 'user.email', 'author@example.com'], staging);
    git(['config', 'core.autocrlf', 'false'], staging);
    git(['add', '-A'], staging);

    // Backdate the commit so the project genuinely looks abandoned.
    const date = manifest.lastCommit ?? '2018-01-01T00:00:00Z';
    git(
      ['commit', '-q', '--no-verify', '-m', `${manifest.name}: ${manifest.title}`],
      staging,
      {
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_DATE: date,
        GIT_AUTHOR_NAME: 'Original Author',
        GIT_AUTHOR_EMAIL: 'author@example.com',
        GIT_COMMITTER_NAME: 'Original Author',
        GIT_COMMITTER_EMAIL: 'author@example.com',
      },
    );

    fs.mkdirSync(builtDir, { recursive: true });
    git(['clone', '--bare', '-q', staging, target], builtDir);

    return manifest;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function main() {
  if (!fs.existsSync(fixturesDir)) {
    console.error('No fixtures/ directory found.');
    process.exit(1);
  }

  const ids = fs
    .readdirSync(fixturesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name);

  const built = [];
  const failed = [];

  for (const id of ids) {
    try {
      const manifest = buildFixture(id);
      if (manifest) built.push(manifest);
    } catch (err) {
      failed.push({ id, error: err.message.split('\n')[0] });
    }
  }

  for (const manifest of built) {
    const tag = manifest.requiresNetwork ? 'network' : 'offline';
    console.log(`  built ${manifest.id.padEnd(24)} ${manifest.language.padEnd(7)} [${tag}]`);
  }
  for (const failure of failed) {
    console.error(`  FAILED ${failure.id}: ${failure.error}`);
  }

  console.log(`\n${built.length} fixture(s) built into fixtures/.built`);
  if (failed.length) process.exit(1);
}

main();
