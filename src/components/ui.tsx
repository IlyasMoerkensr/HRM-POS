'use client';

import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { formatEUR } from '@/lib/money';

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

/** Unieke sleutel per klik (ook op http-telefoons, waar crypto.randomUUID ontbreekt). */
export function newKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto && window.isSecureContext) return crypto.randomUUID();
  const rnd = new Uint32Array(4);
  crypto.getRandomValues(rnd);
  return Array.from(rnd, (n) => n.toString(16).padStart(8, '0')).join('-');
}

type Variant = 'primary' | 'success' | 'danger' | 'secondary' | 'ghost' | 'warning';

const variants: Record<Variant, string> = {
  primary: 'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 active:bg-rose-800',
  warning: 'bg-amber-500 text-white hover:bg-amber-600 active:bg-amber-700',
  secondary: 'bg-white text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50 active:bg-slate-100',
  ghost: 'bg-transparent text-slate-700 hover:bg-slate-200/60 active:bg-slate-200',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const sizes = { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2.5 text-base', lg: 'px-5 py-3.5 text-lg', xl: 'px-6 py-5 text-xl' };
  return (
    <button
      type="button"
      {...props}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition disabled:cursor-not-allowed disabled:opacity-40',
        variants[variant],
        sizes[size],
        className,
      )}
    />
  );
}

export function Money({ cents, className }: { cents: number; className?: string }) {
  return <span className={cx('tabular whitespace-nowrap', className)}>{formatEUR(cents)}</span>;
}

export function Modal({
  title,
  onClose,
  children,
  wide,
  footer,
}: {
  title: ReactNode;
  onClose?: () => void;
  children: ReactNode;
  wide?: boolean;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className={cx(
          'flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-h-[92vh] sm:rounded-2xl',
          wide ? 'sm:max-w-4xl' : 'sm:max-w-lg',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-lg font-bold">{title}</h2>
          {onClose && (
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-1 text-2xl leading-none text-slate-500 hover:bg-slate-100" aria-label="Sluiten">
              ×
            </button>
          )}
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-slate-200 bg-slate-50 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/**
 * Cijferblok. mode 'money': cijfers schuiven van rechts in (1-2-5-0 → € 12,50),
 * zoals op een kassa. mode 'pin': maximaal `maxLength` cijfers.
 */
export function NumPad({
  value,
  onChange,
  mode = 'money',
  maxLength = 7,
}: {
  value: string;
  onChange: (value: string) => void;
  mode?: 'money' | 'pin';
  maxLength?: number;
}) {
  const press = (k: string) => {
    if (k === '⌫') return onChange(value.slice(0, -1));
    if (k === 'C') return onChange('');
    if (k === '00') {
      if (mode === 'pin' || !value) return;
      return onChange((value + '00').slice(0, maxLength));
    }
    if (value.length >= maxLength) return;
    if (mode === 'money' && value === '' && k === '0') return;
    onChange(value + k);
  };
  const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', mode === 'money' ? '00' : 'C', '0', '⌫'];
  return (
    <div className="grid grid-cols-3 gap-2">
      {keys.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => press(k)}
          className="h-14 rounded-xl bg-slate-100 text-2xl font-semibold text-slate-800 active:bg-slate-300"
        >
          {k}
        </button>
      ))}
    </div>
  );
}

/** "1250" → 1250 cent */
export function digitsToCents(digits: string): number {
  return digits ? Number(digits) : 0;
}

export function ErrorBox({ message, onClose }: { message: string | null; onClose?: () => void }) {
  if (!message) return null;
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl bg-rose-50 px-4 py-3 text-rose-800 ring-1 ring-rose-200">
      <span>{message}</span>
      {onClose && (
        <button type="button" onClick={onClose} className="text-rose-500" aria-label="Sluiten">
          ×
        </button>
      )}
    </div>
  );
}

export function PinDots({ length, filled }: { length: number; filled: number }) {
  return (
    <div className="flex justify-center gap-3 py-2">
      {Array.from({ length }, (_, i) => (
        <span key={i} className={cx('h-4 w-4 rounded-full', i < filled ? 'bg-slate-800' : 'bg-slate-300')} />
      ))}
    </div>
  );
}

/** Zwart of wit, afhankelijk van hoe licht de achtergrondkleur is (leesbaarheid). */
export function textOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.4 ? '#0f172a' : '#ffffff';
}
