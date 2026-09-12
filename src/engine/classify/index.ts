import type {
  DetectionResult,
  Diagnosis,
  EnvironmentSpec,
  StepResult,
  VerificationResult,
} from '../types';
import { applyRules } from './rules';

/**
 * Turn a failed verification run into a ranked set of diagnoses.
 *
 * Ordering matters: the orchestrator repairs the smallest blocking set, so the
 * highest-severity, highest-confidence diagnosis on the earliest failing step
 * must come first.
 */

const STEP_ORDER: Record<string, number> = {
  clone: 0,
  detect: 1,
  install: 2,
  build: 3,
  test: 4,
  start: 5,
  lint: 6,
};

export interface DiagnoseInput {
  verification: VerificationResult;
  detection: DetectionResult;
  environment: EnvironmentSpec;
}

export function diagnose(input: DiagnoseInput): Diagnosis[] {
  const diagnoses: Diagnosis[] = [];

  for (const step of input.verification.steps) {
    if (step.status === 'passed' || step.status === 'skipped' || step.status === 'not-applicable') {
      continue;
    }
    for (const found of applyRules(step.output, step.step)) {
      diagnoses.push({ ...found, source: 'deterministic' });
    }
    if (step.status === 'timeout') {
      diagnoses.push({
        category: 'build-config',
        title: `The ${step.step} step exceeded its time limit`,
        detail:
          'The command did not finish within the allotted time. This is usually an interactive prompt waiting for input, a watch-mode process that never exits, or a genuinely very slow build.',
        evidence: tail(step.output, 600),
        step: step.step,
        confidence: 85,
        severity: 'blocker',
        suggestedRepairs: ['disable-watch-mode'],
        source: 'deterministic',
      });
    }
  }

  // Static signals that do not depend on execution output at all.
  diagnoses.push(...staticDiagnoses(input));

  const deduped = dedupe(diagnoses);

  return deduped.sort((a, b) => {
    const stepDelta = (STEP_ORDER[a.step] ?? 9) - (STEP_ORDER[b.step] ?? 9);
    if (stepDelta !== 0) return stepDelta;
    const severityRank = { blocker: 0, major: 1, minor: 2 };
    const sevDelta = severityRank[a.severity] - severityRank[b.severity];
    if (sevDelta !== 0) return sevDelta;
    return b.confidence - a.confidence;
  });
}

/**
 * Diagnoses derived purely from manifests. These fire even in analysis-only
 * mode, which is what keeps Revive useful without a sandbox.
 */
export function staticDiagnoses(input: DiagnoseInput): Diagnosis[] {
  const out: Diagnosis[] = [];
  const { detection, environment } = input;

  // node-sass is a guaranteed future failure on any modern Node.
  const nodeSass = detection.dependencies.find((d) => d.name === 'node-sass');
  if (nodeSass) {
    out.push({
      category: 'node-sass',
      title: 'Project depends on node-sass, which is deprecated and unbuildable on modern Node',
      detail: `node-sass ${nodeSass.range} is pinned. The package was deprecated in 2020 and its prebuilt binaries stop at Node 16. Any install on a newer Node either fails outright or falls back to a source build that needs a full C++ toolchain.`,
      evidence: `package.json: "node-sass": "${nodeSass.range}"`,
      step: 'detect',
      confidence: 92,
      severity: 'blocker',
      suggestedRepairs: ['node-sass-to-dart-sass'],
      source: 'deterministic',
    });
  }

  // Python 2 is unambiguous.
  if (environment.runtimeVersion?.startsWith('2.')) {
    out.push({
      category: 'python-version',
      title: 'Project targets Python 2, which reached end of life in January 2020',
      detail:
        'Python 2.7 is no longer shipped by most systems. Running the code unchanged requires a Python 2 interpreter; running it on Python 3 requires source migration.',
      evidence: `Reconstructed runtime: Python ${environment.runtimeVersion}`,
      step: 'detect',
      confidence: 90,
      severity: 'blocker',
      suggestedRepairs: ['python-2to3'],
      source: 'deterministic',
    });
  }

  // Webpack 4 on modern Node is the classic OpenSSL failure.
  const webpack = detection.dependencies.find((d) => d.name === 'webpack');
  if (webpack && /^[~^]?4\./.test(webpack.range)) {
    out.push({
      category: 'bundler-incompat',
      title: 'Webpack 4 is incompatible with the OpenSSL 3 provider in Node 17+',
      detail:
        'Webpack 4 hashes with MD4, which OpenSSL 3 removed. On Node 17 or newer the build fails with ERR_OSSL_EVP_UNSUPPORTED before producing any output.',
      evidence: `package.json: "webpack": "${webpack.range}"`,
      step: 'detect',
      confidence: 80,
      severity: 'major',
      suggestedRepairs: ['node-openssl-legacy', 'node-use-declared-runtime'],
      source: 'deterministic',
    });
  }

  // A very old declared runtime is worth surfacing before anything runs.
  if (
    environment.runtime === 'node' &&
    environment.runtimeVersion &&
    Number.parseInt(environment.runtimeVersion, 10) <= 12
  ) {
    out.push({
      category: 'runtime-version',
      title: `Project was built for Node ${environment.runtimeVersion}, which is long out of support`,
      detail: `The reconstructed environment is Node ${environment.runtimeVersion}. Node versions through 12 reached end of life in 2022 and differ from current Node in OpenSSL, module resolution and V8 syntax support.`,
      evidence: environment.evidence
        .slice(0, 2)
        .map((e) => `${e.source}: ${e.value}`)
        .join('\n'),
      step: 'detect',
      confidence: environment.confidence,
      severity: 'major',
      suggestedRepairs: ['node-use-declared-runtime'],
      source: 'deterministic',
    });
  }

  return out;
}

/** Collapse repeats of the same category+title, keeping the most confident. */
export function dedupe(diagnoses: Diagnosis[]): Diagnosis[] {
  const byKey = new Map<string, Diagnosis>();
  for (const d of diagnoses) {
    const key = `${d.category}::${d.title}`;
    const existing = byKey.get(key);
    if (!existing || d.confidence > existing.confidence) byKey.set(key, d);
  }
  return [...byKey.values()];
}

function tail(text: string, chars: number): string {
  return text.length <= chars ? text : `...${text.slice(-chars)}`;
}

/** The first blocking failure — what the report calls the root cause. */
export function rootCause(diagnoses: Diagnosis[]): Diagnosis | null {
  return diagnoses.find((d) => d.severity === 'blocker') ?? diagnoses[0] ?? null;
}

export { applyRules, RULES } from './rules';
export type { ClassifyRule } from './rules';
