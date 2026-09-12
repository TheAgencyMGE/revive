import path from 'node:path';
import fs from 'node:fs/promises';
import { config } from './config';
import {
  changedFiles as gitChangedFiles,
  cloneRepository,
  commitAttempt,
  currentCommit,
  diffText,
  formatPatch,
  getCommitCount,
  getDefaultBranch,
  getHeadSha,
  getLastCommitDate,
  initBaselineSnapshot,
  languageBreakdown,
  revertUnattributedChanges,
  rollbackTo,
} from './git';
import { countFiles, directorySize, pathExists, readJson, removeTree, walkRepo } from './fsutil';
import { detectProject } from './detect';
import { reconstructEnvironment } from './environment';
import { probeToolchain, selectRuntime } from './toolchain';
import { createSandbox } from './sandbox';
import { diagnose, rootCause } from './classify';
import { describeStrategy, planRepairs, REGISTRY } from './repair';
import { compareRuns, formatDuration, notRunVerification, runVerification } from './runner';
import { buildSandboxEnv } from './safety';
import { computeDependencyDiff } from './depdiff';
import { generateReport } from './report';
import { writeArtifacts } from './artifacts';
import type {
  AppliedRepair,
  DependencyChange,
  Diagnosis,
  EnvironmentSpec,
  JobStatus,
  LogLevel,
  Phase,
  RepoMetadata,
  Sandbox,
  VerificationResult,
} from './types';

/**
 * The revival pipeline.
 *
 * Phases: analyze -> reconstruct -> baseline -> diagnose -> repair -> verify
 * -> complete. The ordering encodes the repair philosophy directly: nothing is
 * modified until an untouched run has proven what is actually broken.
 */

export interface JobSink {
  log(level: LogLevel, message: string): Promise<void>;
  setPhase(phase: Phase, phaseIdx: number, attempt: number): Promise<void>;
  setState(patch: Record<string, unknown>): Promise<void>;
  recordAttempt(attempt: {
    number: number;
    strategy: string;
    repairs: AppliedRepair[];
    result: VerificationResult | null;
    outcome: string;
    notes?: string;
  }): Promise<void>;
  isCancelled(): Promise<boolean>;
}

export interface RunJobInput {
  jobId: string;
  repoUrl: string;
  /** Local path for fixtures; absent for real GitHub repos. */
  localPath?: string;
  ref?: string;
  sink: JobSink;
  signal: AbortSignal;
  ai?: AiConfig;
}

export interface AiConfig {
  provider: 'anthropic' | 'openai';
  apiKey: string;
  model?: string;
}

export interface RunJobResult {
  status: JobStatus;
  summary: string;
  confidence: number;
}

class CancelledError extends Error {
  constructor() {
    super('Job cancelled');
    this.name = 'CancelledError';
  }
}

