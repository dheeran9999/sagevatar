import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import type { AppNotification } from '../lib/api';
import { actionLabel, useLiveNotifications } from './live-notifications';
import { CategoryIcon, timeLabel } from './notification-parts';
import { IconX } from './icons';
import { useAppearance } from '../auth/AppearanceContext';
import { DEFAULT_APPEARANCE, type NotificationPrefs } from '../lib/appearance';

/** Notification category → the preference that controls its pop-up. */
const PREF: Record<AppNotification['category'], keyof NotificationPrefs> = {
  event: 'events',
  photo: 'creations',
  ai: 'aiAvatars',
  poster: 'recognition',
  account: 'account',
};

const AUTO_DISMISS_MS = 9_000;

/**
 * Real-time notification popups: top-right, under the header, never covering the middle of the
 * screen (the camera stage) and never blocking clicks outside the cards.
 */
export function LiveToasts() {
  const { popups, dismissPopup, markRead } = useLiveNotifications();
  const prefs = useAppearance().appearance.notifications ?? DEFAULT_APPEARANCE.notifications;
  // Pop-ups follow the person's notification preferences; the Notifications page keeps everything.
  const shown = prefs.popups ? popups.filter((n) => prefs[PREF[n.category] ?? 'events'] !== false) : [];
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-3 top-[5.5rem] z-[70] flex w-[min(24rem,calc(100vw-1.5rem))] flex-col gap-2 sm:right-5"
    >
      <AnimatePresence initial={false}>
        {shown.slice(0, 3).map((n) => (
          <LiveToast key={n.id} n={n} onClose={() => dismissPopup(n.id)} onOpen={() => markRead([n.id])} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function LiveToast({ n, onClose, onOpen }: { n: AppNotification; onClose: () => void; onOpen: () => void }) {
  const navigate = useNavigate();
  const [paused, setPaused] = useState(false);
  const left = useRef(AUTO_DISMISS_MS);
  const started = useRef(0);

  useEffect(() => {
    if (paused) return;
    started.current = Date.now();
    const t = window.setTimeout(onClose, left.current);
    return () => {
      window.clearTimeout(t);
      left.current -= Date.now() - started.current;
    };
  }, [paused, onClose]);

  const details = Object.entries(n.data ?? {}).slice(0, 6);
  return (
    <motion.div
      layout
      role="status"
      initial={{ opacity: 0, x: 40, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 40, scale: 0.96, transition: { duration: 0.18 } }}
      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="glass-strong pointer-events-auto relative overflow-hidden !rounded-2xl p-4 pr-10 shadow-[var(--shadow-glow)]"
    >
      <div className="flex gap-3">
        <CategoryIcon category={n.category} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{n.title}</p>
          <p className="mt-0.5 text-sm text-text-muted">{n.body}</p>
          {details.length > 0 && (
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">
              {details.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-text-dim">{k}</dt>
                  <dd className="truncate text-text">{v}</dd>
                </div>
              ))}
            </dl>
          )}
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="text-[11px] text-text-dim">{timeLabel(n.createdAt)}</span>
            {n.link && (
              <button
                onClick={() => {
                  onOpen();
                  navigate(n.link!);
                }}
                className="bg-gradient-brand rounded-full px-3 py-1.5 text-xs font-semibold text-white shadow-[var(--shadow-glow)] transition hover:-translate-y-0.5"
              >
                {actionLabel(n)}
              </button>
            )}
          </div>
        </div>
      </div>
      <button
        onClick={onClose}
        aria-label="Close notification"
        className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-lg text-text-dim transition hover:bg-glass hover:text-text"
      >
        <IconX size={14} />
      </button>
      <motion.span
        aria-hidden
        className="bg-gradient-brand absolute bottom-0 left-0 h-0.5"
        initial={{ width: '100%' }}
        animate={{ width: paused ? undefined : '0%' }}
        transition={{ duration: AUTO_DISMISS_MS / 1000, ease: 'linear' }}
      />
    </motion.div>
  );
}
