import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { api, ApiError, type EventPhoto, type EventWorkspaceInfo } from '../../lib/api';
import { EmptyState, ErrorText, Skeleton } from '../../components/ui';
import { useToast } from '../../components/toast-context';
import { IconCake, IconCamera, IconInfo } from '../../components/icons';
import { EmailDialog } from '../studio/Dialogs';
import { EventCover, StatusBadge, formatWhen } from './shared';
import { EventGallery } from './EventGallery';
import EventManagePage from './EventManagePage';

/** /events/:id — Creators manage it; assigned Employees get the event workspace. */
export default function EventPage() {
  const { can } = useAuth();
  return can('event.manage') ? <EventManagePage /> : <EventWorkspace />;
}

/**
 * Employee event workspace: event info, instructions, "Capture Photos" and this event's gallery.
 * The server answers 404 for events the user isn't assigned to.
 */
function EventWorkspace() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const [event, setEvent] = useState<EventWorkspaceInfo | null>(null);
  const [photos, setPhotos] = useState<EventPhoto[] | null>(null);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [emailing, setEmailing] = useState<EventPhoto | null>(null);

  const load = useCallback(() => {
    Promise.all([api.events.get(id), api.events.photos(id)])
      .then(([e, p]) => {
        setEvent(e);
        setPhotos(p);
      })
      .catch((e: Error) => {
        if (e instanceof ApiError && e.status === 404) setNotFound(true);
        else setError(e.message);
      });
  }, [id]);
  useEffect(load, [load]);

  if (notFound) {
    return (
      <EmptyState icon={<IconInfo size={22} />} title="Event not available">
        <p>You're not assigned to this event, or it's no longer open.</p>
        <Link to="/events" className="text-sm text-brand-2 hover:underline">
          Back to My Events
        </Link>
      </EmptyState>
    );
  }
  if (!event) {
    return (
      <div className="flex flex-col gap-4">
        <ErrorText>{error}</ErrorText>
        <Skeleton className="h-56 !rounded-3xl" />
        <Skeleton className="h-40 !rounded-3xl" />
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-5" aria-label={`Event workspace: ${event.name}`}>
      <Link to="/events" className="text-sm text-text-muted hover:text-text">
        ← My Events
      </Link>
      <div className="glass overflow-hidden !rounded-3xl">
        <EventCover event={event} full className="aspect-[16/6] max-h-72 w-full" />
        <div className="flex flex-col gap-4 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold sm:text-3xl">{event.name}</h1>
              <p className="mt-1 font-mono text-xs text-text-dim">Event ID {event.code}</p>
            </div>
            <StatusBadge status={event.status} />
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-text-dim">When</dt>
              <dd>{formatWhen(event)}</dd>
            </div>
            <div>
              <dt className="text-text-dim">Where</dt>
              <dd>{event.location}</dd>
            </div>
            <div>
              <dt className="text-text-dim">Photos</dt>
              <dd>
                {event.photoCount} in gallery · {event.myPhotoCount} yours
              </dd>
            </div>
          </dl>
          {event.description && <p className="text-sm text-text-muted">{event.description}</p>}
          {event.instructions && (
            <div className="rounded-2xl border border-brand-2/30 bg-brand-2/10 px-4 py-3 text-sm">
              <div className="mb-1 font-medium">Instructions</div>
              <p className="whitespace-pre-line text-text-muted">{event.instructions}</p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            {event.canCapture ? (
              <Link
                to={`/events/${event.id}/capture`}
                className="bg-gradient-brand btn-shine inline-flex h-12 items-center gap-2 rounded-full px-6 text-[15px] font-medium text-white shadow-[var(--shadow-glow)] transition hover:-translate-y-0.5"
              >
                <IconCamera size={18} /> Capture Photos
              </Link>
            ) : null}
            {event.canCapture && (
              <Link
                to={`/recognition?eventId=${encodeURIComponent(event.id)}`}
                className="glass-subtle inline-flex h-12 items-center gap-2 rounded-full px-5 text-[15px] font-medium transition hover:-translate-y-0.5"
              >
                <IconCake size={18} /> Anniversary poster
              </Link>
            )}
            {event.canCapture ? null : (
              <p className="text-sm text-text-muted">
                {event.status === 'CANCELLED'
                  ? 'This event was cancelled.'
                  : 'This event is no longer accepting new photos.'}
              </p>
            )}
            <span className="text-xs text-text-dim">
              {event.galleryVisibility === 'PRIVATE'
                ? 'Private gallery: you see only your own photos.'
                : 'Gallery shared with everyone assigned to this event.'}
            </span>
          </div>
        </div>
      </div>

      <section aria-label="Event photo gallery" className="glass flex flex-col gap-4 p-5">
        <h2 className="text-lg font-semibold">Photo Gallery</h2>
        <EventGallery
          photos={photos}
          onDelete={async (p) => {
            await api.events.deletePhoto(event.id, p.id);
            toast.success('Photo deleted');
            load();
          }}
          onEmail={(p) => setEmailing(p)}
        />
      </section>

      {emailing && (
        <EmailDialog
          open
          onClose={() => setEmailing(null)}
          defaultTo={user?.email ?? ''}
          defaultSubject={`${event.name} — SageVatar photo`}
          attachment={{ url: emailing.thumbUrl, name: `Photo by ${emailing.owner.name} (JPG)` }}
          onSend={async (to, subject, message, progress) => {
            // The photo is already stored; the server attaches it and sends it.
            progress('send');
            return api.events.emailPhoto(event.id, emailing.id, { to, subject, message });
          }}
        />
      )}
    </section>
  );
}
