import path from 'node:path';
import { readFileSafe, readJson } from '../fsutil';
import type { DependencySpec, DetectionResult, PackageManager } from '../types';
import type { AdapterContext } from './index';
import { emptyDetection } from './index';

export interface PackageJson {
  name?: string;
  version?: string;
  type?: string;
  private?: boolean;
  main?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  engines?: Record<string, string>;
  packageManager?: string;
  workspaces?: string[] | { packages?: string[] };
  browserslist?: unknown;
}

/** Frameworks we can name from a dependency, ordered most-specific first. */
const FRAMEWORK_SIGNALS: { dep: string; name: string }[] = [
  { dep: 'next', name: 'Next.js' },
  { dep: 'nuxt', name: 'Nuxt' },
  { dep: 'gatsby', name: 'Gatsby' },
  { dep: '@angular/core', name: 'Angular' },
  { dep: 'react-scripts', name: 'Create React App' },
  { dep: '@sveltejs/kit', name: 'SvelteKit' },
  { dep: 'svelte', name: 'Svelte' },
  { dep: 'vue', name: 'Vue' },
  { dep: 'react', name: 'React' },
  { dep: 'express', name: 'Express' },
  { dep: 'koa', name: 'Koa' },
  { dep: 'fastify', name: 'Fastify' },
  { dep: '@nestjs/core', name: 'NestJS' },
  { dep: 'electron', name: 'Electron' },
];

const BUNDLER_SIGNALS = ['webpack', 'vite', 'rollup', 'parcel', 'esbuild', 'gulp', 'grunt'];

export function detectPackageManager(present: Set<string>, pkg: PackageJson | null): PackageManager {
  // An explicit packageManager field is the strongest signal (Corepack).
  const declared = pkg?.packageManager;
  if (declared) {
    if (declared.startsWith('pnpm')) return 'pnpm';
    if (declared.startsWith('yarn')) return 'yarn';
    if (declared.startsWith('npm')) return 'npm';
  }
  if (present.has('pnpm-lock.yaml')) return 'pnpm';
  if (present.has('yarn.lock')) return 'yarn';
  if (present.has('package-lock.json') || present.has('npm-shrinkwrap.json')) return 'npm';
  return 'npm';
}

/**
 * npm lockfileVersion is a precise dating tool:
 *   v1 -> npm 5/6   (Node 8-14 era)
 *   v2 -> npm 7/8   (Node 15-18)
 *   v3 -> npm 9+    (Node 18+)
 */
export function lockfileEra(version: number | null): string | null {
  switch (version) {
    case 1:
      return 'npm 6 (Node 8-14 era)';
    case 2:
      return 'npm 7-8 (Node 15-18 era)';
    case 3:
      return 'npm 9+ (Node 18+ era)';
    default:
      return null;
  }
}

