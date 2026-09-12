import { config } from './config';
import type {
  DetectedCommands,
  LogLevel,
  Sandbox,
  StepName,
  StepResult,
  VerificationResult,
} from './types';

/**
 * Step execution and scoring.
 *
 * A verification run executes install -> build -> test -> start and produces a
 * single comparable score. The score is what makes "before and after" a
 * meaningful claim rather than a vibe: it weights the steps by how much they
 * actually prove about the project being alive.
 */

export interface RunStepsOptions {
  sandbox: Sandbox;
  cwd: string;
  commands: DetectedCommands;
  env: Record<string, string>;
  signal?: AbortSignal;
  log: (level: LogLevel, message: string) => void;
  onOutput?: (step: StepName, chunk: string) => void;
  /** Skip steps that already passed and cannot be invalidated. */
  skipSteps?: Set<StepName>;
}

/**
 * Step weights.
 *
 * `start` is deliberately weighted low. Probing a start command is inherently
 * unreliable: a CLI invoked without arguments exits non-zero, a server wants a
 * free port, and many projects need configuration that was never committed. It
 * contributes to the score but does not decide whether a project counts as
 * revived — that verdict rests on install, build and test.
 */
const STEP_WEIGHTS: Record<StepName, number> = {
  install: 30,
  build: 35,
  test: 25,
  start: 10,
  lint: 0,
};

/**
 * Patterns that mean "the runner started, collected nothing, and exited 0".
 *
 * Treating that as a pass would be the worst kind of false positive: the score
 * goes up and the report claims the project is verified, when in fact nothing
 * was executed. Each pattern is the empty-run banner of a real test runner.
 */
const EMPTY_TEST_RUN_PATTERNS: RegExp[] = [
  /Ran 0 tests? in/i,              // Python unittest
  /collected 0 items/i,            // pytest
  /no tests ran/i,                 // pytest
  /No tests found/i,               // jest
  /\[no test files\]/i,            // go test
  /testing: warning: no tests to run/i,
  /running 0 tests/i,              // cargo test
  /Tests run: 0,/i,                // Maven surefire
  /0 passing\b(?![\s\S]*[1-9]\d* passing)/i, // mocha
];

/** True when output shows a runner that executed no tests at all. */
export function isEmptyTestRun(output: string): boolean {
  if (!output.trim()) return false;
  // cargo prints one "running 0 tests" block per target; only treat the run as
  // empty if no target ran anything.
  if (/running [1-9]\d* tests?/i.test(output)) return false;
  if (/Ran [1-9]\d* tests?/i.test(output)) return false;
  if (/collected [1-9]\d* items?/i.test(output)) return false;
  return EMPTY_TEST_RUN_PATTERNS.some((pattern) => pattern.test(output));
}

