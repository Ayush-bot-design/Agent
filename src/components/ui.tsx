import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import type { SiteStatus } from '../utils/deployment-logic';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function Card({
  children,
  className,
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article' | 'li';
}) {
  return (
    <Tag
      className={cx(
        'rounded-2xl bg-white/85 ring-1 ring-slate-900/[0.06] shadow-[0_1px_2px_rgba(15,23,42,0.04),0_18px_40px_-28px_rgba(15,23,42,0.35)] backdrop-blur-sm',
        className,
      )}
    >
      {children}
    </Tag>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary:
    'bg-slate-900 text-white hover:bg-slate-800 focus-visible:outline-slate-900 disabled:bg-slate-300',
  secondary:
    'bg-white text-slate-800 ring-1 ring-slate-900/10 hover:bg-slate-50 focus-visible:outline-slate-400',
  ghost: 'bg-transparent text-slate-600 hover:bg-slate-900/5 focus-visible:outline-slate-400',
  danger: 'bg-rose-600 text-white hover:bg-rose-500 focus-visible:outline-rose-600',
  success: 'bg-emerald-600 text-white hover:bg-emerald-500 focus-visible:outline-emerald-600',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <button
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-70',
        size === 'sm' && 'px-3 py-1.5 text-xs',
        size === 'md' && 'px-4 py-2 text-sm',
        size === 'lg' && 'px-5 py-2.5 text-sm sm:text-base',
        BUTTON_STYLES[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Badge({
  children,
  tone = 'slate',
  className,
}: {
  children: ReactNode;
  tone?: 'slate' | 'emerald' | 'indigo' | 'amber' | 'rose' | 'sky';
  className?: string;
}) {
  const tones = {
    slate: 'bg-slate-900/[0.06] text-slate-700 ring-slate-900/10',
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-600/20',
    amber: 'bg-amber-50 text-amber-800 ring-amber-600/25',
    rose: 'bg-rose-50 text-rose-700 ring-rose-600/20',
    sky: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  } as const;
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset whitespace-nowrap',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const STATUS_META: Record<SiteStatus, { label: string; tone: 'emerald' | 'indigo' | 'amber' | 'slate' }> = {
  available: { label: 'Available', tone: 'emerald' },
  in_progress: { label: 'Reserved', tone: 'indigo' },
  pending: { label: 'Pending issue', tone: 'amber' },
  completed: { label: 'Completed', tone: 'slate' },
};

export function StatusBadge({ status }: { status: SiteStatus }) {
  const meta = STATUS_META[status];
  return (
    <Badge tone={meta.tone}>
      <span
        className={cx(
          'h-1.5 w-1.5 rounded-full',
          status === 'available' && 'bg-emerald-500',
          status === 'in_progress' && 'bg-indigo-500',
          status === 'pending' && 'bg-amber-500',
          status === 'completed' && 'bg-slate-400',
        )}
      />
      {meta.label}
    </Badge>
  );
}

export function ProgressBar({
  value,
  tone = 'slate',
  className,
}: {
  value: number;
  tone?: 'slate' | 'emerald' | 'indigo';
  className?: string;
}) {
  const bars = {
    slate: 'bg-slate-900',
    emerald: 'bg-emerald-500',
    indigo: 'bg-indigo-500',
  } as const;
  return (
    <div className={cx('h-1.5 w-full overflow-hidden rounded-full bg-slate-900/10', className)}>
      <div
        className={cx('h-full rounded-full transition-[width] duration-500', bars[tone])}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
  tone = 'slate',
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'slate' | 'emerald' | 'indigo' | 'amber';
}) {
  const accents = {
    slate: 'text-slate-900',
    emerald: 'text-emerald-600',
    indigo: 'text-indigo-600',
    amber: 'text-amber-600',
  } as const;
  return (
    <Card className="px-4 py-3.5">
      <p className="text-[11px] font-semibold tracking-[0.08em] text-slate-500 uppercase">{label}</p>
      <p className={cx('mt-1 text-2xl font-bold tabular-nums tracking-tight', accents[tone])}>
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-slate-500">{hint}</p> : null}
    </Card>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1.5 block text-xs font-semibold text-slate-700">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs font-medium text-rose-600">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-slate-500">{hint}</span>
      ) : null}
    </label>
  );
}

const CONTROL =
  'w-full rounded-xl border-0 bg-white px-3 py-2 text-sm text-slate-900 ring-1 ring-slate-900/10 transition placeholder:text-slate-400 focus:ring-2 focus:ring-slate-900/40 focus:outline-none disabled:bg-slate-50 disabled:text-slate-500';

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cx(CONTROL, className)} />;
}

export function SelectInput({
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cx(CONTROL, 'appearance-none pr-8', className)}>
      {children}
    </select>
  );
}

export function TextArea({
  className,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cx(CONTROL, 'min-h-24 resize-y', className)} />;
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx(
          'relative max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl ring-1 ring-slate-900/10 sm:rounded-3xl sm:p-6',
          wide ? 'sm:max-w-3xl' : 'sm:max-w-xl',
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-bold tracking-tight text-slate-900">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="mt-4">{children}</div>
        {footer ? <div className="mt-5 flex flex-wrap justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Alert({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'success' | 'warning' | 'error';
  children: ReactNode;
}) {
  const tones = {
    info: 'bg-sky-50 text-sky-900 ring-sky-600/20',
    success: 'bg-emerald-50 text-emerald-900 ring-emerald-600/20',
    warning: 'bg-amber-50 text-amber-900 ring-amber-600/25',
    error: 'bg-rose-50 text-rose-900 ring-rose-600/20',
  } as const;
  return (
    <div className={cx('rounded-xl px-3.5 py-2.5 text-sm ring-1 ring-inset', tones[tone])}>
      {children}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-12 text-center">
      <p className="text-base font-semibold text-slate-800">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{description}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function DataRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <dt className="shrink-0 text-xs font-medium text-slate-500">{label}</dt>
      <dd className="min-w-0 text-right text-sm font-medium text-slate-800 break-words">{value ?? '—'}</dd>
    </div>
  );
}
