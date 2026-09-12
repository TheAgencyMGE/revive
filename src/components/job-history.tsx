'use client';

import * as React from 'react';
import Link from 'next/link';
import { Archive, Trash2, Loader2 } from 'lucide-react';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Skeleton,
  StatusPill,
} from '@/components/ui/primitives';
import { fetchJson, formatDuration, LANGUAGE_LABELS, relativeTime } from '@/lib/utils';
import type { JobView } from '@/engine/types';

const RUNNING = new Set(['queued', 'running']);

export function JobHistory() {
  const [jobs, setJobs] = React.useState<JobView[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const data = await fetchJson<{ jobs: JobView[] }>('/api/jobs?limit=100');
      setJobs(data.jobs);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load history.');
      setJobs((current) => current ?? []);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Keep in-flight rows fresh without a stream per row.
  React.useEffect(() => {
    if (!jobs?.some((j) => RUNNING.has(j.status))) return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [jobs, load]);

  const remove = async (id: string) => {
    if (!window.confirm('Delete this run, its logs and its downloads? This cannot be undone.')) {
      return;
    }
    setDeleting(id);
    try {
      await fetchJson(`/api/jobs/${id}`, { method: 'DELETE' });
      setJobs((current) => current?.filter((j) => j.id !== id) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete that run.');
    } finally {
      setDeleting(null);
    }
  };

  if (jobs === null) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <Alert tone="rust" title="Problem">
          {error}
        </Alert>
      ) : null}

      {jobs.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Archive className="h-6 w-6" />}
            title="No revivals yet"
            description="Paste a repository URL or run one of the demos, and it will be recorded here."
            action={
              <Button asChild>
                <Link href="/">Start a revival</Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line">
            {jobs.map((job) => {
              const name = job.metadata
                ? `${job.metadata.owner}/${job.metadata.name}`
                : job.repoUrl.replace(/^https:\/\/github\.com\//, '');
              return (
                <li key={job.id} className="group flex items-center gap-4 px-5 py-3.5 hover:bg-raised">
                  <Link href={`/jobs/${job.id}`} className="flex min-w-0 flex-1 items-center gap-4">
                    <StatusPill status={job.status} className="w-40 shrink-0 justify-start" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-xs text-ink">{name}</div>
                      <div className="mt-0.5 truncate text-2xs text-faint">
                        {job.summary ??
                          (RUNNING.has(job.status) ? `In progress — ${job.phase}` : '—')}
                      </div>
                    </div>
                    <div className="hidden shrink-0 text-right font-mono text-2xs text-faint sm:block">
                      <div>
                        {job.detection
                          ? LANGUAGE_LABELS[job.detection.language] ?? job.detection.language
                          : '—'}
                        {job.source === 'fixture' ? ' · demo' : ''}
                      </div>
                      <div className="mt-0.5">
                        {relativeTime(job.createdAt)}
                        {job.durationMs ? ` · ${formatDuration(job.durationMs)}` : ''}
                      </div>
                    </div>
                    {job.confidence !== null ? (
                      <div className="hidden w-12 shrink-0 text-right font-mono text-xs text-muted md:block">
                        {job.confidence}%
                      </div>
                    ) : (
                      <div className="hidden w-12 md:block" />
                    )}
                  </Link>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => remove(job.id)}
                    disabled={deleting === job.id}
                    aria-label={`Delete run of ${name}`}
                    className="opacity-60 group-hover:opacity-100"
                  >
                    {deleting === job.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
