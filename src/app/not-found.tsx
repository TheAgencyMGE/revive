import Link from 'next/link';
import { Button } from '@/components/ui/primitives';

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-start px-6 py-24">
      <p className="label mb-3">404</p>
      <h1 className="mb-3 font-mono text-2xl font-semibold tracking-display text-ink">
        Nothing was excavated here
      </h1>
      <p className="mb-8 text-sm leading-relaxed text-muted">
        That run does not exist, or it was deleted from history.
      </p>
      <div className="flex gap-2">
        <Button asChild>
          <Link href="/">Start a revival</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/jobs">Browse history</Link>
        </Button>
      </div>
    </div>
  );
}
