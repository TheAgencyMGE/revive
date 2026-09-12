import path from 'node:path';
import fs from 'node:fs/promises';
import { readJson, writeJson, pathExists, readFileSafe } from '../fsutil';
import type { RepairAction, RepairContext, RepairEffect } from '../types';
import type { PackageJson } from '../detect/node';

/**
 * Node / JavaScript repairs.
 *
 * Every repair here is deliberately narrow. The philosophy is reconstruction,
 * not modernisation: prefer restoring the environment the project expected over
 * rewriting the project to suit a newer environment.
 */

async function editPackageJson(
  ctx: RepairContext,
  mutate: (pkg: PackageJson) => boolean | void,
): Promise<{ changed: boolean; file: string }> {
  const file = path.join(ctx.projectDir, 'package.json');
  const pkg = await readJson<PackageJson>(file);
  if (!pkg) return { changed: false, file };
  const result = mutate(pkg);
  if (result === false) return { changed: false, file };
  await writeJson(file, pkg);
  return { changed: true, file: 'package.json' };
}

/**
 * Known dead or renamed packages and their maintained successors.
 * Replacement is only ever suggested when the successor is a genuine drop-in.
 */
export const PACKAGE_REPLACEMENTS: Record<
  string,
  { replacement: string; version: string; note: string; dropIn: boolean }
> = {
  'node-sass': {
    replacement: 'sass',
    version: '^1.77.0',
    note: 'dart-sass is the official successor and is API-compatible for standard SCSS compilation. It is pure JavaScript, so it needs no native build.',
    dropIn: true,
  },
  'left-pad': {
    replacement: 'string.prototype.padstart',
    version: '^3.1.6',
    note: 'left-pad was famously unpublished; padStart is now built into JavaScript.',
    dropIn: false,
  },
  request: {
    replacement: 'axios',
    version: '^1.7.0',
    note: 'request was deprecated in 2020. This is NOT a drop-in replacement — the API differs.',
    dropIn: false,
  },
  'gulp-util': {
    replacement: 'fancy-log',
    version: '^2.0.0',
    note: 'gulp-util was deprecated and split into focused modules.',
    dropIn: false,
  },
};

/** The last CommonJS release of packages that later became ESM-only. */
export const LAST_CJS_VERSION: Record<string, string> = {
  chalk: '^4.1.2',
  'node-fetch': '^2.7.0',
  ora: '^5.4.1',
  'strip-ansi': '^6.0.1',
  'ansi-regex': '^5.0.1',
  execa: '^5.1.1',
  globby: '^11.1.0',
  'p-limit': '^3.1.0',
  nanoid: '^3.3.7',
  got: '^11.8.6',
  inquirer: '^8.2.6',
  'is-stream': '^2.0.1',
  'find-up': '^5.0.0',
  'pretty-bytes': '^5.6.0',
  'file-type': '^16.5.4',
  del: '^6.1.1',
  boxen: '^5.1.2',
};

