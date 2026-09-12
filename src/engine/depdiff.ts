import path from 'node:path';
import { git } from './git';
import { readFileSafe, stripBom } from './fsutil';
import { parseRequirement } from './detect/python';
import type { AppliedRepair, DependencyChange, Language } from './types';

/**
 * Dependency diffing.
 *
 * Rather than diffing text, this compares the parsed dependency tables before
 * and after, so the UI can show "react 16.8.0 -> 17.0.2" instead of asking the
 * user to read a manifest patch.
 */

export interface DependencyDiffInput {
  repoDir: string;
  projectDir: string;
  baselineCommit: string;
  language: Language;
  repairs: AppliedRepair[];
}

export async function computeDependencyDiff(
  input: DependencyDiffInput,
): Promise<DependencyChange[]> {
  const relative = path
    .relative(input.repoDir, input.projectDir)
    .split(path.sep)
    .filter(Boolean)
    .join('/');
  const prefix = relative ? `${relative}/` : '';

  switch (input.language) {
    case 'node':
      return diffNode(input, `${prefix}package.json`);
    case 'python':
      return diffPython(input, prefix);
    case 'rust':
      return diffToml(input, `${prefix}Cargo.toml`);
    case 'java':
      return diffMaven(input, `${prefix}pom.xml`);
    case 'go':
      return diffGoMod(input, `${prefix}go.mod`);
    default:
      return [];
  }
}

/** Read a file as it existed at the baseline commit. */
async function readAtCommit(
  repoDir: string,
  commit: string,
  relPath: string,
): Promise<string | null> {
  const result = await git(['show', `${commit}:${relPath}`], { cwd: repoDir, timeoutMs: 30_000 });
  return result.ok ? result.stdout : null;
}

function reasonFor(name: string, repairs: AppliedRepair[]): string {
  const match = repairs.find(
    (r) => !r.rolledBack && (r.description.includes(name) || r.title.includes(name)),
  );
  return match ? match.title : 'Changed during repair';
}

// ---------------------------------------------------------------------------
// Node
// ---------------------------------------------------------------------------

async function diffNode(
  input: DependencyDiffInput,
  relPath: string,
): Promise<DependencyChange[]> {
  const beforeText = await readAtCommit(input.repoDir, input.baselineCommit, relPath);
  const afterText = await readFileSafe(path.join(input.repoDir, relPath));
  if (!beforeText || !afterText) return [];

  const parse = (text: string): Map<string, string> => {
    const map = new Map<string, string>();
    try {
      const json = JSON.parse(stripBom(text));
      for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
        for (const [name, range] of Object.entries(json[field] ?? {})) {
          map.set(name, String(range));
        }
      }
    } catch {
      /* unparseable — treat as empty */
    }
    return map;
  };

  return compareMaps(parse(beforeText), parse(afterText), input.repairs);
}

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------

async function diffPython(
  input: DependencyDiffInput,
  prefix: string,
): Promise<DependencyChange[]> {
  const changes: DependencyChange[] = [];

  for (const file of ['requirements.txt', 'requirements-dev.txt', 'pyproject.toml', 'Pipfile']) {
    const relPath = `${prefix}${file}`;
    const beforeText = await readAtCommit(input.repoDir, input.baselineCommit, relPath);
    const afterText = await readFileSafe(path.join(input.repoDir, relPath));
    if (!beforeText || !afterText || beforeText === afterText) continue;

    if (file.endsWith('.txt')) {
      const parse = (text: string): Map<string, string> => {
        const map = new Map<string, string>();
        for (const line of text.split('\n')) {
          const parsed = parseRequirement(line);
          if (parsed) map.set(parsed.name.toLowerCase(), parsed.range);
        }
        return map;
      };
      changes.push(...compareMaps(parse(beforeText), parse(afterText), input.repairs));
    }
  }

  return changes;
}

// ---------------------------------------------------------------------------
// Rust / TOML
// ---------------------------------------------------------------------------