export async function detectNode(ctx: AdapterContext): Promise<DetectionResult> {
  const result = emptyDetection();
  result.language = 'node';

  const pkg = await readJson<PackageJson>(path.join(ctx.projectDir, 'package.json'));
  if (!pkg) {
    result.notes.push('package.json is present but could not be parsed as JSON.');
    return result;
  }

  result.manifestFiles = ['package.json'];
  result.packageManager = detectPackageManager(ctx.present, pkg);

  // Lockfiles
  const lockCandidates = [
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'npm-shrinkwrap.json',
  ];
  result.lockfiles = lockCandidates.filter((f) => ctx.present.has(f));
  result.hasLockfile = result.lockfiles.length > 0;

  if (ctx.present.has('package-lock.json')) {
    const lock = await readJson<{ lockfileVersion?: number }>(
      path.join(ctx.projectDir, 'package-lock.json'),
    );
    const version = lock?.lockfileVersion ?? null;
    result.lockfileVersion = version !== null ? String(version) : null;
    const era = lockfileEra(version);
    if (era) result.notes.push(`package-lock.json is lockfileVersion ${version} — ${era}.`);
  } else if (ctx.present.has('yarn.lock')) {
    const text = await readFileSafe(path.join(ctx.projectDir, 'yarn.lock'));
    if (text?.includes('__metadata:')) {
      result.lockfileVersion = 'yarn-berry';
      result.notes.push('yarn.lock is a Yarn 2+ (Berry) lockfile.');
    } else if (text) {
      result.lockfileVersion = 'yarn-classic';
      result.notes.push('yarn.lock is a Yarn 1 (Classic) lockfile.');
    }
  }

  // Dependencies
  const deps: DependencySpec[] = [];
  for (const [name, range] of Object.entries(pkg.dependencies ?? {})) {
    deps.push({ name, range: String(range) });
  }
  for (const [name, range] of Object.entries(pkg.devDependencies ?? {})) {
    deps.push({ name, range: String(range), dev: true });
  }
  result.dependencies = deps;

  // Framework + bundler
  const allDeps = new Map(deps.map((d) => [d.name, d.range]));
  for (const signal of FRAMEWORK_SIGNALS) {
    if (allDeps.has(signal.dep)) {
      result.framework = signal.name;
      result.frameworkVersion = allDeps.get(signal.dep) ?? null;
      break;
    }
  }
  const bundler = BUNDLER_SIGNALS.find((b) => allDeps.has(b));
  if (bundler) {
    result.notes.push(`Bundler detected: ${bundler}@${allDeps.get(bundler)}.`);
    if (!result.framework) {
      result.framework = bundler.charAt(0).toUpperCase() + bundler.slice(1);
      result.frameworkVersion = allDeps.get(bundler) ?? null;
    }
  }

  // Module system.
  // The declaration in package.json is only a claim; what the source actually
  // does matters more. A package that declares ESM while its .js files still
  // use require() is the signature of an abandoned migration, and saying
  // "mixed" rather than trusting the field is what makes that visible.
  const hasEsmField = pkg.type === 'module';
  const hasMjs = ctx.files.some((f) => f.endsWith('.mjs'));
  const hasCjs = ctx.files.some((f) => f.endsWith('.cjs'));
  const usesCjsSyntax = await anyFileMatches(
    ctx,
    /(^|[^\w.])require\s*\(|module\.exports\s*=|exports\.\w+\s*=/,
  );

  if (hasEsmField && (hasCjs || usesCjsSyntax)) {
    result.moduleSystem = 'mixed';
    if (usesCjsSyntax) {
      result.notes.push(
        'package.json declares "type": "module" but the source still uses CommonJS require/module.exports — an ES module migration that was started and not finished.',
      );
    }
  } else if (hasEsmField || hasMjs) {
    result.moduleSystem = 'esm';
  } else {
    result.moduleSystem = 'commonjs';
  }

  // Commands
  const scripts = pkg.scripts ?? {};
  const pm = result.packageManager;
  const run = (script: string) =>
    pm === 'npm' ? `npm run ${script}` : pm === 'yarn' ? `yarn ${script}` : `pnpm run ${script}`;

  result.commands.install = installCommand(pm, result.hasLockfile);

  if (scripts.build) result.commands.build = run('build');
  else if (scripts.compile) result.commands.build = run('compile');
  else if (allDeps.has('typescript') && ctx.present.has('tsconfig.json')) {
    result.commands.build = `${pm === 'npm' ? 'npx' : pm === 'yarn' ? 'yarn' : 'pnpm'} tsc --noEmit`;
  }

  if (scripts.test && !isPlaceholderTest(scripts.test)) {
    result.commands.test = pm === 'npm' ? 'npm test' : pm === 'yarn' ? 'yarn test' : 'pnpm test';
  }

  if (scripts.start) result.commands.start = run('start');
  else if (scripts.dev) result.commands.start = run('dev');
  else if (scripts.serve) result.commands.start = run('serve');
  else if (pkg.main) result.commands.start = `node ${pkg.main}`;
  else if (ctx.present.has('index.js')) result.commands.start = 'node index.js';
  else if (ctx.present.has('server.js')) result.commands.start = 'node server.js';

  if (scripts.lint) result.commands.lint = run('lint');

  if (pkg.workspaces) {
    result.notes.push('package.json declares workspaces — this is a monorepo root.');
  }
  if (pkg.engines?.node) {
    result.notes.push(`engines.node declares "${pkg.engines.node}".`);
  }

  return result;
}

export function installCommand(pm: PackageManager, hasLockfile: boolean): string {
  switch (pm) {
    case 'yarn':
      // `--frozen-lockfile` fails hard on drift; legacy repos usually need the
      // forgiving path, and the repair engine tightens it when appropriate.
      return 'yarn install --non-interactive';
    case 'pnpm':
      return hasLockfile ? 'pnpm install --no-frozen-lockfile' : 'pnpm install';
    case 'npm':
    default:
      // `npm ci` requires a lockfile that matches package.json exactly, which is
      // precisely what abandoned repos fail. Start with the tolerant form.
      return 'npm install --no-audit --no-fund';
  }
}

/** `"test": "echo \"Error: no test specified\" && exit 1"` is not a real test. */
export function isPlaceholderTest(script: string): boolean {
  return /no test specified|exit\s+1\s*$/.test(script.trim()) && script.includes('echo');
}

/**
 * Cheaply test whether any first-party JavaScript source matches a pattern.
 * Bounded so a huge repository cannot turn detection into a full scan.
 */
async function anyFileMatches(ctx: AdapterContext, pattern: RegExp): Promise<boolean> {
  const candidates = ctx.files
    .filter((f) => /\.(js|jsx)$/.test(f))
    .filter((f) => !f.includes('node_modules/') && !f.includes('dist/'))
    .slice(0, 40);

  for (const rel of candidates) {
    const text = await readFileSafe(path.join(ctx.projectDir, rel));
    if (text && pattern.test(text)) return true;
  }
  return false;
}
