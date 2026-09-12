'use client';

import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, ShieldCheck, Trash2 } from 'lucide-react';
import { Button, Alert, Badge } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

/**
 * Optional AI provider settings.
 *
 * The key lives in this browser's sessionStorage and nowhere else: it is not
 * written to the database, not written to disk, not logged, and never placed in
 * the environment of a sandboxed build. It is sent with a revival request only
 * when one is present, used for the duration of that run, and discarded.
 * Closing the tab clears it.
 */

const STORAGE_KEY = 'revive-ai-provider';

export interface AiSettings {
  provider: 'anthropic' | 'openai';
  apiKey: string;
}

export function readAiSettings(): AiSettings | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AiSettings;
    if (!parsed.apiKey || !parsed.provider) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearAiSettings(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [provider, setProvider] = React.useState<'anthropic' | 'openai'>('anthropic');
  const [apiKey, setApiKey] = React.useState('');
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const existing = readAiSettings();
    if (existing) {
      setProvider(existing.provider);
      setApiKey(existing.apiKey);
      setSaved(true);
    } else {
      setSaved(false);
    }
    setError(null);
  }, [open]);

  const save = () => {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      setError('Enter a key, or remove the existing one.');
      return;
    }
    const validPrefix = provider === 'anthropic' ? 'sk-ant-' : 'sk-';
    if (!trimmed.startsWith(validPrefix)) {
      setError(`${provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} keys start with "${validPrefix}".`);
      return;
    }
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ provider, apiKey: trimmed }));
      setSaved(true);
      setError(null);
    } catch {
      setError('This browser blocked session storage, so the key cannot be saved.');
    }
  };

  const remove = () => {
    clearAiSettings();
    setApiKey('');
    setSaved(false);
    setError(null);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-sunken/80 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-surface shadow-2xl focus:outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <div className="flex items-start justify-between border-b border-line px-5 py-4">
            <div>
              <div className="label mb-1.5">Optional</div>
              <Dialog.Title className="text-sm font-semibold text-ink">
                AI-assisted diagnosis
              </Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </Dialog.Close>
          </div>

          <div className="space-y-4 px-5 py-5">
            <Dialog.Description className="text-xs leading-relaxed text-muted">
              Revive does not need this. Every diagnosis and repair you have seen runs from
              package metadata, build output and compatibility rules. Adding a key only helps
              when a build fails in a way no rule recognises — then the raw error is sent to your
              provider for interpretation.
            </Dialog.Description>

            <div>
              <div className="label mb-2">Provider</div>
              <div className="grid grid-cols-2 gap-2">
                {(['anthropic', 'openai'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setProvider(option)}
                    className={cn(
                      'rounded border px-3 py-2 font-mono text-2xs uppercase tracking-label transition-colors',
                      provider === option
                        ? 'border-brass/50 bg-brass/10 text-brass'
                        : 'border-line bg-raised text-muted hover:text-ink',
                    )}
                  >
                    {option === 'anthropic' ? 'Anthropic' : 'OpenAI'}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="api-key" className="label mb-2 block">
                API key
              </label>
              <input
                id="api-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setSaved(false);
                }}
                placeholder={provider === 'anthropic' ? 'sk-ant-...' : 'sk-...'}
                className="w-full rounded border border-line bg-sunken px-3 py-2 font-mono text-xs text-ink placeholder:text-faint focus:border-brass/60 focus:outline-none"
              />
            </div>

            {error ? (
              <Alert tone="rust" title="Not saved">
                {error}
              </Alert>
            ) : null}

            <Alert tone="neutral" title="Where this key goes">
              <ul className="space-y-1">
                <li>Stored in this tab&apos;s session storage only — cleared when you close it.</li>
                <li>Never written to the database, disk, or logs.</li>
                <li>Never placed in the environment of a sandboxed build.</li>
                <li>Sent only to your chosen provider, only when a rule finds no match.</li>
              </ul>
            </Alert>

            <div className="flex items-center justify-between gap-3 pt-1">
              <div>
                {saved ? (
                  <Badge tone="verdigris">
                    <ShieldCheck className="h-3 w-3" /> Key active this session
                  </Badge>
                ) : (
                  <Badge tone="neutral">Running without AI</Badge>
                )}
              </div>
              <div className="flex gap-2">
                {saved ? (
                  <Button variant="danger" size="sm" onClick={remove}>
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                  </Button>
                ) : null}
                <Button variant="primary" size="sm" onClick={save}>
                  Save key
                </Button>
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
