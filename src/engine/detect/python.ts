import path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { readFileSafe } from '../fsutil';
import type { DependencySpec, DetectionResult } from '../types';
import type { AdapterContext } from './index';
import { emptyDetection } from './index';

/** Parse a requirements.txt line into a name/range pair. */
export function parseRequirement(line: string): DependencySpec | null {
  const trimmed = line.split('#')[0].trim();
  if (!trimmed) return null;
  // Skip pip directives (-r other.txt, -e ., --index-url ...).
  if (trimmed.startsWith('-')) return null;
  const match = trimmed.match(/^([A-Za-z0-9._-]+)\s*(\[[^\]]*\])?\s*(.*)$/);
  if (!match) return null;
  const name = match[1];
  const range = (match[3] || '').trim() || '*';
  return { name, range };
}

const FRAMEWORK_SIGNALS: { dep: string; name: string }[] = [
  { dep: 'django', name: 'Django' },
  { dep: 'flask', name: 'Flask' },
  { dep: 'fastapi', name: 'FastAPI' },
  { dep: 'tornado', name: 'Tornado' },
  { dep: 'pyramid', name: 'Pyramid' },
  { dep: 'scrapy', name: 'Scrapy' },
  { dep: 'streamlit', name: 'Streamlit' },
  { dep: 'torch', name: 'PyTorch' },
  { dep: 'tensorflow', name: 'TensorFlow' },
  { dep: 'numpy', name: 'NumPy' },
];

