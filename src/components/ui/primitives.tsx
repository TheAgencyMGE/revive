'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Base interface primitives.
 *
 * Kept in one file because there are only a handful and they share the same
 * token vocabulary; splitting them across a dozen modules would add ceremony
 * without adding clarity.
 */

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded font-mono text-xs uppercase tracking-label transition-colors disabled:pointer-events-none disabled:opacity-40',
  {
    variants: {
      variant: {
        primary:
          'bg-brass text-ground hover:bg-brass/90 font-semibold',
        outline:
          'border border-line bg-transparent text-ink hover:bg-raised hover:border-faint',
        ghost: 'bg-transparent text-muted hover:text-ink hover:bg-raised',
        danger:
          'border border-rust/50 bg-rust/10 text-rust hover:bg-rust/20',
        subtle: 'bg-raised text-ink hover:bg-line/60',
      },
      size: {
        sm: 'h-8 px-3',
        md: 'h-10 px-4',
        lg: 'h-12 px-6 text-sm',
        icon: 'h-8 w-8',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
    );
  },
);
Button.displayName = 'Button';

// ---------------------------------------------------------------------------
// Badge — a specimen tag
// ---------------------------------------------------------------------------

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'brass' | 'verdigris' | 'rust' | 'blueprint';
  className?: string;
}) {
  const tones = {
    neutral: 'border-line bg-raised text-muted',
    brass: 'border-brass/40 bg-brass/10 text-brass',
    verdigris: 'border-verdigris/40 bg-verdigris/10 text-verdigris',
    rust: 'border-rust/40 bg-rust/10 text-rust',
    blueprint: 'border-blueprint/40 bg-blueprint/10 text-blueprint',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 font-mono text-2xs uppercase tracking-label',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export function Card({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('card', className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  eyebrow,
  action,
  className,
}: {
  title: React.ReactNode;
  eyebrow?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 border-b border-line px-5 py-4',
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? <div className="label mb-1.5">{eyebrow}</div> : null}
        <h2 className="text-sm font-semibold tracking-tight text-ink">{title}</h2>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Field row — the label/value pair used across every detail panel
// ---------------------------------------------------------------------------

export function Field({
  label,
  children,
  mono = false,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="label shrink-0">{label}</dt>
      <dd
        className={cn(
          'min-w-0 truncate text-right text-xs text-ink',
          mono && 'font-mono',
        )}
      >
        {children}
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status pill
// ---------------------------------------------------------------------------

export function StatusPill({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const styles: Record<string, { label: string; dot: string; cls: string }> = {
    queued: { label: 'Queued', dot: 'bg-faint', cls: 'border-line bg-raised text-muted' },
    running: {
      label: 'Running',
      dot: 'bg-blueprint animate-pulse-soft',
      cls: 'border-blueprint/40 bg-blueprint/10 text-blueprint',
    },
    succeeded: {
      label: 'Revived',
      dot: 'bg-verdigris',
      cls: 'border-verdigris/40 bg-verdigris/10 text-verdigris',
    },
    partial: {
      label: 'Partially revived',
      dot: 'bg-brass',
      cls: 'border-brass/40 bg-brass/10 text-brass',
    },
    failed: { label: 'Not revived', dot: 'bg-rust', cls: 'border-rust/40 bg-rust/10 text-rust' },
    cancelled: { label: 'Cancelled', dot: 'bg-faint', cls: 'border-line bg-raised text-muted' },
  };
  const style = styles[status] ?? styles.queued;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-sm border px-2.5 py-1 font-mono text-2xs uppercase tracking-label',
        style.cls,
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', style.dot)} aria-hidden />
      {style.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Meter — a horizontal bar used for scores, confidence and evidence weight
// ---------------------------------------------------------------------------

export function Meter({
  value,
  max = 100,
  tone = 'brass',
  className,
  label,
}: {
  value: number;
  max?: number;
  tone?: 'brass' | 'verdigris' | 'rust' | 'blueprint' | 'muted';
  className?: string;
  label?: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const tones = {
    brass: 'bg-brass',
    verdigris: 'bg-verdigris',
    rust: 'bg-rust',
    blueprint: 'bg-blueprint',
    muted: 'bg-faint',
  };
  return (
    <div
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-sunken', className)}
      role="meter"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-500', tones[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon ? <div className="mb-4 text-faint">{icon}</div> : null}
      <h3 className="mb-1.5 text-sm font-semibold text-ink">{title}</h3>
      <p className="max-w-sm text-xs leading-relaxed text-muted">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('relative overflow-hidden rounded bg-raised', className)}
      aria-hidden
    >
      <div className="absolute inset-y-0 w-1/3 animate-sweep bg-gradient-to-r from-transparent via-line/60 to-transparent" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline alert
// ---------------------------------------------------------------------------

export function Alert({
  tone = 'neutral',
  title,
  children,
}: {
  tone?: 'neutral' | 'rust' | 'brass' | 'verdigris';
  title?: string;
  children: React.ReactNode;
}) {
  const tones = {
    neutral: 'border-line bg-raised',
    rust: 'border-rust/40 bg-rust/10',
    brass: 'border-brass/40 bg-brass/10',
    verdigris: 'border-verdigris/40 bg-verdigris/10',
  };
  const titleTones = {
    neutral: 'text-ink',
    rust: 'text-rust',
    brass: 'text-brass',
    verdigris: 'text-verdigris',
  };
  return (
    <div className={cn('rounded-md border px-4 py-3', tones[tone])} role="status">
      {title ? (
        <div className={cn('mb-1 font-mono text-2xs uppercase tracking-label', titleTones[tone])}>
          {title}
        </div>
      ) : null}
      <div className="text-xs leading-relaxed text-muted">{children}</div>
    </div>
  );
}
