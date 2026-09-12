'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/primitives';

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-start px-6 py-24">
      <p className="label mb-3 text-rust">Error</p>
      <h1 className="mb-3 font-mono text-2xl font-semibold tracking-display text-ink">
        This page failed to load
      </h1>
      <p className="mb-8 text-sm leading-relaxed text-muted">
        The server hit an unexpected error. Running revivals are unaffected — they continue in
        the background and can be reopened from history.
      </p>
      <div className="flex gap-2">
        <Button onClick={reset}>Try again</Button>
        <Button asChild variant="outline">
          <Link href="/jobs">Open history</Link>
        </Button>
      </div>
    </div>
  );
}
