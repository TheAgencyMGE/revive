'use client';

import * as React from 'react';
import { Check, X, Loader2, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PHASES, PHASE_LABELS, type Phase } from '@/engine/types';

/**
 * The stratigraphy column.
 *
 * Phases are drawn as stacked layers rather than a progress bar because that is
 * what the pipeline actually is: each stage is deposited on the one beneath it,
 * and you cannot reach a later layer without passing through the earlier ones.
 * The active layer fills; completed layers hold their colour.
 */

const PHASE_BLURBS: Record<string, string> = {
  analyze: 'Clone, inventory, detect the build system',
  reconstruct: 'Date the specimen from its own evidence',
  baseline: 'Run it untouched to see what really breaks',
  diagnose: 'Match the failure to known ecosystem history',
  repair: 'Apply the smallest change that could work',
  verify: 'Re-run everything; roll back if it did not help',
  complete: 'Diff, report, package',
};

export function Pipeline({
  phase,
  status,
  attempt,
}: {
  phase: Phase;
  status: string;
  attempt: number;
}) {
  const currentIndex = PHASES.indexOf(phase as (typeof PHASES)[number]);
  const failed = status === 'failed';
  const cancelled = status === 'cancelled';
  const done = ['succeeded', 'partial'].includes(status);

  return (
    <ol className="space-y-px" aria-label="Revival pipeline">
      {PHASES.map((item, index) => {
        // A terminal job has passed through every phase it reached.
        const isComplete = done ? true : currentIndex > index;
        const isActive = !done && !failed && !cancelled && currentIndex === index;
        const isStalled = (failed || cancelled) && currentIndex === index;
        const isPending = !isComplete && !isActive && !isStalled;

        return (
          <li
            key={item}
            aria-current={isActive ? 'step' : undefined}
            className={cn(
              'relative flex items-start gap-3 rounded-sm border-l-2 py-2.5 pl-3 pr-3 transition-colors',
              isComplete && 'border-l-verdigris bg-verdigris/5',
              isActive && 'border-l-blueprint bg-blueprint/10',
              isStalled && 'border-l-rust bg-rust/10',
              isPending && 'border-l-line',
            )}
          >
            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
              {isComplete ? (
                <Check className="h-3.5 w-3.5 text-verdigris" aria-hidden />
              ) : isActive ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-blueprint" aria-hidden />
              ) : isStalled ? (
                <X className="h-3.5 w-3.5 text-rust" aria-hidden />
              ) : (
                <Minus className="h-3 w-3 text-faint" aria-hidden />
              )}
            </span>

            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span
                  className={cn(
                    'font-mono text-2xs uppercase tracking-label',
                    isComplete && 'text-verdigris',
                    isActive && 'text-blueprint',
                    isStalled && 'text-rust',
                    isPending && 'text-faint',
                  )}
                >
                  {PHASE_LABELS[item]}
                </span>
                {isActive && attempt > 0 && (item === 'repair' || item === 'verify') ? (
                  <span className="shrink-0 font-mono text-2xs text-brass">
                    attempt {attempt}
                  </span>
                ) : null}
              </span>
              <span
                className={cn(
                  'mt-0.5 block text-2xs leading-relaxed',
                  isPending ? 'text-faint/70' : 'text-muted',
                )}
              >
                {PHASE_BLURBS[item]}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
