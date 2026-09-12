'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as Tabs from '@radix-ui/react-tabs';
import {
  ArrowLeft,
  Ban,
  ExternalLink,
  GitCommitHorizontal,
  Loader2,
  RotateCw,
} from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Meter,
  StatusPill,
} from '@/components/ui/primitives';
import { Pipeline } from './pipeline';
import { LogStream } from './log-stream';
import { EvidenceLedger } from './evidence';
import {
  BeforeAfter,
  ChangedFiles,
  DependencyDiff,
  DiagnosisList,
  Downloads,
  RepairList,
} from './results';
import { DiffViewer } from './diff-viewer';
import { useJobStream } from '@/hooks/use-job-stream';
import { cn, describeAge, fetchJson, formatBytes, formatDuration, LANGUAGE_LABELS } from '@/lib/utils';
import type { JobView } from '@/engine/types';

const RUNNING = new Set(['queued', 'running']);

export function JobPage({ initialJob }: { initialJob: JobView }) {
  const router = useRouter();
  const { job, logs, connected, error } = useJobStream(initialJob.id, initialJob);
  const [busy, setBusy] = React.useState<'cancel' | 'retry' | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const current = job ?? initialJob;
  const isRunning = RUNNING.has(current.status);
  const isFinished = !isRunning;

  const cancel = async () => {
    setBusy('cancel');
    setActionError(null);
    try {
      await fetchJson(`/api/jobs/${current.id}/cancel`, { method: 'POST' });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not cancel this run.');
    } finally {
      setBusy(null);
    }
  };

  const retry = async () => {
    setBusy('retry');
    setActionError(null);
    try {
      const result = await fetchJson<{ id: string }>(`/api/jobs/${current.id}/retry`, {
        method: 'POST',
      });
      router.push(`/jobs/${result.id}`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not retry this run.');
      setBusy(null);
    }
  };

  const meta = current.metadata;
  const detection = current.detection;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      {/* ------------------------------------------------------------------ */}
      {/* Header                                                              */}
      {/* ------------------------------------------------------------------ */}
      <div className="mb-6">
        <Link
          href="/jobs"
          className="mb-4 inline-flex items-center gap-1.5 font-mono text-2xs uppercase tracking-label text-faint transition-colors hover:text-muted"
        >
          <ArrowLeft className="h-3 w-3" /> All revivals
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <StatusPill status={current.status} />
              {current.source === 'fixture' ? <Badge tone="neutral">Demo</Badge> : null}
              {current.parentJobId ? (
                <Link href={`/jobs/${current.parentJobId}`}>
                  <Badge tone="neutral">Retry of an earlier run</Badge>
                </Link>
              ) : null}
              {current.sandboxMode ? (
                <Badge tone={current.sandboxMode === 'docker' ? 'verdigris' : 'brass'}>
                  {current.sandboxMode} sandbox
                </Badge>
              ) : null}
            </div>

            <h1 className="mb-1 truncate font-mono text-xl font-semibold tracking-display text-ink sm:text-2xl">
              {meta ? `${meta.owner}/${meta.name}` : current.repoUrl}
            </h1>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-2xs text-faint">
              {meta?.headShortSha ? (
                <span className="inline-flex items-center gap-1">
                  <GitCommitHorizontal className="h-3 w-3" />
                  {meta.headShortSha}
                </span>
              ) : null}
              {meta?.lastCommitDate ? (
                <span>
                  last commit {meta.lastCommitDate.slice(0, 10)} · {describeAge(meta.ageYears)}
                </span>
              ) : null}
              {current.durationMs ? <span>took {formatDuration(current.durationMs)}</span> : null}
              {current.source === 'github' ? (
                <a
                  href={current.repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-brass hover:underline"
                >
                  View on GitHub <ExternalLink className="h-3 w-3" />
                </a>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 gap-2">
            {isRunning ? (
              <Button variant="danger" size="sm" onClick={cancel} disabled={busy !== null}>
                {busy === 'cancel' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Ban className="h-3.5 w-3.5" />
                )}
                Cancel
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={retry} disabled={busy !== null}>
                {busy === 'retry' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCw className="h-3.5 w-3.5" />
                )}
                Run again
              </Button>
            )}
          </div>
        </div>
      </div>

      {actionError ? (
        <div className="mb-4">
          <Alert tone="rust" title="Action failed">
            {actionError}
          </Alert>
        </div>
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {/* Verdict                                                             */}
      {/* ------------------------------------------------------------------ */}
      {isFinished && current.summary ? (
        <div className="mb-6">
          <Verdict
            status={current.status}
            summary={current.summary}
            confidence={current.confidence}
            errorMessage={current.errorMessage}
          />
        </div>
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {/* Main grid                                                           */}
      {/* ------------------------------------------------------------------ */}
      <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
        {/* Left rail */}
        <div className="space-y-5">
          <Card>
            <CardHeader
              eyebrow="Progress"
              title="Pipeline"
              action={
                isRunning ? (
                  <span
                    className={cn(
                      'font-mono text-2xs',
                      connected ? 'text-verdigris' : 'text-brass',
                    )}
                  >
                    {connected ? 'streaming' : 'polling'}
                  </span>
                ) : null
              }
            />
            <div className="p-3">
              <Pipeline
                phase={current.phase}
                status={current.status}
                attempt={current.attempt}
              />
            </div>
          </Card>

          {detection ? (
            <Card>
              <CardHeader eyebrow="Detected" title="Project" />
              <dl className="divide-y divide-line px-5 py-1">
                <Field label="Language">
                  {LANGUAGE_LABELS[detection.language] ?? detection.language}
                </Field>
                {detection.framework ? (
                  <Field label="Framework">{detection.framework}</Field>
                ) : null}
                <Field label="Manager" mono>
                  {detection.packageManager}
                </Field>
                <Field label="Modules" mono>
                  {detection.moduleSystem}
                </Field>
                <Field label="Lockfile" mono>
                  {detection.hasLockfile ? detection.lockfiles.join(', ') : 'none'}
                </Field>
                {detection.dependencies.length ? (
                  <Field label="Dependencies">{detection.dependencies.length}</Field>
                ) : null}
              </dl>
            </Card>
          ) : null}

          {meta ? (
            <Card>
              <CardHeader eyebrow="Repository" title="Inventory" />
              <dl className="divide-y divide-line px-5 py-1">
                <Field label="Files">{meta.fileCount.toLocaleString()}</Field>
                <Field label="Size">{formatBytes(meta.sizeBytes)}</Field>
                <Field label="Commits">{meta.commitCount.toLocaleString()}</Field>
                <Field label="License">{meta.license ?? 'none found'}</Field>
                {meta.topLanguages.length ? (
                  <Field label="Mix">
                    {meta.topLanguages
                      .slice(0, 3)
                      .map((l) => l.name)
                      .join(', ')}
                  </Field>
                ) : null}
              </dl>
            </Card>
          ) : null}

          {isFinished ? (
            <Downloads
              jobId={current.id}
              hasZip={current.hasZip}
              hasPatch={current.hasPatch}
              hasReport={current.hasReport}
            />
          ) : null}
        </div>

        {/* Right: tabs */}
        <div className="min-w-0">
          <Tabs.Root defaultValue={isRunning ? 'output' : 'findings'}>
            <Tabs.List
              className="mb-5 flex gap-1 border-b border-line"
              aria-label="Revival detail"
            >
              {[
                { value: 'findings', label: 'Findings' },
                { value: 'output', label: 'Output' },
                { value: 'changes', label: 'Changes' },
              ].map((tab) => (
                <Tabs.Trigger
                  key={tab.value}
                  value={tab.value}
                  className="-mb-px border-b-2 border-transparent px-3 py-2 font-mono text-2xs uppercase tracking-label text-faint transition-colors hover:text-muted data-[state=active]:border-brass data-[state=active]:text-ink"
                >
                  {tab.label}
                </Tabs.Trigger>
              ))}
            </Tabs.List>

            <Tabs.Content value="findings" className="space-y-5 focus:outline-none">
              <EvidenceLedger original={current.originalEnv} final={current.finalEnv} />
              {current.baseline ? (
                <BeforeAfter baseline={current.baseline} final={current.finalResult} />
              ) : null}
              <DiagnosisList diagnoses={current.diagnosis} />
              <RepairList repairs={current.repairs} />
            </Tabs.Content>

            <Tabs.Content value="output" className="focus:outline-none">
              <Card className="flex h-[calc(100vh-16rem)] min-h-[24rem] flex-col overflow-hidden">
                <LogStream logs={logs} running={isRunning} />
              </Card>
              {error ? (
                <div className="mt-3">
                  <Alert tone="rust" title="Stream error">
                    {error}
                  </Alert>
                </div>
              ) : null}
            </Tabs.Content>

            <Tabs.Content value="changes" className="space-y-5 focus:outline-none">
              <ChangedFiles files={current.changedFiles} />
              <DependencyDiff changes={current.dependencyDiff} />
              <DiffViewer jobId={current.id} enabled={isFinished} />
            </Tabs.Content>
          </Tabs.Root>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Verdict({
  status,
  summary,
  confidence,
  errorMessage,
}: {
  status: string;
  summary: string;
  confidence: number | null;
  errorMessage: string | null;
}) {
  const tone =
    status === 'succeeded'
      ? { border: 'border-verdigris/40', bg: 'bg-verdigris/5', text: 'text-verdigris' }
      : status === 'partial'
        ? { border: 'border-brass/40', bg: 'bg-brass/5', text: 'text-brass' }
        : status === 'cancelled'
          ? { border: 'border-line', bg: 'bg-raised', text: 'text-muted' }
          : { border: 'border-rust/40', bg: 'bg-rust/5', text: 'text-rust' };

  const headline =
    status === 'succeeded'
      ? 'Revived'
      : status === 'partial'
        ? 'Partially revived'
        : status === 'cancelled'
          ? 'Cancelled'
          : 'Not revived';

  return (
    <div className={cn('rounded-md border p-5', tone.border, tone.bg)}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className={cn('mb-1.5 font-mono text-2xs uppercase tracking-label', tone.text)}>
            {headline}
          </div>
          <p className="text-sm leading-relaxed text-ink">{summary}</p>
          {errorMessage && status === 'failed' && errorMessage !== summary ? (
            <p className="mt-2 font-mono text-2xs text-rust">{errorMessage}</p>
          ) : null}
        </div>

        {confidence !== null ? (
          <div className="w-40 shrink-0">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="label">Confidence</span>
              <span className={cn('font-mono text-sm font-semibold', tone.text)}>
                {confidence}%
              </span>
            </div>
            <Meter
              value={confidence}
              tone={status === 'succeeded' ? 'verdigris' : status === 'partial' ? 'brass' : 'rust'}
              label="Result confidence"
            />
            <p className="mt-1.5 text-2xs leading-relaxed text-faint">
              Based on what was verified, not on how the patch looks.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
