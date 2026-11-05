import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, type AppNotification } from '../lib/api';

/**
 * The signed-in user's notifications, live.
 *
 *  - One Server-Sent Events stream per tab: new notifications arrive instantly and pop up.
 *  - If the stream can't stay open, it falls back to polling every 20 s (and keeps retrying the
 *    stream); anything that arrived while disconnected is picked up and shown.
 *  - Read state is the server's; marking read in one tab updates the others.
 */
export interface LiveNotificationsApi {
  items: AppNotification[];
  unread: number;
  /** Notifications that should currently show as popups. */
  popups: AppNotification[];
  dismissPopup: (id: string) => void;
  markRead: (ids: string[]) => Promise<void>;
  markAllRead: () => Promise<void>;
  refresh: () => Promise<void>;
  live: 'connecting' | 'live' | 'polling';
}

const Ctx = createContext<LiveNotificationsApi | null>(null);
const POLL_MS = 20_000;

export function LiveNotificationsProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [popups, setPopups] = useState<AppNotification[]>([]);
  const [live, setLive] = useState<LiveNotificationsApi['live']>('connecting');
  const seen = useRef(new Set<string>());
  const [loadedAt] = useState(() => Date.now());

  const merge = useCallback((incoming: AppNotification[], popupNew: boolean) => {
    const fresh = incoming.filter((n) => !seen.current.has(n.id));
    fresh.forEach((n) => seen.current.add(n.id));
    if (fresh.length) {
      setItems((prev) => [...fresh, ...prev.filter((p) => !fresh.some((f) => f.id === p.id))].slice(0, 50));
      if (popupNew) {
        // Only things that happened after this page loaded pop up; older unread wait in the bell.
        const newer = fresh.filter((n) => !n.readAt && new Date(n.createdAt).getTime() >= loadedAt - 5_000);
        if (newer.length) setPopups((prev) => [...newer.reverse(), ...prev].slice(0, 4));
      }
    }
  }, [loadedAt]);

  const refresh = useCallback(async () => {
    try {
      const r = await api.notifications.list({ take: 30 });
      merge(r.items, seen.current.size > 0);
      setItems((prev) => prev.map((p) => r.items.find((x) => x.id === p.id) ?? p));
      setUnread(r.unread);
    } catch {
      /* next attempt will retry */
    }
  }, [merge]);

  useEffect(() => {
    let es: EventSource | null = null;
    let poll = 0;
    let retry = 0;
    let closed = false;

    const startPolling = () => {
      if (poll) return;
      setLive('polling');
      poll = window.setInterval(() => void refresh(), POLL_MS);
    };
    const stopPolling = () => {
      window.clearInterval(poll);
      poll = 0;
    };

    const connect = () => {
      if (closed || typeof EventSource === 'undefined') return startPolling();
      es = new EventSource(api.notifications.streamUrl, { withCredentials: true });
      es.addEventListener('hello', (e) => {
        setLive('live');
        stopPolling();
        setUnread(JSON.parse((e as MessageEvent).data).unread);
        void refresh(); // catch up on anything missed while disconnected
      });
      es.addEventListener('notification', (e) => {
        const { notification, unread: u } = JSON.parse((e as MessageEvent).data) as {
          notification: AppNotification;
          unread: number;
        };
        merge([notification], true);
        setUnread(u);
      });
      es.addEventListener('read', (e) => {
        const { ids, all, unread: u } = JSON.parse((e as MessageEvent).data) as { ids?: string[]; all?: boolean; unread: number };
        const now = new Date().toISOString();
        setItems((prev) => prev.map((n) => (all || ids?.includes(n.id) ? { ...n, readAt: n.readAt ?? now } : n)));
        setPopups((prev) => prev.filter((n) => !(all || ids?.includes(n.id))));
        setUnread(u);
      });
      es.onerror = () => {
        es?.close();
        startPolling();
        retry = window.setTimeout(connect, 15_000);
      };
    };

    // Start after the current render; the first load seeds the list without popups.
    const start = window.setTimeout(() => void refresh().then(connect), 0);
    return () => {
      closed = true;
      window.clearTimeout(start);
      es?.close();
      stopPolling();
      window.clearTimeout(retry);
    };
  }, [merge, refresh]);

  const markRead = useCallback(async (ids: string[]) => {
    const todo = ids.filter((id) => items.find((n) => n.id === id && !n.readAt));
    setPopups((prev) => prev.filter((n) => !ids.includes(n.id)));
    if (!todo.length) return;
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => (todo.includes(n.id) ? { ...n, readAt: now } : n)));
    const r = await api.notifications.read(todo);
    setUnread(r.unread);
  }, [items]);

  const markAllRead = useCallback(async () => {
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? now })));
    setPopups([]);
    const r = await api.notifications.readAll();
    setUnread(r.unread);
  }, []);

  const dismissPopup = useCallback((id: string) => setPopups((prev) => prev.filter((n) => n.id !== id)), []);

  const value = useMemo(
    () => ({ items, unread, popups, dismissPopup, markRead, markAllRead, refresh, live }),
    [items, unread, popups, dismissPopup, markRead, markAllRead, refresh, live],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLiveNotifications(): LiveNotificationsApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLiveNotifications must be used inside <LiveNotificationsProvider>');
  return v;
}

/** The action button for each notification type. */
export function actionLabel(n: AppNotification) {
  switch (n.type) {
    case 'EVENT_ASSIGNED':
    case 'EVENT_UPDATED':
    case 'EVENT_CANCELLED':
    case 'EVENT_COMPLETED':
      return 'Open Event';
    case 'PHOTO_CREATED':
      return 'View Creation';
    case 'POSTER_SHARED':
    case 'POSTER_CREATED':
      return 'Open Poster';
    case 'AI_GENERATION_DONE':
      return 'Open Studio';
    case 'EMPLOYEE_JOINED':
    case 'AI_GENERATION_ACTIVITY':
      return 'View Employee';
    default:
      return 'Open';
  }
}
