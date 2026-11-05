import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { api, ApiError, type EventWorkspaceInfo } from '../../lib/api';
import { ErrorText, Skeleton } from '../../components/ui';
import StudioPage from '../studio/StudioPage';
import { StatusBadge } from './shared';

/**
 * /events/:id/capture — the Camera Studio bound to one event. The Event ID stays in the URL
 * and every saved photo goes to this event (the server re-checks the assignment).
 */
export default function EventCapturePage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const [event, setEvent] = useState<EventWorkspaceInfo | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.events
      .get(id)
      .then(setEvent)
      .catch((e: Error) =>
        setError(e instanceof ApiError && e.status === 404 ? 'Event not available.' : e.message),
      );
  }, [id]);

  // Creators manage events; capturing is for assigned participants.
  if (can('event.manage')) return <Navigate to={`/events/${id}`} replace />;
  if (error) {
    return (
      <div className="flex flex-col gap-3">
        <ErrorText>{error}</ErrorText>
        <Link to="/events" className="text-sm text-brand-2 hover:underline">
          Back to My Events
        </Link>
      </div>
    );
  }
  if (!event) return <Skeleton className="h-24 !rounded-3xl" />;
  if (!event.canCapture) {
    return (
      <div className="flex flex-col gap-3">
        <ErrorText>This event isn't accepting new photos.</ErrorText>
        <Link to={`/events/${event.id}`} className="text-sm text-brand-2 hover:underline">
          Back to the event
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        role="region"
        aria-label="Current event"
        className="glass flex flex-wrap items-center gap-3 px-4 py-3 !rounded-2xl"
      >
        <Link to={`/events/${event.id}`} className="text-sm text-text-muted hover:text-text">
          ← Event
        </Link>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">Capturing for {event.name}</div>
          <div className="font-mono text-xs text-text-dim">
            {event.code} · photos save to this event's gallery
          </div>
        </div>
        <StatusBadge status={event.status} />
      </div>
      <StudioPage event={{ id: event.id, code: event.code, name: event.name }} />
    </div>
  );
}
