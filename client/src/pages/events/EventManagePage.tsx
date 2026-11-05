import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  api,
  type EventPhoto,
  type EventStatus,
  type ManagedEvent,
  type ManagedUser,
} from '../../lib/api';
import { Chips } from '../../components/Chips';
import { ConfirmDialog } from '../../components/Modal';
import { Button, EmptyState, ErrorText, Field, Pill, Skeleton } from '../../components/ui';
import { useToast } from '../../components/toast-context';
import { IconImage, IconTrash, IconUpload, IconUsers } from '../../components/icons';
import { EventCover, StatusBadge, STATUS_LABEL, formatWhen } from './shared';
import { EventFormDialog } from './EventFormDialog';
import { EventGallery } from './EventGallery';
import { EmailDialog } from '../studio/Dialogs';
import { useAuth } from '../../auth/AuthContext';

type Tab = 'participants' | 'gallery' | 'albums';

/** Which status changes each stored status offers (Creators can always re-open a draft). */
const NEXT: Record<EventStatus, { to: EventStatus; label: string; danger?: boolean }[]> = {
  DRAFT: [{ to: 'UPCOMING', label: 'Publish' }],
  UPCOMING: [
    { to: 'COMPLETED', label: 'Mark completed' },
    { to: 'CANCELLED', label: 'Cancel event', danger: true },
    { to: 'DRAFT', label: 'Back to draft' },
  ],
  ACTIVE: [
    { to: 'COMPLETED', label: 'Mark completed' },
    { to: 'CANCELLED', label: 'Cancel event', danger: true },
  ],
  COMPLETED: [
    { to: 'ARCHIVED', label: 'Archive' },
    { to: 'UPCOMING', label: 'Re-open' },
  ],
  CANCELLED: [
    { to: 'ARCHIVED', label: 'Archive' },
    { to: 'UPCOMING', label: 'Re-open' },
  ],
  ARCHIVED: [{ to: 'COMPLETED', label: 'Unarchive' }],
};

