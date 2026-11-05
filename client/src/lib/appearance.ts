/** Appearance settings — mirrors server/src/lib/preferences.ts. */
export type ThemeMode = 'light' | 'dark' | 'system';
export type Accent =
  | 'sage-blue'
  | 'royal-purple'
  | 'ocean-cyan'
  | 'emerald-green'
  | 'rose-pink'
  | 'sunset-orange'
  | 'lavender';

export interface Appearance {
  theme: ThemeMode;
  accent: Accent;
  glass: 'subtle' | 'standard' | 'strong';
  animations: boolean;
  motion: 'reduced' | 'standard';
  backgroundEffects: boolean;
  density: 'compact' | 'comfortable';
  /** Which live pop-ups to show (everything is still kept in Notifications). */
  notifications: NotificationPrefs;
}

export interface NotificationPrefs {
  popups: boolean;
  events: boolean;
  recognition: boolean;
  creations: boolean;
  aiAvatars: boolean;
  account: boolean;
}

export const DEFAULT_APPEARANCE: Appearance = {
  theme: 'dark',
  accent: 'sage-blue',
  glass: 'standard',
  animations: true,
  motion: 'standard',
  backgroundEffects: true,
  density: 'comfortable',
  notifications: {
    popups: true,
    events: true,
    recognition: true,
    creations: true,
    aiAvatars: true,
    account: true,
  },
};

/** Swatch colours for the picker; the full palettes live in index.css ([data-accent]). */
export const ACCENTS: { id: Accent; label: string; swatch: [string, string] }[] = [
  { id: 'sage-blue', label: 'Sage Blue', swatch: ['#1f6fff', '#22d3ee'] },
  { id: 'royal-purple', label: 'Royal Purple', swatch: ['#7c5cff', '#22d3ee'] },
  { id: 'ocean-cyan', label: 'Ocean Cyan', swatch: ['#0891b2', '#2dd4bf'] },
  { id: 'emerald-green', label: 'Emerald Green', swatch: ['#059669', '#84cc16'] },
  { id: 'rose-pink', label: 'Rose Pink', swatch: ['#e11d74', '#fb7185'] },
  { id: 'sunset-orange', label: 'Sunset Orange', swatch: ['#ea580c', '#facc15'] },
  { id: 'lavender', label: 'Lavender', swatch: ['#9b7bf0', '#f0abfc'] },
];

const systemDark = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
const systemReduced = () =>
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export const resolveTheme = (a: Appearance): 'light' | 'dark' =>
  a.theme === 'system' ? (systemDark() ? 'dark' : 'light') : a.theme;

/** True when decorative motion should not play (user setting or OS setting). */
export const motionReduced = (a: Appearance) =>
  !a.animations || a.motion === 'reduced' || systemReduced();

/** Writes the settings onto <html> as data attributes; index.css does the rest. */
export function applyAppearance(a: Appearance, root: HTMLElement = document.documentElement) {
  const theme = resolveTheme(a);
  root.dataset.theme = theme;
  root.dataset.accent = a.accent;
  root.dataset.glass = a.glass;
  root.dataset.animations = a.animations ? 'on' : 'off';
  root.dataset.motion = a.motion;
  root.dataset.bgEffects = a.backgroundEffects ? 'on' : 'off';
  root.dataset.density = a.density;
  root.style.colorScheme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'light' ? '#eef2fb' : '#030714');
}

const CACHE_KEY = 'sagevatar.appearance';

/** Last-used settings in this browser, so the right theme paints before the API answers. */
export function readCachedAppearance(userId?: string): Appearance | null {
  try {
    const raw = localStorage.getItem(`${CACHE_KEY}.${userId ?? 'last'}`);
    return raw ? { ...DEFAULT_APPEARANCE, ...(JSON.parse(raw) as Partial<Appearance>) } : null;
  } catch {
    return null;
  }
}

export function cacheAppearance(a: Appearance, userId: string) {
  try {
    localStorage.setItem(`${CACHE_KEY}.${userId}`, JSON.stringify(a));
  } catch {
    /* storage unavailable — the server copy is the source of truth anyway */
  }
}
