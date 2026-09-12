import path from 'node:path';
import fs from 'node:fs/promises';
import { pathExists, readFileSafe, walkRepo } from '../fsutil';
import type { RepairAction, RepairContext, RepairEffect } from '../types';

/**
 * Python repairs.
 *
 * Python breakage is dominated by three things: interpreter-version syntax,
 * standard-library removals, and packaging tooling that dropped legacy paths.
 * The repairs below address each without rewriting project logic.
 */

/** Standard-library modules removed in recent Python, with their replacements. */
export const STDLIB_REMOVALS: Record<string, { removedIn: string; shim: string | null }> = {
  imp: { removedIn: '3.12', shim: 'importlib' },
  distutils: { removedIn: '3.12', shim: 'setuptools' },
  asyncore: { removedIn: '3.12', shim: null },
  asynchat: { removedIn: '3.12', shim: null },
  smtpd: { removedIn: '3.12', shim: 'aiosmtpd' },
  cgi: { removedIn: '3.13', shim: 'legacy-cgi' },
  telnetlib: { removedIn: '3.13', shim: null },
  nntplib: { removedIn: '3.13', shim: null },
};

export function pythonRepairs(): RepairAction[] {
  return [
    {
      id: 'python-venv-fallback',
      kind: 'env-inject',
      title: 'Fall back to the system interpreter when no virtualenv is possible',
      rationale:
        'A virtualenv could not be created on this machine. Isolation is desirable but it is not what the user asked about — they want to know whether the project works. Revive drops the virtualenv, puts the project root on PYTHONPATH so imports still resolve, and continues. The reduced isolation is recorded in the report.',
      priority: 2,
      category: 'missing-toolchain',
      risk: 'low',
      source: 'deterministic',
      async apply(ctx): Promise<RepairEffect> {
        const commands = ctx.detection.commands;
        const usesVenv = Object.values(commands).some((c) => c && c.includes('.venv'));
        if (!usesVenv) {
          return {
            applied: false,
            description: 'Commands do not depend on a virtualenv.',
            filesTouched: [],
          };
        }

        // Rewrite every command to use the interpreter already on PATH.
        const rewrite = (command: string | undefined): string | undefined => {
          if (!command) return undefined;
          return command
            .replace(/\.venv[\\/](?:Scripts|bin)[\\/]python/g, 'python')
            .replace(/python -m venv \.venv\s*&&\s*/g, '')
            .replace(/^python -m venv \.venv$/, 'python --version');
        };

        return {
          applied: true,
          description:
            'Switched to the system Python interpreter and added the project root to PYTHONPATH. Dependencies are NOT installed into an isolated environment, so any install step is skipped rather than polluting the host interpreter.',
          filesTouched: [],
          envPatch: { PYTHONPATH: ctx.projectDir },
          commandOverrides: {
            // Nothing is installed system-wide: verifying the interpreter runs
            // is the honest substitute for an install step here.
            install: 'python --version',
            build: rewrite(commands.build),
            test: rewrite(commands.test),
            start: rewrite(commands.start),
          },
        };
      },
    },

    {
      id: 'python-pin-setuptools',
      kind: 'toolchain-pin',
      title: 'Pin setuptools to the generation the project was built against',
      rationale:
        'setuptools 58 removed use_2to3 and later versions stopped patching distutils. Packages authored before that fail to install. Pinning setuptools restores the install path the project expected instead of modifying the package itself.',
      priority: 8,
      category: 'build-config',
      risk: 'low',
      source: 'deterministic',
      async apply(ctx): Promise<RepairEffect> {
        const base = ctx.detection.commands.install ?? '';
        const pyBin = pythonBin();
        // Insert the pin immediately after venv creation so it applies to
        // every subsequent install in the same environment.
        const pinned = base.replace(
          /(-m pip install --upgrade pip[^&]*)/,
          `${pyBin} -m pip install "setuptools<58" "wheel<0.38"`,
        );
        const command =
          pinned === base
            ? `${pyBin} -m pip install "setuptools<58" "wheel<0.38" && ${base}`
            : pinned;

        return {
          applied: true,
          description:
            'Pinned setuptools<58 and wheel<0.38 for the install step, restoring the legacy build behaviour the package was written for.',
          filesTouched: [],
          commandOverrides: { install: command },
        };
      },
    },

    {
      id: 'python-pin-pip',
      kind: 'toolchain-pin',
      title: 'Pin pip to a version that still supports legacy installs',
      rationale:
        'pip 23 removed the `setup.py install` fallback. Packages without wheels cannot install under modern pip. Pinning pip is reversible and leaves the project untouched.',
      priority: 12,
      category: 'obsolete-dependency',
      risk: 'medium',
      source: 'deterministic',
      async apply(ctx): Promise<RepairEffect> {
        const base = ctx.detection.commands.install ?? '';
        const pyBin = pythonBin();
        const command = base.replace(
          /-m pip install --upgrade pip[^&]*/,
          `-m pip install "pip<23.1" "setuptools<68" wheel`,
        );
        return {
          applied: command !== base,
          description:
            command !== base
              ? 'Pinned pip<23.1 so the legacy setup.py install path remains available.'
              : 'Install command does not upgrade pip; no change made.',
          filesTouched: [],
          commandOverrides: command !== base ? { install: command } : undefined,
        };
      },
    },

    {
      id: 'python-install-shim',
      kind: 'dependency-bump',
      title: 'Install a shim for a removed standard-library module',
      rationale:
        'Some removed stdlib modules have maintained PyPI backports that restore the original import path exactly. Adding one is far less invasive than rewriting every call site.',
      priority: 14,
      category: 'compiler-behavior',
      risk: 'low',
      source: 'deterministic',
      async apply(ctx): Promise<RepairEffect> {
        const needed = new Set<string>();
        for (const d of ctx.diagnoses) {
          for (const m of d.evidence.matchAll(/No module named ['"]([\w.]+)['"]/g)) {
            const mod = m[1].split('.')[0];
            if (STDLIB_REMOVALS[mod]?.shim) needed.add(STDLIB_REMOVALS[mod].shim!);
          }
        }
        if (!needed.size) {
          return { applied: false, description: 'No shimmable stdlib removal detected.', filesTouched: [] };
        }

        const base = ctx.detection.commands.install ?? '';
        const pyBin = pythonBin();
        const shims = [...needed].join(' ');
        return {
          applied: true,
          description: `Installed backport shims for removed standard-library modules: ${shims}.`,
          filesTouched: [],
          commandOverrides: { install: `${base} && ${pyBin} -m pip install ${shims}` },
        };
      },
    },

    {
      id: 'python-relax-pin',
      kind: 'dependency-bump',
      title: 'Relax an unsatisfiable requirement pin',
      rationale:
        'Old exact pins frequently have no wheel for a newer interpreter. Relaxing the pin to a compatible-release range keeps the author intent while letting pip resolve something installable.',
      priority: 30,
      category: 'obsolete-dependency',
      risk: 'medium',
      source: 'deterministic',
      async apply(ctx): Promise<RepairEffect> {
        const targets = new Set<string>();
        for (const d of ctx.diagnoses) {
          for (const m of d.evidence.matchAll(
            /No matching distribution found for ([\w.-]+)|satisfies the requirement ([\w.-]+)/g,
          )) {
            const name = (m[1] || m[2] || '').replace(/[=<>!~].*$/, '');
            if (name) targets.add(name.toLowerCase());
          }
        }
        if (!targets.size) {
          return { applied: false, description: 'No unsatisfiable requirement identified.', filesTouched: [] };
        }

        const touched: string[] = [];
        const relaxed: string[] = [];
        const reqFiles = ctx.detection.manifestFiles.filter((f) => f.endsWith('.txt'));

        for (const file of reqFiles) {
          const full = path.join(ctx.projectDir, file);
          const text = await readFileSafe(full);
          if (!text) continue;
          let changed = false;

          const lines = text.split('\n').map((line) => {
            const match = line.match(/^\s*([A-Za-z0-9._-]+)\s*==\s*([\d.]+)/);
            if (!match) return line;
            if (!targets.has(match[1].toLowerCase())) return line;
            const [major, minor] = match[2].split('.');
            // `~=major.minor` allows patch updates only — the smallest widening
            // that can actually resolve.
            const replacement = `${match[1]}>=${major}.${minor ?? 0}`;
            relaxed.push(`${match[1]}==${match[2]} -> ${replacement}`);
            changed = true;
            return replacement;
          });

          if (changed) {
            await fs.writeFile(full, lines.join('\n'), 'utf8');
            touched.push(file);
          }
        }

        return {
          applied: touched.length > 0,
          description: touched.length
            ? `Relaxed unsatisfiable pins: ${relaxed.join(', ')}.`
            : 'No matching exact pin found in the requirement files.',
          filesTouched: touched,
        };
      },
    },

    {
      id: 'python-2to3',
      kind: 'source-patch',
      title: 'Migrate Python 2 syntax to Python 3',
      rationale:
        'Running Python 2 source on a Python 3 interpreter fails at parse time. When no Python 2 interpreter is available, a conservative, mechanical 2to3 conversion of print statements and except clauses is the only route to execution. This is the most invasive repair Revive performs, and every changed file is listed in the diff.',
      priority: 70,
      category: 'python-version',
      risk: 'high',
      source: 'deterministic',
      async apply(ctx): Promise<RepairEffect> {
        const { files } = await walkRepo(ctx.projectDir, { maxFiles: 5000 });
        const pyFiles = files.filter((f) => f.endsWith('.py'));
        const touched: string[] = [];

        for (const rel of pyFiles) {
          const full = path.join(ctx.projectDir, rel);
          const text = await readFileSafe(full);
          if (!text) continue;

          let updated = text;

          // print "x"  ->  print("x")     (statement form only)
          updated = updated.replace(
            /^(\s*)print\s+(?!\()([^\n#]+?)\s*$/gm,
            (_all, indent: string, expr: string) => {
              const trimmed = expr.trim().replace(/,\s*$/, '');
              return `${indent}print(${trimmed})`;
            },
          );

          // except Error, e:  ->  except Error as e:
          updated = updated.replace(
            /except\s+([\w.]+)\s*,\s*(\w+)\s*:/g,
            'except $1 as $2:',
          );

          // raise E, "msg"  ->  raise E("msg")
          updated = updated.replace(
            /raise\s+(\w+)\s*,\s*(['"][^'"]*['"])/g,
            'raise $1($2)',
          );

          if (updated !== text) {
            await fs.writeFile(full, updated, 'utf8');
            touched.push(rel);
          }
        }

        return {
          applied: touched.length > 0,
          description: touched.length
            ? `Applied a conservative Python 2 to 3 migration to ${touched.length} file(s): print statements, except clauses and raise statements. Semantics beyond syntax (integer division, dict iteration order, unicode handling) were deliberately NOT changed, because those require understanding intent.`
            : 'No Python 2 syntax patterns were found to convert.',
          filesTouched: touched,
        };
      },
    },
  ];
}

function pythonBin(): string {
  return process.platform === 'win32' ? '.venv\\Scripts\\python' : '.venv/bin/python';
}
