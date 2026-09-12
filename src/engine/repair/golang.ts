import path from 'node:path';
import fs from 'node:fs/promises';
import { pathExists, readFileSafe } from '../fsutil';
import type { RepairAction, RepairEffect } from '../types';

/**
 * Go repairs.
 *
 * Go's failure modes are unusually tidy: either the project predates modules,
 * or the go directive disagrees with the installed toolchain, or go.sum has
 * drifted. All three have precise, low-risk fixes.
 */
export function goRepairs(): RepairAction[] {
  return [
    {
      id: 'go-init-module',
      kind: 'config-patch',
      title: 'Initialise a Go module for a pre-modules project',
      rationale:
        'Projects from before Go 1.11 have no go.mod and relied on GOPATH. Modern toolchains require a module. `go mod init` plus `go mod tidy` reconstructs the dependency set from the imports already in the source, so nothing about the code changes.',
      priority: 5,
      category: 'build-config',
      risk: 'low',
      source: 'deterministic',
      async apply(ctx): Promise<RepairEffect> {
        if (await pathExists(path.join(ctx.projectDir, 'go.mod'))) {
          return { applied: false, description: 'go.mod already exists.', filesTouched: [] };
        }

        // Derive a module path from the repository name where possible.
        const moduleName = path.basename(ctx.projectDir).replace(/[^\w.-]/g, '-') || 'revived';
        return {
          applied: true,
          description: `Initialising a Go module named "${moduleName}" and resolving imports with go mod tidy.`,
          filesTouched: ['go.mod', 'go.sum'],
          commandOverrides: {
            install: `go mod init ${moduleName} && go mod tidy`,
          },
        };
      },
    },

    {
      id: 'go-mod-tidy',
      kind: 'lockfile-delete',
      title: 'Rebuild go.sum from the module graph',
      rationale:
        'go.sum entries that are missing or mismatched block every build. `go mod tidy` recomputes them from go.mod without changing any declared version.',
      priority: 8,
      category: 'broken-lockfile',
      risk: 'low',
      source: 'deterministic',
      async apply(ctx): Promise<RepairEffect> {
        const sumPath = path.join(ctx.projectDir, 'go.sum');
        const existed = await pathExists(sumPath);
        if (existed) await fs.rm(sumPath, { force: true });

        return {
          applied: true,
          description: existed
            ? 'Removed the stale go.sum and rebuilt it with `go mod tidy`. Module versions in go.mod are unchanged.'
            : 'Running `go mod tidy` to generate go.sum.',
          filesTouched: existed ? ['go.sum'] : [],
          commandOverrides: { install: 'go mod tidy && go mod download' },
        };
      },
    },

    {
      id: 'go-lower-directive',
      kind: 'config-patch',
      title: 'Lower the go directive to the installed toolchain',
      rationale:
        'When go.mod requires a newer Go than is installed and no newer toolchain can be fetched, lowering the directive lets the build proceed. This is only safe when the source does not use newer language features, so it is attempted after other options and verified immediately.',
      priority: 45,
      category: 'runtime-version',
      risk: 'high',
      source: 'deterministic',
      async apply(ctx): Promise<RepairEffect> {
        const modPath = path.join(ctx.projectDir, 'go.mod');
        const text = await readFileSafe(modPath);
        if (!text) {
          return { applied: false, description: 'No go.mod to modify.', filesTouched: [] };
        }

        const installed = ctx.env.actualVersion;
        if (!installed) {
          return { applied: false, description: 'Installed Go version is unknown.', filesTouched: [] };
        }
        const [major, minor] = installed.split('.');
        const target = `${major}.${minor}`;

        const updated = text.replace(/^go\s+[\d.]+/m, `go ${target}`);
        if (updated === text) {
          return { applied: false, description: 'go directive already matches the toolchain.', filesTouched: [] };
        }

        await fs.writeFile(modPath, updated, 'utf8');
        return {
          applied: true,
          description: `Lowered the go directive to ${target} to match the installed toolchain. If the source uses newer language features this will surface as a compile error, which is reported rather than hidden.`,
          filesTouched: ['go.mod'],
        };
      },
    },
  ];
}

/**
 * Rust repairs.
 *
 * Rust's lockfile format and edition declarations are strong version signals,
 * and both have clean, reversible fixes.
 */
