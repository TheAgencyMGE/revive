import type {
  AppliedRepair,
  ChangedFile,
  DependencyChange,
  DetectionResult,
  Diagnosis,
  EnvironmentSpec,
  JobStatus,
  RepoMetadata,
  SandboxCapabilities,
  VerificationResult,
} from './types';
import { CATEGORY_LABELS } from './types';
import { formatBytes } from './fsutil';
import { formatDuration } from './runner';

/**
 * REVIVAL_REPORT.md generation.
 *
 * The report is written for a human who has never seen the repository and
 * wants to know three things: what was wrong, what was changed, and whether
 * they should trust the result. It states limitations plainly rather than
 * overselling a partial success.
 */

export interface ReportInput {
  metadata: RepoMetadata;
  detection: DetectionResult;
  originalEnv: EnvironmentSpec;
  finalEnv: EnvironmentSpec;
  baseline: VerificationResult;
  finalResult: VerificationResult;
  diagnoses: Diagnosis[];
  repairs: AppliedRepair[];
  changedFiles: ChangedFile[];
  dependencyDiff: DependencyChange[];
  status: JobStatus;
  confidence: number;
  summary: string;
  sandbox: SandboxCapabilities;
  durationMs: number;
}

export function generateReport(input: ReportInput): string {
  const lines: string[] = [];
  const push = (...text: string[]) => lines.push(...text);

  const statusBadge: Record<string, string> = {
    succeeded: 'REVIVED',
    partial: 'PARTIALLY REVIVED',
    failed: 'NOT REVIVED',
    cancelled: 'CANCELLED',
    queued: 'QUEUED',
    running: 'RUNNING',
  };

  // -------------------------------------------------------------------------
  push(`# Revival Report: ${input.metadata.owner}/${input.metadata.name}`);
  push('');
  push(`**Status:** ${statusBadge[input.status] ?? input.status}  `);
  push(`**Confidence:** ${input.confidence}%  `);
  push(`**Generated:** ${new Date().toISOString()}  `);
  push(`**Duration:** ${formatDuration(input.durationMs)}`);
  push('');
  push('> ' + input.summary);
  push('');

  // -------------------------------------------------------------------------
  push('## Repository');
  push('');
  push('| | |');
  push('|---|---|');
  push(`| Source | ${input.metadata.url} |`);
  push(`| Commit | \`${input.metadata.headShortSha}\` on \`${input.metadata.defaultBranch}\` |`);
  push(
    `| Last commit | ${input.metadata.lastCommitDate?.slice(0, 10) ?? 'unknown'}${
      input.metadata.ageYears !== null ? ` (${input.metadata.ageYears} years ago)` : ''
    } |`,
  );
  push(`| Commits | ${input.metadata.commitCount} |`);
  push(`| Files | ${input.metadata.fileCount} |`);
  push(`| Size | ${formatBytes(input.metadata.sizeBytes)} |`);
  push(`| License | ${input.metadata.license ?? 'not detected'} |`);
  if (input.metadata.topLanguages.length) {
    push(
      `| Languages | ${input.metadata.topLanguages.map((l) => `${l.name} (${l.files})`).join(', ')} |`,
    );
  }
  push('');

  // -------------------------------------------------------------------------
  push('## Detected project');
  push('');
  push('| | |');
  push('|---|---|');
  push(`| Language | ${input.detection.language} |`);
  push(`| Framework | ${input.detection.framework ?? 'none detected'} |`);
  push(`| Package manager | ${input.detection.packageManager} |`);
  push(`| Manifests | ${input.detection.manifestFiles.join(', ') || 'none'} |`);
  push(
    `| Lockfile | ${
      input.detection.hasLockfile
        ? `${input.detection.lockfiles.join(', ')}${input.detection.lockfileVersion ? ` (v${input.detection.lockfileVersion})` : ''}`
        : 'none'
    } |`,
  );
  push(`| Module system | ${input.detection.moduleSystem} |`);
  if (input.detection.projectRoot) push(`| Project root | \`${input.detection.projectRoot}\` |`);
  push('');

  if (input.detection.notes.length) {
    push('Detection notes:');
    push('');
    for (const note of input.detection.notes) push(`- ${note}`);
    push('');
  }

  // -------------------------------------------------------------------------
  push('## Environment archaeology');
  push('');
  push(
    'Revive reconstructs the toolchain the project originally expected rather than assuming the newest one.',
  );
  push('');
  push('| | Original (inferred) | Final (used) |');
  push('|---|---|---|');
  push(
    `| Runtime | ${input.originalEnv.runtime ?? 'unknown'} ${input.originalEnv.runtimeVersion ?? '?'} | ${input.finalEnv.runtime ?? 'unknown'} ${input.finalEnv.actualVersion ?? 'not run'} |`,
  );
  push(
    `| Package manager | ${input.originalEnv.packageManager}${input.originalEnv.packageManagerVersion ? ` ${input.originalEnv.packageManagerVersion}` : ''} | ${input.finalEnv.packageManager} |`,
  );
  push(`| Inference confidence | ${input.originalEnv.confidence}% | — |`);
  push('');

  if (input.originalEnv.evidence.length) {
    push('### Evidence trail');
    push('');
    push('| Source | Value | Weight | Note |');
    push('|---|---|---|---|');
    for (const e of input.originalEnv.evidence) {
      push(`| \`${e.source}\` | \`${e.value}\` | ${e.weight} | ${e.note ?? ''} |`);
    }
    push('');
  }

  // -------------------------------------------------------------------------
  push('## What was wrong');
  push('');
  if (!input.diagnoses.length) {
    push('No known failure pattern matched the build output.');
    push('');
  } else {
    for (const [index, d] of input.diagnoses.entries()) {
      push(`### ${index + 1}. ${d.title}`);
      push('');
      push(
        `**Category:** ${CATEGORY_LABELS[d.category]} · **Severity:** ${d.severity} · **Step:** ${d.step} · **Confidence:** ${d.confidence}%${d.source === 'ai' ? ' · *AI-assisted*' : ''}`,
      );
      push('');
      push(d.detail);
      push('');
      if (d.evidence.trim()) {
        push('```text');
        push(d.evidence.trim());
        push('```');
        push('');
      }
    }
  }

  // -------------------------------------------------------------------------
  push('## Before and after');
  push('');
  push('| Step | Before | After |');
  push('|---|---|---|');
  for (const step of ['install', 'build', 'test', 'start'] as const) {
    const before = input.baseline.steps.find((s) => s.step === step);
    const after = input.finalResult.steps.find((s) => s.step === step);
    if (!before && !after) continue;
    push(`| ${step} | ${statusIcon(before?.status)} | ${statusIcon(after?.status)} |`);
  }
  push(`| **Score** | **${input.baseline.score}/100** | **${input.finalResult.score}/100** |`);
  push('');

  // -------------------------------------------------------------------------
  push('## Repairs applied');
  push('');
  const kept = input.repairs.filter((r) => !r.rolledBack);
  const rolledBack = input.repairs.filter((r) => r.rolledBack);

  if (!kept.length) {
    push('No repairs were kept.');
    push('');
  } else {
    for (const [index, repair] of kept.entries()) {
      push(`### ${index + 1}. ${repair.title}`);
      push('');
      push(
        `**Kind:** ${repair.kind} · **Risk:** ${repair.risk} · **Attempt:** ${repair.attempt}${repair.source === 'ai' ? ' · *AI-generated*' : ''}`,
      );
      push('');
      push(`**Why:** ${repair.rationale}`);
      push('');
      push(`**What changed:** ${repair.description}`);
      if (repair.filesTouched.length) {
        push('');
        push(`**Files:** ${repair.filesTouched.map((f) => `\`${f}\``).join(', ')}`);
      }
      push('');
    }
  }

  if (rolledBack.length) {
    push('### Attempted and rolled back');
    push('');
    push(
      'These repairs were applied, verified, and reverted because they did not improve the outcome. They are listed because knowing what does *not* work is often as useful as knowing what does.',
    );
    push('');
    for (const repair of rolledBack) {
      push(`- **${repair.title}** (attempt ${repair.attempt}) — ${repair.description}`);
    }
    push('');
  }

  // -------------------------------------------------------------------------
  if (input.dependencyDiff.length) {
    push('## Dependency changes');
    push('');
    push('| Package | Before | After | Change |');
    push('|---|---|---|---|');
    for (const change of input.dependencyDiff) {
      push(
        `| \`${change.name}\` | ${change.before ? `\`${change.before}\`` : '—'} | ${change.after ? `\`${change.after}\`` : '—'} | ${change.kind} |`,
      );
    }
    push('');
  }

  // -------------------------------------------------------------------------
  push('## Files changed');
  push('');
  if (!input.changedFiles.length) {
    push('No files were modified.');
    push('');
  } else {
    push('| File | Change | +/- |');
    push('|---|---|---|');
    for (const file of input.changedFiles) {
      push(`| \`${file.path}\` | ${file.status} | +${file.additions} / -${file.deletions} |`);
    }
    push('');
  }

  // -------------------------------------------------------------------------
  push('## Verification detail');
  push('');
  for (const step of input.finalResult.steps) {
    if (step.status === 'not-applicable') continue;
    push(`### ${step.step} — ${step.status}`);
    push('');
    if (step.command) {
      push('```bash');
      push(step.command);
      push('```');
      push('');
    }
    if (step.output.trim()) {
      push('```text');
      push(tailLines(step.output, 40));
      push('```');
      push('');
    }
  }

  // -------------------------------------------------------------------------
  push('## Execution environment');
  push('');
  push(`**Sandbox mode:** ${input.sandbox.mode}`);
  push('');
  push(input.sandbox.detail);
  push('');
  push('| Control | Enforced |');
  push('|---|---|');
  push(`| Code execution | ${input.sandbox.canExecute ? 'yes' : 'no (analysis only)'} |`);
  push(`| CPU limit | ${yesNo(input.sandbox.cpuLimited)} |`);
  push(`| Memory limit | ${yesNo(input.sandbox.memoryLimited)} |`);
  push(`| Disk limit | ${yesNo(input.sandbox.diskLimited)} |`);
  push(`| Process limit | ${yesNo(input.sandbox.processLimited)} |`);
  push(`| Filesystem isolation | ${yesNo(input.sandbox.filesystemIsolated)} |`);
  push(`| Network control | ${yesNo(input.sandbox.networkControlled)} |`);
  push('');

  // -------------------------------------------------------------------------
  push('## Limitations');
  push('');
  for (const limitation of limitations(input)) push(`- ${limitation}`);
  push('');

  push('---');
  push('');
  push('*Generated by Revive — automated software archaeology for abandoned repositories.*');
  push('');

  return lines.join('\n');
}

