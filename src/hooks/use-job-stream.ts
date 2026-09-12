'use client';

import * as React from 'react';
import type { JobEvent, JobView, LogEvent } from '@/engine/types';
import { fetchJson } from '@/lib/utils';

/**
 * Live job state over Server-Sent Events.
 *
 * The stream replays history on connect, so this hook does not need to
 * reconcile a separate initial fetch with the live feed. If the connection
 * drops it falls back to polling rather than leaving the page frozen — a
 * revival can take minutes and a silent stall would be indistinguishable from
 * a hung build.
 */

export interface JobStreamState {
  job: JobView | null;
  logs: LogEvent[];
  connected: boolean;
  finished: boolean;
  error: string | null;
}

const TERMINAL = new Set(['succeeded', 'partial', 'failed', 'cancelled']);
const MAX_LOGS = 4000;

export function useJobStream(jobId: string, initialJob: JobView | null) {
  const [job, setJob] = React.useState<JobView | null>(initialJob);
  const [logs, setLogs] = React.useState<LogEvent[]>([]);
  const [connected, setConnected] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const seenSeq = React.useRef<Set<number>>(new Set());
  const finished = job ? TERMINAL.has(job.status) : false;

  // Pull the authoritative record whenever the run reaches a terminal state or
  // a phase boundary: the SSE payloads are deltas, the API returns the truth.
  const refresh = React.useCallback(async () => {
    try {
      const data = await fetchJson<{ job: JobView }>(`/api/jobs/${jobId}?logs=false`);
      setJob(data.job);
    } catch {
      // A failed refresh is not fatal — the stream may still be healthy.
    }
  }, [jobId]);

  React.useEffect(() => {
    if (initialJob && TERMINAL.has(initialJob.status)) {
      // Completed run: load logs once, no stream needed.
      fetchJson<{ job: JobView; logs: LogEvent[] }>(`/api/jobs/${jobId}`)
        .then((data) => {
          setJob(data.job);
          setLogs(data.logs);
        })
        .catch(() => setError('Could not load this run.'));
      return;
    }

    let source: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let closed = false;

    const startPolling = () => {
      if (pollTimer || closed) return;
      pollTimer = setInterval(async () => {
        try {
          const data = await fetchJson<{ job: JobView; logs: LogEvent[] }>(
            `/api/jobs/${jobId}`,
          );
          setJob(data.job);
          setLogs(data.logs);
          if (TERMINAL.has(data.job.status) && pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
          }
        } catch {
          /* keep polling */
        }
      }, 2500);
    };

    try {
      source = new EventSource(`/api/jobs/${jobId}/events`);
    } catch {
      startPolling();
      return () => {
        closed = true;
        if (pollTimer) clearInterval(pollTimer);
      };
    }

    source.onopen = () => {
      setConnected(true);
      setError(null);
    };

    source.onmessage = (message) => {
      let event: JobEvent;
      try {
        event = JSON.parse(message.data) as JobEvent;
      } catch {
        return;
      }

      switch (event.type) {
        case 'log': {
          const line = event.data;
          if (seenSeq.current.has(line.seq)) return;
          seenSeq.current.add(line.seq);
          setLogs((current) => {
            const next = [...current, line];
            // Bound memory on very chatty installs.
            return next.length > MAX_LOGS ? next.slice(next.length - MAX_LOGS) : next;
          });
          break;
        }
        case 'phase':
          setJob((current) =>
            current
              ? {
                  ...current,
                  phase: event.data.phase,
                  phaseIdx: event.data.phaseIdx,
                  attempt: event.data.attempt,
                }
              : current,
          );
          break;
        case 'status':
          setJob((current) => (current ? { ...current, status: event.data.status } : current));
          break;
        case 'state':
          setJob((current) =>
            current ? ({ ...current, ...event.data } as JobView) : current,
          );
          break;
        case 'done':
          setJob((current) => (current ? { ...current, status: event.data.status } : current));
          void refresh();
          source?.close();
          setConnected(false);
          break;
      }
    };

    source.onerror = () => {
      setConnected(false);
      // EventSource retries on its own, but if the endpoint is genuinely gone
      // polling keeps the page live instead of stalling silently.
      startPolling();
    };

    return () => {
      closed = true;
      source?.close();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [jobId, initialJob, refresh]);

  return { job, logs, connected, finished, error, refresh } as const;
}
