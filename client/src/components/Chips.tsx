import { motion } from 'framer-motion';

/** Pill-style single-choice control (tabs or radio group) with an animated highlight. */
export function Chips({
  label,
  role,
  layoutId,
  value,
  onChange,
  options,
  strong,
  wrap,
}: {
  label: string;
  role: 'tablist' | 'radiogroup';
  layoutId: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  strong?: boolean;
  /** Wrap onto several lines instead of scrolling sideways. */
  wrap?: boolean;
}) {
  const itemRole = role === 'tablist' ? 'tab' : 'radio';
  return (
    <div
      role={role}
      aria-label={label}
      className={`-mx-1 flex gap-1 px-1 py-0.5 ${wrap ? 'flex-wrap' : 'no-scrollbar overflow-x-auto'}`}
    >
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            role={itemRole}
            aria-selected={role === 'tablist' ? active : undefined}
            aria-checked={role === 'radiogroup' ? active : undefined}
            onClick={() => onChange(o.value)}
            className={`relative shrink-0 rounded-full transition-colors ${
              strong ? 'px-4 py-2 text-sm' : 'border border-transparent px-3 py-1.5 text-xs'
            } ${active ? 'text-text' : 'text-text-muted hover:text-text'}`}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                className={`absolute inset-0 -z-10 rounded-full ${
                  strong ? 'border border-fg/15 bg-fg/12' : 'border border-brand-2/40 bg-brand-2/15'
                }`}
                transition={{ type: 'spring', stiffness: 450, damping: 34 }}
              />
            )}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
