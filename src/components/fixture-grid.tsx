'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Play, WifiOff, Wifi } from 'lucide-react';
import { Badge, Button, Skeleton, Alert } from '@/components/ui/primitives';
import { fetchJson, LANGUAGE_LABELS } from '@/lib/utils';
import { readAiSettings } from '@/components/settings-dialog';

interface Fixture {
  id: string;
  name: string;
  title: string;
  language: string;
  blurb: string;
  expectedFailure: string;
  expectedRepair: string;
  requiresNetwork: boolean;
  lastCommit: string;
  built: boolean;
}

/**
 * The demo shelf.
 *
 * These are real git repositories built from fixtures/, and they run through
 * exactly the same pipeline as a GitHub URL — no scripted path, no mocked
 * result. The offline ones need no registry access, so the demo works even if
 * the network does not.
 */
export function FixtureGrid() {
  const router = useRouter();
  const [fixtures, setFixtures] = React.useState<Fixture[] | null>(null);
  const [starting, setStarting] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetchJson<{ fixtures: Fixture[] }>('/api/fixtures')
      .then((data) => {
        if (!cancelled) setFixtures(data.fixtures);
      })
      .catch(() => {
        if (!cancelled) setFixtures([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const run = async (id: string) => {
    if (starting) return;
    setStarting(id);
    setError(null);
    try {
      const ai = readAiSettings();
      const result = await fetchJson<{ id: string }>('/api/jobs', {
        method: 'POST',
        body: JSON.stringify({ fixtureId: id, ai: ai ?? undefined }),
      });
      router.push(`/jobs/${result.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start that demo.');
      setStarting(null);
    }
  };

  if (fixtures === null) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-44" />
        ))}
      </div>
    );
  }

  if (!fixtures.length) {
    return (
      <Alert tone="brass" title="Demos not built">
        Run <code className="font-mono">npm run fixtures:build</code> to create the demo
        repositories.
      </Alert>
    );
  }

  const year = (iso: string) => new Date(iso).getFullYear();

  return (
    <div className="space-y-4">
      {error ? (
        <Alert tone="rust" title="Could not start">
          {error}
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {fixtures.map((fixture) => (
          <article
            key={fixture.id}
            className="group flex flex-col rounded-md border border-line bg-surface transition-colors hover:border-faint"
          >
            {/* Specimen tag */}
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
              <span className="font-mono text-2xs uppercase tracking-label text-brass">
                {LANGUAGE_LABELS[fixture.language] ?? fixture.language}
              </span>
              <span
                className="font-mono text-2xs text-faint"
                title={`Last commit ${fixture.lastCommit.slice(0, 10)}`}
              >
                {year(fixture.lastCommit)}
              </span>
            </div>

            <div className="flex flex-1 flex-col gap-3 p-4">
              <div>
                <h3 className="mb-1 font-mono text-xs text-ink">{fixture.name}</h3>
                <p className="text-xs font-medium leading-snug text-ink">{fixture.title}</p>
              </div>

              <p className="flex-1 text-xs leading-relaxed text-muted">{fixture.blurb}</p>

              <dl className="space-y-1.5 border-t border-line pt-3">
                <div className="flex gap-2">
                  <dt className="label shrink-0 pt-0.5 text-rust/80">Fails</dt>
                  <dd className="truncate font-mono text-2xs text-muted" title={fixture.expectedFailure}>
                    {fixture.expectedFailure}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="label shrink-0 pt-0.5 text-verdigris/80">Fix</dt>
                  <dd className="truncate text-2xs text-muted" title={fixture.expectedRepair}>
                    {fixture.expectedRepair}
                  </dd>
                </div>
              </dl>

              <div className="flex items-center justify-between gap-2 pt-1">
                {fixture.requiresNetwork ? (
                  <span className="inline-flex items-center gap-1.5 font-mono text-2xs uppercase tracking-label text-faint">
                    <Wifi className="h-3 w-3" /> Needs registry
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 font-mono text-2xs uppercase tracking-label text-verdigris/70">
                    <WifiOff className="h-3 w-3" /> Works offline
                  </span>
                )}

                <Button
                  size="sm"
                  variant="outline"
                  disabled={!fixture.built || starting !== null}
                  onClick={() => run(fixture.id)}
                  aria-label={`Revive the ${fixture.name} demo`}
                >
                  {starting === fixture.id ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Starting
                    </>
                  ) : (
                    <>
                      <Play className="h-3 w-3" /> Run
                    </>
                  )}
                </Button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