export async function runJob(input: RunJobInput): Promise<RunJobResult> {
  const { sink, signal } = input;
  const workspaceDir = path.join(config.workspaceRoot, input.jobId);
  const repoDir = path.join(workspaceDir, 'repo');

  let sandbox: Sandbox | null = null;
  const startedAt = Date.now();

  const checkCancelled = async () => {
    if (signal.aborted || (await sink.isCancelled())) throw new CancelledError();
  };

  try {
    await fs.mkdir(workspaceDir, { recursive: true });

    // =====================================================================
    // PHASE 1 — ANALYZE
    // =====================================================================
    await sink.setPhase('analyze', 0, 0);
    await sink.log('info', `Starting revival of ${input.repoUrl}`);

    const metadata = await cloneAndInspect(input, repoDir, sink);
    await sink.setState({ metadata });
    await checkCancelled();

    const { files } = await walkRepo(repoDir, { maxFiles: config.maxRepoFiles });
    const detection = await detectProject({ repoDir, files });
    const projectDir = detection.projectRoot
      ? path.join(repoDir, detection.projectRoot)
      : repoDir;

    await sink.setState({ detection });
    await sink.log(
      'success',
      `Detected ${describeDetection(detection.language)} project` +
        (detection.framework ? ` using ${detection.framework}` : '') +
        ` with ${detection.packageManager}`,
    );
    if (detection.projectRoot) {
      await sink.log('info', `Project root is ./${detection.projectRoot}`);
    }
    for (const note of detection.notes.slice(0, 6)) {
      await sink.log('info', note);
    }

    if (detection.language === 'unknown') {
      await sink.log(
        'warn',
        'No supported build system was recognised. Revive supports Node.js, Python, Java, Go and Rust.',
      );
    }

    // Snapshot the pristine state — everything after this is diffable.
    await initBaselineSnapshot(repoDir);
    const baselineCommit = await currentCommit(repoDir);
    await sink.log('info', 'Captured a pristine snapshot for diffing and rollback.');

    await checkCancelled();

    // =====================================================================
    // PHASE 2 — RECONSTRUCT
    // =====================================================================
    await sink.setPhase('reconstruct', 1, 0);
    await sink.log('info', 'Reconstructing the environment this project originally expected...');

    const present = new Set(
      detection.projectRoot
        ? files
            .filter((f) => f.startsWith(`${detection.projectRoot}/`))
            .map((f) => f.slice(detection.projectRoot.length + 1))
        : files,
    );

    const originalEnv = await reconstructEnvironment({
      projectDir,
      detection,
      metadata,
      present,
    });

    for (const evidence of originalEnv.evidence) {
      await sink.log(
        'info',
        `Evidence: ${evidence.source} = ${evidence.value}${evidence.note ? ` — ${evidence.note}` : ''}`,
      );
    }

    if (originalEnv.runtimeVersion) {
      await sink.log(
        'success',
        `Original environment: ${originalEnv.runtime} ${originalEnv.runtimeVersion} (confidence ${originalEnv.confidence}%)`,
      );
    } else {
      await sink.log('warn', 'Could not determine the original runtime version from the repository.');
    }

    // What can this machine actually provide?
    const probe = await probeToolchain(detection.language);
    const selection = selectRuntime(originalEnv, probe);
    await sink.log(selection.matchesRequested ? 'success' : 'warn', selection.explanation);

    const finalEnv: EnvironmentSpec = {
      ...originalEnv,
      available: probe.primary.available,
      actualVersion: selection.version,
    };
    await sink.setState({ originalEnv, finalEnv });

    // Sandbox selection happens now that we know the language + runtime.
    sandbox = await createSandbox({
      workspaceDir,
      mountDir: repoDir,
      language: detection.language,
      runtimeVersion: originalEnv.runtimeVersion,
      allowNetwork: true,
    });
    await sink.setState({ sandboxMode: sandbox.capabilities.mode });
    await sink.log(
      sandbox.capabilities.canExecute ? 'info' : 'warn',
      `Sandbox: ${sandbox.capabilities.mode} — ${sandbox.capabilities.detail}`,
    );

    await checkCancelled();

    // Environment for every sandboxed command.
    let stepEnv = buildSandboxEnv(
      selection.pathPrefix
        ? { PATH: `${selection.pathPrefix}${path.delimiter}${process.env.PATH ?? ''}` }
        : {},
      {
        home: path.join(workspaceDir, '.sandbox-home'),
        tmpDir: path.join(workspaceDir, '.sandbox-tmp'),
      },
    );

    let commands = { ...detection.commands };

    // =====================================================================
    // PHASE 3 — BASELINE
    // =====================================================================
    await sink.setPhase('baseline', 2, 0);

    let baseline: VerificationResult;

    if (!sandbox.capabilities.canExecute) {
      baseline = notRunVerification(
        'Execution is disabled in analysis-only mode. Static diagnosis was performed instead.',
      );
      await sink.log('warn', 'Skipping execution — running in analysis-only mode.');
    } else if (detection.language === 'unknown') {
      baseline = notRunVerification('No recognised build system to execute.');
      await sink.log('warn', 'Skipping execution — no build system detected.');
    } else {
      await sink.log('info', 'Running the project untouched to establish a baseline...');
      await logCommands(sink, commands);
      baseline = await runVerification({
        sandbox,
        cwd: projectDir,
        commands,
        env: stepEnv,
        signal,
        log: (level, message) => void sink.log(level, message),
        onOutput: (step, chunk) => void streamOutput(sink, step, chunk),
      });
      await sink.log(
        baseline.overall === 'working' ? 'success' : 'warn',
        `Baseline result: ${baseline.overall} (score ${baseline.score}/100)`,
      );
    }

    await sink.setState({ baseline });
    await checkCancelled();

    // Already working? Report honestly and stop — there is nothing to repair.
    if (baseline.overall === 'working') {
      const summary =
        'This repository already builds and runs correctly. Revive made no changes.';
      await sink.log('success', summary);
      await finalize({
        input,
        repoDir,
        projectDir,
        baselineCommit,
        detection,
        metadata,
        originalEnv,
        finalEnv,
        baseline,
        finalResult: baseline,
        diagnoses: [],
        repairs: [],
        sandbox,
        status: 'succeeded',
        summary,
        confidence: 95,
        startedAt,
      });
      return { status: 'succeeded', summary, confidence: 95 };
    }

    // =====================================================================
    // PHASE 4 — DIAGNOSE
    // =====================================================================
    await sink.setPhase('diagnose', 3, 0);
    await sink.log('info', 'Diagnosing the failure...');

    let diagnoses: Diagnosis[] = diagnose({
      verification: baseline,
      detection,
      environment: finalEnv,
    });

    // Optional AI assistance — never required, never blocking.
    if (input.ai && diagnoses.length === 0) {
      await sink.log('info', 'No deterministic rule matched; consulting the configured AI provider.');
      try {
        const { aiDiagnose } = await import('./ai/provider');
        const aiFindings = await aiDiagnose({
          config: input.ai,
          verification: baseline,
          detection,
          environment: finalEnv,
          signal,
        });
        diagnoses = [...diagnoses, ...aiFindings];
        await sink.log('success', `AI provided ${aiFindings.length} additional diagnosis/diagnoses.`);
      } catch (err) {
        await sink.log('warn', `AI diagnosis unavailable: ${errorMessage(err)}. Continuing deterministically.`);
      }
    }

    await sink.setState({ diagnosis: diagnoses });

    if (!diagnoses.length) {
      await sink.log('warn', 'No known failure pattern matched the output.');
    }
    for (const d of diagnoses.slice(0, 8)) {
      await sink.log(
        d.severity === 'blocker' ? 'error' : 'warn',
        `[${d.severity}] ${d.title} (${d.confidence}% confidence)`,
      );
    }

    // Preserve the diagnosis of the ORIGINAL failure. The loop below
    // re-diagnoses against each new failure surface, and once the project is
    // fixed that list is empty — so without keeping this, the report would
    // claim nothing was ever wrong.
    const initialDiagnoses = diagnoses;

    const cause = rootCause(diagnoses);
    if (cause) await sink.log('info', `Root cause: ${cause.title}`);

    await checkCancelled();

    // =====================================================================
    // PHASE 5 + 6 — REPAIR / VERIFY (iterative)
    // =====================================================================
    const appliedRepairs: AppliedRepair[] = [];
    const attemptedIds = new Set<string>();
    let best = baseline;
    let bestCommit = baselineCommit;
    let attemptNumber = 0;

    while (attemptNumber < config.maxAttempts) {
      await checkCancelled();

      const plan = planRepairs({
        diagnoses,
        language: detection.language,
        attempted: attemptedIds,
        budget: attemptNumber === 0 ? 2 : 3,
      });

      if (!plan.length) {
        await sink.log('info', 'No further repair strategies are available.');
        break;
      }

      attemptNumber++;
      await sink.setPhase('repair', 4, attemptNumber);
      const strategy = describeStrategy(plan);
      await sink.log('info', `Attempt ${attemptNumber}: ${strategy}`);

      // Roll back to the best known state before each attempt so failed
      // repairs never compound.
      await rollbackTo(repoDir, bestCommit);

      const attemptRepairs: AppliedRepair[] = [];
      let envPatch: Record<string, string> = {};
      let commandOverrides = {};

      for (const action of plan) {
        attemptedIds.add(action.id);
        await checkCancelled();
        try {
          const effect = await action.apply({
            repoDir,
            projectDir,
            detection: { ...detection, commands },
            env: finalEnv,
            diagnoses,
            log: (level, message) => void sink.log(level, message),
          });

          if (!effect.applied) {
            await sink.log('debug', `Skipped ${action.title}: ${effect.description}`);
            continue;
          }

          await sink.log('success', `Applied: ${action.title}`);
          await sink.log('info', effect.description);

          attemptRepairs.push({
            id: action.id,
            kind: action.kind,
            title: action.title,
            rationale: action.rationale,
            category: action.category,
            risk: action.risk,
            source: action.source,
            attempt: attemptNumber,
            filesTouched: effect.filesTouched,
            description: effect.description,
            rolledBack: false,
          });

          if (effect.envPatch) envPatch = { ...envPatch, ...effect.envPatch };
          if (effect.commandOverrides) commandOverrides = { ...commandOverrides, ...effect.commandOverrides };
        } catch (err) {
          await sink.log('warn', `Repair "${action.title}" failed to apply: ${errorMessage(err)}`);
        }
      }

      if (!attemptRepairs.length) {
        await sink.log('info', 'No repair in this plan changed anything; stopping.');
        break;
      }

      // Verify.
      await sink.setPhase('verify', 5, attemptNumber);
      const attemptEnv = { ...stepEnv, ...envPatch };
      const attemptCommands = { ...commands, ...commandOverrides };

      if (!sandbox.capabilities.canExecute) {
        await sink.log('warn', 'Cannot verify — execution is disabled. Repairs are reported unverified.');
        appliedRepairs.push(...attemptRepairs);
        await sink.recordAttempt({
          number: attemptNumber,
          strategy,
          repairs: attemptRepairs,
          result: null,
          outcome: 'pending',
          notes: 'Not verified: execution disabled.',
        });
        break;
      }

      await sink.log('info', `Verifying attempt ${attemptNumber}...`);
      const result = await runVerification({
        sandbox,
        cwd: projectDir,
        commands: attemptCommands,
        env: attemptEnv,
        signal,
        log: (level, message) => void sink.log(level, message),
        onOutput: (step, chunk) => void streamOutput(sink, step, chunk),
      });

      const comparison = compareRuns(best, result);

      if (comparison === 'improved' || result.overall === 'working') {
        await sink.log(
          'success',
          `Attempt ${attemptNumber} improved the project: score ${best.score} -> ${result.score}`,
        );
        appliedRepairs.push(...attemptRepairs);
        best = result;
        stepEnv = attemptEnv;
        commands = attemptCommands;
        await commitAttempt(repoDir, `revive: attempt ${attemptNumber} — ${strategy}`);
        bestCommit = await currentCommit(repoDir);

        await sink.recordAttempt({
          number: attemptNumber,
          strategy,
          repairs: attemptRepairs,
          result,
          outcome: result.overall === 'working' ? 'success' : 'improved',
        });

        await sink.setState({ repairs: appliedRepairs, finalResult: result });

        if (result.overall === 'working') {
          await sink.log('success', 'The project builds and runs. Stopping here.');
          break;
        }

        // Re-diagnose against the new failure surface to plan the next
        // attempt. The persisted diagnosis stays the original one.
        diagnoses = diagnose({ verification: result, detection, environment: finalEnv });
      } else {
        await sink.log(
          'warn',
          `Attempt ${attemptNumber} did not improve the project (score ${result.score} vs ${best.score}). Rolling back.`,
        );
        await rollbackTo(repoDir, bestCommit);
        for (const repair of attemptRepairs) repair.rolledBack = true;

        await sink.recordAttempt({
          number: attemptNumber,
          strategy,
          repairs: attemptRepairs,
          result,
          outcome: comparison === 'regressed' ? 'regressed' : 'no-change',
          notes: 'Changes were rolled back because they did not improve the outcome.',
        });

        // Keep rolled-back repairs in the record — the report shows what was
        // tried and rejected, which is often the most informative part.
        appliedRepairs.push(...attemptRepairs);
        await sink.setState({ repairs: appliedRepairs });
      }
    }

    await checkCancelled();

    // =====================================================================
    // PHASE 7 — COMPLETE
    // =====================================================================
    const status = determineStatus(baseline, best);
    const confidence = computeConfidence(baseline, best, appliedRepairs, finalEnv, sandbox);
    // The summary describes the original failure and what remains, not the
    // (possibly empty) list of problems left after a successful repair.
    const summary = buildSummary(status, baseline, best, appliedRepairs, cause, rootCause(diagnoses));

    await finalize({
      input,
      repoDir,
      projectDir,
      baselineCommit,
      detection,
      metadata,
      originalEnv,
      finalEnv,
      baseline,
      finalResult: best,
      diagnoses: initialDiagnoses,
      remaining: diagnoses,
      repairs: appliedRepairs,
      sandbox,
      status,
      summary,
      confidence,
      startedAt,
    });

    return { status, summary, confidence };
  } catch (err) {
    if (err instanceof CancelledError || signal.aborted) {
      await sink.log('warn', 'Job cancelled by request.');
      await sink.setPhase('cancelled', 6, 0);
      return { status: 'cancelled', summary: 'Cancelled before completion.', confidence: 0 };
    }
    throw err;
  } finally {
    await sandbox?.dispose().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Phase helpers
// ---------------------------------------------------------------------------

async function cloneAndInspect(
  input: RunJobInput,
  repoDir: string,
  sink: JobSink,
): Promise<RepoMetadata> {
  const source = input.localPath ?? input.repoUrl;
  await sink.log('info', `Cloning ${input.localPath ? 'fixture' : 'repository'}...`);

  const clone = await cloneRepository({
    url: source,
    dest: repoDir,
    ref: input.ref,
    signal: input.signal,
  });

  if (!clone.ok) {
    const reason = clone.stderr.split('\n').filter(Boolean).slice(-3).join(' ').trim();
    if (/not found|could not read|repository .* does not exist|authentication/i.test(reason)) {
      throw new JobError(
        'That repository could not be found. Check the URL and make sure the repository is public.',
        'REPO_NOT_FOUND',
      );
    }
    if (/timed out/i.test(reason)) {
      throw new JobError('Cloning timed out. The repository may be very large.', 'CLONE_TIMEOUT');
    }
    throw new JobError(`Clone failed: ${reason || 'unknown git error'}`, 'CLONE_FAILED');
  }

  // Size and file-count guards run before anything else touches the contents.
  const sizeBytes = await directorySize(repoDir, config.maxRepoBytes + 1);
  if (sizeBytes > config.maxRepoBytes) {
    await removeTree(repoDir).catch(() => undefined);
    throw new JobError(
      `Repository is larger than the ${Math.round(config.maxRepoBytes / 1024 / 1024)} MB limit.`,
      'REPO_TOO_LARGE',
    );
  }

  // The guard counts everything on disk (including .git) because that is what
  // could exhaust the host; the reported count excludes git internals and
  // build output so it reflects the project a person would recognise.
  const onDiskCount = await countFiles(repoDir, config.maxRepoFiles);
  if (onDiskCount > config.maxRepoFiles) {
    await removeTree(repoDir).catch(() => undefined);
    throw new JobError(
      `Repository contains more than ${config.maxRepoFiles} files.`,
      'REPO_TOO_MANY_FILES',
    );
  }

  const fileCount = (await walkRepo(repoDir, { maxFiles: config.maxRepoFiles })).files.length;

  const [headSha, defaultBranch, lastCommitDate, commitCount, topLanguages] = await Promise.all([
    getHeadSha(repoDir),
    getDefaultBranch(repoDir),
    getLastCommitDate(repoDir),
    getCommitCount(repoDir),
    languageBreakdown(repoDir),
  ]);

  const ageYears = lastCommitDate
    ? Math.max(
        0,
        (Date.now() - new Date(lastCommitDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000),
      )
    : null;

  const { owner, name } = parseOwnerName(input.repoUrl);

  const metadata: RepoMetadata = {
    owner,
    name,
    url: input.repoUrl,
    defaultBranch,
    headSha,
    headShortSha: headSha.slice(0, 7),
    lastCommitDate,
    ageYears: ageYears === null ? null : Math.round(ageYears * 10) / 10,
    commitCount,
    fileCount,
    sizeBytes,
    topLanguages,
    hasReadme: await hasReadme(repoDir),
    license: await detectLicense(repoDir),
  };

  await sink.log(
    'success',
    `Cloned ${metadata.owner}/${metadata.name} at ${metadata.headShortSha} — ${fileCount} files, last commit ${
      lastCommitDate ? lastCommitDate.slice(0, 10) : 'unknown'
    }${ageYears ? ` (${metadata.ageYears} years ago)` : ''}`,
  );

  return metadata;
}

async function finalize(args: {
  input: RunJobInput;
  repoDir: string;
  projectDir: string;
  baselineCommit: string;
  detection: any;
  metadata: RepoMetadata;
  originalEnv: EnvironmentSpec;
  finalEnv: EnvironmentSpec;
  baseline: VerificationResult;
  finalResult: VerificationResult;
  diagnoses: Diagnosis[];
  remaining?: Diagnosis[];
  repairs: AppliedRepair[];
  sandbox: Sandbox;
  status: JobStatus;
  summary: string;
  confidence: number;
  startedAt: number;
}): Promise<void> {
  const { input, sink } = { ...args, sink: args.input.sink };

  await sink.setPhase('complete', 6, 0);
  await sink.log('info', 'Generating artifacts...');

  // Keep only changes a kept repair is responsible for. Files written as a
  // side effect of running the project (lockfiles generated by install, and
  // so on) are verification noise, not repairs, and must not appear in the
  // patch. Paths from repairs are relative to the project root.
  const projectPrefix = path
    .relative(args.repoDir, args.projectDir)
    .split(path.sep)
    .filter(Boolean)
    .join('/');
  const allowed = new Set(
    args.repairs
      .filter((r) => !r.rolledBack)
      .flatMap((r) => r.filesTouched)
      .map((f) => (projectPrefix ? `${projectPrefix}/${f}` : f)),
  );
  const discarded = await revertUnattributedChanges(args.repoDir, args.baselineCommit, allowed);
  if (discarded.length) {
    await sink.log(
      'info',
      `Left out ${discarded.length} file(s) created by running the project rather than by a repair: ${discarded.slice(0, 5).join(', ')}${discarded.length > 5 ? ', ...' : ''}`,
    );
  }

  await commitAttempt(args.repoDir, 'revive: final state');

  const [changed, diff, patch] = await Promise.all([
    gitChangedFiles(args.repoDir, args.baselineCommit),
    diffText(args.repoDir, args.baselineCommit),
    formatPatch(args.repoDir, args.baselineCommit),
  ]);

  const dependencyDiff: DependencyChange[] = await computeDependencyDiff({
    repoDir: args.repoDir,
    projectDir: args.projectDir,
    baselineCommit: args.baselineCommit,
    language: args.detection.language,
    repairs: args.repairs,
  });

  const report = generateReport({
    metadata: args.metadata,
    detection: args.detection,
    originalEnv: args.originalEnv,
    finalEnv: args.finalEnv,
    baseline: args.baseline,
    finalResult: args.finalResult,
    diagnoses: args.diagnoses,
    repairs: args.repairs,
    changedFiles: changed,
    dependencyDiff,
    status: args.status,
    confidence: args.confidence,
    summary: args.summary,
    sandbox: args.sandbox.capabilities,
    durationMs: Date.now() - args.startedAt,
  });

  const artifacts = await writeArtifacts({
    jobId: input.jobId,
    repoDir: args.repoDir,
    patch,
    report,
    repoName: args.metadata.name,
  });

  await sink.setState({
    changedFiles: changed,
    dependencyDiff,
    diffText: diff,
    finalResult: args.finalResult,
    repairs: args.repairs,
    diagnosis: args.diagnoses,
    confidence: args.confidence,
    summary: args.summary,
    patchPath: artifacts.patchPath,
    zipPath: artifacts.zipPath,
    reportPath: artifacts.reportPath,
    durationMs: Date.now() - args.startedAt,
  });

  await sink.log(
    'success',
    `Complete: ${changed.length} file(s) changed, report and downloads generated.`,
  );
}

// ---------------------------------------------------------------------------
// Scoring and summaries
// ---------------------------------------------------------------------------

export function determineStatus(
  baseline: VerificationResult,
  final: VerificationResult,
): JobStatus {
  if (final.overall === 'working') return 'succeeded';
  if (final.score > baseline.score) return 'partial';
  if (final.overall === 'partial') return 'partial';
  return 'failed';
}

export function computeConfidence(
  baseline: VerificationResult,
  final: VerificationResult,
  repairs: AppliedRepair[],
  env: EnvironmentSpec,
  sandbox: Sandbox,
): number {
  if (!sandbox.capabilities.canExecute) {
    // Static-only: confidence reflects the environment evidence alone.
    return Math.min(50, Math.round(env.confidence * 0.5));
  }

  let score = final.score;

  // Verified execution is worth far more than a plausible-looking patch.
  if (final.overall === 'working') score = Math.max(score, 90);

  // High-risk repairs reduce confidence that behaviour was preserved.
  const kept = repairs.filter((r) => !r.rolledBack);
  const highRisk = kept.filter((r) => r.risk === 'high').length;
  score -= highRisk * 12;

  // Tests passing is the strongest signal that behaviour survived.
  if (final.testOk && final.steps.some((s) => s.step === 'test' && s.status === 'passed')) {
    score += 8;
  }

  // A confident environment reconstruction raises trust in the whole result.
  score += Math.round(env.confidence * 0.05);

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function buildSummary(
  status: JobStatus,
  baseline: VerificationResult,
  final: VerificationResult,
  repairs: AppliedRepair[],
  cause: Diagnosis | null,
  remaining: Diagnosis | null = null,
): string {
  const kept = repairs.filter((r) => !r.rolledBack);
  const causeText = cause ? cause.title.toLowerCase() : 'an unrecognised failure';
  const remainingText = remaining ? remaining.title.toLowerCase() : causeText;

  switch (status) {
    case 'succeeded':
      return kept.length
        ? `Revived. The project failed because of ${causeText}; ${kept.length} targeted ${kept.length === 1 ? 'repair' : 'repairs'} restored a working build.`
        : 'Revived with no changes required.';
    case 'partial':
      return `Partially revived. ${describeProgress(baseline, final)} The remaining blocker is ${remainingText}.`;
    case 'failed':
      return `Could not be revived automatically. The blocking failure is ${causeText}. Every diagnosis and attempted repair is recorded below.`;
    default:
      return 'Run did not complete.';
  }
}

function describeProgress(baseline: VerificationResult, final: VerificationResult): string {
  const gained: string[] = [];
  if (!baseline.installOk && final.installOk) gained.push('dependencies now install');
  if (!baseline.buildOk && final.buildOk) gained.push('the project now builds');
  if (!baseline.testOk && final.testOk) gained.push('tests now pass');
  if (!gained.length) return `Build health improved from ${baseline.score} to ${final.score}.`;
  return `${capitalize(gained.join(', '))}.`;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export class JobError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'JobError';
    this.code = code;
  }
}

function describeDetection(language: string): string {
  const names: Record<string, string> = {
    node: 'JavaScript/TypeScript',
    python: 'Python',
    java: 'Java',
    go: 'Go',
    rust: 'Rust',
    unknown: 'unrecognised',
  };
  return names[language] ?? language;
}

async function logCommands(sink: JobSink, commands: Record<string, string | undefined>) {
  const entries = Object.entries(commands).filter(([, v]) => v);
  if (!entries.length) {
    await sink.log('warn', 'No install/build/test commands could be determined.');
    return;
  }
  for (const [name, command] of entries) {
    await sink.log('info', `${name}: ${command}`);
  }
}

/** Stream sandbox output into the log, a line at a time, without flooding. */
const outputBuffers = new Map<string, string>();
async function streamOutput(sink: JobSink, step: string, chunk: string) {
  const key = step;
  const buffer = (outputBuffers.get(key) ?? '') + chunk;
  const lines = buffer.split('\n');
  outputBuffers.set(key, lines.pop() ?? '');
  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (trimmed) await sink.log('debug', trimmed);
  }
}

function parseOwnerName(url: string): { owner: string; name: string } {
  const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/i);
  if (match) return { owner: match[1], name: match[2] };
  const name = url.split(/[/\\]/).filter(Boolean).pop() ?? 'repository';
  return { owner: 'local', name: name.replace(/\.git$/, '') };
}

async function hasReadme(repoDir: string): Promise<boolean> {
  for (const name of ['README.md', 'README.rst', 'README.txt', 'README', 'readme.md']) {
    if (await pathExists(path.join(repoDir, name))) return true;
  }
  return false;
}

async function detectLicense(repoDir: string): Promise<string | null> {
  for (const name of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING']) {
    const file = path.join(repoDir, name);
    if (!(await pathExists(file))) continue;
    const text = await fs.readFile(file, 'utf8').catch(() => '');
    const head = text.slice(0, 600);
    if (/MIT License/i.test(head)) return 'MIT';
    if (/Apache License/i.test(head)) return 'Apache-2.0';
    if (/GNU GENERAL PUBLIC LICENSE/i.test(head)) return 'GPL';
    if (/BSD/i.test(head)) return 'BSD';
    if (/Mozilla Public License/i.test(head)) return 'MPL-2.0';
    if (/ISC License/i.test(head)) return 'ISC';
    return 'Other';
  }
  return null;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export { formatDuration };