export async function runVerification(options: RunStepsOptions): Promise<VerificationResult> {
  const started = Date.now();
  const steps: StepResult[] = [];
  const order: StepName[] = ['install', 'build', 'test', 'start'];

  let blocked = false;

  for (const step of order) {
    const command = options.commands[step];

    if (!command) {
      steps.push({
        step,
        command: '',
        status: 'not-applicable',
        exitCode: null,
        durationMs: 0,
        output: '',
        truncated: false,
      });
      continue;
    }

    // Once install fails there is no point running build/test — the results
    // would be noise and would pollute the diagnosis.
    if (blocked) {
      steps.push({
        step,
        command,
        status: 'skipped',
        exitCode: null,
        durationMs: 0,
        output: `Skipped because an earlier step failed.`,
        truncated: false,
      });
      continue;
    }

    if (options.signal?.aborted) {
      steps.push({
        step,
        command,
        status: 'skipped',
        exitCode: null,
        durationMs: 0,
        output: 'Cancelled.',
        truncated: false,
      });
      continue;
    }

    options.log('command', `$ ${command}`);

    // `start` is a long-running process: we probe it briefly and treat
    // "still alive after the probe window" as success.
    const isStart = step === 'start';
    const timeoutMs = isStart ? config.startProbeMs : config.stepTimeoutMs;

    const result = await options.sandbox.exec(command, {
      cwd: options.cwd,
      env: options.env,
      timeoutMs,
      signal: options.signal,
      onOutput: (chunk) => options.onOutput?.(step, chunk),
    });

    let status: StepResult['status'];
    if (isStart) {
      // A server that is killed by our probe timeout is a server that started.
      status = result.timedOut || result.ok ? 'passed' : 'failed';
    } else if (result.timedOut) {
      status = 'timeout';
    } else {
      status = result.ok ? 'passed' : 'failed';
    }

    // A green test run that collected nothing proves nothing. Downgrade it to
    // "skipped" so it neither raises the score nor claims verification.
    let emptyRun = false;
    if (step === 'test' && status === 'passed' && isEmptyTestRun(result.combined)) {
      status = 'skipped';
      emptyRun = true;
    }

    steps.push({
      step,
      command,
      status,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      output: emptyRun
        ? `[revive] The test runner exited successfully but collected no tests, so this is not treated as a pass.\n\n${truncate(result.combined, config.maxStoredStepOutput)}`
        : truncate(result.combined, config.maxStoredStepOutput),
      truncated: result.truncated || result.combined.length > config.maxStoredStepOutput,
    });

    if (emptyRun) {
      options.log(
        'warn',
        'The test suite ran but collected zero tests — not counting this as verification.',
      );
    } else if (status === 'passed') {
      options.log('success', `${step} succeeded in ${formatDuration(result.durationMs)}`);
    } else {
      options.log('error', `${step} failed (exit ${result.exitCode ?? 'signal'})`);
      // install and build are hard blockers; a failing test still tells us the
      // toolchain works, so we keep going to gather more signal.
      if (step === 'install' || step === 'build') blocked = true;
    }
  }

  return scoreVerification(steps, Date.now() - started);
}

export function scoreVerification(steps: StepResult[], durationMs: number): VerificationResult {
  const byStep = new Map(steps.map((s) => [s.step, s]));
  const passed = (step: StepName) => byStep.get(step)?.status === 'passed';
  const applicable = (step: StepName) => {
    const status = byStep.get(step)?.status;
    return status !== 'not-applicable' && status !== undefined;
  };

  let earned = 0;
  let possible = 0;
  for (const step of ['install', 'build', 'test', 'start'] as StepName[]) {
    if (!applicable(step)) continue;
    possible += STEP_WEIGHTS[step];
    if (passed(step)) earned += STEP_WEIGHTS[step];
  }

  const score = possible === 0 ? 0 : Math.round((earned / possible) * 100);

  const installOk = passed('install') || !applicable('install');
  const buildOk = passed('build') || !applicable('build');
  const testOk = passed('test') || !applicable('test');
  const startOk = passed('start') || !applicable('start');

  // "working" means the project installs, builds and passes its own tests.
  // `start` is reported and scored but excluded from this verdict for the
  // reasons given above; a failing start is called out in the revival report.
  const ranAnything = steps.some((s) => s.status === 'passed' || s.status === 'failed');
  let overall: VerificationResult['overall'];
  if (!ranAnything) overall = 'not-run';
  else if (installOk && buildOk && testOk) overall = 'working';
  else if (installOk && (buildOk || passed('build'))) overall = 'partial';
  else if (score >= 40) overall = 'partial';
  else overall = 'broken';

  return {
    steps,
    installOk,
    buildOk,
    testOk,
    startOk,
    overall,
    score,
    durationMs,
  };
}

/** An empty result for analysis-only mode. */
export function notRunVerification(reason: string): VerificationResult {
  const steps: StepResult[] = (['install', 'build', 'test', 'start'] as StepName[]).map((step) => ({
    step,
    command: '',
    status: 'skipped',
    exitCode: null,
    durationMs: 0,
    output: reason,
    truncated: false,
  }));
  return {
    steps,
    installOk: false,
    buildOk: false,
    testOk: false,
    startOk: false,
    overall: 'not-run',
    score: 0,
    durationMs: 0,
  };
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.3);
  const tail = max - head;
  return `${text.slice(0, head)}\n\n... [${text.length - max} characters omitted] ...\n\n${text.slice(-tail)}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/** Did the repaired run actually do better than the baseline? */
export function compareRuns(
  before: VerificationResult,
  after: VerificationResult,
): 'improved' | 'regressed' | 'no-change' {
  if (after.score > before.score) return 'improved';
  if (after.score < before.score) return 'regressed';
  return 'no-change';
}
