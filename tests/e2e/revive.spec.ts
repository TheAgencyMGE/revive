import { test, expect } from '@playwright/test';

/**
 * The judge's path: open the homepage, run the offline demo, watch it revive,
 * inspect the diff, and download the artifacts.
 */

test('homepage explains the product and lists demos', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Paste an abandoned repo');
  await expect(page.getByLabel('Public GitHub repository URL')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Revive the tiny-metrics demo' })).toBeEnabled();
});

test('rejects a non-GitHub URL with a clear message', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Public GitHub repository URL').fill('https://gitlab.com/a/b');
  await page.getByRole('button', { name: /revive it/i }).click();
  // Target our own error element: Next's dev server injects a separate hidden
  // role="alert" route announcer, which makes a bare role query ambiguous.
  const error = page.locator('#repo-error');
  await expect(error).toHaveAttribute('role', 'alert');
  await expect(error).toContainText('public GitHub repository');
  await expect(page).toHaveURL('/');
});

test('revives the offline demo end to end', async ({ page, request }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Revive the tiny-metrics demo' }).click();

  await expect(page).toHaveURL(/\/jobs\/[a-z0-9]+$/);
  const jobId = page.url().split('/').pop()!;

  // The verdict appears only once the pipeline has genuinely finished.
  await expect(page.getByText(/^Revived\./)).toBeVisible();

  // Findings: the archaeology and the diagnosis.
  await expect(page.getByText('node 10.16.3').first()).toBeVisible();
  await expect(
    page.getByText('Package is declared as ESM but the source is still CommonJS').first(),
  ).toBeVisible();

  // Changes: only package.json, with the removed declaration in the diff.
  await page.getByRole('tab', { name: 'Changes' }).click();
  await expect(page.getByText('package.json').first()).toBeVisible();
  await expect(page.getByText('"type": "module",').first()).toBeVisible();

  // Artifacts actually download.
  for (const kind of ['zip', 'patch', 'report']) {
    const res = await request.get(`/api/jobs/${jobId}/download/${kind}`);
    expect(res.status()).toBe(200);
    expect((await res.body()).length).toBeGreaterThan(20);
  }

  // And the run is in history.
  await page.goto('/jobs');
  await expect(page.getByText('local/tiny-metrics').first()).toBeVisible();
});

test('health endpoint reports sandbox and fixtures', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.database.ok).toBe(true);
  expect(['docker', 'restricted', 'analysis-only']).toContain(body.sandbox.mode);
  expect(body.fixtures.built).toBeGreaterThan(0);
});
