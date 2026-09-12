import path from 'node:path';
import fs from 'node:fs/promises';
import { pathExists } from '../fsutil';
import type { Diagnosis, Language, RepairAction, RepairEffect } from '../types';
import { nodeRepairs } from './node';
import { pythonRepairs } from './python';
import { jvmRepairs } from './jvm';
import { goRepairs, rustRepairs } from './golang';

/**
 * Repair registry and planner.
 *
 * The planner is where the repair philosophy is enforced: it chooses the
 * smallest set of changes that could unblock the earliest failing step, ordered
 * so that cheap, reversible, low-risk repairs are always tried before invasive
 * ones. It never applies a repair that no diagnosis asked for.
 */

/** Repairs that are not specific to any one language. */
function commonRepairs(): RepairAction[] {
  return [
    {
      id: 'inject-placeholder-env',
      kind: 'env-inject',
      title: 'Supply placeholder values for missing environment variables',
      rationale:
        'Abandoned projects routinely assume a .env file that was never committed. Injecting inert placeholders lets the build proceed far enough to reveal the real failures, and the assumption is recorded in the report rather than hidden.',
      priority: 4,
      category: 'missing-env',
      risk: 'low',
      source: 'deterministic',
      async apply(ctx): Promise<RepairEffect> {
        const names = new Set<string>();
        for (const d of ctx.diagnoses) {
          if (d.category !== 'missing-env') continue;
          for (const m of d.evidence.matchAll(/\b([A-Z][A-Z0-9_]{2,})\b/g)) {
            const name = m[1];
            // Skip common log noise that looks like a variable name.
            if (['ERROR', 'WARNING', 'FATAL', 'DEBUG', 'INFO', 'TRACE', 'NOTE'].includes(name)) {
              continue;
            }
            names.add(name);
          }
        }

        // A .env.example is the authoritative list of what the project wanted.
        const examplePath = path.join(ctx.projectDir, '.env.example');
        let fromExample = 0;
        const envPatch: Record<string, string> = {};

        if (await pathExists(examplePath)) {
          const text = await fs.readFile(examplePath, 'utf8');
          for (const line of text.split('\n')) {
            const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=/);
            if (match) {
              names.add(match[1]);
              fromExample++;
            }
          }
        }

        if (!names.size) {
          return { applied: false, description: 'No missing environment variable identified.', filesTouched: [] };
        }

        for (const name of names) {
          // Inert, obviously-fake values. Never a real-looking credential.
          envPatch[name] = `revive-placeholder-${name.toLowerCase()}`;
        }

        return {
          applied: true,
          description: `Injected ${names.size} placeholder environment variable(s)${
            fromExample ? ` (${fromExample} read from .env.example)` : ''
          }: ${[...names].slice(0, 10).join(', ')}${names.size > 10 ? ', ...' : ''}. Values are inert placeholders — the project will need real values to do anything useful.`,
          filesTouched: [],
          envPatch,
        };
      },
    },

    {
      id: 'retry-with-backoff',
      kind: 'install-flag',
      title: 'Retry the failed network operation',
      rationale:
        'Registry timeouts are transient. A bounded retry distinguishes a flaky network from a genuinely missing package, so the diagnosis is not poisoned by an unrelated outage.',
      priority: 1,
      category: 'network',
      risk: 'low',
      source: 'deterministic',
      async apply(): Promise<RepairEffect> {
        return {
          applied: true,
          description: 'Retrying the install step — the previous failure looked like a transient network error.',
          filesTouched: [],
        };
      },
    },
  ];
}

/** Runtime-reconstruction repairs, one per language. These are handled by the
 *  orchestrator (which owns toolchain selection), so they are declared here
 *  purely so diagnoses can reference them by id. */
function runtimeRepairs(): RepairAction[] {
  const make = (id: string, language: string): RepairAction => ({
    id,
    kind: 'runtime-pin',
    title: `Run with the ${language} version the project originally targeted`,
    rationale: `The reconstructed environment names a specific ${language} version. Running the project unchanged on that version is the least invasive possible repair, and it is always attempted before any file is edited.`,
    priority: 0,
    category: 'runtime-version',
    risk: 'low',
    source: 'deterministic',
    async apply(): Promise<RepairEffect> {
      // The orchestrator performs the actual toolchain switch when it selects
      // a sandbox image; this action records the intent in the report.
      return {
        applied: true,
        description: `Requested the reconstructed ${language} runtime for subsequent steps.`,
        filesTouched: [],
      };
    },
  });

  return [
    make('node-use-declared-runtime', 'Node'),
    make('python-use-declared-runtime', 'Python'),
    make('java-use-declared-runtime', 'Java'),
    make('go-use-declared-runtime', 'Go'),
    make('rust-use-declared-runtime', 'Rust'),
  ];
}

/** Every repair Revive knows about, keyed by id. */
export function buildRegistry(): Map<string, RepairAction> {
  const all = [
    ...commonRepairs(),
    ...runtimeRepairs(),
    ...nodeRepairs(),
    ...pythonRepairs(),
    ...jvmRepairs(),
    ...goRepairs(),
    ...rustRepairs(),
  ];
  const registry = new Map<string, RepairAction>();
  for (const action of all) registry.set(action.id, action);
  return registry;
}

export const REGISTRY = buildRegistry();

export interface PlanInput {
  diagnoses: Diagnosis[];
  language: Language;
  /** Repair ids already attempted, so a plan never repeats itself. */
  attempted: Set<string>;
  /** How many repairs this attempt may apply. */
  budget?: number;
}

/**
 * Choose the repairs for the next attempt.
 *
 * Only repairs suggested by an actual diagnosis are eligible. They are ordered
 * by (severity of the diagnosis that asked for them, then repair priority), and
 * the budget keeps each attempt small so that when verification improves we
 * know which change was responsible.
 */
export function planRepairs(input: PlanInput): RepairAction[] {
  const budget = input.budget ?? 3;
  const scored = new Map<string, { action: RepairAction; score: number }>();

  const severityWeight = { blocker: 0, major: 100, minor: 200 };

  for (const diagnosis of input.diagnoses) {
    for (const repairId of diagnosis.suggestedRepairs) {
      if (input.attempted.has(repairId)) continue;
      const action = REGISTRY.get(repairId);
      if (!action) continue;

      // Score: lower is applied earlier.
      const score = severityWeight[diagnosis.severity] + action.priority - diagnosis.confidence / 10;
      const existing = scored.get(repairId);
      if (!existing || score < existing.score) {
        scored.set(repairId, { action, score });
      }
    }
  }

  return [...scored.values()]
    .sort((a, b) => a.score - b.score)
    .slice(0, budget)
    .map((entry) => entry.action);
}

/** Human-readable strategy label for an attempt, shown in the UI. */
export function describeStrategy(actions: RepairAction[]): string {
  if (!actions.length) return 'No further repairs available';
  if (actions.length === 1) return actions[0].title;
  return `${actions[0].title} (+${actions.length - 1} more)`;
}

export { nodeRepairs, pythonRepairs, jvmRepairs, goRepairs, rustRepairs };
export { PACKAGE_REPLACEMENTS, LAST_CJS_VERSION } from './node';
export { STDLIB_REMOVALS } from './python';
export { minimumTargetForJdk, JDK_MINIMUM_TARGET } from './jvm';
