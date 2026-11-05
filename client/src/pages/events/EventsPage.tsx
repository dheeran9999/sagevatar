import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { api, type EventStatus, type ManagedEventSummary, type MyEvent } from '../../lib/api';
import { Chips } from '../../components/Chips';
import { Button, EmptyState, ErrorText, Skeleton } from '../../components/ui';
import { useToast } from '../../components/toast-context';
import { IconCamera, IconSparkles, IconUsers } from '../../components/icons';
import { EventCard, STATUS_LABEL } from './shared';
import { EventFormDialog } from './EventFormDialog';

/** /events — Creators manage all events; Employees see only the events they're assigned to. */
export default function EventsPage() {
  const { can } = useAuth();
  return can('event.manage') ? <ManageEvents /> : <MyEvents />;
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}

function Loading() {
  return (
    <Grid>
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-72 !rounded-3xl" />
      ))}
    </Grid>
  );
}

function MyEvents() {
  const [events, setEvents] = useState<MyEvent[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.events
      .mine()
      .then(setEvents)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <section className="flex flex-col gap-5">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-2">Employee</p>
        <h1 className="text-2xl font-semibold sm:text-3xl">My Events</h1>
        <p className="mt-1 text-sm text-text-muted">Events you've been assigned to.</p>
      </header>
      <ErrorText>{error}</ErrorText>
      {!events && !error && <Loading />}
      {events && events.length === 0 && (
        <EmptyState icon={<IconCamera size={22} />} title="No events yet">
          When a Creator assigns you to an event, it appears here.
        </EmptyState>
      )}
      {events && events.length > 0 && (
        <Grid>
          {events.map((e, i) => (
            <EventCard
              key={e.id}
              event={e}
              index={i}
              action={
                <Link
                  to={`/events/${e.id}`}
                  className="bg-gradient-brand btn-shine inline-flex h-10 w-full items-center justify-center gap-2 rounded-full text-sm font-medium text-white shadow-[var(--shadow-glow)] transition hover:-translate-y-0.5"
                >
                  {e.status === 'CANCELLED' || e.status === 'COMPLETED'
                    ? 'View event'
                    : 'Enter Event'}
                </Link>
              }
            />
          ))}
        </Grid>
      )}
    </section>
  );
}

const FILTERS: (EventStatus | 'all')[] = [
  'all',
  'DRAFT',
  'UPCOMING',
  'ACTIVE',
  'COMPLETED',
  'CANCELLED',
  'ARCHIVED',
];

function ManageEvents() {
  const navigate = useNavigate();
  const toast = useToast();
  const [events, setEvents] = useState<ManagedEventSummary[] | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<EventStatus | 'all'>('all');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api.manageEvents
      .list()
      .then(setEvents)
      .catch((e: Error) => setError(e.message));
  }, []);

  const shown = useMemo(
    () => (events ?? []).filter((e) => filter === 'all' || e.status === filter),
    [events, filter],
  );

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-2">Creator</p>
          <h1 className="text-2xl font-semibold sm:text-3xl">Events</h1>
          <p className="mt-1 text-sm text-text-muted">
            Create events, assign employees and manage each event's gallery.
          </p>
        </div>
        <Button icon={<IconSparkles size={16} />} onClick={() => setCreating(true)}>
          New event
        </Button>
      </header>
      <Chips
        label="Filter events by status"
        role="tablist"
        layoutId="event-filter"
        value={filter}
        onChange={(v) => setFilter(v as EventStatus | 'all')}
        options={FILTERS.map((f) => ({ value: f, label: f === 'all' ? 'All' : STATUS_LABEL[f] }))}
      />
      <ErrorText>{error}</ErrorText>
      {!events && !error && <Loading />}
      {events && shown.length === 0 && (
        <EmptyState
          icon={<IconCamera size={22} />}
          title={events.length ? 'No events with this status' : 'No events yet'}
        >
          Create an event, then assign employees to it.
        </EmptyState>
      )}
      {shown.length > 0 && (
        <Grid>
          {shown.map((e, i) => (
            <EventCard
              key={e.id}
              event={e}
              index={i}
              meta={
                <span className="inline-flex items-center gap-1">
                  <IconUsers size={13} /> {e.participantCount}
                </span>
              }
              action={
                <Link
                  to={`/events/${e.id}`}
                  className="inline-flex h-10 w-full items-center justify-center rounded-full border border-glass-border bg-glass text-sm font-medium transition hover:border-glass-edge hover:bg-glass-strong"
                >
                  Manage event
                </Link>
              }
            />
          ))}
        </Grid>
      )}
      {creating && (
        <EventFormDialog
          open
          onClose={() => setCreating(false)}
          onSubmit={async (form) => {
            const e = await api.manageEvents.create(form);
            toast.success('Event created', `${e.name} · ${e.code}`);
            navigate(`/events/${e.id}`);
          }}
        />
      )}
    </section>
  );
}
