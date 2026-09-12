import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

/** "3 minutes ago" — used in job history. */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const delta = Date.now() - then;

  if (delta < 60_000) return 'just now';
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

/** How long ago a repository was last touched, in human terms. */
export function describeAge(years: number | null | undefined): string {
  if (years === null || years === undefined) return 'unknown age';
  if (years < 1) return 'under a year old';
  if (years < 2) return '1 year dormant';
  return `${Math.round(years)} years dormant`;
}

export const STATUS_STYLES: Record<
  string,
  { label: string; dot: string; text: string; border: string; bg: string }
> = {
  queued: {
    label: 'Queued',
    dot: 'bg-faint',
    text: 'text-muted',
    border: 'border-line',
    bg: 'bg-raised',
  },
  running: {
    label: 'Running',
    dot: 'bg-blueprint animate-pulse-soft',
    text: 'text-blueprint',
    border: 'border-blueprint/40',
    bg: 'bg-blueprint/10',
  },
  succeeded: {
    label: 'Revived',
    dot: 'bg-verdigris',
    text: 'text-verdigris',
    border: 'border-verdigris/40',
    bg: 'bg-verdigris/10',
  },
  partial: {
    label: 'Partially revived',
    dot: 'bg-brass',
    text: 'text-brass',
    border: 'border-brass/40',
    bg: 'bg-brass/10',
  },
  failed: {
    label: 'Not revived',
    dot: 'bg-rust',
    text: 'text-rust',
    border: 'border-rust/40',
    bg: 'bg-rust/10',
  },
  cancelled: {
    label: 'Cancelled',
    dot: 'bg-faint',
    text: 'text-muted',
    border: 'border-line',
    bg: 'bg-raised',
  },
};

export const LANGUAGE_LABELS: Record<string, string> = {
  node: 'JavaScript',
  python: 'Python',
  java: 'Java',
  go: 'Go',
  rust: 'Rust',
  unknown: 'Unknown',
};

/** Fetch JSON, turning a non-2xx into a thrown Error carrying the API message. */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });

  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }

  if (!response.ok) {
    const message =
      (body as { error?: string }).error ?? `Request failed with status ${response.status}`;
    const error = new Error(message) as Error & { code?: string; status?: number };
    error.code = (body as { code?: string }).code;
    error.status = response.status;
    throw error;
  }

  return body as T;
}
