import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { Event, EventStatus, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import type { Mailer } from './mailer.js';
import { notify } from './notify.js';

export const EVENT_STATUSES = [
  'DRAFT',
  'UPCOMING',
  'ACTIVE',
  'COMPLETED',
  'CANCELLED',
  'ARCHIVED',
] as const;
export const VISIBILITIES = ['PARTICIPANTS', 'PRIVATE'] as const;

/** Statuses an assigned Employee can see at all. Drafts and archived events stay hidden. */
export const EMPLOYEE_VISIBLE: EventStatus[] = ['UPCOMING', 'ACTIVE', 'COMPLETED', 'CANCELLED'];

/** "Upcoming" becomes "Active" automatically while the event is running. */
export function effectiveStatus(
  e: Pick<Event, 'status' | 'startsAt' | 'endsAt'>,
  now = new Date(),
) {
  if (e.status === 'UPCOMING' && now >= e.startsAt && now <= e.endsAt) return 'ACTIVE' as const;
  return e.status;
}

/** New photos are accepted only while an event is upcoming or running. */
export const canCapture = (e: Pick<Event, 'status' | 'startsAt' | 'endsAt'>) =>
  ['UPCOMING', 'ACTIVE'].includes(effectiveStatus(e));

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O/1/I

/** EVT-YYMMDD-XXXX, retried until unique. */
export async function newEventCode(prisma: PrismaClient, date: string) {
  const ymd = date.replace(/-/g, '').slice(2);
  for (let i = 0; i < 10; i++) {
    const bytes = randomBytes(4);
    const suffix = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
    const code = `EVT-${ymd}-${suffix}`;
    if (!(await prisma.event.findUnique({ where: { code } }))) return code;
  }
  throw new Error('Could not allocate an event code');
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const EventFields = z.object({
  name: z.string().trim().min(2, 'Enter the event name').max(120),
  eventDate: z.string().regex(DATE, 'Pick the event date'),
  startTime: z.string().regex(TIME, 'Enter a start time (HH:mm)'),
  endTime: z.string().regex(TIME, 'Enter an end time (HH:mm)'),
  /** Minutes behind UTC, as returned by the browser's Date#getTimezoneOffset(). */
  timezoneOffset: z.coerce.number().int().min(-840).max(840).default(0),
  location: z.string().trim().min(2, 'Enter the location').max(200),
  description: z.string().trim().max(2000).default(''),
  instructions: z.string().trim().max(2000).default(''),
  galleryVisibility: z.enum(VISIBILITIES).default('PARTICIPANTS'),
  status: z.enum(EVENT_STATUSES).default('DRAFT'),
});

/** Edits: every field optional and WITHOUT defaults. */
export const EventEdit = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  eventDate: z.string().regex(DATE).optional(),
  startTime: z.string().regex(TIME).optional(),
  endTime: z.string().regex(TIME).optional(),
  location: z.string().trim().min(2).max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  instructions: z.string().trim().max(2000).optional(),
  galleryVisibility: z.enum(VISIBILITIES).optional(),
  status: z.enum(EVENT_STATUSES).optional(),
});

/** Turns the entered local date + times into instants; the end must be after the start. */
export function instants(f: {
  eventDate: string;
  startTime: string;
  endTime: string;
  timezoneOffset: number;
}) {
  const [y, m, d] = f.eventDate.split('-').map(Number);
  const at = (t: string) => {
    const [h, min] = t.split(':').map(Number);
    return new Date(Date.UTC(y, m - 1, d, h, min) + f.timezoneOffset * 60_000);
  };
  const startsAt = at(f.startTime);
  const endsAt = at(f.endTime);
  if (Number.isNaN(startsAt.getTime())) return null;
  return { startsAt, endsAt, valid: endsAt > startsAt };
}

export const eventDir = (config: AppConfig, eventId: string) =>
  path.join(config.privateStorage, 'events', eventId);
export const eventKey = (eventId: string, ...parts: string[]) =>
  path.posix.join('events', eventId, ...parts);

export const coverUrl = (e: Pick<Event, 'id' | 'coverKey' | 'updatedAt'>, thumb = true) =>
  e.coverKey
    ? `/api/events/${e.id}/cover${thumb ? '?thumb=1&' : '?'}v=${e.updatedAt.getTime().toString(36)}`
    : null;

/** Public shape of an event (no storage keys). */
export function eventDto(e: Event) {
  return {
    id: e.id,
    code: e.code,
    name: e.name,
    description: e.description,
    instructions: e.instructions,
    location: e.location,
    eventDate: e.eventDate,
    startTime: e.startTime,
    endTime: e.endTime,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    status: effectiveStatus(e),
    storedStatus: e.status,
    galleryVisibility: e.galleryVisibility,
    coverUrl: coverUrl(e, true),
    coverFullUrl: coverUrl(e, false),
    canCapture: canCapture(e),
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

// ---- Notifications ----------------------------------------------------------

export type EventNotificationType =
  'EVENT_ASSIGNED' | 'EVENT_UPDATED' | 'EVENT_CANCELLED' | 'EVENT_COMPLETED';

/**
 * Notifies participants about an event: stored per user, pushed live as a popup, and emailed
 * (best effort — a mail failure never undoes the change that triggered it).
 */
export async function notifyUsers(
  prisma: PrismaClient,
  mailer: Mailer,
  config: AppConfig,
  userIds: string[],
  n: {
    type: EventNotificationType;
    title: string;
    body: string;
    eventId: string;
    actorId?: string;
    data?: Record<string, string>;
    dedupeKey?: string;
  },
) {
  if (!userIds.length) return [];
  return notify(prisma, userIds, { ...n, link: `/events/${n.eventId}` }, { mailer, config });
}

/** Popup details for an event notification. */
export const eventDetails = (e: Pick<Event, 'name' | 'code' | 'eventDate' | 'startTime' | 'endTime' | 'location'>, creator?: string) => ({
  Event: e.name,
  ...(creator ? { 'Assigned by': creator } : {}),
  When: when(e),
  Where: e.location,
  'Event ID': e.code,
});

export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

export const when = (e: Pick<Event, 'eventDate' | 'startTime' | 'endTime'>) =>
  `${e.eventDate} ${e.startTime}–${e.endTime}`;
