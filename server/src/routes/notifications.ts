import { Router } from 'express';
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { parse } from '../lib/http.js';
import { hub, notificationDto, unreadCount } from '../lib/notify.js';

const ReadBody = z.object({ ids: z.array(z.string().max(40)).min(1).max(100) }).strict();

const ListQuery = z.object({
  category: z.enum(['event', 'photo', 'ai', 'poster', 'account']).optional(),
  unread: z.enum(['1', 'true']).optional(),
  /** Load older items: id of the last item already shown. */
  before: z.string().max(40).optional(),
  take: z.coerce.number().int().min(1).max(100).default(30),
});

/**
 * The signed-in user's own notifications. Every query is scoped by userId, and the live stream
 * only ever carries the signed-in user's own notifications.
 */
export function notificationsRouter(prisma: PrismaClient): Router {
  const router = Router();

  const withActors = async <T extends { actorId: string | null }>(rows: T[]) => {
    const ids = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))];
    const actors = ids.length
      ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
      : [];
    return rows.map((r) => ({ ...r, actor: actors.find((a) => a.id === r.actorId) ?? null }));
  };

  router.get('/', async (req, res) => {
    const userId = req.user!.id;
    const q = parse(ListQuery, req.query);
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(q.category ? { category: q.category } : {}),
      ...(q.unread ? { readAt: null } : {}),
    };
    if (q.before) {
      const ref = await prisma.notification.findFirst({ where: { id: q.before, userId }, select: { createdAt: true } });
      if (ref) where.createdAt = { lt: ref.createdAt };
    }
    const [rows, unread] = await Promise.all([
      prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take: q.take + 1 }),
      unreadCount(prisma, userId),
    ]);
    const items = (await withActors(rows.slice(0, q.take))).map(notificationDto);
    res.json({ items, unread, hasMore: rows.length > q.take });
  });

  /** Marks specific notifications (only the caller's own) as read. */
  router.post('/read', async (req, res) => {
    const { ids } = parse(ReadBody, req.body);
    const userId = req.user!.id;
    const r = await prisma.notification.updateMany({
      where: { userId, readAt: null, id: { in: ids } },
      data: { readAt: new Date() },
    });
    const unread = await unreadCount(prisma, userId);
    hub.publish(userId, 'read', { ids, unread }); // keep the user's other tabs in sync
    res.json({ updated: r.count, unread });
  });

  router.post('/read-all', async (req, res) => {
    const userId = req.user!.id;
    const r = await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
    hub.publish(userId, 'read', { all: true, unread: 0 });
    res.json({ updated: r.count, unread: 0 });
  });

  /**
   * Live stream (Server-Sent Events). The browser keeps it open; new notifications arrive
   * instantly. The client falls back to polling if the stream can't be kept open.
   */
  router.get('/stream', async (req, res) => {
    const userId = req.user!.id;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (event: string, payload: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    };
    res.write('retry: 5000\n\n');
    send('hello', { unread: await unreadCount(prisma, userId) });
    const off = hub.subscribe(userId, send);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(ping);
      off();
    });
  });

  return router;
}
