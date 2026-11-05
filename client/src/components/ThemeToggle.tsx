import { motion } from 'framer-motion';
import { useAppearance } from '../auth/AppearanceContext';
import { resolveTheme } from '../lib/appearance';
import { IconMoon, IconSun } from './icons';

/**
 * Dedicated Light/Dark switch for the header. One click (or Space/Enter) flips the theme
 * instantly; the choice is saved to the account and cached in localStorage, so it's restored
 * on the next sign-in. Purely presentational — the camera, studio state and exported photos
 * are untouched by a theme change.
 */
export function ThemeToggle() {
  const { appearance, update } = useAppearance();
  const dark = resolveTheme(appearance) === 'dark';
  const next = dark ? 'light' : 'dark';
  const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label={label}
      title={label}
      onClick={() => update({ theme: next })}
      className="theme-toggle group relative flex h-9 w-[4.25rem] shrink-0 items-center rounded-full border border-glass-border bg-glass p-1 outline-none transition-colors hover:border-glass-edge focus-visible:ring-2 focus-visible:ring-brand-2/70"
    >
      <span className={`relative z-10 grid h-7 w-7 place-items-center ${dark ? 'text-text-dim' : 'text-amber-500'}`}>
        <IconSun size={15} />
      </span>
      <span className={`relative z-10 ml-auto grid h-7 w-7 place-items-center ${dark ? 'text-white' : 'text-text-dim'}`}>
        <IconMoon size={15} />
      </span>
      <motion.span
        aria-hidden
        layout
        transition={{ type: 'spring', stiffness: 520, damping: 34 }}
        className={`absolute top-1 h-7 w-7 rounded-full shadow-md ${
          dark
            ? 'right-1 bg-gradient-brand shadow-[0_0_14px_-2px_rgb(34_211_238/0.7)]'
            : 'left-1 bg-white shadow-[0_2px_8px_-2px_rgb(30_64_175/0.35)]'
        }`}
      />
    </button>
  );
}
