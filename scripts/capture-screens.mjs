#!/usr/bin/env node
/**
 * Capture product screenshots from a running Revive instance.
 *
 * Used for the README and as source material for the Remotion demo video, so
 * both show the real interface on real runs rather than mockups.
 *
 *   npm run dev            # in another terminal
 *   node scripts/capture-screens.mjs
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.REVIVE_URL ?? 'http://localhost:3000';
const outDirs = [path.join(root, 'docs', 'media'), path.join(root, 'video', 'public', 'screens')];
for (const dir of outDirs) fs.mkdirSync(dir, { recursive: true });

async function latestJob(fixtureId) {
  const res = await fetch(`${base}/api/jobs?limit=200`);
  const { jobs } = await res.json();
  return jobs.find((j) => j.fixtureId === fixtureId && j.status === 'succeeded') ?? null;
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
});
// Hide the Next.js development indicator so captures show only the product.
await context.addInitScript(() => {
  const style = document.createElement('style');
  style.textContent = 'nextjs-portal, [data-nextjs-toast], #__next-build-watcher { display: none !important; }';
  document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style));
});
const page = await context.newPage();

async function shot(name, { fullPage = false, clip } = {}) {
  // Let entrance animations settle so captures are stable.
  await page.waitForTimeout(700);
  for (const dir of outDirs) {
    await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage, clip });
  }
  console.log(`captured ${name}`);
}

// Home
await page.goto(base, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Revive the tiny-metrics demo' }).waitFor();
await shot('home');
await page.getByText('Demo shelf').scrollIntoViewIfNeeded();
await page.evaluate(() => window.scrollBy(0, -60));
await shot('demo-shelf');

// Job pages
const featured = [
  ['node-half-migration', 'tiny-metrics'],
  ['node-webpack4-openssl', 'webpack'],
  ['python2-legacy', 'python'],
  ['java-target-mismatch', 'java'],
];

for (const [fixture, slug] of featured) {
  const job = await latestJob(fixture);
  if (!job) {
    console.warn(`no succeeded run for ${fixture}; skipping`);
    continue;
  }
  await page.goto(`${base}/jobs/${job.id}`, { waitUntil: 'networkidle' });
  await page.getByText('Take it with you').waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(`${slug}-findings`);

  await page.getByRole('tab', { name: 'Output' }).click();
  await page.getByRole('log').waitFor();
  await page.waitForTimeout(500);
  await shot(`${slug}-output`);

  await page.getByRole('tab', { name: 'Changes' }).click();
  await page.waitForTimeout(1200);
  await shot(`${slug}-changes`);
}

// History
await page.goto(`${base}/jobs`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await shot('history');

await browser.close();