function limitations(input: ReportInput): string[] {
  const out: string[] = [];

  if (!input.sandbox.canExecute) {
    out.push(
      'Code was never executed, so every conclusion here is static. Diagnoses are based on manifests and known compatibility rules rather than observed failures.',
    );
  }
  if (!input.finalEnv.available) {
    out.push(
      `The ${input.originalEnv.runtime ?? 'required'} toolchain was not available on the execution host, so the project could not be run in its original environment.`,
    );
  } else if (
    input.originalEnv.runtimeVersion &&
    input.finalEnv.actualVersion &&
    input.originalEnv.runtimeVersion.split('.')[0] !== input.finalEnv.actualVersion.split('.')[0]
  ) {
    out.push(
      `The project targets ${input.originalEnv.runtime} ${input.originalEnv.runtimeVersion} but was executed on ${input.finalEnv.actualVersion}. Some failures may be artifacts of that mismatch rather than defects in the code.`,
    );
  }

  const testStep = input.finalResult.steps.find((s) => s.step === 'test');
  if (!testStep || testStep.status === 'not-applicable') {
    out.push(
      'The project defines no test suite, so there is no behavioural evidence that the repairs preserved the original behaviour — only that it builds.',
    );
  } else if (testStep.status !== 'passed') {
    out.push(
      'Tests did not pass. Revive never edits tests to make them green, so a failing suite is reported as a failing suite.',
    );
  }

  const startStep = input.finalResult.steps.find((s) => s.step === 'start');
  if (startStep && startStep.status === 'failed') {
    out.push(
      `The start command (\`${startStep.command}\`) exited non-zero. This does not affect the revived verdict — many projects need arguments, a free port, or configuration that was never committed — but it does mean Revive has not observed the project actually running.`,
    );
  }

  const highRisk = input.repairs.filter((r) => !r.rolledBack && r.risk === 'high');
  if (highRisk.length) {
    out.push(
      `${highRisk.length} high-risk repair(s) were applied (${highRisk.map((r) => r.title).join('; ')}). Review the diff before trusting the result.`,
    );
  }

  if (input.status === 'partial') {
    out.push('The project is not fully working. Remaining failures are listed above.');
  }

  if (!out.length) {
    out.push('No significant limitations. The project was verified end to end in its target environment.');
  }

  return out;
}

function statusIcon(status: string | undefined): string {
  switch (status) {
    case 'passed':
      return 'pass';
    case 'failed':
      return 'FAIL';
    case 'timeout':
      return 'timeout';
    case 'skipped':
      return 'skipped';
    case 'not-applicable':
      return 'n/a';
    default:
      return '—';
  }
}

function yesNo(value: boolean): string {
  return value ? 'yes' : 'no';
}

function tailLines(text: string, count: number): string {
  const lines = text.trimEnd().split('\n');
  if (lines.length <= count) return lines.join('\n');
  return `... [${lines.length - count} earlier lines omitted] ...\n${lines.slice(-count).join('\n')}`;
}