async function diffToml(
  input: DependencyDiffInput,
  relPath: string,
): Promise<DependencyChange[]> {
  const beforeText = await readAtCommit(input.repoDir, input.baselineCommit, relPath);
  const afterText = await readFileSafe(path.join(input.repoDir, relPath));
  if (!beforeText || !afterText) return [];

  // A light line-based parse is sufficient and avoids failing on exotic TOML.
  const parse = (text: string): Map<string, string> => {
    const map = new Map<string, string>();
    let inDeps = false;
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (line.startsWith('[')) {
        inDeps = /^\[(dependencies|dev-dependencies|build-dependencies)\]/.test(line);
        continue;
      }
      if (!inDeps || !line || line.startsWith('#')) continue;
      const match = line.match(/^([\w-]+)\s*=\s*(.+)$/);
      if (match) {
        map.set(match[1], match[2].replace(/^["']|["']$/g, ''));
      }
    }
    return map;
  };

  return compareMaps(parse(beforeText), parse(afterText), input.repairs);
}

// ---------------------------------------------------------------------------
// Maven
// ---------------------------------------------------------------------------

async function diffMaven(
  input: DependencyDiffInput,
  relPath: string,
): Promise<DependencyChange[]> {
  const beforeText = await readAtCommit(input.repoDir, input.baselineCommit, relPath);
  const afterText = await readFileSafe(path.join(input.repoDir, relPath));
  if (!beforeText || !afterText) return [];

  const parse = (text: string): Map<string, string> => {
    const map = new Map<string, string>();
    const pattern =
      /<dependency>\s*<groupId>([^<]+)<\/groupId>\s*<artifactId>([^<]+)<\/artifactId>(?:\s*<version>([^<]+)<\/version>)?/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      map.set(`${match[1]}:${match[2]}`, match[3] ?? 'managed');
    }
    // Compiler levels matter as much as dependencies for Java revival.
    for (const tag of ['maven.compiler.source', 'maven.compiler.target', 'maven.compiler.release']) {
      const value = text.match(new RegExp(`<${tag}>([^<]+)</${tag}>`));
      if (value) map.set(`(property) ${tag}`, value[1]);
    }
    return map;
  };

  return compareMaps(parse(beforeText), parse(afterText), input.repairs);
}

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------

async function diffGoMod(
  input: DependencyDiffInput,
  relPath: string,
): Promise<DependencyChange[]> {
  const beforeText = await readAtCommit(input.repoDir, input.baselineCommit, relPath);
  const afterText = await readFileSafe(path.join(input.repoDir, relPath));
  if (!afterText) return [];

  if (!beforeText) {
    return [
      {
        name: 'go.mod',
        before: null,
        after: 'created',
        kind: 'added',
        reason: 'Module definition created for a pre-modules project',
      },
    ];
  }

  const parse = (text: string): Map<string, string> => {
    const map = new Map<string, string>();
    for (const raw of text.split('\n')) {
      const line = raw.split('//')[0].trim();
      const goDirective = line.match(/^go\s+([\d.]+)$/);
      if (goDirective) {
        map.set('(directive) go', goDirective[1]);
        continue;
      }
      const require = line.match(/^(?:require\s+)?([\w./-]+\.[\w./-]+)\s+(v[\w.+-]+)/);
      if (require) map.set(require[1], require[2]);
    }
    return map;
  };

  return compareMaps(parse(beforeText), parse(afterText), input.repairs);
}

// ---------------------------------------------------------------------------
// Shared comparison
// ---------------------------------------------------------------------------

export function compareMaps(
  before: Map<string, string>,
  after: Map<string, string>,
  repairs: AppliedRepair[],
): DependencyChange[] {
  const changes: DependencyChange[] = [];
  const names = new Set([...before.keys(), ...after.keys()]);

  for (const name of names) {
    const from = before.get(name) ?? null;
    const to = after.get(name) ?? null;
    if (from === to) continue;

    let kind: DependencyChange['kind'];
    if (from === null) kind = 'added';
    else if (to === null) kind = 'removed';
    else kind = 'changed';

    changes.push({ name, before: from, after: to, kind, reason: reasonFor(name, repairs) });
  }

  // Pair a removal with an addition from the same repair as a "replaced".
  for (const removed of changes.filter((c) => c.kind === 'removed')) {
    const partner = changes.find(
      (c) => c.kind === 'added' && c.reason === removed.reason && c.reason !== 'Changed during repair',
    );
    if (partner) {
      partner.kind = 'replaced';
      partner.before = removed.name;
    }
  }

  return changes.sort((a, b) => a.name.localeCompare(b.name));
}
