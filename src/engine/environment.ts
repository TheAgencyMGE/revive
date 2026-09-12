import path from 'node:path';
import semver from 'semver';
import { readFileSafe, readJson } from './fsutil';
import type {
  DetectionResult,
  EnvironmentEvidence,
  EnvironmentSpec,
  Language,
  RepoMetadata,
} from './types';

/**
 * Environment reconstruction — the archaeology step.
 *
 * The goal is NOT "what is the newest toolchain", it is "what did this project
 * run on when it last worked". Evidence is gathered from explicit declarations
 * first (.nvmrc, engines, rust-version), then from indirect fingerprints
 * (lockfile format version), and only as a last resort from the commit date.
 * Each source carries a weight, and the weights drive the confidence score the
 * UI reports.
 */

// ---------------------------------------------------------------------------
// Release timelines — used to date a project from its last commit.
// ---------------------------------------------------------------------------

interface Release {
  version: string;
  released: string; // ISO date the version became current
}

/** Node.js versions that were the common default at a given time. */
export const NODE_TIMELINE: Release[] = [
  { version: '0.10', released: '2013-03-11' },
  { version: '4', released: '2015-09-08' },
  { version: '6', released: '2016-04-26' },
  { version: '8', released: '2017-05-30' },
  { version: '10', released: '2018-04-24' },
  { version: '12', released: '2019-04-23' },
  { version: '14', released: '2020-04-21' },
  { version: '16', released: '2021-04-20' },
  { version: '18', released: '2022-04-19' },
  { version: '20', released: '2023-04-18' },
  { version: '22', released: '2024-04-24' },
];

export const PYTHON_TIMELINE: Release[] = [
  { version: '2.7', released: '2010-07-03' },
  { version: '3.4', released: '2014-03-16' },
  { version: '3.6', released: '2016-12-23' },
  { version: '3.7', released: '2018-06-27' },
  { version: '3.8', released: '2019-10-14' },
  { version: '3.9', released: '2020-10-05' },
  { version: '3.10', released: '2021-10-04' },
  { version: '3.11', released: '2022-10-24' },
  { version: '3.12', released: '2023-10-02' },
];

export const JAVA_TIMELINE: Release[] = [
  { version: '8', released: '2014-03-18' },
  { version: '11', released: '2018-09-25' },
  { version: '17', released: '2021-09-14' },
  { version: '21', released: '2023-09-19' },
];

export const GO_TIMELINE: Release[] = [
  { version: '1.11', released: '2018-08-24' },
  { version: '1.13', released: '2019-09-03' },
  { version: '1.16', released: '2021-02-16' },
  { version: '1.18', released: '2022-03-15' },
  { version: '1.20', released: '2023-02-01' },
  { version: '1.22', released: '2024-02-06' },
];

/** The release that was current on a given date. */
export function versionAtDate(timeline: Release[], isoDate: string | null): string | null {
  if (!isoDate) return null;
  const date = new Date(isoDate).getTime();
  if (Number.isNaN(date)) return null;
  let current: string | null = null;
  for (const release of timeline) {
    if (new Date(release.released).getTime() <= date) current = release.version;
    else break;
  }
  return current;
}

/**
 * Turn a semver range into the lowest satisfying concrete major.
 * ">=8.0.0 <11" -> "8"; "^14.17" -> "14"; "14.x" -> "14"
 */
export function lowestMajorFromRange(range: string): string | null {
  const cleaned = range.trim();
  if (!cleaned) return null;
  // Fast path for simple forms.
  const simple = cleaned.match(/^[\^~>=]*\s*v?(\d+)/);
  try {
    const parsed = semver.validRange(cleaned);
    if (parsed) {
      const min = semver.minVersion(cleaned);
      // Pre-1.0 Node (0.10, 0.12) versioned by minor, so "major 0" would be
      // meaningless in a report — keep the minor for those.
      if (min) return min.major === 0 ? `0.${min.minor}` : String(min.major);
    }
  } catch {
    /* fall through to the regex result */
  }
  const zeroMinor = cleaned.match(/^[\^~>=]*\s*v?0\.(\d+)/);
  if (zeroMinor) return `0.${zeroMinor[1]}`;
  return simple ? simple[1] : null;
}

