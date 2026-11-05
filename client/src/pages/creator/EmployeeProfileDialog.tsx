import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type EmployeeProfile } from '../../lib/api';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/toast-context';
import { Button, ErrorText, Field, Pill, Skeleton } from '../../components/ui';
import { StatusBadge } from '../events/shared';

/** A Creator's view of one employee: profile, permitted edits, creation activity and events. */
export function EmployeeProfileDialog({ userId, onClose, onChanged }: { userId: string; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [p, setP] = useState<EmployeeProfile | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [tab, setTab] = useState<'creations' | 'events' | 'eventPhotos'>('creations');

  const load = () =>
    api.creator
      .profile(userId)
      .then(setP)
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const save = async (
    body: {
      name?: string;
      employeeCode?: string | null;
      isActive?: boolean;
      department?: string | null;
      designation?: string | null;
      phone?: string | null;
    },
    ok: string,
  ) => {
    setBusy(Object.keys(body)[0]);
    setError('');
    try {
      await api.creator.updateEmployee(userId, body);
      toast.success(ok);
      await load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  return (
    <Modal open onClose={onClose} size="lg" title={p ? p.name : 'Employee'} description={p ? p.email : undefined}>
      {!p ? (
        error ? <ErrorText>{error}</ErrorText> : <Skeleton className="h-64" />
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap gap-1.5">
            <Pill>Employee</Pill>
            {!p.isActive ? <Pill tone="warn">Deactivated</Pill> : p.status === 'INVITE_PENDING' ? <Pill>Invite pending</Pill> : <Pill tone="ok">Active</Pill>}
            <Pill>Joined {new Date(p.createdAt).toLocaleDateString()}</Pill>
            <Pill>{p.lastLoginAt ? `Last seen ${new Date(p.lastLoginAt).toLocaleDateString()}` : 'Never signed in'}</Pill>
            {p.invitedBy && <Pill>Invited by {p.invitedBy}</Pill>}
          </div>

          <div className="flex items-center gap-4">
            {p.photo ? (
              <img
                src={p.photo.thumbUrl}
                alt={`${p.name}'s authorised profile photograph`}
                className="h-20 w-20 shrink-0 rounded-full object-cover ring-2 ring-brand-2/40"
              />
            ) : (
              <span className="grid h-20 w-20 shrink-0 place-items-center rounded-full border border-dashed border-glass-edge text-center text-[10px] text-text-dim">
                No profile photo
              </span>
            )}
            <dl className="grid flex-1 grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <dt className="text-text-muted">Phone</dt>
              <dd>{p.phone ?? '—'}</dd>
              <dt className="text-text-muted">Pending email</dt>
              <dd className="truncate">{p.pendingEmail ?? '—'}</dd>
            </dl>
          </div>

          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const val = (k: string) => String(f.get(k) ?? '').trim() || null;
              void save(
                {
                  name: String(f.get('name')),
                  employeeCode: val('employeeCode'),
                  department: val('department'),
                  designation: val('designation'),
                  phone: val('phone'),
                },
                'Employee details saved',
              );
            }}
          >
            <Field label="Name" name="name" defaultValue={p.name} required maxLength={100} />
            <Field label="Employee ID" name="employeeCode" defaultValue={p.employeeCode ?? ''} placeholder="e.g. SAGE102" maxLength={24} />
            <Field label="Department" name="department" defaultValue={p.department ?? ''} placeholder="e.g. Engineering" maxLength={80} />
            <Field label="Designation" name="designation" defaultValue={p.designation ?? ''} placeholder="e.g. Senior Developer" maxLength={80} />
            <Field label="Phone" name="phone" type="tel" defaultValue={p.phone ?? ''} maxLength={32} />
            <div className="flex items-end justify-end">
              <Button type="submit" loading={busy === 'name'}>Save details</Button>
            </div>
          </form>
          <p className="-mt-3 text-xs text-text-dim">
            The email and role can’t be changed here — Employees always stay Employees.
          </p>
          <ErrorText>{error}</ErrorText>

          <dl className="grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
            {(
              [
                ['Creations', p.counts.creations],
                ['Event photos', p.counts.eventPhotos],
                ['Events', p.counts.events],
                ['AI avatars', p.counts.aiImages],
                ['Recognition photos', p.counts.recognitionPhotos],
                ['Posters', p.counts.posters],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="glass-subtle !rounded-xl p-2">
                <dd className="text-lg font-semibold">{v}</dd>
                <dt className="text-[11px] text-text-dim">{k}</dt>
              </div>
            ))}
          </dl>

          <div role="tablist" className="flex gap-1">
            {(
              [
                ['creations', 'Creation activity'],
                ['eventPhotos', 'Event photos'],
                ['events', 'Event assignments'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`rounded-full px-3 py-1.5 text-sm ${tab === id ? 'bg-gradient-brand text-white' : 'text-text-muted hover:text-text'}`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'creations' &&
            (p.creations.length ? (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {p.creations.map((c) => (
                  <li key={c.id}>
                    <Link to={c.link} onClick={onClose} className="block overflow-hidden rounded-xl border border-glass-border hover:border-brand/50">
                      <img src={c.thumbUrl} alt="" className="aspect-square w-full object-cover" loading="lazy" />
                      <span className="block truncate p-2 text-xs">
                        {c.kind === 'poster' ? 'Poster' : (c.avatar ?? 'No avatar')} · {new Date(c.createdAt).toLocaleDateString()}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-text-muted">No saved creations yet.</p>
            ))}

          {tab === 'eventPhotos' &&
            (p.eventPhotos.length ? (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {p.eventPhotos.map((c) => (
                  <li key={c.id}>
                    <Link to={c.link} onClick={onClose} className="block overflow-hidden rounded-xl border border-glass-border hover:border-brand/50">
                      <img src={c.thumbUrl} alt="" className="aspect-square w-full object-cover" loading="lazy" />
                      <span className="block truncate p-2 text-xs">{c.event.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-text-muted">No event photos yet.</p>
            ))}

          {tab === 'events' &&
            (p.assignments.length ? (
              <ul className="flex flex-col gap-2">
                {p.assignments.map((e) => (
                  <li key={e.id}>
                    <Link to={`/events/${e.id}`} onClick={onClose} className="glass-subtle flex flex-wrap items-center gap-3 !rounded-xl px-3 py-2 hover:border-brand/50">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{e.name}</span>
                        <span className="text-xs text-text-dim">{e.eventDate} · {e.location} · {e.code}</span>
                      </span>
                      <StatusBadge status={e.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-text-muted">Not assigned to any events.</p>
            ))}

          <div className="flex justify-end">
            <Button
              variant={p.isActive ? 'danger' : 'primary'}
              loading={busy === 'isActive'}
              onClick={() => save({ isActive: !p.isActive }, p.isActive ? `${p.name} deactivated` : `${p.name} reactivated`)}
            >
              {p.isActive ? 'Deactivate account' : 'Reactivate account'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
