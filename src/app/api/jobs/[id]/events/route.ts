import type { NextRequest } from 'next/server';
import { bus } from '@/server/bus';
import { parseJobId } from '@/lib/validation';
import { getJobLogs, getJobView } from '@/server/store';
import type { JobEvent } from '@/engine/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/jobs/:id/events — Server-Sent Events stream of live progress.
 *
 * SSE rather than WebSockets: the traffic is one-directional, it survives
 * proxies that do not upgrade connections, and it reconnects automatically in
 * every browser. On connect the stream replays current state plus any logs
 * already written, so a page opened mid-run is never missing history.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  let jobId: string;
  try {
    jobId = parseJobId(id);
  } catch {
    return new Response('Invalid job id', { status: 400 });
  }

  const job = await getJobView(jobId);
  if (!job) return new Response('Job not found', { status: 404 });

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: JobEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };

      // Replay persisted state so a late subscriber sees the whole run.
      send({ type: 'status', data: { status: job.status } });
      send({
        type: 'phase',
        data: { phase: job.phase, phaseIdx: job.phaseIdx, attempt: job.attempt },
      });

      const history = await getJobLogs(jobId, -1);
      for (const line of history) {
        send({
          type: 'log',
          data: {
            jobId,
            seq: line.seq,
            ts: line.ts.toISOString(),
            phase: line.phase,
            level: line.level as never,
            message: line.message,
          },
        });
      }

      // Anything the worker emitted between the DB read and subscribing.
      const seen = new Set(history.map((l) => l.seq));
      for (const event of bus.history(jobId)) {
        if (event.type === 'log' && seen.has(event.data.seq)) continue;
        send(event);
      }

      // A terminal job needs no live subscription.
      if (['succeeded', 'partial', 'failed', 'cancelled'].includes(job.status)) {
        send({ type: 'done', data: { status: job.status } });
        closed = true;
        controller.close();
        return;
      }

      const unsubscribe = bus.subscribe(jobId, (event) => {
        send(event);
        if (event.type === 'done') {
          cleanup();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      });

      // Proxies and load balancers drop idle connections; a comment frame every
      // 20s keeps the stream alive without polluting the event log.
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          cleanup();
        }
      }, 20_000);

      function cleanup() {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
      }

      request.signal.addEventListener('abort', () => {
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Disable proxy buffering so events arrive as they happen.
      'x-accel-buffering': 'no',
    },
  });
}