export async function detectPython(ctx: AdapterContext): Promise<DetectionResult> {
  const result = emptyDetection();
  result.language = 'python';
  result.moduleSystem = 'n/a';

  const deps: DependencySpec[] = [];

  // --- Poetry / PEP 621 -----------------------------------------------------
  if (ctx.present.has('pyproject.toml')) {
    result.manifestFiles.push('pyproject.toml');
    const text = await readFileSafe(path.join(ctx.projectDir, 'pyproject.toml'));
    if (text) {
      try {
        const toml = parseToml(text) as Record<string, any>;
        const poetry = toml?.tool?.poetry;
        if (poetry) {
          result.packageManager = 'poetry';
          for (const [name, spec] of Object.entries(poetry.dependencies ?? {})) {
            if (name.toLowerCase() === 'python') {
              result.notes.push(`Poetry requires Python "${String(spec)}".`);
              continue;
            }
            deps.push({
              name,
              range: typeof spec === 'string' ? spec : JSON.stringify(spec),
            });
          }
          for (const [name, spec] of Object.entries(poetry['dev-dependencies'] ?? {})) {
            deps.push({ name, range: String(spec), dev: true });
          }
        } else if (toml?.project) {
          // PEP 621 metadata, installed with plain pip.
          result.packageManager = 'pip';
          for (const entry of toml.project.dependencies ?? []) {
            const parsed = parseRequirement(String(entry));
            if (parsed) deps.push(parsed);
          }
          if (toml.project['requires-python']) {
            result.notes.push(
              `pyproject.toml requires-python = "${toml.project['requires-python']}".`,
            );
          }
        }
        const backend = toml?.['build-system']?.['build-backend'];
        if (backend) result.notes.push(`Build backend: ${backend}.`);
      } catch {
        result.notes.push('pyproject.toml could not be parsed as TOML.');
      }
    }
  }

  // --- Pipenv ---------------------------------------------------------------
  if (ctx.present.has('Pipfile')) {
    result.manifestFiles.push('Pipfile');
    result.packageManager = 'pipenv';
    const text = await readFileSafe(path.join(ctx.projectDir, 'Pipfile'));
    if (text) {
      try {
        const toml = parseToml(text) as Record<string, any>;
        for (const [name, spec] of Object.entries(toml.packages ?? {})) {
          deps.push({ name, range: typeof spec === 'string' ? spec : JSON.stringify(spec) });
        }
        for (const [name, spec] of Object.entries(toml['dev-packages'] ?? {})) {
          deps.push({ name, range: String(spec), dev: true });
        }
        const pythonVersion = toml.requires?.python_version;
        if (pythonVersion) result.notes.push(`Pipfile requires python_version ${pythonVersion}.`);
      } catch {
        result.notes.push('Pipfile could not be parsed as TOML.');
      }
    }
  }

  // --- requirements.txt -----------------------------------------------------
  const requirementFiles = ctx.files.filter((f) =>
    /^requirements(-[\w.]+)?\.txt$|^requirements\/.+\.txt$/.test(f),
  );
  if (requirementFiles.length) {
    result.manifestFiles.push(...requirementFiles);
    if (result.packageManager === 'unknown') result.packageManager = 'pip';
    for (const file of requirementFiles) {
      const text = await readFileSafe(path.join(ctx.projectDir, file));
      if (!text) continue;
      const isDev = /dev|test/i.test(file);
      for (const line of text.split('\n')) {
        const parsed = parseRequirement(line);
        if (parsed) deps.push({ ...parsed, dev: isDev });
      }
    }
  }

  if (ctx.present.has('setup.py')) result.manifestFiles.push('setup.py');
  if (result.packageManager === 'unknown') result.packageManager = 'pip';

  // Lockfiles
  const lockCandidates = ['poetry.lock', 'Pipfile.lock'];
  result.lockfiles = lockCandidates.filter((f) => ctx.present.has(f));
  result.hasLockfile = result.lockfiles.length > 0;

  result.dependencies = deps;

  const names = new Set(deps.map((d) => d.name.toLowerCase()));
  for (const signal of FRAMEWORK_SIGNALS) {
    if (names.has(signal.dep)) {
      result.framework = signal.name;
      result.frameworkVersion =
        deps.find((d) => d.name.toLowerCase() === signal.dep)?.range ?? null;
      break;
    }
  }

  // --- Commands -------------------------------------------------------------
  // A project-local virtualenv keeps installs off the host interpreter.
  const venvPython = 'python -m venv .venv';
  const pyBin = process.platform === 'win32' ? '.venv\\Scripts\\python' : '.venv/bin/python';

  switch (result.packageManager) {
    case 'poetry':
      result.commands.install = 'poetry install';
      result.commands.test = 'poetry run pytest';
      break;
    case 'pipenv':
      result.commands.install = 'pipenv install --dev';
      result.commands.test = 'pipenv run pytest';
      break;
    default: {
      const reqFile =
        requirementFiles.find((f) => f === 'requirements.txt') ?? requirementFiles[0];
      const installable =
        Boolean(reqFile) || ctx.present.has('setup.py') || ctx.present.has('pyproject.toml');

      // Always create the virtualenv so nothing is installed against the host
      // interpreter. Only reach for the network when there is something to fetch.
      const installParts = [venvPython];
      if (installable) {
        installParts.push(`${pyBin} -m pip install --upgrade pip setuptools wheel`);
        if (reqFile) {
          installParts.push(`${pyBin} -m pip install -r ${reqFile}`);
        } else {
          installParts.push(`${pyBin} -m pip install -e .`);
        }
      } else {
        result.notes.push(
          'No requirements file or package metadata found, so the install step only creates an isolated virtualenv.',
        );
      }
      result.commands.install = installParts.join(' && ');
      break;
    }
  }

  if (!result.commands.test) {
    const hasTests = ctx.files.some((f) => /(^|\/)(test_|tests?\/)/i.test(f));
    if (hasTests) {
      // Only reach for pytest when the project actually depends on it;
      // otherwise unittest is in the standard library and always available.
      const usesPytest = deps.some((d) => d.name.toLowerCase() === 'pytest');
      // unittest discovery needs to be pointed at the test directory, with the
      // project root as the top-level import path, or it silently finds
      // nothing in the very common `tests/` layout.
      const testDir = ctx.files.some((f) => f.startsWith('tests/'))
        ? 'tests'
        : ctx.files.some((f) => f.startsWith('test/'))
          ? 'test'
          : '.';
      // unittest can only discover inside an importable start directory. A
      // `tests/` folder without __init__.py is not a package, so the top-level
      // must be the test directory itself; when it IS a package, the top-level
      // has to be the project root or relative imports break.
      const testDirIsPackage = ctx.present.has(`${testDir}/__init__.py`);
      const topLevel = testDir === '.' || testDirIsPackage ? '.' : testDir;
      result.commands.test = usesPytest
        ? `${pyBin} -m pytest -q`
        : `${pyBin} -m unittest discover -s ${testDir} -t ${topLevel} -v`;
      if (!usesPytest) {
        result.notes.push(
          'pytest is not a declared dependency, so tests are run with the standard-library unittest discovery.',
        );
      }
    }
  }

  // Entry point
  if (ctx.present.has('manage.py')) {
    result.commands.start = `${pyBin} manage.py check`;
    result.framework = result.framework ?? 'Django';
  } else if (ctx.present.has('app.py')) {
    result.commands.start = `${pyBin} app.py`;
  } else if (ctx.present.has('main.py')) {
    result.commands.start = `${pyBin} main.py`;
  }

  // Python has no compile step; byte-compiling everything is the closest
  // equivalent and catches syntax that a newer interpreter rejects.
  result.commands.build = `${pyBin} -m compileall -q .`;

  return result;
}
