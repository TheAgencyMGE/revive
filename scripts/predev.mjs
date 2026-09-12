#!/usr/bin/env node
/**
 * Runs before `npm run dev` / `npm start` so a fresh clone needs no manual setup:
 *   1. write .env with the SQLite default if missing
 *   2. generate the Prisma client if missing
 *   3. create/sync the SQLite schema
 *   4. build demo fixtures if missing
 * Every step is idempotent and fast when already done.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });
const log = (msg) => console.log(`[revive] ${msg}`);

// Node version check — fail with a clear message rather than a cryptic crash.
const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  console.error(`[revive] Node 20 or newer is required (found ${process.versions.node}).`);
  process.exit(1);
}

const envPath = path.join(root, '.env');
if (!fs.existsSync(envPath)) {
  fs.writeFileSync(envPath, 'DATABASE_URL="file:./dev.db"\n');
  log('created .env with the local SQLite default');
}

const clientMarker = path.join(root, 'node_modules', '.prisma', 'client', 'index.js');
if (!fs.existsSync(clientMarker)) {
  log('generating Prisma client');
  run('npx prisma generate');
}

log('syncing database schema');
run('npx prisma db push --skip-generate');

const builtDir = path.join(root, 'fixtures', '.built');
const fixtureCount = fs
  .readdirSync(path.join(root, 'fixtures'), { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith('.')).length;
const builtCount = fs.existsSync(builtDir) ? fs.readdirSync(builtDir).length : 0;
if (builtCount < fixtureCount) {
  log('building demo repositories');
  run('node scripts/build-fixtures.mjs');
}

log('ready');
