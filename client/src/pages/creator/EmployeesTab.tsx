import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { EmployeeProfileDialog } from './EmployeeProfileDialog';
import { AnimatePresence, motion } from 'framer-motion';
import { api, type Invite, type ManagedUser } from '../../lib/api';
import { useToast } from '../../components/toast-context';
import { Button, Field, OrbitLoader, Panel, Pill } from '../../components/ui';
import { IconCheck, IconLink, IconMail, IconSearch } from '../../components/icons';
import { inputClass } from '../../components/ui';

export default function EmployeesTab() {
  const toast = useToast();
  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [invite, setInvite] = useState<(Invite & { email: string }) | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [params, setParams] = useSearchParams();
  // ?user=<id> (e.g. from a notification) opens that employee's profile.
  const profileId = params.get('user');
  const openProfile = (id: string | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (id) next.set('user', id);
        else next.delete('user');
        return next;
      },
      { replace: true },
    );

  const load = useCallback(
    () =>
      api.creator
        .users(q.trim() || undefined)
        .then(setUsers)
        .catch((e: Error) => toast.error('Could not load people', e.message)),
    [toast, q],
  );
  useEffect(() => {
    const t = window.setTimeout(() => void load(), 200);
    return () => window.clearTimeout(t);
  }, [load]);

  const act = async (key: string, fn: () => Promise<unknown>, success?: string) => {
    setBusy(key);
    try {
      await fn();
      if (success) toast.success(success);
      await load();
    } catch (e) {
      toast.error('Something went wrong', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    act(
      'invite',
      async () => {
        const r = await api.creator.invite(email, name);
        setInvite({ ...r, email: r.user.email });
        setCopied(false);
        setEmail('');
        setName('');
      },
      'Invitation created',
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <Panel title="Invite an employee" subtitle="Invited people always join as Employees.">
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field
            label="Full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <Field
            label="Work email"
            type="email"
            icon={<IconMail size={16} />}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Button type="submit" size="lg" loading={busy === 'invite'} disabled={!email || !name}>
            Create invite
          </Button>
        </form>
        <AnimatePresence>
          {invite && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-4 rounded-2xl border border-brand-2/30 bg-brand-2/[0.07] p-4 text-sm">
                <p className="mb-3 flex items-start gap-2">
                  <IconLink size={16} className="mt-0.5 shrink-0 text-brand-2" />
                  <span>
                    One-time link for <strong>{invite.email}</strong> · expires{' '}
                    {new Date(invite.expiresAt).toLocaleString()}. Share it privately — email
                    delivery isn’t configured yet.
                  </span>
                </p>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={invite.inviteUrl}
                    aria-label="Invite link"
                    onFocus={(e) => e.currentTarget.select()}
                    className="min-w-0 flex-1 rounded-full border border-glass-border bg-ink/60 px-4 py-2 font-mono text-xs"
                  />
                  <Button
                    variant="ghost"
                    icon={copied ? <IconCheck size={15} /> : undefined}
                    onClick={async () => {
                      await navigator.clipboard.writeText(invite.inviteUrl);
                      setCopied(true);
                      toast.success('Link copied');
                    }}
                  >
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Panel>

      <Panel
        title="People"
        subtitle="Creator accounts are provisioned by IT and can’t be changed here."
      >
        <label className="relative mb-4 block">
          <span className="sr-only">Search people</span>
          <IconSearch size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-dim" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, email or Employee ID…"
            className={`${inputClass} pl-10`}
          />
        </label>
        {users === null ? (
          <OrbitLoader />
        ) : (
          <ul className="flex flex-col gap-2">
            {users.map((u, i) => (
              <motion.li
                key={u.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0, transition: { delay: i * 0.02 } }}
                className="glass-subtle flex flex-wrap items-center gap-3 px-4 py-3"
              >
                <span className="bg-gradient-brand grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-semibold text-white">
                  {u.name.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{u.name}</div>
                  <div className="truncate text-xs text-text-muted">
                    {u.email}
                    {u.employeeCode && <span className="text-text-dim"> · {u.employeeCode}</span>}
                    {u.counts && u.role === 'EMPLOYEE' && (
                      <span className="text-text-dim">
                        {' '}
                        · {u.counts.creations} creations · {u.counts.events} events
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Pill tone={u.role === 'CREATOR' ? 'brand' : 'neutral'}>
                    {u.role === 'CREATOR' ? 'Creator' : 'Employee'}
                  </Pill>
                  {!u.isActive ? (
                    <Pill tone="warn">Deactivated</Pill>
                  ) : u.status === 'INVITE_PENDING' ? (
                    <Pill>Invite pending</Pill>
                  ) : u.status === 'EMAIL_UNVERIFIED' ? (
                    <Pill tone="warn">Email not verified</Pill>
                  ) : (
                    <Pill tone="ok">Active</Pill>
                  )}
                </div>
                <div className="hidden w-32 text-right text-xs text-text-dim md:block">
                  {u.lastLoginAt
                    ? `Seen ${new Date(u.lastLoginAt).toLocaleDateString()}`
                    : 'Never signed in'}
                </div>
                {u.role === 'EMPLOYEE' && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="subtle" onClick={() => openProfile(u.id)}>
                      Profile
                    </Button>
                    {u.status === 'INVITE_PENDING' && u.isActive && (
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={busy === `re-${u.id}`}
                        onClick={() =>
                          act(
                            `re-${u.id}`,
                            async () => {
                              const r = await api.creator.reinvite(u.id);
                              setInvite({ ...r, email: u.email });
                              setCopied(false);
                            },
                            'New invite link created',
                          )
                        }
                      >
                        New link
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant={u.isActive ? 'danger' : 'ghost'}
                      loading={busy === u.id}
                      onClick={() =>
                        act(
                          u.id,
                          () => api.creator.setActive(u.id, !u.isActive),
                          u.isActive ? `${u.name} deactivated` : `${u.name} reactivated`,
                        )
                      }
                    >
                      {u.isActive ? 'Deactivate' : 'Reactivate'}
                    </Button>
                  </div>
                )}
              </motion.li>
            ))}
          </ul>
        )}
        {users?.length === 0 && <p className="text-sm text-text-muted">No one matches “{q}”.</p>}
      </Panel>
      {profileId && <EmployeeProfileDialog userId={profileId} onClose={() => openProfile(null)} onChanged={load} />}
    </div>
  );
}
