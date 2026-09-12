'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';
import { Moon, Sun, Cog } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/primitives';
import { SettingsDialog } from '@/components/settings-dialog';

/** The mark: a stratigraphy column, echoing the pipeline on the run screen. */
function ReviveMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden fill="none">
      <rect x="1" y="1.5" width="14" height="2.6" rx="0.6" className="fill-rust/70" />
      <rect x="1" y="5.2" width="14" height="2.6" rx="0.6" className="fill-brass/80" />
      <rect x="1" y="8.9" width="14" height="2.6" rx="0.6" className="fill-verdigris" />
      <rect x="1" y="12.6" width="14" height="2" rx="0.6" className="fill-line" />
    </svg>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const [isLight, setIsLight] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);

  React.useEffect(() => {
    setIsLight(document.documentElement.classList.contains('light'));
  }, []);

  const toggleTheme = React.useCallback(() => {
    const next = !document.documentElement.classList.contains('light');
    document.documentElement.classList.toggle('light', next);
    try {
      localStorage.setItem('revive-theme', next ? 'light' : 'dark');
    } catch {
      // Private browsing — the theme simply will not persist.
    }
    setIsLight(next);
  }, []);

  const links = [
    { href: '/', label: 'Revive' },
    { href: '/jobs', label: 'History' },
  ];

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-line bg-ground/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5" aria-label="Revive home">
            <ReviveMark className="h-4 w-4" />
            <span className="font-mono text-sm font-semibold tracking-display text-ink">
              revive
            </span>
          </Link>

          <nav className="flex items-center gap-1" aria-label="Main">
            {links.map((link) => {
              const active =
                link.href === '/' ? pathname === '/' : pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'rounded px-2.5 py-1.5 font-mono text-2xs uppercase tracking-label transition-colors',
                    active ? 'bg-raised text-ink' : 'text-faint hover:text-muted',
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSettingsOpen(true)}
              aria-label="Settings"
              title="Optional AI provider"
            >
              <Cog className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              aria-label={isLight ? 'Switch to dark theme' : 'Switch to light theme'}
            >
              {isLight ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </header>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}
