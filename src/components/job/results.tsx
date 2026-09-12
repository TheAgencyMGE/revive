'use client';

import * as React from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Download,
  FileText,
  Minus,
  Package,
  RotateCcw,
  X,
} from 'lucide-react';
import { Badge, Button, Card, CardHeader, Meter, EmptyState } from '@/components/ui/primitives';
import { cn, formatDuration } from '@/lib/utils';
import { CATEGORY_LABELS } from '@/engine/types';
import type {
  AppliedRepair,
  ChangedFile,
  DependencyChange,
  Diagnosis,
  VerificationResult,
} from '@/engine/types';

// ---------------------------------------------------------------------------
// Before / after step matrix
// ---------------------------------------------------------------------------

const STEP_ORDER = ['install', 'build', 'test', 'start'] as const;

function StepCell({ status }: { status: string | undefined }) {
  const map: Record<string, { icon: React.ReactNode; cls: string; label: string }> = {
    passed: {
      icon: <Check className="h-3.5 w-3.5" />,
      cls: 'text-verdigris bg-verdigris/10 border-verdigris/30',
      label: 'passed',
    },
    failed: {
      icon: <X className="h-3.5 w-3.5" />,
      cls: 'text-rust bg-rust/10 border-rust/30',
      label: 'failed',
    },
    timeout: {
      icon: <AlertTriangle className="h-3.5 w-3.5" />,
      cls: 'text-brass bg-brass/10 border-brass/30',
      label: 'timed out',
    },
    skipped: {
      icon: <Minus className="h-3.5 w-3.5" />,
      cls: 'text-faint bg-raised border-line',
      label: 'skipped',
    },
    'not-applicable': {
      icon: <Minus className="h-3.5 w-3.5" />,
      cls: 'text-faint/50 bg-transparent border-line',
      label: 'not defined',
    },
  };
  const style = map[status ?? 'not-applicable'] ?? map['not-applicable'];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 font-mono text-2xs uppercase tracking-label',
        style.cls,
      )}
      title={style.label}
    >
      {style.icon}
      {style.label}
    </span>
  );
}

