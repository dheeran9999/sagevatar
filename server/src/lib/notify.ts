/**
 * Notifications: stored permanently per recipient, pushed instantly to that recipient's open
 * browser tabs (Server-Sent Events), and optionally emailed.
 *
 * Every notification belongs to exactly one user; the live hub is keyed by user id, so a
 * notification can never reach anyone else's stream.
 */
import type { Notification, Prisma, PrismaClient } from '@prisma/client';
import type { AppConfig } from '../config.js';
import type { Mailer } from './mailer.js';

export type NotificationType =
  | 'EVENT_ASSIGNED'
  | 'EVENT_UPDATED'
  | 'EVENT_CANCELLED'
  | 'EVENT_COMPLETED'
  | 'PHOTO_CREATED'
  | 'AI_GENERATION_DONE'
  | 'AI_GENERATION_ACTIVITY'
  | 'POSTER_SHARED'
  | 'POSTER_CREATED'
  | 'ACCOUNT_WELCOME'
  | 'EMPLOYEE_JOINED';

export type NotificationCategory = 'event' | 'photo' | 'ai' | 'poster' | 'account';

export const CATEGORY: Record<NotificationType, NotificationCategory> = {
  EVENT_ASSIGNED: 'event',
  EVENT_UPDATED: 'event',
  EVENT_CANCELLED: 'event',
  EVENT_COMPLETED: 'event',
  PHOTO_CREATED: 'photo',
  AI_GENERATION_DONE: 'ai',
  AI_GENERATION_ACTIVITY: 'ai',
  POSTER_SHARED: 'poster',
  POSTER_CREATED: 'poster',
  ACCOUNT_WELCOME: 'account',
  EMPLOYEE_JOINED: 'account',
};

/** Public shape (also what the live stream sends). */
export function notificationDto(n: Notification & { actor?: { name: string } | null }) {
  return {
    id: n.id,
    type: n.type,
    category: n.category,
    title: n.title,
    body: n.body,
    link: n.link,
    eventId: n.eventId,
    actor: n.actor ? { name: n.actor.name } : null,
    data: (n.data as Record<string, string> | null) ?? null,
    readAt: n.readAt,
    createdAt: n.createdAt,
  };
}
export type NotificationDto = ReturnType<typeof notificationDto>;

type Listener = (event: string, payload: unknown) => void;

/** In-process pub/sub keyed by user id (one server process; swap for Redis to scale out). */
class NotificationHub {
  private listeners = new Map<string, Set<Listener>>();

  subscribe(userId: string, fn: Listener) {
    let set = this.listeners.get(userId);
    if (!set) this.listeners.set(userId, (set = new Set()));
    set.add(fn);
    return () => {
      set!.delete(fn);
      if (!set!.size) this.listeners.delete(userId);
    };
  }

  publish(userId: string, event: string, payload: unknown) {
    for (const fn of this.listeners.get(userId) ?? []) {
      try {
        fn(event, payload);
      } catch {
        /* a broken connection must not affect others */
      }
    }
  }

  connections(userId: string) {
    return this.listeners.get(userId)?.size ?? 0;
  }
}

export const hub = new NotificationHub();

export async function unreadCount(prisma: PrismaClient, userId: string) {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export interface NotifyInput {
  type: NotificationType;
  title: string;
  body: string;
  link?: string | null;
  eventId?: string | null;
  actorId?: string | null;
  /** Labelled details for the popup, e.g. { Employee: 'Rahul Kumar', 'Employee ID': 'SAGE102' }. */
  data?: Record<string, string>;
  /** Same key → never notified twice (per recipient). */
  dedupeKey?: string;
}

/**
 * Creates one notification per recipient (duplicates skipped), pushes each to that
 * recipient's live stream, and — when `email` is given — emails it (best effort).
 * Returns the ids of users who were actually notified.
 */
export async function notify(
  prisma: PrismaClient,
  recipients: string[],
  n: NotifyInput,
  email?: { mailer: Mailer; config: AppConfig },
): Promise<string[]> {
  const unique = [...new Set(recipients)];
  const delivered: string[] = [];
  for (const userId of unique) {
    let row: Notification & { actor: { name: string } | null };
    try {
      row = await prisma.notification.create({
        data: {
          userId,
          type: n.type,
          category: CATEGORY[n.type],
          title: n.title.slice(0, 200),
          body: n.body.slice(0, 1000),
          link: n.link ?? null,
          eventId: n.eventId ?? null,
          actorId: n.actorId ?? null,
          data: (n.data ?? undefined) as Prisma.InputJsonValue | undefined,
          dedupeKey: n.dedupeKey ?? null,
        },
        include: { user: false },
      }).then(async (created) => ({
        ...created,
        actor: created.actorId
          ? await prisma.user.findUnique({ where: { id: created.actorId }, select: { name: true } })
          : null,
      }));
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') continue; // already notified (dedupe key)
      throw e;
    }
    delivered.push(userId);
    hub.publish(userId, 'notification', {
      notification: notificationDto(row),
      unread: await unreadCount(prisma, userId),
    });
  }

  if (email && delivered.length) {
    const users = await prisma.user.findMany({
      where: { id: { in: delivered }, isActive: true },
      select: { email: true, name: true },
    });
    const url = n.link ? `${email.config.CLIENT_ORIGIN}${n.link}` : email.config.CLIENT_ORIGIN;
    const details = Object.entries(n.data ?? {})
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');
    await Promise.all(
      users.map((u) =>
        email.mailer
          .send({
            to: u.email,
            subject: `SageVatar · ${n.title}`,
            text: `Hi ${u.name},\n\n${n.body}\n${details ? `\n${details}\n` : ''}\nOpen in SageVatar: ${url}\n`,
            html: `<p>Hi ${esc(u.name)},</p><p>${esc(n.body)}</p>${
              details ? `<p>${esc(details).replace(/\n/g, '<br>')}</p>` : ''
            }<p><a href="${esc(url)}">Open in SageVatar</a></p>`,
          })
          .catch((err) => console.warn(`notification email to ${u.email} failed: ${(err as Error).message}`)),
      ),
    );
  }
  return delivered;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Every active Creator (recipients of employee activity). */
export async function creatorIds(prisma: PrismaClient, exclude?: string) {
  const rows = await prisma.user.findMany({
    where: { roleCode: 'CREATOR', isActive: true, ...(exclude ? { id: { not: exclude } } : {}) },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
