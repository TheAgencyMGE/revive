import path from 'node:path';
import { pathExists, readFileSafe, readJson, walkRepo } from '../fsutil';
import type { DetectionResult, Language, PackageManager } from '../types';
import { detectNode } from './node';
import { detectPython } from './python';
import { detectJava } from './java';
import { detectGo } from './go';
import { detectRust } from './rust';

/**
 * Language / build-system detection.
 *
 * Detection is evidence-driven rather than guess-driven: each adapter reports
 * what manifests it actually found, and the strongest signal wins. When a repo
 * contains several ecosystems we keep the full list so the report can say so.
 */

export interface DetectInput {
  repoDir: string;
  files: string[];
}

const MANIFEST_SIGNALS: { file: string; language: Language; weight: number }[] = [
  { file: 'package.json', language: 'node', weight: 10 },
  { file: 'pyproject.toml', language: 'python', weight: 10 },
  { file: 'requirements.txt', language: 'python', weight: 8 },
  { file: 'Pipfile', language: 'python', weight: 9 },
  { file: 'setup.py', language: 'python', weight: 7 },
  { file: 'pom.xml', language: 'java', weight: 10 },
  { file: 'build.gradle', language: 'java', weight: 10 },
  { file: 'build.gradle.kts', language: 'java', weight: 10 },
  { file: 'go.mod', language: 'go', weight: 10 },
  { file: 'Cargo.toml', language: 'rust', weight: 10 },
];

/**
 * Find the directory that actually holds the project.
 * Handles the common "repo root is a wrapper, code lives in src/ or app/" case
 * without wandering into deeply nested example folders.
 */
export function findProjectRoot(files: string[]): string {
  const manifestNames = new Set(MANIFEST_SIGNALS.map((m) => m.file));
  let best: { dir: string; depth: number; weight: number } | null = null;

  for (const file of files) {
    const base = file.split('/').pop()!;
    if (!manifestNames.has(base)) continue;
    const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
    const depth = dir === '' ? 0 : dir.split('/').length;
    if (depth > 3) continue; // ignore vendored/example projects buried deep
    // Skip obvious non-primary locations.
    if (/(^|\/)(example|examples|sample|samples|test|tests|fixtures|docs|website)(\/|$)/i.test(dir)) {
      continue;
    }
    const weight = MANIFEST_SIGNALS.find((m) => m.file === base)!.weight;
    if (!best || depth < best.depth || (depth === best.depth && weight > best.weight)) {
      best = { dir, depth, weight };
    }
  }
  return best?.dir ?? '';
}

export async function detectProject(input: DetectInput): Promise<DetectionResult> {
  const projectRoot = findProjectRoot(input.files);
  const projectDir = projectRoot ? path.join(input.repoDir, projectRoot) : input.repoDir;

  // Re-scope the file list to the project root so adapters see relative paths.
  const scopedFiles = projectRoot
    ? input.files
        .filter((f) => f.startsWith(`${projectRoot}/`))
        .map((f) => f.slice(projectRoot.length + 1))
    : input.files;

  const present = new Set(scopedFiles);
  const scores = new Map<Language, number>();

  for (const signal of MANIFEST_SIGNALS) {
    if (present.has(signal.file)) {
      scores.set(signal.language, (scores.get(signal.language) ?? 0) + signal.weight);
    }
  }

  // Extension counts break ties when manifests are absent or ambiguous.
  const extWeights: Record<string, Language> = {
    '.ts': 'node',
    '.tsx': 'node',
    '.js': 'node',
    '.jsx': 'node',
    '.py': 'python',
    '.java': 'java',
    '.go': 'go',
    '.rs': 'rust',
  };
  for (const file of scopedFiles) {
    const ext = path.extname(file).toLowerCase();
    const lang = extWeights[ext];
    if (lang) scores.set(lang, (scores.get(lang) ?? 0) + 0.05);
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const language: Language = ranked[0]?.[0] ?? 'unknown';
  const languages = ranked.filter(([, score]) => score >= 1).map(([lang]) => lang);

  const ctx = { repoDir: input.repoDir, projectDir, files: scopedFiles, present };

  let result: DetectionResult;
  switch (language) {
    case 'node':
      result = await detectNode(ctx);
      break;
    case 'python':
      result = await detectPython(ctx);
      break;
    case 'java':
      result = await detectJava(ctx);
      break;
    case 'go':
      result = await detectGo(ctx);
      break;
    case 'rust':
      result = await detectRust(ctx);
      break;
    default:
      result = emptyDetection();
      result.notes.push(
        'No recognised manifest (package.json, pyproject.toml, pom.xml, go.mod, Cargo.toml) was found.',
      );
  }

  result.languages = languages.length ? languages : [result.language];
  result.projectRoot = projectRoot;
  return result;
}

export interface AdapterContext {
  repoDir: string;
  projectDir: string;
  files: string[];
  present: Set<string>;
}

export function emptyDetection(): DetectionResult {
  return {
    language: 'unknown',
    languages: [],
    framework: null,
    frameworkVersion: null,
    packageManager: 'unknown',
    manifestFiles: [],
    lockfiles: [],
    hasLockfile: false,
    lockfileVersion: null,
    commands: {},
    dependencies: [],
    moduleSystem: 'n/a',
    projectRoot: '',
    notes: [],
  };
}

export { detectNode, detectPython, detectJava, detectGo, detectRust };
export type { PackageManager };
export { pathExists, readFileSafe, readJson, walkRepo };