export function nodeRepairs(): RepairAction[] {
  return [
    // -----------------------------------------------------------------------
    // node-sass -> dart-sass
    // -----------------------------------------------------------------------
    {
      id: 'node-sass-to-dart-sass',
      kind: 'dependency-replace',
      title: 'Replace node-sass with dart-sass',
      rationale:
        'node-sass is deprecated and its native bindings do not exist for modern Node. dart-sass (`sass`) is the official successor, compiles the same SCSS, and requires no native toolchain.',
      priority: 10,
      category: 'node-sass',
      risk: 'low',
      source: 'deterministic',
      async apply(ctx): Promise<RepairEffect> {
        const touched: string[] = [];
        let replaced = false;

        const { changed } = await editPackageJson(ctx, (pkg) => {
          let didChange = false;
          for (const field of ['dependencies', 'devDependencies'] as const) {
            const table = pkg[field];
            if (table?.['node-sass']) {
              const isDev = field === 'devDependencies';
              delete table['node-sass'];
              const target = isDev ? (pkg.devDependencies ??= {}) : (pkg.dependencies ??= {});
              target.sass = PACKAGE_REPLACEMENTS['node-sass'].version;
              didChange = true;
              replaced = true;
            }
          }
          // sass-loader versions below 8 call into the node-sass API directly.
          for (const field of ['dependencies', 'devDependencies'] as const) {
            const table = pkg[field];
            const loader = table?.['sass-loader'];
            if (loader && /^[~^]?[0-7]\./.test(String(loader))) {
              table!['sass-loader'] = '^10.5.2';
              ctx.log(
                'info',
                `Raised sass-loader from ${loader} to ^10.5.2 — versions below 8 call the node-sass API directly and cannot drive dart-sass.`,
              );
              didChange = true;
            }
          }
          return didChange;
        });

        if (changed) touched.push('package.json');

        // Any explicit `implementation: require('node-sass')` must be updated too.
        for (const config of ['webpack.config.js', 'webpack.config.babel.js', 'vue.config.js']) {
          const file = path.join(ctx.projectDir, config);
          if (!(await pathExists(file))) continue;
          const text = await readFileSafe(file);
          if (text?.includes('node-sass')) {
            await fs.writeFile(file, text.replace(/node-sass/g, 'sass'), 'utf8');
            touched.push(config);
          }
        }

        return {
          applied: replaced || touched.length > 0,
          description: replaced
            ? 'Replaced node-sass with dart-sass (`sass`), preserving the existing SCSS sources unchanged.'
            : 'node-sass was not present in the manifest.',
          filesTouched: touched,
        };
      },
    },

    // -----------------------------------------------------------------------
    // OpenSSL legacy provider for webpack 4
    // -----------------------------------------------------------------------
    {
      id: 'node-openssl-legacy',
      kind: 'env-inject',
      title: 'Re-enable the legacy OpenSSL provider for webpack 4',
      rationale:
        'Webpack 4 hashes with MD4, removed in OpenSSL 3. Setting NODE_OPTIONS=--openssl-legacy-provider restores the hash without modifying the project, which is the least invasive way to run a webpack 4 build on modern Node.',
      priority: 5,
      category: 'runtime-version',
      risk: 'low',
      source: 'deterministic',
      async apply(): Promise<RepairEffect> {
        return {
          applied: true,
          description:
            'Set NODE_OPTIONS=--openssl-legacy-provider for all subsequent build steps. No project files were modified.',
          filesTouched: [],
          envPatch: { NODE_OPTIONS: '--openssl-legacy-provider' },
        };
      },
    },

    // -----------------------------------------------------------------------
    // Peer dependency conflicts
    // -----------------------------------------------------------------------
    {
      id: 'npm-legacy-peer-deps',
      kind: 'install-flag',
      title: 'Install with legacy peer dependency resolution',
      rationale:
        'npm 7 turned peer conflicts into hard errors. A project last installed under npm 6 resolved fine with the old behaviour, so --legacy-peer-deps reproduces the tree that actually worked rather than forcing dependency upgrades.',
      priority: 3,
      category: 'peer-conflict',
      risk: 'low',
      source: 'deterministic',
      async apply(ctx): Promise<RepairEffect> {
        const base = ctx.detection.commands.install ?? 'npm install';
        if (base.includes('--legacy-peer-deps')) {
          return { applied: false, description: 'Already installing with --legacy-peer-deps.', filesTouched: [] };
        }
        return {
          applied: true,
          description:
            'Added --legacy-peer-deps to the install command, restoring npm 6 peer-resolution semantics.',
          filesTouched: [],
          commandOverrides: { install: `${base} --legacy-peer-deps` },
        };
      },
    },

    {
      id: 'npm-install-instead-of-ci',
      kind: 'install-flag',
      title: 'Use `npm install` instead of `npm ci`',
      rationale:
        '`npm ci` refuses to run when the lockfile has drifted from package.json. `npm install` reconciles the two, which is what a developer would have done at the time.',
      priority: 2,
      category: 'broken-lockfile',
      risk: 'low',
      source: 'deterministic',
      async apply(ctx): Promise<RepairEffect> {
        const base = ctx.detection.commands.install ?? '';
        if (!base.includes('npm ci')) {
          return { applied: false, description: 'Install command does not use npm ci.', filesTouched: [] };
        }
        return {
          applied: true,
          description: 'Switched the install command from `npm ci` to `npm install`.',
          filesTouched: [],
          commandOverrides: { install: base.replace('npm ci', 'npm install --no-audit --no-fund') },
        };
      },
    },

    {
      id: 'npm-ignore-engines',
      kind: 'install-flag',
      title: 'Bypass the engine-range check during install',
      rationale:
        'The engines field blocks installation on a mismatched Node version. When the declared runtime is unavailable, ignoring the check lets the rest of the diagnosis proceed instead of stopping at a warning.',
      priority: 20,
      category: 'runtime-version',
      risk: 'medium',
      source: 'deterministic',
      async apply(ctx): Promise<RepairEffect> {
        const base = ctx.detection.commands.install ?? 'npm install';
        const flag = ctx.detection.packageManager === 'yarn' ? '--ignore-engines' : '--engine-strict=false';
        return {
          applied: true,
          description: `Added ${flag} so the engine mismatch does not block installation. The mismatch itself is still reported.`,
          filesTouched: [],
          commandOverrides: { install: `${base} ${flag}` },
        };
      },
    },

    // -----------------------------------------------------------------------
    // Lockfiles
    // -----------------------------------------------------------------------
    {
      id: 'lockfile-regenerate',
      kind: 'lockfile-delete',
      title: 'Regenerate the lockfile from the manifest',
      rationale:
        'The lockfile records integrity hashes or a resolution tree that the registry no longer serves. Deleting it lets the package manager resolve a fresh tree that still respects every range declared in package.json.',
      priority: 15,
      category: 'broken-lockfile',
      risk: 'medium',
      source: 'deterministic',
      async apply(ctx): Promise<RepairEffect> {
        const touched: string[] = [];
        for (const lock of ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml']) {
          const file = path.join(ctx.projectDir, lock);
          if (await pathExists(file)) {
            await fs.rm(file, { force: true });
            touched.push(lock);
          }
        }
        return {
          applied: touched.length > 0,
          description: touched.length
            ? `Deleted ${touched.join(', ')} so the package manager resolves a fresh tree. Version ranges in package.json are unchanged, so the resolution stays within what the author specified.`
            : 'No lockfile to regenerate.',
          filesTouched: touched,
        };
      },
    },

    // -----------------------------------------------------------------------
    // Dead packages
    // -----------------------------------------------------------------------
    {
      id: 'dead-package-replace',
      kind: 'dependency-replace',
      title: 'Replace an unpublished package with its maintained successor',
      rationale:
        'The registry returns 404 for this dependency. Where a known drop-in successor exists, substituting it preserves behaviour; where none exists, the dependency is reported rather than silently swapped.',
      priority: 12,
      category: 'dead-package',
      risk: 'medium',
      source: 'deterministic',
      async apply(ctx): Promise<RepairEffect> {
        const missing = extractMissingPackages(ctx);
        if (!missing.length) {
          return { applied: false, description: 'No unresolvable package could be identified.', filesTouched: [] };
        }

        const swapped: string[] = [];
        const { changed } = await editPackageJson(ctx, (pkg) => {
          let didChange = false;
          for (const name of missing) {
            const replacement = PACKAGE_REPLACEMENTS[name];
            if (!replacement?.dropIn) continue;
            for (const field of ['dependencies', 'devDependencies'] as const) {
              if (pkg[field]?.[name]) {
                delete pkg[field]![name];
                pkg[field]![replacement.replacement] = replacement.version;
                swapped.push(`${name} -> ${replacement.replacement}@${replacement.version}`);
                didChange = true;
              }
            }
          }
          return didChange;
        });

        return {
          applied: changed,
          description: changed
            ? `Replaced unpublished packages: ${swapped.join(', ')}.`
            : `Could not safely replace ${missing.join(', ')} — no verified drop-in successor exists, so the dependency was left in place for a human to decide.`,
          filesTouched: changed ? ['package.json'] : [],
        };
      },
    },

    {
      id: 'dead-package-remove',
      kind: 'dependency-remove',
      title: 'Remove an unresolvable dependency',
      rationale:
        'When a package is gone from the registry and has no successor, removing it is the only way to complete installation. This is applied last, and only to dependencies that nothing in the source imports.',
      priority: 60,
      category: 'dead-package',
      risk: 'high',
      source: 'deterministic',
      async apply(ctx): Promise<RepairEffect> {
        const missing = extractMissingPackages(ctx);
        if (!missing.length) {
          return { applied: false, description: 'No unresolvable package identified.', filesTouched: [] };
        }

        const removed: string[] = [];
        const { changed } = await editPackageJson(ctx, (pkg) => {
          let didChange = false;
          for (const name of missing) {
            for (const field of ['dependencies', 'devDependencies'] as const) {
              if (pkg[field]?.[name]) {
                delete pkg[field]![name];
                removed.push(name);
                didChange = true;
              }
            }
          }
          return didChange;
        });

        return {
          applied: changed,
          description: changed
            ? `Removed unresolvable dependencies: ${removed.join(', ')}. If the source imports them the build will still fail, and that failure is reported rather than masked.`
            : 'Nothing to remove.',
          filesTouched: changed ? ['package.json'] : [],
        };
      },
    },

    // -----------------------------------------------------------------------
    // ESM / CJS
    // -----------------------------------------------------------------------
    {
      id: 'esm-pin-cjs-version',
      kind: 'dependency-bump',
      title: 'Pin ESM-only dependencies back to their last CommonJS release',
      rationale:
        'Several popular packages shipped an ESM-only major. A CommonJS project cannot require them. Pinning to the final CommonJS release keeps the original source working untouched, which is far less invasive than converting the project to ESM.',
      priority: 8,
      category: 'module-system',
      risk: 'low',
      source: 'deterministic',
      async apply(ctx): Promise<RepairEffect> {
        const pinned: string[] = [];
        const { changed } = await editPackageJson(ctx, (pkg) => {
          let didChange = false;
          for (const field of ['dependencies', 'devDependencies'] as const) {
            const table = pkg[field];
            if (!table) continue;
            for (const [name, range] of Object.entries(table)) {
              const lastCjs = LAST_CJS_VERSION[name];
              if (!lastCjs) continue;
              const currentMajor = Number.parseInt(String(range).replace(/^[^\d]*/, ''), 10);
              const cjsMajor = Number.parseInt(lastCjs.replace(/^[^\d]*/, ''), 10);
              if (Number.isFinite(currentMajor) && currentMajor > cjsMajor) {
                table[name] = lastCjs;
                pinned.push(`${name}@${range} -> ${lastCjs}`);
                didChange = true;
              }
            }
          }
          return didChange;
        });

        return {
          applied: changed,
          description: changed
            ? `Pinned ESM-only packages to their last CommonJS release: ${pinned.join(', ')}.`
            : 'No ESM-only dependency needed pinning.',
          filesTouched: changed ? ['package.json'] : [],
        };
      },
    },

    {
      id: 'esm-remove-type-module',
      kind: 'config-patch',
      title: 'Remove the incorrect ES module declaration',
      rationale:
        'package.json declares "type": "module" while the source is CommonJS, so Node refuses to load any file. The declaration is the thing that is wrong, not the source: removing it restores exactly the behaviour the code was written and tested against, and leaves every source file untouched.',
      priority: 4,
      category: 'module-system',
      risk: 'low',
      source: 'deterministic',
      async apply(ctx): Promise<RepairEffect> {
        const { changed } = await editPackageJson(ctx, (pkg) => {
          if (pkg.type !== 'module') return false;
          delete pkg.type;
          return true;
        });
        return {
          applied: changed,
          description: changed
            ? 'Removed "type": "module" from package.json, restoring CommonJS module resolution. No source files were modified.'
            : 'package.json does not declare "type": "module".',
          filesTouched: changed ? ['package.json'] : [],
        };
      },
    },

    {
      id: 'esm-set-type-module',
      kind: 'config-patch',
      title: 'Declare the package as an ES module',
      rationale:
        'The source uses import/export but package.json does not set "type": "module", so Node parses it as CommonJS.',
      priority: 25,
      category: 'module-system',
      risk: 'medium',
      source: 'deterministic',
      async apply(ctx): Promise<RepairEffect> {
        const { changed } = await editPackageJson(ctx, (pkg) => {
          if (pkg.type === 'module') return false;
          pkg.type = 'module';
          return true;
        });
        return {
          applied: changed,
          description: changed
            ? 'Added "type": "module" to package.json.'
            : 'package.json already declares "type": "module".',
          filesTouched: changed ? ['package.json'] : [],
        };
      },
    },

    // -----------------------------------------------------------------------
    // Bundlers
    // -----------------------------------------------------------------------
    {
      id: 'webpack-pin-major',
      kind: 'dependency-bump',
      title: 'Align the webpack version with the configuration it was written for',
      rationale:
        'A webpack config validates against one major version. Restoring the webpack release the config targets is less invasive and far more likely to succeed than migrating the configuration.',
      priority: 18,
      category: 'bundler-incompat',
      risk: 'medium',
      source: 'deterministic',
      async apply(ctx): Promise<RepairEffect> {
        const configText =
          (await readFileSafe(path.join(ctx.projectDir, 'webpack.config.js'))) ?? '';
        // webpack 5 config markers vs webpack 4 markers.
        const looksLikeV5 = /experiments\s*:|assetModuleFilename|\btype:\s*['"]asset/.test(configText);
        const target = looksLikeV5 ? '^5.91.0' : '^4.47.0';

        const { changed } = await editPackageJson(ctx, (pkg) => {
          const field = pkg.devDependencies?.webpack ? 'devDependencies' : 'dependencies';
          if (!pkg[field]?.webpack) return false;
          if (pkg[field]!.webpack === target) return false;
          pkg[field]!.webpack = target;
          // webpack-cli majors are coupled to webpack majors.
          if (pkg[field]!['webpack-cli']) {
            pkg[field]!['webpack-cli'] = looksLikeV5 ? '^5.1.4' : '^3.3.12';
          }
          return true;
        });

        return {
          applied: changed,
          description: changed
            ? `Pinned webpack to ${target}, matching the configuration style actually present in webpack.config.js.`
            : 'Webpack version already matches the configuration.',
          filesTouched: changed ? ['package.json'] : [],
        };
      },
    },

    {
      id: 'webpack-add-fallbacks',
      kind: 'config-patch',
      title: 'Restore Node core-module fallbacks removed in webpack 5',
      rationale:
        'Webpack 5 stopped auto-polyfilling Node core modules. Adding explicit `resolve.fallback: false` entries for the unresolved modules reproduces webpack 4 behaviour for builds that never used them at runtime.',
      priority: 30,
      category: 'bundler-incompat',
      risk: 'medium',
      source: 'deterministic',
      async apply(ctx): Promise<RepairEffect> {
        const file = path.join(ctx.projectDir, 'webpack.config.js');
        if (!(await pathExists(file))) {
          return { applied: false, description: 'No webpack.config.js found.', filesTouched: [] };
        }
        const text = await readFileSafe(file);
        if (!text || text.includes('resolve.fallback') || text.includes('fallback:')) {
          return { applied: false, description: 'Fallbacks are already configured.', filesTouched: [] };
        }

        const modules = new Set<string>();
        for (const d of ctx.diagnoses) {
          const matches = d.evidence.matchAll(/Can't resolve '([a-z]+)'/g);
          for (const m of matches) modules.add(m[1]);
        }
        if (!modules.size) {
          return { applied: false, description: 'No unresolved core modules identified.', filesTouched: [] };
        }

        const fallbackBlock = [...modules].map((m) => `      ${m}: false,`).join('\n');
        const patched = text.replace(
          /module\.exports\s*=\s*\{/,
          `module.exports = {\n  resolve: {\n    fallback: {\n${fallbackBlock}\n    },\n  },`,
        );
        if (patched === text) {
          return { applied: false, description: 'Could not locate the config object to patch.', filesTouched: [] };
        }
        await fs.writeFile(file, patched, 'utf8');
        return {
          applied: true,
          description: `Added resolve.fallback entries for ${[...modules].join(', ')} so webpack 5 stops trying to polyfill them.`,
          filesTouched: ['webpack.config.js'],
        };
      },
    },

    {
      id: 'babel-align-major',
      kind: 'config-patch',
      title: 'Align Babel packages with the configuration format in use',
      rationale:
        'Babel 6 and 7 use different package names and plugin formats. Mixing them produces preset-resolution failures.',
      priority: 22,
      category: 'build-config',
      risk: 'medium',
      source: 'deterministic',
      async apply(ctx): Promise<RepairEffect> {
        const hasBabelrc = await pathExists(path.join(ctx.projectDir, '.babelrc'));
        const { changed } = await editPackageJson(ctx, (pkg) => {
          let didChange = false;
          for (const field of ['dependencies', 'devDependencies'] as const) {
            const table = pkg[field];
            if (!table) continue;
            // Babel 6 packages alongside @babel/* is the broken combination.
            const hasLegacy = Object.keys(table).some((k) => /^babel-(core|preset|plugin)/.test(k));
            const hasModern = Object.keys(table).some((k) => k.startsWith('@babel/'));
            if (hasLegacy && hasModern) {
              for (const key of Object.keys(table)) {
                if (/^babel-(core|preset-env|preset-react|plugin)/.test(key)) {
                  delete table[key];
                  didChange = true;
                }
              }
            }
          }
          return didChange;
        });

        return {
          applied: changed,
          description: changed
            ? 'Removed Babel 6 packages that conflicted with the installed @babel/* (Babel 7) packages.'
            : `No conflicting Babel majors found${hasBabelrc ? ' (.babelrc is present and was left untouched)' : ''}.`,
          filesTouched: changed ? ['package.json'] : [],
        };
      },
    },

    // -----------------------------------------------------------------------
    // Misc
    // -----------------------------------------------------------------------
    {
      id: 'native-module-bump',
      kind: 'dependency-bump',
      title: 'Raise native dependencies to a release with prebuilt binaries',
      rationale:
        'Native modules ship prebuilt binaries per Node ABI. A release predating the running Node has no binary and must compile from source. The first release that supports the current ABI is the minimal fix.',
      priority: 28,
      category: 'native-module',
      risk: 'medium',
      source: 'deterministic',
      async apply(ctx): Promise<RepairEffect> {
        // Minimum versions that ship prebuilds for Node 18/20.
        const MODERN: Record<string, string> = {
          bcrypt: '^5.1.1',
          sqlite3: '^5.1.7',
          canvas: '^2.11.2',
          sharp: '^0.33.0',
          'better-sqlite3': '^11.0.0',
          grpc: '@grpc/grpc-js',
          'utf-8-validate': '^6.0.3',
          bufferutil: '^4.0.8',
          fsevents: '^2.3.3',
        };
        const bumped: string[] = [];
        const { changed } = await editPackageJson(ctx, (pkg) => {
          let didChange = false;
          for (const field of ['dependencies', 'devDependencies'] as const) {
            const table = pkg[field];
            if (!table) continue;
            for (const [name, target] of Object.entries(MODERN)) {
              if (!table[name] || target.startsWith('@')) continue;
              if (table[name] === target) continue;
              bumped.push(`${name}@${table[name]} -> ${target}`);
              table[name] = target;
              didChange = true;
            }
          }
          return didChange;
        });

        return {
          applied: changed,
          description: changed
            ? `Raised native modules to releases with prebuilt binaries: ${bumped.join(', ')}.`
            : 'No known native module needed raising.',
          filesTouched: changed ? ['package.json'] : [],
        };
      },
    },

    {
      id: 'install-missing-module',
      kind: 'dependency-bump',
      title: 'Add a module that is imported but not declared',
      rationale:
        'Older package managers hoisted transitive dependencies to the top level, so code could import packages it never declared. Modern resolvers do not, exposing the missing declaration.',
      priority: 26,
      category: 'obsolete-dependency',
      risk: 'medium',
      source: 'deterministic',
      async apply(ctx): Promise<RepairEffect> {
        const missing = new Set<string>();
        for (const d of ctx.diagnoses) {
          if (d.category !== 'obsolete-dependency') continue;
          for (const m of d.evidence.matchAll(
            /Cannot find module ['"]([^'".][^'"]*)['"]|Can't resolve ['"]([^'".][^'"]*)['"]/g,
          )) {
            const name = m[1] || m[2];
            // Only bare package specifiers; relative imports are a source bug.
            if (name && !name.startsWith('.') && !name.startsWith('/')) {
              const pkgName = name.startsWith('@')
                ? name.split('/').slice(0, 2).join('/')
                : name.split('/')[0];
              missing.add(pkgName);
            }
          }
        }
        if (!missing.size) {
          return { applied: false, description: 'No undeclared module identified.', filesTouched: [] };
        }

        const added: string[] = [];
        const { changed } = await editPackageJson(ctx, (pkg) => {
          let didChange = false;
          pkg.dependencies ??= {};
          for (const name of missing) {
            if (pkg.dependencies[name] || pkg.devDependencies?.[name]) continue;
            pkg.dependencies[name] = '*';
            added.push(name);
            didChange = true;
          }
          return didChange;
        });

        return {
          applied: changed,
          description: changed
            ? `Declared previously-implicit dependencies: ${added.join(', ')}. They are added with an open range so the resolver picks a version compatible with the rest of the tree.`
            : 'All imported modules are already declared.',
          filesTouched: changed ? ['package.json'] : [],
        };
      },
    },

    {
      id: 'increase-node-memory',
      kind: 'env-inject',
      title: 'Raise the Node heap limit for the build',
      rationale:
        'Older bundlers exceed the default heap on large projects. Raising max-old-space-size is a runtime flag and changes nothing in the repository.',
      priority: 35,
      category: 'build-config',
      risk: 'low',
      source: 'deterministic',
      async apply(): Promise<RepairEffect> {
        return {
          applied: true,
          description: 'Set NODE_OPTIONS=--max-old-space-size=3072 for subsequent steps.',
          filesTouched: [],
          envPatch: { NODE_OPTIONS: '--max-old-space-size=3072' },
        };
      },
    },

    {
      id: 'disable-watch-mode',
      kind: 'script-patch',
      title: 'Run tests in single-run mode instead of watch mode',
      rationale:
        'Test runners default to watch mode in interactive terminals and never exit, which reads as a hang. CI=true plus an explicit --watchAll=false forces a single run.',
      priority: 6,
      category: 'outdated-script',
      risk: 'low',
      source: 'deterministic',
      async apply(ctx): Promise<RepairEffect> {
        const base = ctx.detection.commands.test;
        if (!base) {
          return { applied: false, description: 'No test command to adjust.', filesTouched: [] };
        }
        const overrides: Record<string, string> = {};
        let command = base;
        if (!/--watch(All)?=false|--run\b|--ci\b/.test(command)) {
          command = `${command} -- --watchAll=false --ci`;
        }
        overrides.test = command;
        return {
          applied: true,
          description: 'Forced the test runner into single-run mode (CI=true, --watchAll=false).',
          filesTouched: [],
          envPatch: { CI: 'true' },
          commandOverrides: overrides,
        };
      },
    },

    {
      id: 'dependency-relax-range',
      kind: 'dependency-bump',
      title: 'Relax an unsatisfiable exact version pin',
      rationale:
        'An exact pin to a version that was unpublished can never resolve. Widening it to the nearest compatible range keeps the author intent (same major) while allowing resolution.',
      priority: 40,
      category: 'obsolete-dependency',
      risk: 'medium',
      source: 'deterministic',
      async apply(ctx): Promise<RepairEffect> {
        const targets = new Set<string>();
        for (const d of ctx.diagnoses) {
          for (const m of d.evidence.matchAll(
            /No matching version found for ([@\w/.-]+)|notarget[^\n]*?for ([@\w/.-]+)/g,
          )) {
            const raw = m[1] || m[2];
            if (raw) targets.add(raw.replace(/@[^@]*$/, '').replace(/@$/, ''));
          }
        }

        const relaxed: string[] = [];
        const { changed } = await editPackageJson(ctx, (pkg) => {
          let didChange = false;
          for (const field of ['dependencies', 'devDependencies'] as const) {
            const table = pkg[field];
            if (!table) continue;
            for (const name of targets) {
              const range = table[name];
              if (!range) continue;
              // Exact pin -> caret range on the same major.
              if (/^\d+\.\d+\.\d+/.test(String(range))) {
                const major = String(range).split('.')[0];
                table[name] = `^${major}.0.0`;
                relaxed.push(`${name}@${range} -> ^${major}.0.0`);
                didChange = true;
              }
            }
          }
          return didChange;
        });

        return {
          applied: changed,
          description: changed
            ? `Relaxed unsatisfiable pins within the same major version: ${relaxed.join(', ')}.`
            : 'No unsatisfiable exact pin identified.',
          filesTouched: changed ? ['package.json'] : [],
        };
      },
    },
  ];
}

/** Pull package names out of 404 / ETARGET diagnosis evidence. */
export function extractMissingPackages(ctx: RepairContext): string[] {
  const names = new Set<string>();
  for (const d of ctx.diagnoses) {
    if (d.category !== 'dead-package' && d.category !== 'obsolete-dependency') continue;
    const patterns = [
      /404[^\n]*?['"]([@\w/.-]+)['"]/g,
      /404 Not Found[^\n]*?\/([@\w/.-]+)/g,
      /No matching version found for ([@\w/.-]+?)(?:@|\s|$)/g,
    ];
    for (const pattern of patterns) {
      for (const m of d.evidence.matchAll(pattern)) {
        const raw = (m[1] || '').replace(/^-\s*/, '').replace(/@[\d^~<>=].*$/, '');
        if (raw && raw.length < 100) names.add(raw);
      }
    }
  }
  return [...names];
}