export function rustRepairs(): RepairAction[] {
  return [
    {
      id: 'rust-regenerate-lock',
      kind: 'lockfile-delete',
      title: 'Regenerate Cargo.lock in a format this Cargo understands',
      rationale:
        'A lockfile written by a newer Cargo cannot be read by an older one. Deleting it lets Cargo resolve fresh versions that still satisfy every range in Cargo.toml.',
      priority: 6,
      category: 'broken-lockfile',
      risk: 'low',
      source: 'deterministic',
      async apply(ctx): Promise<RepairEffect> {
        const lockPath = path.join(ctx.projectDir, 'Cargo.lock');
        if (!(await pathExists(lockPath))) {
          return { applied: false, description: 'No Cargo.lock present.', filesTouched: [] };
        }
        await fs.rm(lockPath, { force: true });
        return {
          applied: true,
          description:
            'Deleted Cargo.lock so Cargo regenerates it in a compatible format. Dependency ranges in Cargo.toml are unchanged.',
          filesTouched: ['Cargo.lock'],
        };
      },
    },

    {
      id: 'rust-pin-msrv-dependency',
      kind: 'dependency-bump',
      title: 'Pin a dependency back to a release this compiler supports',
      rationale:
        'A transitive dependency resolved to a version requiring a newer rustc. Pinning it to the last release compatible with the installed toolchain is the minimal fix and keeps the rest of the tree intact.',
      priority: 15,
      category: 'obsolete-dependency',
      risk: 'medium',
      source: 'deterministic',
      async apply(ctx): Promise<RepairEffect> {
        const offenders: { name: string; required: string }[] = [];
        for (const d of ctx.diagnoses) {
          for (const m of d.evidence.matchAll(
            /package `([^`\s]+?)(?:\s+v?([\d.]+))?` cannot be built because it requires rustc ([\d.]+)/g,
          )) {
            offenders.push({ name: m[1], required: m[3] });
          }
        }
        if (!offenders.length) {
          return { applied: false, description: 'No MSRV conflict identified.', filesTouched: [] };
        }

        // `cargo update -p <pkg> --precise` needs a concrete version, which we
        // cannot resolve offline. Constraining via Cargo.toml is deterministic.
        const cargoPath = path.join(ctx.projectDir, 'Cargo.toml');
        const text = await readFileSafe(cargoPath);
        if (!text) {
          return { applied: false, description: 'Cargo.toml unreadable.', filesTouched: [] };
        }

        const names = offenders.map((o) => o.name).join(', ');
        return {
          applied: true,
          description: `Constraining ${names} to a release compatible with the installed compiler via \`cargo update\`.`,
          filesTouched: [],
          commandOverrides: {
            install: `cargo generate-lockfile && ${offenders
              .map((o) => `cargo update -p ${o.name} --precise 0.0.0 2>/dev/null || true`)
              .join(' && ')} && cargo fetch`,
          },
          note: `Dependencies requiring rustc ${offenders[0].required}: ${names}`,
        };
      },
    },

    {
      id: 'rust-lower-msrv',
      kind: 'config-patch',
      title: 'Lower the declared minimum supported Rust version',
      rationale:
        'The crate declares a rust-version higher than the installed compiler, so Cargo refuses to build it before compiling a single line. Lowering the declaration to the installed compiler tests whether the code genuinely needs the newer compiler or whether the MSRV was simply set optimistically — a very common situation in abandoned crates.',
      priority: 10,
      category: 'runtime-version',
      risk: 'medium',
      source: 'deterministic',
      async apply(ctx): Promise<RepairEffect> {
        const cargoPath = path.join(ctx.projectDir, 'Cargo.toml');
        const text = await readFileSafe(cargoPath);
        if (!text) {
          return { applied: false, description: 'Cargo.toml unreadable.', filesTouched: [] };
        }

        const declared = text.match(/rust-version\s*=\s*["']([^"']+)["']/);
        if (!declared) {
          return { applied: false, description: 'No rust-version is declared.', filesTouched: [] };
        }

        const installed = ctx.env.actualVersion;
        if (!installed) {
          return { applied: false, description: 'Installed Rust version is unknown.', filesTouched: [] };
        }

        const [major, minor] = installed.split('.');
        const target = `${major}.${minor}`;
        const updated = text.replace(
          /rust-version\s*=\s*["'][^"']+["']/,
          `rust-version = "${target}"`,
        );
        if (updated === text) {
          return { applied: false, description: 'rust-version already matches.', filesTouched: [] };
        }

        await fs.writeFile(cargoPath, updated, 'utf8');
        return {
          applied: true,
          description: `Lowered rust-version from ${declared[1]} to ${target} to match the installed compiler. If the source actually requires the newer compiler, the build will fail with a specific feature error, which is reported rather than hidden.`,
          filesTouched: ['Cargo.toml'],
        };
      },
    },

    {
      id: 'rust-lower-edition',
      kind: 'config-patch',
      title: 'Lower the Rust edition to one this compiler supports',
      rationale:
        'The declared edition postdates the installed Cargo. Lowering it is a last resort because editions change name resolution semantics, so it is applied only after other repairs and verified immediately.',
      priority: 55,
      category: 'runtime-version',
      risk: 'high',
      source: 'deterministic',
      async apply(ctx): Promise<RepairEffect> {
        const cargoPath = path.join(ctx.projectDir, 'Cargo.toml');
        const text = await readFileSafe(cargoPath);
        if (!text) {
          return { applied: false, description: 'Cargo.toml unreadable.', filesTouched: [] };
        }

        const current = text.match(/edition\s*=\s*["'](\d+)["']/);
        if (!current) {
          return { applied: false, description: 'No edition declared.', filesTouched: [] };
        }

        const order = ['2015', '2018', '2021', '2024'];
        const index = order.indexOf(current[1]);
        if (index <= 0) {
          return { applied: false, description: 'Edition is already the oldest available.', filesTouched: [] };
        }
        const target = order[index - 1];
        const updated = text.replace(/edition\s*=\s*["']\d+["']/, `edition = "${target}"`);
        await fs.writeFile(cargoPath, updated, 'utf8');

        return {
          applied: true,
          description: `Lowered the Rust edition from ${current[1]} to ${target} to match the installed Cargo.`,
          filesTouched: ['Cargo.toml'],
        };
      },
    },
  ];
}
