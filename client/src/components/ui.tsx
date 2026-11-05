import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { AnimatePresence, motion, type HTMLMotionProps } from 'framer-motion';
import { spring } from '../lib/motion';
import { IconAlert, IconEye, IconEyeOff } from './icons';

// ---------------------------------------------------------------- Button

type Variant = 'primary' | 'ghost' | 'danger' | 'subtle';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-gradient-brand btn-shine text-white shadow-[var(--shadow-glow)] hover:shadow-[0_14px_44px_-8px_color-mix(in_srgb,var(--color-brand)_70%,transparent)]',
  ghost:
    'bg-glass border border-glass-border text-text hover:bg-glass-strong hover:border-glass-edge',
  subtle: 'text-text-muted hover:text-text hover:bg-glass',
  danger: 'bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-[15px] gap-2.5',
};

export type ButtonProps = Omit<HTMLMotionProps<'button'>, 'children'> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  children?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, className = '', disabled, children, ...props },
  ref,
) {
  const inactive = disabled || loading;
  return (
    <motion.button
      ref={ref}
      whileHover={inactive ? undefined : { y: -1.5 }}
      whileTap={inactive ? undefined : { scale: 0.96 }}
      transition={spring}
      disabled={inactive}
      aria-busy={loading || undefined}
      {...props}
      className={`inline-flex select-none items-center justify-center whitespace-nowrap rounded-full font-medium transition-[background-color,border-color,box-shadow,color,opacity] duration-300 disabled:cursor-not-allowed disabled:opacity-50 ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
    >
      {loading ? <Spinner size={size === 'lg' ? 18 : 15} /> : icon}
      {children && <span className="relative">{children}</span>}
    </motion.button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonProps & { label: string }>(
  function IconButton({ label, className = '', size = 'md', ...props }, ref) {
    const dims = { sm: '!w-8 !px-0', md: '!w-10 !px-0', lg: '!w-12 !px-0' }[size];
    return (
      <Button
        ref={ref}
        aria-label={label}
        title={label}
        size={size}
        variant="ghost"
        className={`${dims} ${className}`}
        {...props}
      />
    );
  },
);

// ---------------------------------------------------------------- Loading

export function Spinner({ size = 18, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={`animate-spin ${className}`}
      role="status"
      aria-label="Loading"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="3"
        fill="none"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`skeleton ${className}`} />;
}

/** Studio-styled loader: orbiting dots around a soft core. */
export function OrbitLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" className="flex flex-col items-center gap-3 py-10 text-sm text-text-muted">
      <div className="relative h-12 w-12">
        <div className="absolute inset-3 rounded-full bg-gradient-brand opacity-70 blur-[2px] animate-pulse-soft" />
        <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-brand-2 border-r-brand [animation-duration:1.1s]" />
      </div>
      <span>{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------- Fields

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string;
  icon?: ReactNode;
  trailing?: ReactNode;
};

export const inputClass =
  'peer w-full rounded-2xl border border-glass-border bg-ink/50 py-3 text-[15px] text-text outline-none transition-[border-color,box-shadow,background-color] duration-300 placeholder:text-text-dim hover:border-glass-edge focus:border-brand-2/70 focus:bg-ink/70 focus:shadow-[0_0_0_4px_rgb(34_211_238/0.15),0_0_24px_-4px_rgb(34_211_238/0.35)] aria-[invalid=true]:border-accent/60';

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, hint, error, icon, trailing, id, className = '', ...props },
  ref,
) {
  const auto = useId();
  const inputId = id ?? auto;
  const describedBy = error ? `${inputId}-err` : hint ? `${inputId}-hint` : undefined;
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={inputId} className="text-[13px] font-medium text-text-muted">
        {label}
      </label>
      <div className="group relative">
        {icon && (
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-dim transition-colors group-focus-within:text-brand-2">
            {icon}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...props}
          className={`${inputClass} ${icon ? 'pl-11' : 'pl-4'} ${trailing ? 'pr-12' : 'pr-4'}`}
        />
        {trailing && (
          <span className="absolute right-1.5 top-1/2 -translate-y-1/2">{trailing}</span>
        )}
      </div>
      {error ? (
        <span id={`${inputId}-err`} className="text-xs text-accent">
          {error}
        </span>
      ) : (
        hint && (
          <span id={`${inputId}-hint`} className="text-xs text-text-dim">
            {hint}
          </span>
        )
      )}
    </div>
  );
});

export const PasswordField = forwardRef<HTMLInputElement, Omit<FieldProps, 'type' | 'trailing'>>(
  function PasswordField(props, ref) {
    const [visible, setVisible] = useState(false);
    return (
      <Field
        ref={ref}
        {...props}
        type={visible ? 'text' : 'password'}
        trailing={
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? 'Hide password' : 'Show password'}
            aria-pressed={visible}
            className="grid h-9 w-9 place-items-center rounded-xl text-text-dim transition hover:bg-glass hover:text-text"
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={visible ? 'off' : 'on'}
                initial={{ opacity: 0, rotate: -45, scale: 0.7 }}
                animate={{ opacity: 1, rotate: 0, scale: 1 }}
                exit={{ opacity: 0, rotate: 45, scale: 0.7 }}
                transition={{ duration: 0.18 }}
              >
                {visible ? <IconEyeOff /> : <IconEye />}
              </motion.span>
            </AnimatePresence>
          </button>
        }
      />
    );
  },
);

export const selectClass =
  'rounded-2xl border border-glass-border bg-ink/60 px-3.5 py-2.5 text-sm text-text outline-none transition hover:border-glass-edge focus:border-brand-2/70';

// ---------------------------------------------------------------- Feedback

export function ErrorText({ children }: { children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {children ? (
        <motion.p
          role="alert"
          initial={{ opacity: 0, height: 0, y: -4 }}
          animate={{ opacity: 1, height: 'auto', y: 0 }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.25 }}
          className="flex items-start gap-2 overflow-hidden rounded-2xl border border-accent/25 bg-accent/10 px-3.5 py-2.5 text-sm text-accent"
        >
          <IconAlert className="mt-px shrink-0" size={16} />
          <span>{children}</span>
        </motion.p>
      ) : null}
    </AnimatePresence>
  );
}

export function Pill({
  tone = 'neutral',
  children,
}: {
  tone?: 'ok' | 'warn' | 'neutral' | 'brand';
  children: ReactNode;
}) {
  const t = {
    ok: 'bg-success/15 text-success border-success/25',
    warn: 'bg-accent/15 text-accent border-accent/25',
    neutral: 'bg-glass text-text-muted border-glass-border',
    brand: 'bg-brand/20 text-[#c4b5fd] border-brand/30',
  }[tone];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${t}`}
    >
      {children}
    </span>
  );
}

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className = '',
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`glass p-5 sm:p-6 ${className}`}>
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-text-muted">{subtitle}</p>}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-2xl border border-glass-border bg-glass text-brand-2 shadow-[var(--shadow-glow-cyan)]">
        {icon}
      </div>
      <h3 className="text-base font-semibold">{title}</h3>
      {children && <p className="max-w-sm text-sm text-text-muted">{children}</p>}
    </div>
  );
}