// ---------------------------------------------------------------------------
// Reconstruction
// ---------------------------------------------------------------------------

export interface ReconstructInput {
  projectDir: string;
  detection: DetectionResult;
  metadata: RepoMetadata;
  present: Set<string>;
}

export async function reconstructEnvironment(input: ReconstructInput): Promise<EnvironmentSpec> {
  const { detection } = input;
  const evidence: EnvironmentEvidence[] = [];

  let runtime: string | null = null;
  let runtimeVersion: string | null = null;
  let packageManagerVersion: string | null = null;

  switch (detection.language) {
    case 'node': {
      runtime = 'node';
      const found = await reconstructNode(input, evidence);
      runtimeVersion = found.version;
      packageManagerVersion = found.packageManagerVersion;
      break;
    }
    case 'python': {
      runtime = 'python';
      runtimeVersion = await reconstructPython(input, evidence);
      break;
    }
    case 'java': {
      runtime = 'java';
      runtimeVersion = await reconstructJava(input, evidence);
      break;
    }
    case 'go': {
      runtime = 'go';
      runtimeVersion = await reconstructGo(input, evidence);
      break;
    }
    case 'rust': {
      runtime = 'rust';
      runtimeVersion = await reconstructRust(input, evidence);
      break;
    }
    default:
      runtime = null;
  }

  // Fall back to dating the project from its last commit.
  if (!runtimeVersion && detection.language !== 'unknown') {
    const timeline = timelineFor(detection.language);
    if (timeline) {
      const dated = versionAtDate(timeline, input.metadata.lastCommitDate);
      if (dated) {
        runtimeVersion = dated;
        evidence.push({
          source: 'commit-date',
          value: dated,
          weight: 20,
          note: `No explicit version declared. Last commit was ${formatDate(input.metadata.lastCommitDate)}, when ${detection.language} ${dated} was current.`,
        });
      }
    }
  }

  const confidence = scoreConfidence(evidence);

  return {
    language: detection.language,
    runtime,
    runtimeVersion,
    packageManager: detection.packageManager,
    packageManagerVersion,
    evidence,
    confidence,
    available: false, // filled in by the orchestrator after probing the host
    actualVersion: null,
  };
}

function timelineFor(language: Language): Release[] | null {
  switch (language) {
    case 'node':
      return NODE_TIMELINE;
    case 'python':
      return PYTHON_TIMELINE;
    case 'java':
      return JAVA_TIMELINE;
    case 'go':
      return GO_TIMELINE;
    default:
      return null;
  }
}

/** Weighted evidence -> 0-100 confidence. Explicit declarations dominate. */
export function scoreConfidence(evidence: EnvironmentEvidence[]): number {
  if (!evidence.length) return 0;
  const total = evidence.reduce((sum, e) => sum + e.weight, 0);
  // 100 weight ~= one explicit, authoritative declaration.
  return Math.max(5, Math.min(100, Math.round((total / 100) * 100)));
}

