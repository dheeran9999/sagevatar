import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../../auth/AuthContext';
import { api, type CreatorDashboard } from '../../lib/api';
import { timeLabel } from '../../components/notification-parts';
import { EmptyState, ErrorText, Pill, Skeleton } from '../../components/ui';
import {
  IconAlert,
  IconCake,
  IconCalendar,
  IconCamera,
  IconImage,
  IconLayers,
  IconSparkles,
  IconUsers,
} from '../../components/icons';
import { StatusBadge } from '../events/shared';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type Stat = { key: keyof CreatorDashboard['stats']; label: string; icon: ComponentType<{ size?: number }>; to: string };

const STATS: Stat[] = [
  { key: 'totalEmployees', label: 'Total employees', icon: IconUsers, to: '/creator/employees' },
  { key: 'activeEmployees', label: 'Active employees', icon: IconUsers, to: '/creator/employees' },
  { key: 'avatarAssets', label: 'Avatar assets', icon: IconLayers, to: '/creator/library' },
  { key: 'aiGenerated', label: 'AI-generated avatars', icon: IconSparkles, to: '/creator/analytics' },
  { key: 'photoCreations', label: 'Photo creations', icon: IconImage, to: '/creator/analytics' },
  { key: 'totalEvents', label: 'Total events', icon: IconCalendar, to: '/events' },
  { key: 'activeEvents', label: 'Active events', icon: IconCalendar, to: '/events' },
  { key: 'upcomingEvents', label: 'Upcoming events', icon: IconCalendar, to: '/events' },
  { key: 'eventPhotos', label: 'Event photographs', icon: IconCamera, to: '/events' },
  { key: 'recognitionPosters', label: 'Recognition posters', icon: IconCake, to: '/recognition' },
];

function Feed({ title, to, empty, children }: { title: string; to: string; empty: boolean; children: ReactNode }) {
  return (
    <section className="glass flex flex-col gap-3 p-5">
      <header className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{title}</h2>
        <Link to={to} className="text-xs text-brand-2 hover:underline">
          View all
        </Link>
      </header>
      {empty ? <p className="text-sm text-text-muted">Nothing yet.</p> : <ul className="flex flex-col gap-1">{children}</ul>}
    </section>
  );
}

const Row = ({ to, children }: { to?: string | null; children: ReactNode }) =>
  to ? (
    <li>
      <Link to={to} className="flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-fg/5">
        {children}
      </Link>
    </li>
  ) : (
    <li className="flex items-center gap-3 rounded-xl px-2 py-1.5">{children}</li>
  );

