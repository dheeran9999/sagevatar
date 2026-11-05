import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { api, type AppNotification, type NotificationCategory } from '../lib/api';
import { actionLabel, useLiveNotifications } from '../components/live-notifications';
import { CATEGORY_LABEL, CategoryIcon, timeLabel } from '../components/notification-parts';
import { Button, EmptyState, ErrorText, Pill, Skeleton } from '../components/ui';
import { IconBell, IconCheck } from '../components/icons';

/** Categories each role cares about (both roles only ever see their own notifications). */
const CREATOR_TABS: NotificationCategory[] = ['photo', 'ai', 'event', 'poster', 'account'];
const EMPLOYEE_TABS: NotificationCategory[] = ['event', 'poster', 'ai', 'account'];

/** Notification Center: full history, filters, open, mark read. */
export default function NotificationsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { unread, markRead, markAllRead, items: liveItems } = useLiveNotifications();
  const tabs = can('employee.manage') ? CREATOR_TABS : EMPLOYEE_TABS;
  const [category, setCategory] = useState<NotificationCategory | undefined>();
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(
    async (before?: string) => {
      try {
        const r = await api.notifications.list({ category, unread: onlyUnread, before, take: 25 });
        setItems((prev) => (before ? [...(prev ?? []), ...r.items] : r.items));
        setHasMore(r.hasMore);
        setError('');
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [category, onlyUnread],
  );
  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  // New live notifications (and read changes) show without a refresh.
  const shown = useMemo(() => {
    if (!items) return null;
    const add = liveItems.filter(
      (n) =>
        !items.some((p) => p.id === n.id) &&
        new Date(n.createdAt) > new Date(items[0]?.createdAt ?? 0) &&
        (!category || n.category === category) &&
        (!onlyUnread || !n.readAt),
    );
    return [...add, ...items.map((p) => liveItems.find((l) => l.id === p.id) ?? p)];
  }, [items, liveItems, category, onlyUnread]);

  const open = async (n: AppNotification) => {
    await markRead([n.id]);
    if (n.link) navigate(n.link);
  };

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-2">Notification Center</p>
          <h1 className="text-2xl font-semibold sm:text-3xl">Notifications</h1>
          <p className="text-sm text-text-muted">{unread ? `${unread} unread` : 'All caught up'}</p>
        </div>
        <Button variant="subtle" icon={<IconCheck size={16} />} disabled={!unread} onClick={() => void markAllRead().then(() => load())}>
          Mark all read
        </Button>
      </header>

      <div className="glass no-scrollbar flex flex-wrap items-center gap-1 !rounded-full p-1.5">
        {[undefined, ...tabs].map((c) => (
          <button
            key={c ?? 'all'}
            onClick={() => setCategory(c)}
            aria-pressed={category === c}
            className={`rounded-full px-4 py-2 text-sm transition-colors ${
              category === c ? 'bg-gradient-brand text-white' : 'text-text-muted hover:text-text'
            }`}
          >
            {c ? CATEGORY_LABEL[c] : 'All'}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 px-3 text-sm text-text-muted">
          <input type="checkbox" checked={onlyUnread} onChange={(e) => setOnlyUnread(e.target.checked)} /> Unread only
        </label>
      </div>

      <ErrorText>{error}</ErrorText>
      {shown === null ? (
        <div className="flex flex-col gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 !rounded-2xl" />)}</div>
      ) : shown.length === 0 ? (
        <EmptyState icon={<IconBell size={22} />} title="Nothing here yet">
          {onlyUnread ? 'No unread notifications.' : 'Notifications about your events, photos and recognitions will appear here.'}
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((n) => (
            <li key={n.id} className={`glass flex gap-4 !rounded-2xl p-4 ${n.readAt ? 'opacity-80' : ''}`}>
              <CategoryIcon category={n.category} size={40} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className={`text-sm ${n.readAt ? '' : 'font-semibold'}`}>{n.title}</p>
                  {!n.readAt && <Pill tone="brand">New</Pill>}
                  <Pill>{CATEGORY_LABEL[n.category] ?? n.category}</Pill>
                </div>
                <p className="mt-0.5 text-sm text-text-muted">{n.body}</p>
                {n.data && (
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs sm:grid-cols-[auto_1fr_auto_1fr]">
                    {Object.entries(n.data).map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-text-dim">{k}</dt>
                        <dd className="truncate">{v}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-text-dim">
                    {timeLabel(n.createdAt)}
                    {n.actor && ` · from ${n.actor.name}`}
                  </span>
                  <span className="flex-1" />
                  {!n.readAt && (
                    <Button size="sm" variant="ghost" onClick={() => void markRead([n.id])}>
                      Mark as read
                    </Button>
                  )}
                  {n.link && (
                    <Button size="sm" onClick={() => void open(n)}>
                      {actionLabel(n)}
                    </Button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {hasMore && items && (
        <Button variant="subtle" className="self-center" onClick={() => void load(items[items.length - 1].id)}>
          Load older notifications
        </Button>
      )}
    </div>
  );
}