/** Creator: one event — details, status, cover, participants, gallery and albums. */
export default function EventManagePage() {
  const { id = '' } = useParams();
  const toast = useToast();
  const [event, setEvent] = useState<ManagedEvent | null>(null);
  const [photos, setPhotos] = useState<EventPhoto[] | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('participants');
  const [editing, setEditing] = useState(false);
  const [statusTo, setStatusTo] = useState<{ to: EventStatus; label: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const coverInput = useRef<HTMLInputElement>(null);
  const { user } = useAuth();
  const [emailing, setEmailing] = useState<EventPhoto | null>(null);

  const loadPhotos = useCallback(() => {
    api.manageEvents
      .photos(id)
      .then(setPhotos)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  useEffect(() => {
    api.manageEvents
      .get(id)
      .then(setEvent)
      .catch((e: Error) => setError(e.message));
    loadPhotos();
  }, [id, loadPhotos]);

  if (!event) {
    return (
      <div className="flex flex-col gap-4">
        <ErrorText>{error}</ErrorText>
        {!error && <Skeleton className="h-64 !rounded-3xl" />}
      </div>
    );
  }

  const changeStatus = async (to: EventStatus) => {
    setBusy(true);
    try {
      const e = await api.manageEvents.update(event.id, { status: to, timezoneOffset: 0 });
      setEvent(e);
      toast.success(
        `Event ${STATUS_LABEL[to].toLowerCase()}`,
        'Participants have been notified where relevant.',
      );
      setStatusTo(null);
    } catch (err) {
      toast.error('Could not change the status', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-5" aria-label={`Manage event: ${event.name}`}>
      <Link to="/events" className="text-sm text-text-muted hover:text-text">
        ← All events
      </Link>

      <div className="glass overflow-hidden !rounded-3xl">
        <div className="relative">
          <EventCover event={event} full className="aspect-[16/5] max-h-64 w-full" />
          <div className="absolute bottom-3 right-3 flex gap-2">
            <input
              ref={coverInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              aria-label="Upload cover image"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                try {
                  setEvent(await api.manageEvents.uploadCover(event.id, f));
                  toast.success('Cover updated');
                } catch (err) {
                  toast.error('Cover upload failed', (err as Error).message);
                }
              }}
            />
            <Button
              size="sm"
              variant="ghost"
              icon={<IconUpload size={14} />}
              onClick={() => coverInput.current?.click()}
            >
              {event.coverUrl ? 'Change cover' : 'Add cover'}
            </Button>
            {event.coverUrl && (
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => setEvent(await api.manageEvents.removeCover(event.id))}
              >
                Remove
              </Button>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-4 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold sm:text-3xl">{event.name}</h1>
              <p className="mt-1 font-mono text-xs text-text-dim">
                Event ID {event.code} · created by {event.createdBy}
              </p>
            </div>
            <StatusBadge status={event.status} />
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-text-dim">When</dt>
              <dd>{formatWhen(event)}</dd>
            </div>
            <div>
              <dt className="text-text-dim">Where</dt>
              <dd>{event.location}</dd>
            </div>
            <div>
              <dt className="text-text-dim">Gallery</dt>
              <dd>
                {event.galleryVisibility === 'PRIVATE'
                  ? 'Private (owner + Creators)'
                  : 'Shared with participants'}
              </dd>
            </div>
            <div>
              <dt className="text-text-dim">Totals</dt>
              <dd>
                {event.participants.length} participants · {event.photoCount} photos
              </dd>
            </div>
          </dl>
          {event.instructions && (
            <p className="whitespace-pre-line rounded-2xl border border-glass-border px-4 py-3 text-sm text-text-muted">
              {event.instructions}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => setEditing(true)}>
              Edit details
            </Button>
            {!['CANCELLED', 'ARCHIVED'].includes(event.storedStatus) && (
              <Link
                to={`/recognition?eventId=${encodeURIComponent(event.id)}`}
                className="inline-flex h-10 items-center gap-2 rounded-full border border-glass-border px-4 text-sm font-medium hover:bg-glass"
              >
                Anniversary poster
              </Link>
            )}
            {NEXT[event.storedStatus].map((s) => (
              <Button
                key={s.to}
                variant={
                  s.danger
                    ? 'danger'
                    : s.to === 'UPCOMING' && event.storedStatus === 'DRAFT'
                      ? 'primary'
                      : 'ghost'
                }
                onClick={() => setStatusTo(s)}
              >
                {s.label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <Chips
        label="Event sections"
        role="tablist"
        layoutId="event-tab"
        value={tab}
        onChange={(v) => setTab(v as Tab)}
        options={[
          { value: 'participants', label: `Participants (${event.participants.length})` },
          { value: 'gallery', label: `Gallery (${event.photoCount})` },
          { value: 'albums', label: `Albums (${event.albums.length})` },
        ]}
        strong
      />

      {tab === 'participants' && <Participants event={event} onChange={setEvent} />}
      {tab === 'gallery' && (
        <section className="glass p-5" aria-label="Event gallery (all photos)">
          <EventGallery
            photos={photos}
            albums={event.albums}
            manage
            exportHref={(album) =>
              api.manageEvents.exportUrl(event.id, album === 'all' ? undefined : album)
            }
            onEmail={(p) => setEmailing(p)}
            onDelete={async (p) => {
              await api.manageEvents.removePhoto(event.id, p.id);
              toast.success('Photo removed');
              loadPhotos();
              setEvent(await api.manageEvents.get(event.id));
            }}
            onMove={async (p, albumId) => {
              await api.manageEvents.movePhoto(event.id, p.id, albumId);
              loadPhotos();
              setEvent(await api.manageEvents.get(event.id));
            }}
          />
        </section>
      )}
      {tab === 'albums' && <Albums event={event} onChange={setEvent} />}

      {emailing && (
        <EmailDialog
          open
          onClose={() => setEmailing(null)}
          defaultTo={user?.email ?? ''}
          defaultSubject={event.name + ' — SageVatar photo'}
          attachment={{
            url: emailing.thumbUrl,
            name: 'Photo by ' + emailing.owner.name + ' (JPG)',
          }}
          onSend={async (to, subject, message, progress) => {
            progress('send');
            return api.events.emailPhoto(event.id, emailing.id, { to, subject, message });
          }}
        />
      )}
      {editing && (
        <EventFormDialog
          open
          event={event}
          onClose={() => setEditing(false)}
          onSubmit={async (form) => {
            setEvent(await api.manageEvents.update(event.id, form));
            toast.success('Event updated', 'Participants are notified of changes.');
          }}
        />
      )}
      <ConfirmDialog
        open={!!statusTo}
        title={statusTo ? `${statusTo.label}?` : ''}
        description={
          statusTo?.to === 'CANCELLED'
            ? 'Participants are notified and no new photos can be added.'
            : statusTo?.to === 'COMPLETED'
              ? 'Participants are notified. The gallery stays available; no new photos.'
              : statusTo?.to === 'ARCHIVED'
                ? 'Archived events are hidden from employees.'
                : statusTo?.to === 'UPCOMING' && event.storedStatus === 'DRAFT'
                  ? 'Assigned employees are notified and can enter the event.'
                  : undefined
        }
        confirmLabel={statusTo?.label}
        danger={statusTo?.to === 'CANCELLED'}
        busy={busy}
        onCancel={() => setStatusTo(null)}
        onConfirm={() => statusTo && changeStatus(statusTo.to)}
      />
    </section>
  );
}

function Participants({
  event,
  onChange,
}: {
  event: ManagedEvent;
  onChange: (e: ManagedEvent) => void;
}) {
  const toast = useToast();
  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<{ userId: string; name: string } | null>(null);

  useEffect(() => {
    api.creator
      .users()
      .then(setUsers)
      .catch(() => setUsers([]));
  }, []);

  const assigned = useMemo(() => new Set(event.participants.map((p) => p.userId)), [event]);
  const candidates = (users ?? []).filter(
    (u) =>
      u.role === 'EMPLOYEE' &&
      u.isActive &&
      !assigned.has(u.id) &&
      `${u.name} ${u.email}`.toLowerCase().includes(q.trim().toLowerCase()),
  );

  const assign = async () => {
    setBusy(true);
    try {
      const r = await api.manageEvents.assign(event.id, [...picked]);
      onChange(r.event);
      setPicked(new Set());
      toast.success(
        `${r.added.length} employee${r.added.length === 1 ? '' : 's'} assigned`,
        event.storedStatus === 'DRAFT'
          ? 'They’ll be notified when you publish.'
          : 'They’ve been notified.',
      );
    } catch (e) {
      toast.error('Could not assign', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="glass flex flex-col gap-3 p-5" aria-label="Assigned participants">
        <h2 className="text-lg font-semibold">Participants</h2>
        {event.participants.length === 0 ? (
          <EmptyState icon={<IconUsers size={22} />} title="Nobody assigned yet">
            Add employees from the list.
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {event.participants.map((p) => (
              <li
                key={p.userId}
                className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-fg/5"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{p.name}</div>
                  <div className="truncate text-xs text-text-dim">{p.email}</div>
                </div>
                <Pill>{p.photoCount} photos</Pill>
                {!p.isActive && <Pill tone="warn">Deactivated</Pill>}
                <Button
                  size="sm"
                  variant="subtle"
                  aria-label={`Remove ${p.name} from event`}
                  icon={<IconTrash size={14} />}
                  onClick={() => setRemoving({ userId: p.userId, name: p.name })}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="glass flex flex-col gap-3 p-5" aria-label="Assign employees">
        <h2 className="text-lg font-semibold">Assign employees</h2>
        <p className="text-xs text-text-muted">
          {event.storedStatus === 'DRAFT'
            ? 'This event is a draft: assigned employees are notified when you publish it.'
            : ['CANCELLED', 'ARCHIVED'].includes(event.storedStatus)
              ? 'This event is closed, so assigned employees are not notified.'
              : 'Assigned employees get an instant notification and an email invitation.'}
        </p>
        <Field
          label="Find employees"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name or email"
        />
        {users === null ? (
          <Skeleton className="h-32" />
        ) : candidates.length === 0 ? (
          <p className="text-sm text-text-muted">Everyone available is already assigned.</p>
        ) : (
          <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {candidates.map((u) => (
              <li key={u.id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 hover:bg-fg/5">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-brand"
                    checked={picked.has(u.id)}
                    onChange={(e) => {
                      const next = new Set(picked);
                      if (e.target.checked) next.add(u.id);
                      else next.delete(u.id);
                      setPicked(next);
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{u.name}</span>
                    <span className="block truncate text-xs text-text-dim">{u.email}</span>
                  </span>
                  {u.status !== 'ACTIVE_ACCOUNT' && (
                    <Pill tone="warn">
                      {u.status === 'INVITE_PENDING' ? 'Invite pending' : 'Unverified'}
                    </Pill>
                  )}
                </label>
              </li>
            ))}
          </ul>
        )}
        <Button onClick={assign} loading={busy} disabled={!picked.size}>
          Assign {picked.size || ''} selected
        </Button>
      </section>

      <ConfirmDialog
        open={!!removing}
        title={removing ? `Remove ${removing.name}?` : ''}
        description="They lose access to this event. Photos they already took stay in the gallery."
        confirmLabel="Remove"
        danger
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          onChange(await api.manageEvents.unassign(event.id, removing.userId));
          setRemoving(null);
        }}
      />
    </div>
  );
}

function Albums({ event, onChange }: { event: ManagedEvent; onChange: (e: ManagedEvent) => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  return (
    <section className="glass flex flex-col gap-4 p-5" aria-label="Event albums">
      <h2 className="text-lg font-semibold">Albums</h2>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setError('');
          try {
            onChange(await api.manageEvents.createAlbum(event.id, name.trim()));
            setName('');
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <div className="min-w-56 flex-1">
          <Field
            label="New album"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Stage, Team photos"
          />
        </div>
        <Button type="submit" disabled={!name.trim()}>
          Create album
        </Button>
      </form>
      <ErrorText>{error}</ErrorText>
      {event.albums.length === 0 ? (
        <EmptyState icon={<IconImage size={22} />} title="No albums">
          Albums help sort the event gallery. Move photos into them from the Gallery tab.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {event.albums.map((a) => (
            <li key={a.id} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-fg/5">
              <span className="flex-1 text-sm font-medium">{a.name}</span>
              <Pill>{a.photoCount} photos</Pill>
              <Button
                size="sm"
                variant="subtle"
                aria-label={`Delete album ${a.name}`}
                icon={<IconTrash size={14} />}
                onClick={async () => {
                  onChange(await api.manageEvents.deleteAlbum(event.id, a.id));
                  toast.info('Album deleted', 'Its photos are kept as Unsorted.');
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
