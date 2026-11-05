import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { TONE, useNotifications } from './toast-context';
import { actionLabel, useLiveNotifications } from './live-notifications';
import { CategoryIcon, timeLabel } from './notification-parts';
import { IconBell } from './icons';

/**
 * Header bell: the user's own notifications from the server (live), plus this browser session's
 * activity messages. Opening it doesn't mark anything read — clicking an item, or "Mark all
 * read", does.
 */
export function NotificationBell() {
  const { items: session, unread: sessionUnread, markAllRead: markSessionRead, clear } = useNotifications();
  const { items, unread, markRead, markAllRead, live } = useLiveNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  // The session helper changes identity on every update; call it through a ref.
  const markSessionReadRef = useRef(markSessionRead);
  useEffect(() => {
    markSessionReadRef.current = markSessionRead;
  });

  useEffect(() => {
    if (!open) return;
    markSessionReadRef.current(); // local activity messages are informational only
    const close = (e: PointerEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const total = unread + sessionUnread;
  const recent = items.slice(0, 12);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={total ? `Notifications, ${total} unread` : 'Notifications'}
        className="relative grid h-10 w-10 place-items-center rounded-full text-text-muted transition hover:bg-glass hover:text-text"
      >
        <motion.span key={unread} animate={unread ? { rotate: [0, -14, 12, -8, 0] } : { rotate: 0 }} transition={{ duration: 0.6 }}>
          <IconBell size={19} />
        </motion.span>
        <AnimatePresence>
          {total > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              className="bg-gradient-brand absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-semibold text-white"
            >
              {total > 9 ? '9+' : total}
            </motion.span>
          )}
        </AnimatePresence>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="Notifications"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 500, damping: 34 }}
            style={{ transformOrigin: 'top right' }}
            className="glass glass-popover absolute right-0 z-40 mt-2 w-[min(24rem,calc(100vw-1.5rem))] !rounded-2xl p-2"
          >
            <div className="flex items-center justify-between gap-2 px-2 py-1.5">
              <span className="text-sm font-semibold">
                Notifications {unread > 0 && <span className="text-text-dim">· {unread} unread</span>}
              </span>
              <span className="flex items-center gap-3">
                {live !== 'live' && <span className="text-[10px] text-text-dim" title="Live updates reconnecting; checking every 20 s">{live}</span>}
                {unread > 0 && (
                  <button onClick={() => void markAllRead()} className="text-xs text-brand-2 hover:underline">
                    Mark all read
                  </button>
                )}
              </span>
            </div>
            {recent.length === 0 && session.length === 0 ? (
              <p className="px-2 pb-3 pt-1 text-sm text-text-muted">You’re all caught up.</p>
            ) : (
              <ul className="flex max-h-[26rem] flex-col gap-1 overflow-y-auto">
                {recent.map((n) => (
                  <li key={n.id}>
                    <button
                      onClick={() => {
                        void markRead([n.id]);
                        setOpen(false);
                        if (n.link) navigate(n.link);
                      }}
                      className={`flex w-full gap-3 rounded-xl px-2 py-2 text-left hover:bg-fg/5 ${n.readAt ? 'opacity-75' : ''}`}
                    >
                      <CategoryIcon category={n.category} size={30} />
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm ${n.readAt ? '' : 'font-semibold'}`}>{n.title}</p>
                        <p className="line-clamp-2 text-xs text-text-muted">{n.body}</p>
                        <p className="mt-0.5 text-[11px] text-text-dim">
                          {timeLabel(n.createdAt)}
                          {n.link && <span className="text-brand-2"> · {actionLabel(n)}</span>}
                        </p>
                      </div>
                      {!n.readAt && <span aria-label="Unread" className="bg-gradient-brand mt-1.5 h-2 w-2 shrink-0 rounded-full" />}
                    </button>
                  </li>
                ))}
                {session.length > 0 && (
                  <li className="flex items-center justify-between px-2 pt-2 text-[11px] uppercase tracking-wider text-text-dim">
                    This session
                    <button onClick={clear} className="normal-case tracking-normal hover:text-text">Clear</button>
                  </li>
                )}
                {session.map((n) => {
                  const t = TONE[n.tone];
                  return (
                    <li key={n.id} className="flex gap-3 rounded-xl px-2 py-2">
                      <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border ${t.ring}`}>
                        <t.icon size={14} />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm">{n.title}</p>
                        {n.message && <p className="text-xs text-text-muted">{n.message}</p>}
                        <p className="mt-0.5 text-[11px] text-text-dim">{timeLabel(new Date(n.at).toISOString())}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <Link
              to="/notifications"
              onClick={() => setOpen(false)}
              className="mt-1 block rounded-xl px-2 py-2 text-center text-sm text-brand-2 hover:bg-fg/5"
            >
              Open Notification Center
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
