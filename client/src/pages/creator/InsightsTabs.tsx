import { useEffect, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { api, type Analytics, type AuditEntry } from '../../lib/api';
import { Select } from '../../components/Select';
import { ErrorText, OrbitLoader, Panel, Pill } from '../../components/ui';
import { IconCamera, IconMail, IconUsers, IconSparkles } from '../../components/icons';

function Stat({
  label,
  value,
  sub,
  icon,
  i,
}: {
  label: string;
  value: number;
  sub?: string;
  icon: ReactNode;
  i: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0, transition: { delay: i * 0.05 } }}
      className="glass glass-interactive p-4 sm:p-5"
    >
      <div className="flex items-center justify-between text-xs text-text-muted">
        {label}
        <span className="grid h-8 w-8 place-items-center rounded-xl border border-glass-border bg-glass text-brand-2">
          {icon}
        </span>
      </div>
      <div className="font-display mt-2 text-3xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-xs text-text-dim">{sub}</div>}
    </motion.div>
  );
}

export function AnalyticsTab() {
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.creator
      .analytics()
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <ErrorText>{error}</ErrorText>;
  if (!data) return <OrbitLoader label="Crunching numbers…" />;

  const days = Object.entries(data.creations.perDay);
  const max = Math.max(1, ...days.map(([, n]) => n));

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat
          i={0}
          icon={<IconUsers size={16} />}
          label="Employees"
          value={data.users.employees}
          sub={`${data.users.pendingInvites} invites pending`}
        />
        <Stat
          i={1}
          icon={<IconSparkles size={16} />}
          label="Signed in (7 days)"
          value={data.users.activeUsers7d}
        />
        <Stat
          i={2}
          icon={<IconCamera size={16} />}
          label="Photos created"
          value={data.creations.total}
          sub={`${data.creations.last7Days} in the last 7 days`}
        />
        <Stat
          i={3}
          icon={<IconMail size={16} />}
          label="Emails sent"
          value={data.emails.SENT}
          sub={`${data.emails.FAILED} failed`}
        />
      </div>
      <Panel title="Photos per day" subtitle="Last 14 days">
        <div
          className="flex h-36 items-end gap-1.5"
          role="img"
          aria-label="Photos created per day over the last 14 days"
        >
          {days.map(([day, n], i) => (
            <div key={day} className="group relative flex h-full flex-1 items-end">
              <motion.div
                initial={{ scaleY: 0 }}
                animate={{ scaleY: 1 }}
                transition={{ delay: i * 0.03, type: 'spring', stiffness: 200, damping: 24 }}
                style={{ height: `${Math.max(4, (n / max) * 100)}%`, transformOrigin: 'bottom' }}
                className="w-full rounded-t-lg bg-gradient-to-t from-brand/70 to-brand-2/80 opacity-80 transition-opacity group-hover:opacity-100"
                title={`${day}: ${n}`}
              />
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-between text-[11px] text-text-dim">
          <span>{days[0]?.[0]}</span>
          <span>{days.at(-1)?.[0]}</span>
        </div>
      </Panel>
      <Panel title="Most used avatars">
        {!data.topAvatars.length && (
          <p className="text-sm text-text-muted">No photos created yet.</p>
        )}
        <ul className="flex flex-wrap gap-3">
          {data.topAvatars.map((a) => (
            <li key={a.id} className="glass-subtle flex items-center gap-2 px-3 py-2 text-sm">
              {a.thumbnailUrl && (
                <img src={a.thumbnailUrl} alt="" className="h-8 w-8 object-contain" />
              )}
              {a.name ?? 'Removed avatar'} <Pill tone="brand">{a.uses}</Pill>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

const ACTIONS = [
  'AUTH_LOGIN_SUCCESS',
  'AUTH_LOGIN_FAILED',
  'AUTH_LOCKED_OUT',
  'ACCESS_DENIED',
  'EMPLOYEE_INVITED',
  'USER_DEACTIVATED',
  'AVATAR_CREATED',
  'AVATAR_UPDATED',
  'CATEGORY_UPDATED',
  'TEMPLATE_CREATED',
  'CREATION_CREATED',
  'CREATION_DELETED',
];

export function AuditTab() {
  const [items, setItems] = useState<AuditEntry[] | null>(null);
  const [action, setAction] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    api.creator
      .audit(action || undefined)
      .then((r) => setItems(r.items))
      .catch((e: Error) => setError(e.message));
  }, [action]);

  return (
    <Panel
      title="Audit log"
      subtitle="Sign-ins, denied access and every library or account change."
      actions={
        <Select
          label="Filter by action"
          hideLabel
          value={action}
          onChange={setAction}
          options={[
            { value: '', label: 'All actions' },
            ...ACTIONS.map((a) => ({ value: a, label: a.replaceAll('_', ' ').toLowerCase() })),
          ]}
        />
      }
    >
      <ErrorText>{error}</ErrorText>
      {items === null && !error ? (
        <OrbitLoader />
      ) : (
        <ol className="relative flex flex-col gap-1 border-l border-glass-border pl-5">
          {items?.map((e, i) => {
            const bad = /DENIED|FAILED|LOCKED|DEACTIVATED/.test(e.action);
            return (
              <motion.li
                key={e.id}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0, transition: { delay: Math.min(i, 15) * 0.015 } }}
                className="relative flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-3 py-2 transition-colors hover:bg-glass"
              >
                <span
                  className={`absolute -left-[25px] top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full ring-4 ring-ink ${bad ? 'bg-accent' : 'bg-brand-2'}`}
                />
                <Pill tone={bad ? 'warn' : 'neutral'}>
                  {e.action.replaceAll('_', ' ').toLowerCase()}
                </Pill>
                <span className="text-sm">
                  {e.actor ? e.actor.name : <span className="text-text-dim">System</span>}
                </span>
                {e.entityType && (
                  <span className="text-xs text-text-dim">
                    {e.entityType} · {e.entityId?.slice(0, 8)}
                  </span>
                )}
                <span className="ml-auto text-xs tabular-nums text-text-dim">
                  {new Date(e.createdAt).toLocaleString()}
                </span>
              </motion.li>
            );
          })}
          {items?.length === 0 && (
            <li className="py-6 text-sm text-text-muted">Nothing recorded yet.</li>
          )}
        </ol>
      )}
    </Panel>
  );
}
