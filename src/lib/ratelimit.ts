import { config } from '@/engine/config';

/**
 * In-memory sliding-window rate limiter.
 *
 * Sized for a single-instance local deployment, which is what Revive targets.
 * The interface is intentionally the same shape a Redis-backed limiter would
 * expose, so swapping one in later touches only this file.
 */

interface Bucket {
  timestamps: number[];
}

const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
}

export function rateLimit(
  key: string,
  limit = config.rateLimitMax,
  windowMs = config.rateLimitWindowMs,
): RateLimitResult {
  const now = Date.now();

  // Periodically drop empty buckets so a long-running process cannot grow
  // unbounded from one-off client addresses.
  if (now - lastSweep > windowMs * 5) {
    for (const [bucketKey, bucket] of buckets) {
      if (!bucket.timestamps.some((t) => now - t < windowMs)) buckets.delete(bucketKey);
    }
    lastSweep = now;
  }

  const bucket = buckets.get(key) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);

  if (bucket.timestamps.length >= limit) {
    buckets.set(key, bucket);
    const oldest = bucket.timestamps[0];
    return { allowed: false, remaining: 0, resetMs: Math.max(0, windowMs - (now - oldest)) };
  }

  bucket.timestamps.push(now);
  buckets.set(key, bucket);
  return {
    allowed: true,
    remaining: limit - bucket.timestamps.length,
    resetMs: windowMs,
  };
}

/**
 * Identify the caller. Behind a proxy the first x-forwarded-for hop is used;
 * otherwise everything collapses to one bucket, which is correct for a local
 * single-user deployment.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim().slice(0, 64);
  const real = request.headers.get('x-real-ip');
  if (real) return real.slice(0, 64);
  return 'local';
}

export function resetRateLimits(): void {
  buckets.clear();
}
