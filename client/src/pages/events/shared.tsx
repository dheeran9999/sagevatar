import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import type { EventInfo, EventStatus } from '../../lib/api';
import { IconCamera, IconImage } from '../../components/icons';

export const STATUS_LABEL: Record<EventStatus, string> = {
  DRAFT: 'Draft',
  UPCOMING: 'Upcoming',
  ACTIVE: 'Active',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  ARCHIVED: 'Archived',
};

const STATUS_STYLE: Record<EventStatus, string> = {
  DRAFT: 'border-fg/20 bg-fg/10 text-text-muted',
  UPCOMING: 'border-brand-2/40 bg-brand-2/15 text-brand-2',
  ACTIVE: 'border-success/40 bg-success/15 text-success',
  COMPLETED: 'border-brand/40 bg-brand/15 text-text',
  CANCELLED: 'border-accent/40 bg-accent/15 text-accent',
  ARCHIVED: 'border-fg/15 bg-fg/5 text-text-dim',
};

export function StatusBadge({ status }: { status: EventStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}
    >
      {status === 'ACTIVE' && (
        <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-success" aria-hidden />
      )}
      {STATUS_LABEL[status]}
    </span>
  );
}

/** "Tue 11 Nov 2026 · 10:00–18:00" from the entered local date and times. */
export function formatWhen(e: Pick<EventInfo, 'eventDate' | 'startTime' | 'endTime'>) {
  const [y, m, d] = e.eventDate.split('-').map(Number);
  const date = new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return `${date} · ${e.startTime}–${e.endTime}`;
}

export function EventCover({
  event,
  className = '',
  full = false,
}: {
  event: Pick<EventInfo, 'coverUrl' | 'coverFullUrl' | 'name'>;
  className?: string;
  full?: boolean;
}) {
  const src = full ? (event.coverFullUrl ?? event.coverUrl) : event.coverUrl;
  return (
    <div className={`relative overflow-hidden bg-ink-3 ${className}`}>
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <div className="bg-gradient-brand grid h-full w-full place-items-center opacity-80">
          <IconCamera size={34} className="text-white/80" />
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink/70 via-transparent to-transparent" />
    </div>
  );
}

/** Card used by "My Events" and the Creator's event list. */
export function EventCard({
  event,
  meta,
  action,
  index = 0,
}: {
  event: EventInfo & { photoCount: number };
  meta?: ReactNode;
  action: ReactNode;
  index?: number;
}) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0, transition: { delay: Math.min(index, 8) * 0.04 } }}
      className="glass glass-interactive flex flex-col overflow-hidden !rounded-3xl"
      aria-label={event.name}
    >
      <EventCover event={event} className="aspect-[16/8]" />
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-base font-semibold leading-snug">{event.name}</h3>
          <StatusBadge status={event.status} />
        </div>
        <p className="text-sm text-text-muted">{formatWhen(event)}</p>
        <p className="text-sm text-text-muted">{event.location}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-dim">
          <span className="font-mono">{event.code}</span>
          <span className="inline-flex items-center gap-1">
            <IconImage size={13} /> {event.photoCount} photo{event.photoCount === 1 ? '' : 's'}
          </span>
          {meta}
        </div>
        <div className="mt-auto pt-2">{action}</div>
      </div>
    </motion.article>
  );
}
