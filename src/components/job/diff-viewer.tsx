'use client';

import * as React from 'react';
import { FileDiff } from 'lucide-react';
import { Card, CardHeader, Skeleton, EmptyState } from '@/components/ui/primitives';
import { cn, fetchJson } from '@/lib/utils';

/**
 * Unified diff viewer.
 *
 * The diff is parsed into files and hunks and rendered as React elements —
 * never as HTML — because every byte of it originates in an untrusted
 * repository. Line content is escaped by React itself.
 */

interface DiffLine {
  type: 'add' | 'del' | 'context' | 'hunk' | 'meta';
  text: string;
}

interface DiffFile {
  path: string;
  lines: DiffLine[];
  additions: number;
  deletions: number;
}

export function parseUnifiedDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;

  for (const raw of diff.split('\n')) {
    if (raw.startsWith('diff --git')) {
      if (current) files.push(current);
      // "diff --git a/path b/path" — take the b-side path.
      const match = raw.match(/ b\/(.+)$/);
      current = {
        path: match ? match[1] : raw.replace('diff --git ', ''),
        lines: [],
        additions: 0,
        deletions: 0,
      };
      continue;
    }
    if (!current) continue;

    if (
      raw.startsWith('index ') ||
      raw.startsWith('--- ') ||
      raw.startsWith('+++ ') ||
      raw.startsWith('new file') ||
      raw.startsWith('deleted file') ||
      raw.startsWith('similarity ') ||
      raw.startsWith('rename ') ||
      raw.startsWith('old mode') ||
      raw.startsWith('new mode') ||
      raw.startsWith('Binary files')
    ) {
      current.lines.push({ type: 'meta', text: raw });
    } else if (raw.startsWith('@@')) {
      current.lines.push({ type: 'hunk', text: raw });
    } else if (raw.startsWith('+')) {
      current.additions++;
      current.lines.push({ type: 'add', text: raw.slice(1) });
    } else if (raw.startsWith('-')) {
      current.deletions++;
      current.lines.push({ type: 'del', text: raw.slice(1) });
    } else {
      current.lines.push({ type: 'context', text: raw.startsWith(' ') ? raw.slice(1) : raw });
    }
  }

  if (current) files.push(current);
  return files;
}

export function DiffViewer({ jobId, enabled }: { jobId: string; enabled: boolean }) {
  const [diff, setDiff] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!enabled || diff !== null) return;
    setLoading(true);
    fetchJson<{ diff: string }>(`/api/jobs/${jobId}/diff`)
      .then((data) => setDiff(data.diff))
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load the diff.'))
      .finally(() => setLoading(false));
  }, [enabled, jobId, diff]);

  const files = React.useMemo(() => (diff ? parseUnifiedDiff(diff) : []), [diff]);

  if (!enabled) return null;

  return (
    <Card>
      <CardHeader
        eyebrow="Diff"
        title="Exactly what changed"
        action={<FileDiff className="h-4 w-4 text-faint" />}
      />

      {loading ? (
        <div className="space-y-2 p-5">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : error ? (
        <EmptyState title="Diff unavailable" description={error} />
      ) : !files.length ? (
        <EmptyState
          title="No diff to show"
          description="Revive did not modify any files in this run."
        />
      ) : (
        <div className="divide-y divide-line">
          {files.map((file) => (
            <details key={file.path} open={files.length <= 3}>
              <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-3 hover:bg-raised">
                <code className="min-w-0 flex-1 truncate font-mono text-xs text-ink">
                  {file.path}
                </code>
                <span className="shrink-0 font-mono text-2xs">
                  <span className="text-verdigris">+{file.additions}</span>{' '}
                  <span className="text-rust">-{file.deletions}</span>
                </span>
              </summary>

              <div className="scrollbar-thin max-h-[28rem] overflow-auto border-t border-line bg-sunken">
                <table className="w-full border-collapse font-mono text-2xs leading-relaxed">
                  <tbody>
                    {file.lines.map((line, index) => (
                      <tr
                        key={index}
                        className={cn(
                          line.type === 'add' && 'bg-verdigris/10',
                          line.type === 'del' && 'bg-rust/10',
                          line.type === 'hunk' && 'bg-raised',
                        )}
                      >
                        <td
                          className={cn(
                            'w-6 select-none border-r border-line px-1 text-center align-top',
                            line.type === 'add' && 'text-verdigris',
                            line.type === 'del' && 'text-rust',
                            line.type !== 'add' && line.type !== 'del' && 'text-faint/40',
                          )}
                        >
                          {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ''}
                        </td>
                        <td
                          className={cn(
                            'whitespace-pre-wrap break-all px-3 py-px',
                            line.type === 'add' && 'text-verdigris',
                            line.type === 'del' && 'text-rust',
                            line.type === 'hunk' && 'text-blueprint',
                            line.type === 'meta' && 'text-faint',
                            line.type === 'context' && 'text-muted',
                          )}
                        >
                          {line.text}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
        </div>
      )}
    </Card>
  );
}