function formatDate(iso: string | null): string {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'unknown' : d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Per-language reconstruction
// ---------------------------------------------------------------------------

async function reconstructNode(
  input: ReconstructInput,
  evidence: EnvironmentEvidence[],
): Promise<{ version: string | null; packageManagerVersion: string | null }> {
  const dir = input.projectDir;
  let version: string | null = null;
  let packageManagerVersion: string | null = null;

  // 1. .nvmrc — an explicit, unambiguous declaration.
  const nvmrc = await readFileSafe(path.join(dir, '.nvmrc'));
  if (nvmrc) {
    const value = nvmrc.trim().replace(/^v/, '');
    if (/^\d/.test(value)) {
      version = value;
      evidence.push({
        source: '.nvmrc',
        value,
        weight: 100,
        note: 'The repository explicitly pins a Node version for nvm users.',
      });
    }
  }

  // 2. .node-version (asdf / nodenv)
  if (!version) {
    const nodeVersion = await readFileSafe(path.join(dir, '.node-version'));
    if (nodeVersion) {
      const value = nodeVersion.trim().replace(/^v/, '');
      if (/^\d/.test(value)) {
        version = value;
        evidence.push({
          source: '.node-version',
          value,
          weight: 95,
          note: 'Explicit pin used by nodenv/asdf.',
        });
      }
    }
  }

  // 3. engines.node in package.json
  const pkg = await readJson<{
    engines?: Record<string, string>;
    packageManager?: string;
  }>(path.join(dir, 'package.json'));

  if (pkg?.engines?.node) {
    const range = pkg.engines.node;
    const major = lowestMajorFromRange(range);
    evidence.push({
      source: 'engines.node',
      value: range,
      weight: version ? 30 : 85,
      note: version
        ? 'Corroborates the pinned version.'
        : `Declared engine range; lowest satisfying major is Node ${major ?? 'unknown'}.`,
    });
    if (!version && major) version = major;
  }

  if (pkg?.packageManager) {
    const match = pkg.packageManager.match(/@(.+)$/);
    if (match) {
      packageManagerVersion = match[1].split('+')[0];
      evidence.push({
        source: 'packageManager',
        value: pkg.packageManager,
        weight: 40,
        note: 'Corepack pin for the package manager version.',
      });
    }
  }

  // 4. CI configuration frequently records the real tested version.
  const ciVersion = await readCiNodeVersion(input);
  if (ciVersion) {
    evidence.push({
      source: ciVersion.source,
      value: ciVersion.version,
      weight: version ? 25 : 70,
      note: version ? 'CI corroboration.' : 'Recovered from the CI workflow that last passed.',
    });
    if (!version) version = ciVersion.version;
  }

  // 5. Lockfile format — an indirect but reliable fingerprint.
  if (input.detection.lockfileVersion) {
    const lockVersion = input.detection.lockfileVersion;
    const implied = impliedNodeFromLockfile(lockVersion);
    if (implied) {
      evidence.push({
        source: 'lockfileVersion',
        value: lockVersion,
        weight: version ? 20 : 55,
        note: `Lockfile format implies ${implied.label}.`,
      });
      if (!version) version = implied.node;
      if (!packageManagerVersion) packageManagerVersion = implied.pm;
    }
  }

  return { version, packageManagerVersion };
}

export function impliedNodeFromLockfile(
  lockVersion: string,
): { node: string; pm: string; label: string } | null {
  switch (lockVersion) {
    case '1':
      return { node: '14', pm: '6', label: 'npm 6, typically Node 8-14' };
    case '2':
      return { node: '16', pm: '8', label: 'npm 7-8, typically Node 15-18' };
    case '3':
      return { node: '20', pm: '9', label: 'npm 9+, Node 18+' };
    case 'yarn-classic':
      return { node: '14', pm: 'yarn 1', label: 'Yarn 1 Classic' };
    case 'yarn-berry':
      return { node: '18', pm: 'yarn 3', label: 'Yarn 2+ Berry' };
    default:
      return null;
  }
}

/** Read a Node version out of GitHub Actions / Travis / CircleCI config. */
async function readCiNodeVersion(
  input: ReconstructInput,
): Promise<{ version: string; source: string } | null> {
  const candidates = [
    '.github/workflows/ci.yml',
    '.github/workflows/ci.yaml',
    '.github/workflows/test.yml',
    '.github/workflows/node.js.yml',
    '.github/workflows/build.yml',
    '.travis.yml',
    'circle.yml',
    '.circleci/config.yml',
  ];

  for (const candidate of candidates) {
    const text = await readFileSafe(path.join(input.projectDir, candidate));
    if (!text) continue;

    // node-version: '14' | node-version: [14, 16]
    const actions = text.match(/node-version:\s*\[?\s*['"]?(\d+(?:\.\d+)*)/);
    if (actions) return { version: actions[1], source: candidate };

    // Travis: node_js: - 8
    const travis = text.match(/node_js:\s*\n\s*-\s*['"]?(\d+(?:\.\d+)*)/);
    if (travis) return { version: travis[1], source: candidate };

    // CircleCI image: circleci/node:10
    const circle = text.match(/circleci\/node:(\d+(?:\.\d+)*)/);
    if (circle) return { version: circle[1], source: candidate };
  }
  return null;
}

async function reconstructPython(
  input: ReconstructInput,
  evidence: EnvironmentEvidence[],
): Promise<string | null> {
  const dir = input.projectDir;
  let version: string | null = null;

  // .python-version (pyenv)
  const pyenv = await readFileSafe(path.join(dir, '.python-version'));
  if (pyenv) {
    const value = pyenv.trim();
    if (/^\d/.test(value)) {
      version = value;
      evidence.push({
        source: '.python-version',
        value,
        weight: 100,
        note: 'Explicit pyenv pin.',
      });
    }
  }

  // pyproject.toml requires-python / Poetry python constraint
  const pyproject = await readFileSafe(path.join(dir, 'pyproject.toml'));
  if (pyproject) {
    const requires =
      pyproject.match(/requires-python\s*=\s*["']([^"']+)["']/) ??
      pyproject.match(/^\s*python\s*=\s*["']([^"']+)["']/m);
    if (requires) {
      const raw = requires[1];
      const match = raw.match(/(\d+\.\d+)/);
      evidence.push({
        source: 'pyproject.toml',
        value: raw,
        weight: version ? 30 : 90,
        note: version ? 'Corroborates the pyenv pin.' : 'Declared Python constraint.',
      });
      if (!version && match) version = match[1];
    }
  }

  // setup.py python_requires
  if (!version) {
    const setup = await readFileSafe(path.join(dir, 'setup.py'));
    const requires = setup?.match(/python_requires\s*=\s*["']([^"']+)["']/);
    if (requires) {
      const match = requires[1].match(/(\d+\.\d+)/);
      if (match) {
        version = match[1];
        evidence.push({
          source: 'setup.py',
          value: requires[1],
          weight: 80,
          note: 'python_requires in setup.py.',
        });
      }
    }
  }

  // Pipfile [requires] python_version
  if (!version) {
    const pipfile = await readFileSafe(path.join(dir, 'Pipfile'));
    const requires = pipfile?.match(/python_version\s*=\s*["']([^"']+)["']/);
    if (requires) {
      version = requires[1];
      evidence.push({
        source: 'Pipfile',
        value: requires[1],
        weight: 90,
        note: 'Pipfile [requires] python_version.',
      });
    }
  }

  // runtime.txt (Heroku)
  if (!version) {
    const runtime = await readFileSafe(path.join(dir, 'runtime.txt'));
    const match = runtime?.match(/python-(\d+\.\d+)/i);
    if (match) {
      version = match[1];
      evidence.push({
        source: 'runtime.txt',
        value: match[0],
        weight: 85,
        note: 'Heroku runtime pin.',
      });
    }
  }

  // Python 2 is a hard, unmistakable signal in the source itself.
  if (!version) {
    const hasPy2Print = input.detection.notes.some((n) => n.includes('Python 2'));
    if (hasPy2Print) version = '2.7';
  }

  // Classifiers in setup.py are a good secondary source.
  if (!version) {
    const setup = await readFileSafe(path.join(dir, 'setup.py'));
    const classifiers = setup?.match(/Programming Language :: Python :: (\d+\.\d+)/g);
    if (classifiers?.length) {
      const versions = classifiers
        .map((c) => c.match(/(\d+\.\d+)$/)?.[1])
        .filter(Boolean) as string[];
      const highest = versions.sort((a, b) => Number(b) - Number(a))[0];
      if (highest) {
        version = highest;
        evidence.push({
          source: 'setup.py classifiers',
          value: versions.join(', '),
          weight: 60,
          note: 'Highest Python version the package advertised support for.',
        });
      }
    }
  }

  return version;
}

async function reconstructJava(
  input: ReconstructInput,
  evidence: EnvironmentEvidence[],
): Promise<string | null> {
  const dir = input.projectDir;

  const pom = await readFileSafe(path.join(dir, 'pom.xml'));
  if (pom) {
    const target =
      pom.match(/<maven\.compiler\.target>([^<]+)</) ??
      pom.match(/<maven\.compiler\.release>([^<]+)</) ??
      pom.match(/<java\.version>([^<]+)</) ??
      pom.match(/<target>([^<]+)</);
    if (target) {
      const value = target[1].trim();
      // "1.8" is the legacy spelling of Java 8.
      const normalized = value.startsWith('1.') ? value.slice(2) : value;
      evidence.push({
        source: 'pom.xml compiler target',
        value,
        weight: 100,
        note:
          value.startsWith('1.')
            ? `Legacy version spelling "${value}" means Java ${normalized}.`
            : 'Explicit compiler target.',
      });
      return normalized;
    }
  }

  for (const gradleFile of ['build.gradle', 'build.gradle.kts']) {
    const text = await readFileSafe(path.join(dir, gradleFile));
    if (!text) continue;
    const match =
      text.match(/sourceCompatibility\s*=?\s*['"]?(?:JavaVersion\.VERSION_)?([\d._]+)['"]?/) ??
      text.match(/languageVersion\s*=\s*JavaLanguageVersion\.of\((\d+)\)/);
    if (match) {
      const raw = match[1].replace(/_/g, '.');
      const normalized = raw.startsWith('1.') ? raw.slice(2) : raw;
      evidence.push({
        source: `${gradleFile} sourceCompatibility`,
        value: raw,
        weight: 100,
        note: 'Explicit Java source compatibility.',
      });
      return normalized;
    }
  }

  return null;
}

async function reconstructGo(
  input: ReconstructInput,
  evidence: EnvironmentEvidence[],
): Promise<string | null> {
  const text = await readFileSafe(path.join(input.projectDir, 'go.mod'));
  const match = text?.match(/^go\s+([\d.]+)/m);
  if (match) {
    evidence.push({
      source: 'go.mod',
      value: match[1],
      weight: 100,
      note: 'The go directive states the language version the module was written for.',
    });
    return match[1];
  }
  return null;
}

async function reconstructRust(
  input: ReconstructInput,
  evidence: EnvironmentEvidence[],
): Promise<string | null> {
  const dir = input.projectDir;

  for (const file of ['rust-toolchain.toml', 'rust-toolchain']) {
    const text = await readFileSafe(path.join(dir, file));
    if (!text) continue;
    const match = text.match(/channel\s*=\s*["']([^"']+)["']/) ?? text.match(/^([\d.]+)\s*$/m);
    if (match) {
      evidence.push({
        source: file,
        value: match[1],
        weight: 100,
        note: 'Explicit rustup toolchain pin.',
      });
      return match[1];
    }
  }

  const cargo = await readFileSafe(path.join(dir, 'Cargo.toml'));
  const rustVersion = cargo?.match(/rust-version\s*=\s*["']([^"']+)["']/);
  if (rustVersion) {
    evidence.push({
      source: 'Cargo.toml rust-version',
      value: rustVersion[1],
      weight: 90,
      note: 'Minimum supported Rust version (MSRV).',
    });
    return rustVersion[1];
  }

  const edition = cargo?.match(/edition\s*=\s*["'](\d+)["']/);
  if (edition) {
    // Editions map to a minimum compiler, which is the best available floor.
    const minimum: Record<string, string> = {
      '2015': '1.0',
      '2018': '1.31',
      '2021': '1.56',
      '2024': '1.85',
    };
    const value = minimum[edition[1]];
    if (value) {
      evidence.push({
        source: 'Cargo.toml edition',
        value: edition[1],
        weight: 55,
        note: `Edition ${edition[1]} requires at least Rust ${value}.`,
      });
      return value;
    }
  }

  return null;
}
