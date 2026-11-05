import { z } from 'zod';

/** Appearance settings a user can change for themselves. Stored per user as JSON. */
export const ACCENTS = [
  'sage-blue',
  'royal-purple',
  'ocean-cyan',
  'emerald-green',
  'rose-pink',
  'sunset-orange',
  'lavender',
] as const;

export const PreferencesSchema = z
  .object({
    theme: z.enum(['light', 'dark', 'system']),
    accent: z.enum(ACCENTS),
    glass: z.enum(['subtle', 'standard', 'strong']),
    animations: z.boolean(),
    motion: z.enum(['reduced', 'standard']),
    backgroundEffects: z.boolean(),
    density: z.enum(['compact', 'comfortable']),
    /** Which live notification pop-ups to show (everything is still kept in Notifications). */
    notifications: z
      .object({
        popups: z.boolean(),
        events: z.boolean(),
        recognition: z.boolean(),
        creations: z.boolean(),
        aiAvatars: z.boolean(),
        account: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type Preferences = z.infer<typeof PreferencesSchema>;

export const DEFAULT_PREFERENCES: Preferences = {
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

/** Reads stored JSON, keeping every valid field and falling back to defaults for the rest. */
export function readPreferences(raw: string | null | undefined): Preferences {
  if (!raw) return { ...DEFAULT_PREFERENCES };
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
  const out: Record<string, unknown> = { ...DEFAULT_PREFERENCES };
  if (stored && typeof stored === 'object') {
    for (const [key, field] of Object.entries(PreferencesSchema.shape)) {
      const r = field.safeParse((stored as Record<string, unknown>)[key]);
      if (r.success) out[key] = r.data;
    }
  }
  return out as Preferences;
}
