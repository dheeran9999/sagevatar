import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { parse } from '../../lib/http.js';
import { avatarUrls } from '../../lib/library-storage.js';

const DAY = 86_400_000;

/**
 * Aggregate usage analytics. Deliberately returns counts only — never another
 * user's photos or photo metadata (permission: analytics.view).
 */
export function analyticsRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    const since7 = new Date(Date.now() - 7 * DAY);
    const since14 = new Date(Date.now() - 14 * DAY);

    const [
      employees,
      activeEmployees,
      pendingInvites,
      creationsTotal,
      creations7d,
      emailByStatus,
      topAvatarRows,
      recent,
      activeUsers7d,
    ] = await Promise.all([
      prisma.user.count({ where: { roleCode: 'EMPLOYEE' } }),
      prisma.user.count({
        where: { roleCode: 'EMPLOYEE', isActive: true, passwordHash: { not: null } },
      }),
      prisma.user.count({ where: { roleCode: 'EMPLOYEE', passwordHash: null } }),
      prisma.photoCreation.count(),
      prisma.photoCreation.count({ where: { createdAt: { gte: since7 } } }),
      prisma.emailActivity.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.photoCreation.groupBy({
        by: ['avatarId'],
        where: { avatarId: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { avatarId: 'desc' } },
        take: 5,
      }),
      prisma.photoCreation.findMany({
        where: { createdAt: { gte: since14 } },
        select: { createdAt: true },
      }),
      prisma.user.count({ where: { lastLoginAt: { gte: since7 } } }),
    ]);

    const avatars = await prisma.avatar.findMany({
      where: { id: { in: topAvatarRows.map((r) => r.avatarId!) } },
      select: { id: true, name: true, thumbKey: true, updatedAt: true },
    });

    const perDay: Record<string, number> = {};
    for (let i = 13; i >= 0; i--)
      perDay[new Date(Date.now() - i * DAY).toISOString().slice(0, 10)] = 0;
    for (const r of recent) {
      const k = r.createdAt.toISOString().slice(0, 10);
      if (k in perDay) perDay[k]++;
    }

    const emails = { QUEUED: 0, SENT: 0, FAILED: 0 } as Record<string, number>;
    for (const e of emailByStatus) emails[e.status] = e._count._all;

    res.json({
      users: { employees, activeEmployees, pendingInvites, activeUsers7d },
      creations: { total: creationsTotal, last7Days: creations7d, perDay },
      emails,
      topAvatars: topAvatarRows.map((r) => ({
        ...(() => {
          const a = avatars.find((x) => x.id === r.avatarId);
          return a ? { id: a.id, name: a.name, thumbnailUrl: avatarUrls(a).thumbnailUrl } : {};
        })(),
        uses: r._count._all,
      })),
    });
  });

  return router;
}

const AuditQuery = z.object({
  action: z.string().max(40).optional(),
  actorId: z.string().max(40).optional(),
  take: z.coerce.number().int().min(1).max(200).default(50),
  skip: z.coerce.number().int().min(0).default(0),
});

/** Read-only audit trail (permission: audit.view). */
export function auditRouter(prisma: PrismaClient): Router {
  const router = Router();
  router.get('/', async (req, res) => {
    const q = parse(AuditQuery, req.query);
    const where = { action: q.action, actorId: q.actorId };
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: q.take,
        skip: q.skip,
        include: { actor: { select: { name: true, email: true, roleCode: true } } },
      }),
      prisma.auditLog.count({ where }),
    ]);
    res.json({ items, total });
  });
  return router;
}
