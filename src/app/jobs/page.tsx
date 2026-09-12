import type { Metadata } from 'next';
import { JobHistory } from '@/components/job-history';

export const metadata: Metadata = { title: 'History' };
export const dynamic = 'force-dynamic';

export default function HistoryPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <div className="mb-8">
        <p className="label mb-2">Archive</p>
        <h1 className="font-mono text-2xl font-semibold tracking-display text-ink">
          Every revival, kept
        </h1>
        <p className="mt-2 max-w-xl text-xs leading-relaxed text-muted">
          Runs are stored with their logs, diagnosis, diff and downloads, so you can come back to
          any of them. Retrying creates a new run and leaves the original untouched.
        </p>
      </div>
      <JobHistory />
    </div>
  );
}
