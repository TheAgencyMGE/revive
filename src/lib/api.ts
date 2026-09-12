import { NextResponse } from 'next/server';

/**
 * Shared API response helpers.
 *
 * Errors always carry a stable machine-readable `code` alongside a message
 * written for a human, so the UI can render something useful for every failure
 * instead of a generic toast.
 */

export interface ApiError {
  error: string;
  code: string;
  details?: unknown;
}

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, {
    ...init,
    headers: { 'cache-control': 'no-store', ...(init?.headers ?? {}) },
  });
}

export function fail(
  message: string,
  code: string,
  status = 400,
  details?: unknown,
): NextResponse {
  const body: ApiError = { error: message, code };
  if (details !== undefined) body.details = details;
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export function notFound(what = 'Resource'): NextResponse {
  return fail(`${what} not found.`, 'NOT_FOUND', 404);
}

/**
 * Wrap a route handler so an unexpected throw becomes a clean 500 rather than
 * leaking a stack trace to the client.
 */
export function withErrorHandling<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (err) {
      console.error('[revive] unhandled API error:', err);
      return fail(
        'Something went wrong handling that request.',
        'INTERNAL_ERROR',
        500,
      );
    }
  };
}
