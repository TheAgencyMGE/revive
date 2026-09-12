import { EventEmitter } from 'node:events';
import type { JobEvent } from '@/engine/types';

/**
 * In-process event bus for live log streaming.
 *
 * SSE handlers subscribe per job. Because the worker runs inside the same Node
 * process as the API, no broker is needed — this is the deliberate trade that
 * keeps Revive dependency-free. The interface is narrow enough that swapping in
 * Redis pub/sub later would touch only this file.
 */

class JobBus {
  private readonly emitter = new EventEmitter();
  /** Recent events per job, so a late subscriber can catch up. */
  private readonly replay = new Map<string, JobEvent[]>();
  private static readonly REPLAY_LIMIT = 500;

  constructor() {
    // Many concurrent SSE clients on one job is normal; the default limit of 10
    // would print spurious leak warnings.
    this.emitter.setMaxListeners(200);
  }

  publish(jobId: string, event: JobEvent): void {
    const buffer = this.replay.get(jobId) ?? [];
    buffer.push(event);
    if (buffer.length > JobBus.REPLAY_LIMIT) {
      buffer.splice(0, buffer.length - JobBus.REPLAY_LIMIT);
    }
    this.replay.set(jobId, buffer);
    this.emitter.emit(jobId, event);
  }

  subscribe(jobId: string, listener: (event: JobEvent) => void): () => void {
    this.emitter.on(jobId, listener);
    return () => this.emitter.off(jobId, listener);
  }

  /** Events already emitted for this job, for immediate replay on connect. */
  history(jobId: string): JobEvent[] {
    return this.replay.get(jobId) ?? [];
  }

  clear(jobId: string): void {
    this.replay.delete(jobId);
    this.emitter.removeAllListeners(jobId);
  }
}

const globalForBus = globalThis as unknown as { reviveBus?: JobBus };

export const bus = globalForBus.reviveBus ?? new JobBus();
if (process.env.NODE_ENV !== 'production') globalForBus.reviveBus = bus;
