import type { ReactNode } from 'react';

/** Transparency-revealing checkerboard behind library assets. */
export function Checkerboard({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-xl bg-[#1a2142] bg-[conic-gradient(#ffffff12_25%,transparent_0_50%,#ffffff12_0_75%,transparent_0)] bg-[length:18px_18px] ${className}`}
    >
      {children}
    </div>
  );
}

export function TextArea({
  label,
  hint,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-text-muted">{label}</span>
      <textarea
        rows={3}
        {...props}
        className="rounded-2xl border border-glass-border bg-ink/50 px-4 py-3 text-[15px] text-text outline-none transition placeholder:text-text-dim hover:border-glass-edge focus:border-brand-2/70"
      />
      {hint && <span className="text-xs text-text-dim">{hint}</span>}
    </label>
  );
}
