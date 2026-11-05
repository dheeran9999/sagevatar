import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { IconX } from './icons';
import {
  HISTORY_MAX,
  NotificationsContext,
  TONE,
  ToastContext,
  type NotificationItem,
  type NotificationsApi,
  type Toast,
  type ToastApi,
  type Tone,
} from './toast-context';

const DURATION = 4200;

/** Glass notification stack (bottom-right desktop, top on mobile). Announced politely to screen readers. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [history, setHistory] = useState<NotificationItem[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const notify = useCallback(
    (tone: Tone, title: string, message?: string) => {
      const id = ++seq.current;
      setToasts((t) => [...t.slice(-3), { id, tone, title, message }]);
      setHistory((h) =>
        [{ id, tone, title, message, at: Date.now(), read: false }, ...h].slice(0, HISTORY_MAX),
      );
      setTimeout(() => dismiss(id), tone === 'error' ? DURATION * 1.5 : DURATION);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      notify,
      success: (t, m) => notify('success', t, m),
      error: (t, m) => notify('error', t, m),
      info: (t, m) => notify('info', t, m),
    }),
    [notify],
  );

  const notifications = useMemo<NotificationsApi>(
    () => ({
      items: history,
      unread: history.filter((n) => !n.read).length,
      markAllRead: () => setHistory((h) => h.map((n) => (n.read ? n : { ...n, read: true }))),
      clear: () => setHistory([]),
    }),
    [history],
  );

  return (
    <ToastContext.Provider value={api}>
      <NotificationsContext.Provider value={notifications}>
        {children}
      </NotificationsContext.Provider>
      <div
        aria-live="polite"
        aria-relevant="additions"
        className="pointer-events-none fixed inset-x-3 top-3 z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:bottom-5 sm:right-5 sm:top-auto sm:items-end"
      >
        <AnimatePresence initial={false}>
          {toasts.map((t) => {
            const s = TONE[t.tone];
            const Icon = s.icon;
            return (
              <motion.div
                key={t.id}
                layout
                role={t.tone === 'error' ? 'alert' : 'status'}
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 40, scale: 0.95, transition: { duration: 0.2 } }}
                transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                className="glass glass-popover pointer-events-auto relative flex w-full max-w-sm items-start gap-3 overflow-hidden !rounded-2xl p-3.5 pr-10"
              >
                <span
                  className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl border ${s.ring}`}
                >
                  <Icon size={16} />
                </span>
                <div className="min-w-0 pt-0.5">
                  <p className="text-sm font-medium">{t.title}</p>
                  {t.message && (
                    <p className="mt-0.5 break-words text-xs text-text-muted">{t.message}</p>
                  )}
                </div>
                <button
                  onClick={() => dismiss(t.id)}
                  aria-label="Dismiss notification"
                  className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-lg text-text-dim transition hover:bg-glass hover:text-text"
                >
                  <IconX size={14} />
                </button>
                <motion.span
                  className={`absolute bottom-0 left-0 h-0.5 ${s.bar} opacity-60`}
                  initial={{ width: '100%' }}
                  animate={{ width: '0%' }}
                  transition={{
                    duration: (t.tone === 'error' ? DURATION * 1.5 : DURATION) / 1000,
                    ease: 'linear',
                  }}
                />
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
