import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { pathExists } from './fsutil';
import type { EnvironmentSpec, Language } from './types';

/**
 * Host toolchain discovery.
 *
 * In Docker mode the reconstructed runtime is simply an image tag, so this
 * module only matters for restricted mode — but there it matters a great deal.
 * Revive looks for version managers (nvm, pyenv, asdf, SDKMAN, rustup) that may
 * already have the historical runtime installed, and reports honestly when the
 * requested version is unavailable rather than silently using the wrong one.
 */

export interface ToolVersion {
  tool: string;
  version: string | null;
  path: string | null;
  available: boolean;
}

const versionCache = new Map<string, ToolVersion>();

/** Run `<tool> <flag>` and parse a version out of the output. */
export async function probeTool(
  tool: string,
  args: string[] = ['--version'],
): Promise<ToolVersion> {
  const cacheKey = `${tool} ${args.join(' ')}`;
  const cached = versionCache.get(cacheKey);
  if (cached) return cached;

  const result = await new Promise<ToolVersion>((resolve) => {
    let settled = false;
    const finish = (value: ToolVersion) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const child = spawn(tool, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: os.platform() === 'win32', // .cmd shims need a shell on Windows
    });

    let output = '';
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      finish({ tool, version: null, path: null, available: false });
    }, 15_000);

    child.stdout?.on('data', (c) => (output += c.toString()));
    child.stderr?.on('data', (c) => (output += c.toString()));

    child.on('error', () => {
      clearTimeout(timer);
      finish({ tool, version: null, path: null, available: false });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      // Availability must be judged by exit status, not by whether anything was
      // printed: on Windows a missing command still writes
      // "'mvn' is not recognized..." to stderr, which would otherwise read as
      // a successful probe and send the engine down the wrong build path.
      if (code !== 0) {
        finish({ tool, version: null, path: null, available: false });
        return;
      }
      finish({
        tool,
        version: parseVersion(output),
        path: null,
        available: true,
      });
    });
  });

  versionCache.set(cacheKey, result);
  return result;
}

