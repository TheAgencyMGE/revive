import path from 'node:path';
import fs from 'node:fs/promises';
import { pathExists, readJson } from '@/engine/fsutil';

/**
 * Demo fixture registry.
 *
 * Fixtures are real git repositories built from `fixtures/<id>/files` by
 * `npm run fixtures:build`. They are cloned and repaired through the exact same
 * pipeline as an external GitHub URL — there is no special-casing anywhere in
 * the engine — which is what makes them an honest demonstration rather than a
 * scripted one.
 */

export interface FixtureManifest {
  id: string;
  name: string;
  title: string;
  language: string;
  blurb: string;
  expectedFailure: string;
  expectedRepair: string;
  requiresNetwork: boolean;
  lastCommit: string;
}

export interface Fixture extends FixtureManifest {
  /** Path to the built git repository, or null if it has not been built. */
  repoPath: string;
  built: boolean;
}

const FIXTURE_DIR = path.resolve(process.cwd(), 'fixtures');
const BUILT_DIR = path.join(FIXTURE_DIR, '.built');

let cache: Fixture[] | null = null;

export async function listFixtures(force = false): Promise<Fixture[]> {
  if (cache && !force) return cache;

  const fixtures: Fixture[] = [];

  let entries: string[] = [];
  try {
    entries = await fs.readdir(FIXTURE_DIR);
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    const manifestPath = path.join(FIXTURE_DIR, entry, 'fixture.json');
    const manifest = await readJson<FixtureManifest>(manifestPath);
    if (!manifest?.id) continue;

    // Fixture ids come from disk, but they reach a filesystem path, so they
    // are validated to the same pattern the API accepts.
    if (!/^[a-z0-9-]{1,64}$/.test(manifest.id)) continue;

    const repoPath = path.join(BUILT_DIR, manifest.id);
    fixtures.push({
      ...manifest,
      repoPath,
      built: await pathExists(path.join(repoPath, 'HEAD')),
    });
  }

  fixtures.sort((a, b) => {
    // Offline fixtures first — they are the reliable demo path.
    if (a.requiresNetwork !== b.requiresNetwork) return a.requiresNetwork ? 1 : -1;
    return a.title.localeCompare(b.title);
  });

  cache = fixtures;
  return fixtures;
}

export async function getFixture(id: string): Promise<Fixture | null> {
  if (!/^[a-z0-9-]{1,64}$/.test(id)) return null;
  const fixtures = await listFixtures(true);
  return fixtures.find((f) => f.id === id) ?? null;
}

/** Display URL for a fixture — clearly marked as local, never a real GitHub link. */
export function fixtureUrl(fixture: FixtureManifest): string {
  return `fixture://revive/${fixture.id}/${fixture.name}`;
}

export function clearFixtureCache(): void {
  cache = null;
}