/** Creator Dashboard: organisation-wide counts and recent activity. */
export default function DashboardPage() {
  const { user } = useAuth();
  const [d, setD] = useState<CreatorDashboard | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = () =>
      api.creator
        .dashboard()
        .then((r) => (r?.stats && r.recent ? setD(r) : setError('The dashboard returned no data.')))
        .catch((e: Error) => setError(e.message));
    void load();
    const t = window.setInterval(load, 60_000);
    return () => window.clearInterval(t);
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <header className="px-1">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-2">Creator Dashboard</p>
        <h1 className="text-2xl font-semibold sm:text-3xl">Welcome back{user ? `, ${user.name.split(' ')[0]}` : ''}</h1>
      </header>
      {error && !d ? (
        <EmptyState icon={<IconAlert size={22} />} title="Couldn’t load the dashboard">
          {error}
        </EmptyState>
      ) : (
        <ErrorText>{error}</ErrorText>
      )}

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-label="Key numbers">
        {STATS.map((s, i) => (
          <motion.li key={s.key} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0, transition: { delay: i * 0.03 } }}>
            <Link to={s.to} className="glass flex h-full flex-col gap-2 !rounded-2xl p-4 transition hover:-translate-y-0.5">
              <span className="flex items-center justify-between text-text-dim">
                <span className="text-xs">{s.label}</span>
                <s.icon size={16} />
              </span>
              {d ? (
                <span className="text-3xl font-semibold tabular-nums">{d.stats[s.key].toLocaleString()}</span>
              ) : (
                <Skeleton className="h-9 w-16" />
              )}
            </Link>
          </motion.li>
        ))}
      </ul>

      {!d ? (
        !error && <div className="grid gap-5 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-64 !rounded-3xl" />)}</div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          <Feed title="Recently registered employees" to="/creator/employees" empty={!d.recent.employees.length}>
            {d.recent.employees.map((u) => (
              <Row key={u.id} to={`/creator/employees?user=${u.id}`}>
                <span className="bg-gradient-brand grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold text-white">
                  {u.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{u.name}</span>
                  <span className="block truncate text-xs text-text-dim">{u.employeeCode ?? u.email}</span>
                </span>
                <Pill tone={u.status === 'ACTIVE' ? 'ok' : 'warn'}>
                  {u.status === 'ACTIVE' ? 'Active' : u.status === 'INVITE_PENDING' ? 'Invited' : 'Deactivated'}
                </Pill>
              </Row>
            ))}
          </Feed>

          <Feed title="Recently created events" to="/events" empty={!d.recent.events.length}>
            {d.recent.events.map((e) => (
              <Row key={e.id} to={`/events/${e.id}`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{e.name}</span>
                  <span className="block truncate text-xs text-text-dim">
                    {e.eventDate} · {plural(e.participants, 'person', 'people')} · {plural(e.photos, 'photo')}
                  </span>
                </span>
                <StatusBadge status={e.status} />
              </Row>
            ))}
          </Feed>

          <Feed title="Employee photo creations" to="/creator/employees" empty={!d.recent.creations.length}>
            {d.recent.creations.map((c) => (
              <Row key={c.id} to={c.link}>
                <img src={`/api/creator/creations/${c.id}/image/result`} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" loading="lazy" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">
                    {c.owner.name}
                    {c.owner.role === 'CREATOR' && <span className="text-text-dim"> (Creator)</span>}
                  </span>
                  <span className="block truncate text-xs text-text-dim">
                    {c.kind === 'poster' ? 'Recognition poster' : (c.avatar ?? 'No avatar')} · {timeLabel(c.createdAt)}
                  </span>
                </span>
              </Row>
            ))}
          </Feed>

          <Feed title="Generated recognition posters" to="/recognition" empty={!d.recent.posters.length}>
            {d.recent.posters.map((p) => (
              <Row key={p.id} to={p.link}>
                <img src={`/api/posters/${p.id}/thumb`} alt="" className="h-9 w-12 shrink-0 rounded-lg object-cover" loading="lazy" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{p.title}</span>
                  <span className="block truncate text-xs text-text-dim">
                    {plural(p.people, 'person', 'people')} · by {p.createdBy}
                    {p.event ? ` · ${p.event}` : ''} · {timeLabel(p.createdAt)}
                  </span>
                </span>
                {p.official && <Pill tone="brand">Official</Pill>}
              </Row>
            ))}
          </Feed>

          <Feed title="Recent avatar uploads" to="/creator/library" empty={!d.recent.avatars.length}>
            {d.recent.avatars.map((a) => (
              <Row key={a.id} to="/creator/library">
                {a.thumbnailUrl ? (
                  <img src={a.thumbnailUrl} alt="" className="h-9 w-9 shrink-0 rounded-lg bg-glass object-contain" loading="lazy" />
                ) : (
                  <span className="h-9 w-9 shrink-0 rounded-lg bg-glass" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{a.name}</span>
                  <span className="block truncate text-xs text-text-dim">
                    {a.category} · by {a.createdBy} · {timeLabel(a.createdAt)}
                  </span>
                </span>
                {!a.isActive && <Pill tone="warn">Inactive</Pill>}
              </Row>
            ))}
          </Feed>

          <Feed title="Recent event activity" to="/events" empty={!d.recent.eventActivity.length}>
            {d.recent.eventActivity.map((a) => (
              <Row key={a.id} to={a.link}>
                <span className="min-w-0 flex-1 text-sm">
                  <span className="font-medium">{a.actor}</span> {a.text} <span className="font-medium">{a.event ?? 'an event'}</span>
                  <span className="block text-xs text-text-dim">{timeLabel(a.at)}</span>
                </span>
              </Row>
            ))}
          </Feed>
        </div>
      )}
    </div>
  );
}
