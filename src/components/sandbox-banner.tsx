'use client';

import * as React from 'react';
import { Shield, ShieldAlert, ShieldOff } from 'lucide-react';
import { fetchJson } from '@/lib/utils';

interface Health {
  sandbox: { mode: string; canExecute: boolean; detail: string; reason: string };
  toolchains: Record<string, { available: boolean; version: string | null }>;
}

/**
 * Tells the user up front what this machine can actually execute.
 *
 * Discovering mid-run that Rust is not installed, or that Docker is missing and
 * isolation is weaker than they assumed, is a worse experience than being told
 * before they start.
 */
export function SandboxBanner() {
  const [health, setHealth] = React.useState<Health | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetchJson<Health>('/api/health')
      .then((data) => {
        if (!cancelled) setHealth(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!health) return null;

  const { sandbox, toolchains } = health;

  const icon =
    sandbox.mode === 'docker' ? (
      <Shield className="h-3.5 w-3.5 text-verdigris" />
    ) : sandbox.mode === 'restricted' ? (
      <ShieldAlert className="h-3.5 w-3.5 text-brass" />
    ) : (
      <ShieldOff className="h-3.5 w-3.5 text-rust" />
    );

  const headline =
    sandbox.mode === 'docker'
      ? 'Hardened container isolation'
      : sandbox.mode === 'restricted'
        ? 'Restricted local execution'
        : 'Analysis only — nothing is executed';

  const available = Object.entries(toolchains)
    .filter(([, value]) => value.available)
    .map(([name, value]) => `${name}${value.version ? ` ${value.version}` : ''}`);

  return (
    <div className="rounded-md border border-line bg-surface/70 px-4 py-3">
      <div className="mb-1.5 flex items-center gap-2">
        {icon}
        <span className="font-mono text-2xs uppercase tracking-label text-ink">{headline}</span>
      </div>
      <p className="text-xs leading-relaxed text-muted">{sandbox.detail}</p>
      {available.length ? (
        <p className="mt-2 font-mono text-2xs text-faint">
          Toolchains here: {available.join(' · ')}
        </p>
      ) : null}
    </div>
  );
}
