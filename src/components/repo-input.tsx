'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/primitives';
import { fetchJson } from '@/lib/utils';
import { readAiSettings } from '@/components/settings-dialog';
import { isValidRepoUrl } from '@/lib/validation';

/**
 * The primary entry point: a GitHub URL goes in, a revival comes out.
 *
 * Validation runs client-side for immediate feedback and again on the server,
 * which is the boundary that actually matters.
 */
export function RepoInput({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter();
  const [value, setValue] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const touched = value.trim().length > 0;
  const looksValid = touched && isValidRepoUrl(value);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;

    const trimmed = value.trim();
    if (!trimmed) {
      setError('Paste a public GitHub repository URL to begin.');
      return;
    }
    if (!isValidRepoUrl(trimmed)) {
      setError('That needs to be a public GitHub repository, like github.com/owner/repo.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const ai = readAiSettings();
      const result = await fetchJson<{ id: string }>('/api/jobs', {
        method: 'POST',
        body: JSON.stringify({ repoUrl: trimmed, ai: ai ?? undefined }),
      });
      router.push(`/jobs/${result.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the revival.');
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="w-full">
      <div
        className={`flex flex-col gap-2 rounded-lg border bg-surface p-2 transition-colors sm:flex-row sm:items-center ${
          error ? 'border-rust/50' : looksValid ? 'border-brass/40' : 'border-line'
        }`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3 px-3">
          <span className="hidden shrink-0 font-mono text-2xs uppercase tracking-label text-faint sm:inline">
            github.com/
          </span>
          <input
            type="text"
            value={value}
            autoFocus={autoFocus}
            spellCheck={false}
            autoComplete="off"
            aria-label="Public GitHub repository URL"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'repo-error' : undefined}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError(null);
            }}
            placeholder="owner/repository"
            className="h-11 w-full min-w-0 bg-transparent font-mono text-sm text-ink placeholder:text-faint focus:outline-none"
          />
        </div>
        <Button type="submit" size="lg" disabled={submitting} className="shrink-0">
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Starting
            </>
          ) : (
            <>
              Revive it
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </Button>
      </div>

      {error ? (
        <p id="repo-error" role="alert" className="mt-2.5 text-xs text-rust">
          {error}
        </p>
      ) : (
        <p className="mt-2.5 text-xs text-faint">
          Public repositories only. Nothing is cloned until you press the button, and the code
          runs in a disposable sandbox.
        </p>
      )}
    </form>
  );
}
