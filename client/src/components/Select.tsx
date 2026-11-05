import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { IconCheck, IconChevronDown } from './icons';

export interface Option<T extends string> {
  value: T;
  label: string;
}

/**
 * Animated glass dropdown (ARIA "select-only combobox" pattern).
 * Keyboard: ↑/↓ move, Home/End jump, Enter/Space choose, Esc closes, type-ahead by first letter.
 */
export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  className = '',
  hideLabel = false,
  name,
}: {
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (v: T) => void;
  className?: string;
  hideLabel?: boolean;
  /** When set, the value is also submitted with the surrounding <form>. */
  name?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const openList = () => {
    setActive(
      Math.max(
        0,
        options.findIndex((o) => o.value === value),
      ),
    );
    setOpen(true);
  };
  const choose = (i: number) => {
    onChange(options[i].value);
    setOpen(false);
  };

  const onKey = (e: KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        openList();
      }
      return;
    }
    const last = options.length - 1;
    if (e.key === 'ArrowDown') setActive((a) => Math.min(last, a + 1));
    else if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1));
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(last);
    else if (e.key === 'Enter' || e.key === ' ') choose(active);
    else if (e.key === 'Escape' || e.key === 'Tab') return setOpen(false);
    else if (e.key.length === 1) {
      const i = options.findIndex((o) => o.label.toLowerCase().startsWith(e.key.toLowerCase()));
      if (i >= 0) setActive(i);
      return;
    } else return;
    e.preventDefault();
  };

  return (
    <div ref={root} className={`relative ${className}`}>
      <span
        id={`${id}-label`}
        className={hideLabel ? 'sr-only' : 'mb-1.5 block text-[13px] font-medium text-text-muted'}
      >
        {label}
      </span>
      <button
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-labelledby={`${id}-label`}
        aria-activedescendant={open ? `${id}-opt-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKey}
        className="flex h-10 w-full min-w-[9rem] items-center justify-between gap-3 rounded-full border border-glass-border bg-ink/60 px-4 text-sm text-text transition hover:border-glass-edge focus-visible:border-brand-2/70"
      >
        <span className="truncate">{current?.label}</span>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="text-text-muted"
        >
          <IconChevronDown size={16} />
        </motion.span>
      </button>
      {name && <input type="hidden" name={name} value={value} />}
      <AnimatePresence>
        {open && (
          <motion.ul
            id={`${id}-list`}
            role="listbox"
            aria-labelledby={`${id}-label`}
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 500, damping: 34 }}
            style={{ transformOrigin: 'top' }}
            className="glass glass-popover absolute right-0 z-40 mt-2 max-h-72 min-w-full overflow-auto !rounded-2xl p-1.5"
          >
            {options.map((o, i) => {
              const selected = o.value === value;
              return (
                <li
                  key={o.value}
                  id={`${id}-opt-${i}`}
                  role="option"
                  aria-selected={selected}
                  onPointerEnter={() => setActive(i)}
                  onClick={() => choose(i)}
                  className={`relative flex cursor-pointer items-center justify-between gap-4 rounded-xl px-3 py-2 text-sm transition-colors ${
                    selected ? 'text-text' : 'text-text-muted'
                  }`}
                >
                  {i === active && (
                    <motion.span
                      layoutId={`${id}-hl`}
                      className="absolute inset-0 -z-10 rounded-xl bg-fg/10"
                      transition={{ type: 'spring', stiffness: 600, damping: 40 }}
                    />
                  )}
                  <span className="whitespace-nowrap">{o.label}</span>
                  {selected && <IconCheck size={15} className="text-brand-2" />}
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
