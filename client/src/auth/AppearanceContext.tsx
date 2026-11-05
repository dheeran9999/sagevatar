import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { MotionConfig, MotionGlobalConfig } from 'framer-motion';
import { useAuth } from './AuthContext';
import { api } from '../lib/api';
import {
  applyAppearance,
  cacheAppearance,
  DEFAULT_APPEARANCE,
  readCachedAppearance,
  type Appearance,
} from '../lib/appearance';

interface AppearanceState {
  appearance: Appearance;
  update: (patch: Partial<Appearance>) => void;
  reset: () => void;
  saving: boolean;
  error: string;
}

const AppearanceContext = createContext<AppearanceState | null>(null);

/**
 * Applies the signed-in user's Appearance settings app-wide and saves changes to their
 * account (debounced). Signed-out pages use the defaults.
 */
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id;
  const [loaded, setLoaded] = useState<{ userId?: string; value: Appearance }>({
    value: DEFAULT_APPEARANCE,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const timer = useRef<number | undefined>(undefined);

  // Signed out → defaults. Signed in → cached copy first, then the account's saved settings.
  const appearance = useMemo(
    () =>
      !userId
        ? DEFAULT_APPEARANCE
        : loaded.userId === userId
          ? loaded.value
          : (readCachedAppearance(userId) ?? DEFAULT_APPEARANCE),
    [userId, loaded],
  );

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    api.auth
      .preferences()
      .then(({ preferences }) => {
        if (!alive) return;
        const value = { ...DEFAULT_APPEARANCE, ...(preferences ?? {}) };
        setLoaded({ userId, value });
        cacheAppearance(value, userId);
      })
      .catch(() => {
        /* keep the cached/default look; saving reports its own errors */
      });
    return () => {
      alive = false;
    };
  }, [userId]);

  useEffect(() => {
    applyAppearance(appearance);
    MotionGlobalConfig.skipAnimations = !appearance.animations;
    if (appearance.theme !== 'system') return;
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onChange = () => applyAppearance(appearance);
    mq?.addEventListener('change', onChange);
    return () => mq?.removeEventListener('change', onChange);
  }, [appearance]);

  const persist = useCallback(
    (next: Appearance) => {
      if (!userId) return;
      setLoaded({ userId, value: next });
      cacheAppearance(next, userId);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        setSaving(true);
        api.auth
          .savePreferences(next)
          .then(() => setError(''))
          .catch((e: Error) => setError(`Couldn't save your settings: ${e.message}`))
          .finally(() => setSaving(false));
      }, 400);
    },
    [userId],
  );

  const update = useCallback(
    (patch: Partial<Appearance>) => persist({ ...appearance, ...patch }),
    [appearance, persist],
  );
  const reset = useCallback(() => persist(DEFAULT_APPEARANCE), [persist]);

  const value = useMemo(
    () => ({ appearance, update, reset, saving, error }),
    [appearance, update, reset, saving, error],
  );

  return (
    <AppearanceContext.Provider value={value}>
      {/* "always" drops movement but keeps fades; "user" follows the OS setting. */}
      <MotionConfig reducedMotion={appearance.motion === 'reduced' ? 'always' : 'user'}>
        {children}
      </MotionConfig>
    </AppearanceContext.Provider>
  );
}

export function useAppearance(): AppearanceState {
  const ctx = useContext(AppearanceContext);
  if (!ctx) throw new Error('useAppearance must be used inside <AppearanceProvider>');
  return ctx;
}
