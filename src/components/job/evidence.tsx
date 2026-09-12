'use client';

import * as React from 'react';
import { ArrowRight, HelpCircle } from 'lucide-react';
import { Card, CardHeader, Meter, Badge } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import type { EnvironmentSpec } from '@/engine/types';

/**
 * The evidence ledger.
 *
 * This is the part of Revive that nothing else does: rather than asserting a
 * runtime version, it shows every signal it found, how much each one counted,
 * and what that signal means. A user who disagrees with the conclusion can see
 * exactly which piece of evidence to argue with.
 */
export function EvidenceLedger({
  original,
  final,
}: {
  original: EnvironmentSpec | null;
  final: EnvironmentSpec | null;
}) {
  if (!original) {
    return (
      <Card>
        <CardHeader eyebrow="Archaeology" title="Original environment" />
        <div className="px-5 py-6 text-xs text-muted">
          Not determined yet.
        </div>
      </Card>
    );
  }

  const wanted = original.runtimeVersion;
  const used = final?.actualVersion ?? null;
  const matched =
    wanted && used ? wanted.split('.')[0] === used.split('.')[0] : false;

  return (
    <Card>
      <CardHeader
        eyebrow="Archaeology"
        title="What this project was built for"
        action={
          <Badge tone={original.confidence >= 70 ? 'verdigris' : 'brass'}>
            {original.confidence}% confident
          </Badge>
        }
      />

      {/* Original -> final runtime */}
      <div className="flex flex-wrap items-center gap-4 border-b border-line px-5 py-4">
        <div>
          <div className="label mb-1">Originally</div>
          <div className="font-mono text-lg font-semibold tracking-display text-brass">
            {original.runtime ?? 'unknown'} {wanted ?? '?'}
          </div>
        </div>

        <ArrowRight className="h-4 w-4 shrink-0 text-faint" aria-hidden />

        <div>
          <div className="label mb-1">Ran on</div>
          <div
            className={cn(
              'font-mono text-lg font-semibold tracking-display',
              used ? (matched ? 'text-verdigris' : 'text-rust') : 'text-faint',
            )}
          >
            {used ? `${final?.runtime ?? ''} ${used}` : 'not executed'}
          </div>
        </div>

        {used && !matched ? (
          <p className="w-full text-2xs leading-relaxed text-brass">
            The original runtime was not available on this machine. Version-specific failures
            below may be caused by that gap rather than by the code.
          </p>
        ) : null}
      </div>

      {/* The ledger itself */}
      <div className="px-5 py-4">
        <div className="mb-3 flex items-center gap-1.5">
          <span className="label">Evidence</span>
          <HelpCircle className="h-3 w-3 text-faint" aria-hidden />
          <span className="text-2xs text-faint">
            heavier signals outrank lighter ones
          </span>
        </div>

        {original.evidence.length === 0 ? (
          <p className="text-xs text-muted">
            The repository declared nothing about its runtime, so no direct evidence was
            available.
          </p>
        ) : (
          <ul className="space-y-3.5">
            {original.evidence.map((item, index) => (
              <li key={`${item.source}-${index}`}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <code className="truncate font-mono text-xs text-ink">{item.source}</code>
                  <code className="shrink-0 font-mono text-xs text-brass">{item.value}</code>
                </div>
                <Meter
                  value={item.weight}
                  tone={item.weight >= 80 ? 'brass' : 'muted'}
                  label={`${item.source} weight ${item.weight}`}
                />
                {item.note ? (
                  <p className="mt-1.5 text-2xs leading-relaxed text-muted">{item.note}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
