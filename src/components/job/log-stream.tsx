'use client';

import * as React from 'react';
import { ArrowDownToLine, Filter } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/primitives';
import type { LogEvent } from '@/engine/types';

/**
 * Live build output.
 *
 * Auto-scroll follows the tail until the user scrolls up, then stops and offers
 * to resume — scrolling away from the tail is a deliberate act, and yanking the
 * viewport back while someone is reading an error is the single most irritating
 * thing a log viewer can do.
 */

const LEVEL_STYLES: Record<string, string> = {
  debug: 'text-faint',
  info: 'text-muted',
  warn: 'text-brass',
  error: 'text-rust',
  success: 'text-verdigris',
  command: 'text-blueprint',
};

export function LogStream({ logs, running }: { logs: LogEvent[]; running: boolean }) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [following, setFollowing] = React.useState(true);
  const [hideDebug, setHideDebug] = React.useState(false);

  const visible = React.useMemo(
    () => (hideDebug ? logs.filter((l) => l.level !== 'debug') : logs),
    [logs, hideDebug],
  );

  React.useEffect(() => {
    if (!following) return;
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visible, following]);

  const onScroll = React.useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setFollowing(atBottom);
  }, []);

  const jumpToEnd = () => {
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setFollowing(true);
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="label">Output</span>
          <span className="font-mono text-2xs text-faint">
            {visible.length.toLocaleString()} line{visible.length === 1 ? '' : 's'}
          </span>
          {running ? (
            <span className="ml-1 inline-flex items-center gap-1.5 font-mono text-2xs text-blueprint">
              <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-blueprint" />
              live
            </span>
          ) : null}
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => setHideDebug((v) => !v)}
          aria-pressed={hideDebug}
          title={hideDebug ? 'Show raw build output' : 'Hide raw build output'}
        >
          <Filter className="h-3.5 w-3.5" />
          {hideDebug ? 'Milestones' : 'Everything'}
        </Button>
      </div>

      <div
        ref={containerRef}
        onScroll={onScroll}
        role="log"
        aria-live="polite"
        aria-label="Build output"
        className="scrollbar-thin min-h-0 flex-1 overflow-y-auto bg-sunken px-4 py-3 font-mono text-2xs leading-[1.7]"
      >
        {visible.length === 0 ? (
          <p className="py-8 text-center text-faint">
            {running ? 'Waiting for the first output…' : 'No output was recorded.'}
          </p>
        ) : (
          visible.map((line) => (
            <div key={`${line.seq}-${line.ts}`} className="flex gap-3">
              <span className="w-14 shrink-0 select-none text-right text-faint/50">
                {line.ts.slice(11, 19)}
              </span>
              <span
                className={cn(
                  'min-w-0 flex-1 whitespace-pre-wrap break-words',
                  LEVEL_STYLES[line.level] ?? 'text-muted',
                  line.level === 'command' && 'font-semibold',
                )}
              >
                {line.message}
              </span>
            </div>
          ))
        )}
      </div>

      {!following && visible.length > 0 ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
          <Button
            variant="subtle"
            size="sm"
            onClick={jumpToEnd}
            className="pointer-events-auto shadow-lg"
          >
            <ArrowDownToLine className="h-3.5 w-3.5" />
            Follow output
          </Button>
        </div>
      ) : null}
    </div>
  );
}