export function BeforeAfter({
  baseline,
  final,
}: {
  baseline: VerificationResult | null;
  final: VerificationResult | null;
}) {
  if (!baseline) return null;

  return (
    <Card>
      <CardHeader eyebrow="Verification" title="Before and after" />

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <caption className="sr-only">Build step results before and after repair</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="label px-5 py-2.5 font-normal">
                Step
              </th>
              <th scope="col" className="label px-5 py-2.5 font-normal">
                Untouched
              </th>
              <th scope="col" className="label px-5 py-2.5 font-normal">
                After repair
              </th>
            </tr>
          </thead>
          <tbody>
            {STEP_ORDER.map((step) => {
              const before = baseline.steps.find((s) => s.step === step);
              const after = final?.steps.find((s) => s.step === step);
              if (before?.status === 'not-applicable' && after?.status === 'not-applicable') {
                return null;
              }
              const improved =
                before?.status !== 'passed' && after?.status === 'passed';
              return (
                <tr key={step} className="border-b border-line last:border-0">
                  <th
                    scope="row"
                    className="px-5 py-3 font-mono text-xs font-normal text-ink"
                  >
                    {step}
                  </th>
                  <td className="px-5 py-3">
                    <StepCell status={before?.status} />
                  </td>
                  <td className="px-5 py-3">
                    <span className="flex items-center gap-2">
                      <StepCell status={after?.status} />
                      {improved ? (
                        <span className="font-mono text-2xs text-verdigris">fixed</span>
                      ) : null}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="border-t border-line px-5 py-4">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="label">Build health</span>
          <span className="font-mono text-xs">
            <span className="text-muted">{baseline.score}</span>
            <ArrowRight className="mx-1.5 inline h-3 w-3 text-faint" />
            <span
              className={cn(
                'font-semibold',
                (final?.score ?? 0) > baseline.score ? 'text-verdigris' : 'text-muted',
              )}
            >
              {final?.score ?? baseline.score}
            </span>
            <span className="text-faint"> / 100</span>
          </span>
        </div>
        <Meter
          value={final?.score ?? baseline.score}
          tone={(final?.score ?? 0) >= 90 ? 'verdigris' : 'brass'}
          label="Build health score"
        />
        <p className="mt-2 text-2xs leading-relaxed text-faint">
          Weighted across install, build and test. Starting the app is reported but weighted
          lightly, because a start command often needs arguments or configuration that was never
          committed.
        </p>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Diagnoses
// ---------------------------------------------------------------------------

export function DiagnosisList({ diagnoses }: { diagnoses: Diagnosis[] }) {
  if (!diagnoses.length) {
    return (
      <Card>
        <CardHeader eyebrow="Diagnosis" title="What was wrong" />
        <EmptyState
          title="No known failure pattern matched"
          description="The build output did not match any of Revive's compatibility rules. The raw output is in the log above."
        />
      </Card>
    );
  }

  const severityTone = {
    blocker: 'rust',
    major: 'brass',
    minor: 'neutral',
  } as const;

  return (
    <Card>
      <CardHeader
        eyebrow="Diagnosis"
        title="What was wrong"
        action={
          <span className="font-mono text-2xs text-faint">
            {diagnoses.length} finding{diagnoses.length === 1 ? '' : 's'}
          </span>
        }
      />
      <ul className="divide-y divide-line">
        {diagnoses.map((d, index) => (
          <li key={`${d.category}-${index}`} className="px-5 py-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge tone={severityTone[d.severity]}>{d.severity}</Badge>
              <Badge tone="neutral">{CATEGORY_LABELS[d.category] ?? d.category}</Badge>
              <span className="font-mono text-2xs text-faint">
                {d.step} · {d.confidence}%
              </span>
              {d.source === 'ai' ? <Badge tone="blueprint">AI-assisted</Badge> : null}
            </div>

            <h3 className="mb-1.5 text-sm font-semibold leading-snug text-ink">{d.title}</h3>
            <p className="mb-3 text-xs leading-relaxed text-muted">{d.detail}</p>

            {d.evidence.trim() ? (
              <pre className="scrollbar-thin max-h-44 overflow-auto rounded border border-line bg-sunken p-3 font-mono text-2xs leading-relaxed text-muted">
                {d.evidence.trim()}
              </pre>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Repairs
// ---------------------------------------------------------------------------

export function RepairList({ repairs }: { repairs: AppliedRepair[] }) {
  const kept = repairs.filter((r) => !r.rolledBack);
  const rolledBack = repairs.filter((r) => r.rolledBack);

  if (!repairs.length) {
    return (
      <Card>
        <CardHeader eyebrow="Repair" title="Changes made" />
        <EmptyState
          title="No repairs were applied"
          description="Either the project already worked, or no repair strategy matched the diagnosis."
        />
      </Card>
    );
  }

  const riskTone = { low: 'verdigris', medium: 'brass', high: 'rust' } as const;

  return (
    <Card>
      <CardHeader
        eyebrow="Repair"
        title="Changes made"
        action={
          <span className="font-mono text-2xs text-faint">
            {kept.length} kept
            {rolledBack.length ? ` · ${rolledBack.length} reverted` : ''}
          </span>
        }
      />

      <ul className="divide-y divide-line">
        {kept.map((repair, index) => (
          <li key={`${repair.id}-${index}`} className="px-5 py-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge tone={riskTone[repair.risk]}>{repair.risk} risk</Badge>
              <Badge tone="neutral">{repair.kind}</Badge>
              <span className="font-mono text-2xs text-faint">attempt {repair.attempt}</span>
              {repair.source === 'ai' ? <Badge tone="blueprint">AI</Badge> : null}
            </div>

            <h3 className="mb-1.5 text-sm font-semibold leading-snug text-ink">{repair.title}</h3>
            <p className="mb-2 text-xs leading-relaxed text-muted">{repair.description}</p>

            <details className="group">
              <summary className="cursor-pointer list-none font-mono text-2xs uppercase tracking-label text-brass hover:underline">
                Why this fix
              </summary>
              <p className="mt-2 text-xs leading-relaxed text-muted">{repair.rationale}</p>
            </details>

            {repair.filesTouched.length ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {repair.filesTouched.map((file) => (
                  <code
                    key={file}
                    className="rounded-sm border border-line bg-raised px-1.5 py-0.5 font-mono text-2xs text-muted"
                  >
                    {file}
                  </code>
                ))}
              </div>
            ) : (
              <p className="mt-3 font-mono text-2xs text-faint">No files modified</p>
            )}
          </li>
        ))}
      </ul>

      {rolledBack.length ? (
        <div className="border-t border-line bg-sunken/40 px-5 py-4">
          <div className="mb-1 flex items-center gap-2">
            <RotateCcw className="h-3.5 w-3.5 text-faint" aria-hidden />
            <span className="label">Tried and reverted</span>
          </div>
          <p className="mb-3 text-2xs leading-relaxed text-faint">
            These were applied, verified, and undone because they did not improve the outcome.
            Knowing what fails is often as useful as knowing what works.
          </p>
          <ul className="space-y-2">
            {rolledBack.map((repair, index) => (
              <li key={`${repair.id}-rb-${index}`} className="text-xs text-muted">
                <span className="text-ink">{repair.title}</span>
                <span className="text-faint"> — attempt {repair.attempt}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Dependency changes
// ---------------------------------------------------------------------------

export function DependencyDiff({ changes }: { changes: DependencyChange[] }) {
  if (!changes.length) return null;

  const kindTone = {
    added: 'verdigris',
    removed: 'rust',
    changed: 'brass',
    replaced: 'blueprint',
  } as const;

  return (
    <Card>
      <CardHeader
        eyebrow="Dependencies"
        title="Dependency changes"
        action={<Package className="h-4 w-4 text-faint" />}
      />
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="label px-5 py-2.5 font-normal">
                Package
              </th>
              <th scope="col" className="label px-5 py-2.5 font-normal">
                Before
              </th>
              <th scope="col" className="label px-5 py-2.5 font-normal">
                After
              </th>
              <th scope="col" className="label px-5 py-2.5 font-normal">
                Change
              </th>
            </tr>
          </thead>
          <tbody>
            {changes.map((change) => (
              <tr key={change.name} className="border-b border-line last:border-0">
                <td className="px-5 py-2.5 font-mono text-xs text-ink">{change.name}</td>
                <td className="px-5 py-2.5 font-mono text-xs text-muted">
                  {change.before ?? '—'}
                </td>
                <td className="px-5 py-2.5 font-mono text-xs text-verdigris">
                  {change.after ?? '—'}
                </td>
                <td className="px-5 py-2.5">
                  <Badge tone={kindTone[change.kind]}>{change.kind}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Changed files
// ---------------------------------------------------------------------------

export function ChangedFiles({ files }: { files: ChangedFile[] }) {
  if (!files.length) {
    return (
      <Card>
        <CardHeader eyebrow="Diff" title="Files changed" />
        <EmptyState
          title="Nothing was modified"
          description="Revive reached this result without editing a single file — the repair was an environment or command change."
        />
      </Card>
    );
  }

  const statusTone = {
    added: 'text-verdigris',
    modified: 'text-brass',
    deleted: 'text-rust',
    renamed: 'text-blueprint',
  } as const;

  return (
    <Card>
      <CardHeader
        eyebrow="Diff"
        title="Files changed"
        action={
          <span className="font-mono text-2xs text-faint">
            {files.length} file{files.length === 1 ? '' : 's'}
          </span>
        }
      />
      <ul className="divide-y divide-line">
        {files.map((file) => (
          <li key={file.path} className="flex items-center gap-3 px-5 py-2.5">
            <span
              className={cn('w-16 shrink-0 font-mono text-2xs uppercase', statusTone[file.status])}
            >
              {file.status}
            </span>
            <code className="min-w-0 flex-1 truncate font-mono text-xs text-ink">
              {file.path}
            </code>
            <span className="shrink-0 font-mono text-2xs">
              <span className="text-verdigris">+{file.additions}</span>{' '}
              <span className="text-rust">-{file.deletions}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------

export function Downloads({
  jobId,
  hasZip,
  hasPatch,
  hasReport,
}: {
  jobId: string;
  hasZip: boolean;
  hasPatch: boolean;
  hasReport: boolean;
}) {
  const items = [
    {
      available: hasZip,
      href: `/api/jobs/${jobId}/download/zip`,
      icon: <Download className="h-3.5 w-3.5" />,
      label: 'Repaired repository',
      hint: 'ZIP, without dependency trees',
    },
    {
      available: hasPatch,
      href: `/api/jobs/${jobId}/download/patch`,
      icon: <FileText className="h-3.5 w-3.5" />,
      label: 'Patch',
      hint: 'Apply with git apply',
    },
    {
      available: hasReport,
      href: `/api/jobs/${jobId}/download/report`,
      icon: <FileText className="h-3.5 w-3.5" />,
      label: 'REVIVAL_REPORT.md',
      hint: 'Full findings and limitations',
    },
  ].filter((item) => item.available);

  if (!items.length) return null;

  return (
    <Card>
      <CardHeader eyebrow="Artifacts" title="Take it with you" />
      <ul className="divide-y divide-line">
        {items.map((item) => (
          <li key={item.href}>
            <a
              href={item.href}
              className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-raised"
            >
              <span className="text-brass">{item.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium text-ink">{item.label}</span>
                <span className="block text-2xs text-faint">{item.hint}</span>
              </span>
              <Download className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
            </a>
          </li>
        ))}
      </ul>
    </Card>
  );
}