/** Extract the first plausible semantic version from tool output. */
export function parseVersion(output: string): string | null {
  const patterns = [
    /version "?(\d+\.\d+\.\d+[\w.+-]*)"?/i, // java version "17.0.2"
    /version "?(\d+\.\d+)"?/i,
    /\bgo(\d+\.\d+(?:\.\d+)?)/, // go version go1.22.0
    /\bv?(\d+\.\d+\.\d+)\b/,
    /\bv?(\d+\.\d+)\b/,
  ];
  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export interface ToolchainProbe {
  language: Language;
  primary: ToolVersion;
  packageManagers: ToolVersion[];
  /** Other versions of the runtime found via version managers. */
  alternates: { version: string; source: string; binPath: string }[];
}

export async function probeToolchain(language: Language): Promise<ToolchainProbe> {
  switch (language) {
    case 'node': {
      const [node, npm, yarn, pnpm] = await Promise.all([
        probeTool('node'),
        probeTool('npm'),
        probeTool('yarn'),
        probeTool('pnpm'),
      ]);
      return {
        language,
        primary: node,
        packageManagers: [npm, yarn, pnpm].filter((t) => t.available),
        alternates: await findNodeAlternates(),
      };
    }
    case 'python': {
      // `python` may be absent while `python3` exists, and vice versa.
      let python = await probeTool('python', ['--version']);
      if (!python.available) python = await probeTool('python3', ['--version']);
      const [poetry, pipenv] = await Promise.all([
        probeTool('poetry'),
        probeTool('pipenv'),
      ]);
      return {
        language,
        primary: python,
        packageManagers: [poetry, pipenv].filter((t) => t.available),
        alternates: await findPythonAlternates(),
      };
    }
    case 'java': {
      const [java, mvn, gradle] = await Promise.all([
        probeTool('java', ['-version']),
        probeTool('mvn', ['-v']),
        probeTool('gradle', ['-v']),
      ]);
      return {
        language,
        primary: java,
        packageManagers: [mvn, gradle].filter((t) => t.available),
        alternates: await findJavaAlternates(),
      };
    }
    case 'go': {
      const go = await probeTool('go', ['version']);
      return { language, primary: go, packageManagers: [], alternates: [] };
    }
    case 'rust': {
      const [cargo, rustc] = await Promise.all([probeTool('cargo'), probeTool('rustc')]);
      return {
        language,
        primary: rustc,
        packageManagers: [cargo].filter((t) => t.available),
        alternates: await findRustAlternates(),
      };
    }
    default:
      return {
        language,
        primary: { tool: 'unknown', version: null, path: null, available: false },
        packageManagers: [],
        alternates: [],
      };
  }
}

// ---------------------------------------------------------------------------
// Version manager discovery
// ---------------------------------------------------------------------------

async function findNodeAlternates(): Promise<{ version: string; source: string; binPath: string }[]> {
  const found: { version: string; source: string; binPath: string }[] = [];
  const home = os.homedir();

  // nvm (POSIX) and nvm-windows store installed versions in predictable trees.
  const candidates = [
    { dir: path.join(home, '.nvm', 'versions', 'node'), source: 'nvm' },
    { dir: path.join(process.env.NVM_HOME ?? path.join(home, 'AppData', 'Roaming', 'nvm')), source: 'nvm-windows' },
    { dir: path.join(home, '.volta', 'tools', 'image', 'node'), source: 'volta' },
    { dir: path.join(home, '.asdf', 'installs', 'nodejs'), source: 'asdf' },
    { dir: path.join(home, '.fnm', 'node-versions'), source: 'fnm' },
  ];

  for (const candidate of candidates) {
    if (!(await pathExists(candidate.dir))) continue;
    try {
      const entries = await fs.readdir(candidate.dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const version = entry.name.replace(/^v/, '');
        if (!/^\d+\.\d+/.test(version)) continue;
        const binPath =
          os.platform() === 'win32'
            ? path.join(candidate.dir, entry.name)
            : path.join(candidate.dir, entry.name, 'bin');
        if (await pathExists(binPath)) {
          found.push({ version, source: candidate.source, binPath });
        }
      }
    } catch {
      /* unreadable — skip */
    }
  }
  return found;
}

async function findPythonAlternates(): Promise<
  { version: string; source: string; binPath: string }[]
> {
  const found: { version: string; source: string; binPath: string }[] = [];
  const home = os.homedir();

  const pyenvRoot = process.env.PYENV_ROOT ?? path.join(home, '.pyenv');
  const versionsDir = path.join(pyenvRoot, 'versions');
  if (await pathExists(versionsDir)) {
    try {
      for (const entry of await fs.readdir(versionsDir, { withFileTypes: true })) {
        if (entry.isDirectory() && /^\d+\.\d+/.test(entry.name)) {
          found.push({
            version: entry.name,
            source: 'pyenv',
            binPath: path.join(versionsDir, entry.name, 'bin'),
          });
        }
      }
    } catch {
      /* skip */
    }
  }

  // Windows: the py launcher exposes every registered interpreter.
  if (os.platform() === 'win32') {
    const launcher = await probeTool('py', ['-0p']);
    if (launcher.available) {
      found.push({ version: 'py-launcher', source: 'py launcher', binPath: 'py' });
    }
  }

  return found;
}

async function findJavaAlternates(): Promise<{ version: string; source: string; binPath: string }[]> {
  const found: { version: string; source: string; binPath: string }[] = [];
  const home = os.homedir();

  const sdkmanDir = path.join(home, '.sdkman', 'candidates', 'java');
  if (await pathExists(sdkmanDir)) {
    try {
      for (const entry of await fs.readdir(sdkmanDir, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name !== 'current') {
          found.push({
            version: entry.name,
            source: 'SDKMAN',
            binPath: path.join(sdkmanDir, entry.name, 'bin'),
          });
        }
      }
    } catch {
      /* skip */
    }
  }

  // Common system JDK install roots.
  const roots =
    os.platform() === 'win32'
      ? ['C:\\Program Files\\Java', 'C:\\Program Files\\Eclipse Adoptium']
      : ['/usr/lib/jvm', '/Library/Java/JavaVirtualMachines'];

  for (const root of roots) {
    if (!(await pathExists(root))) continue;
    try {
      for (const entry of await fs.readdir(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const match = entry.name.match(/(\d+)(?:\.(\d+))?/);
        if (!match) continue;
        const binPath =
          os.platform() === 'darwin'
            ? path.join(root, entry.name, 'Contents', 'Home', 'bin')
            : path.join(root, entry.name, 'bin');
        if (await pathExists(binPath)) {
          found.push({ version: match[1], source: 'system JDK', binPath });
        }
      }
    } catch {
      /* skip */
    }
  }

  return found;
}

async function findRustAlternates(): Promise<{ version: string; source: string; binPath: string }[]> {
  const found: { version: string; source: string; binPath: string }[] = [];
  const home = os.homedir();
  const toolchainsDir = path.join(process.env.RUSTUP_HOME ?? path.join(home, '.rustup'), 'toolchains');

  if (await pathExists(toolchainsDir)) {
    try {
      for (const entry of await fs.readdir(toolchainsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const match = entry.name.match(/^(\d+\.\d+(?:\.\d+)?|stable|beta|nightly)/);
        if (!match) continue;
        found.push({
          version: match[1],
          source: 'rustup',
          binPath: path.join(toolchainsDir, entry.name, 'bin'),
        });
      }
    } catch {
      /* skip */
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Runtime selection
// ---------------------------------------------------------------------------

export interface RuntimeSelection {
  /** The version that will actually be used. */
  version: string | null;
  /** Whether that matches what the project asked for. */
  matchesRequested: boolean;
  /** PATH prefix to prepend so the chosen runtime wins. */
  pathPrefix: string | null;
  explanation: string;
}

/**
 * Choose the runtime to execute with, preferring the reconstructed version.
 *
 * This never installs anything — it only selects from what is already present.
 * When the requested version is unavailable it says so explicitly, which is the
 * honest answer and lets the diagnosis explain version-related failures
 * correctly instead of blaming the code.
 */
export function selectRuntime(
  requested: EnvironmentSpec,
  probe: ToolchainProbe,
): RuntimeSelection {
  const wanted = requested.runtimeVersion;
  const installed = probe.primary.version;

  if (!probe.primary.available) {
    return {
      version: null,
      matchesRequested: false,
      pathPrefix: null,
      explanation: `No ${requested.runtime ?? 'runtime'} toolchain is installed on this machine, so the project cannot be executed here.`,
    };
  }

  if (!wanted) {
    return {
      version: installed,
      matchesRequested: true,
      pathPrefix: null,
      explanation: `The project declares no specific runtime version; using the installed ${probe.primary.tool} ${installed}.`,
    };
  }

  const wantedMajor = wanted.split('.')[0];
  const installedMajor = installed?.split('.')[0];

  if (wantedMajor === installedMajor) {
    return {
      version: installed,
      matchesRequested: true,
      pathPrefix: null,
      explanation: `The installed ${probe.primary.tool} ${installed} matches the reconstructed requirement (${wanted}).`,
    };
  }

  // Look for the requested major among version-manager installs.
  const match = probe.alternates
    .filter((alt) => alt.version.split('.')[0] === wantedMajor)
    .sort((a, b) => compareVersions(b.version, a.version))[0];

  if (match) {
    return {
      version: match.version,
      matchesRequested: true,
      pathPrefix: match.binPath,
      explanation: `Reconstructed the original environment using ${match.source}: ${probe.primary.tool} ${match.version} (project asked for ${wanted}).`,
    };
  }

  return {
    version: installed,
    matchesRequested: false,
    pathPrefix: null,
    explanation: `The project targets ${probe.primary.tool} ${wanted}, but only ${installed} is installed and no version manager provides ${wantedMajor}.x. Running with ${installed} — version-specific failures below are expected and are reported as such.`,
  };
}

/** Numeric-aware version comparison. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const delta = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

/** Clear the probe cache — used by tests. */
export function resetToolchainCache(): void {
  versionCache.clear();
}
