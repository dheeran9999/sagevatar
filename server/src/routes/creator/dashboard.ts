import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { avatarUrls } from '../../lib/library-storage.js';
import { effectiveStatus } from '../../lib/events.js';
import { designByKey } from '../../lib/poster/templates.js';

/**
 * Creator Dashboard: organisation-wide counts and recent activity in one call
 * (permission: analytics.view — Creators only).
 */
export function dashboardRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    const now = new Date();
    const [
      totalEmployees,
      activeEmployees,
      avatarAssets,
      aiGenerated,
      photoCreations,
      totalEvents,
      liveEvents,
      eventPhotos,
      posters,
      recentEmployees,
      recentEvents,
      recentCreations,
      recentPosters,
      recentAvatars,
      eventActivity,
    ] = await Promise.all([
      prisma.user.count({ where: { roleCode: 'EMPLOYEE' } }),
      prisma.user.count({ where: { roleCode: 'EMPLOYEE', isActive: true, passwordHash: { not: null } } }),
      prisma.avatar.count(),
      prisma.generatedAvatar.count(),
      prisma.photoCreation.count(),
      prisma.event.count(),
      prisma.event.findMany({
        where: { status: { in: ['UPCOMING', 'ACTIVE'] } },
        select: { status: true, startsAt: true, endsAt: true },
      }),
      prisma.eventPhoto.count(),
      prisma.groupPoster.count({ where: { status: 'SUCCEEDED' } }),
      prisma.user.findMany({
        where: { roleCode: 'EMPLOYEE' },
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: { id: true, name: true, email: true, employeeCode: true, createdAt: true, isActive: true, passwordHash: true },
      }),
      prisma.event.findMany({
        orderBy: { createdAt: 'desc' },
        take: 6,
        include: { _count: { select: { assignments: true, photos: true } } },
      }),
      prisma.photoCreation.findMany({
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          id: true,
          title: true,
          createdAt: true,
          layout: true,
          user: { select: { id: true, name: true, employeeCode: true, roleCode: true } },
          avatar: { select: { name: true } },
          generatedAvatarId: true,
        },
      }),
      prisma.groupPoster.findMany({
        where: { status: 'SUCCEEDED' },
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: {
          id: true,
          title: true,
          templateKey: true,
          participants: true,
          createdAt: true,
          user: { select: { name: true, roleCode: true } },
          event: { select: { name: true } },
        },
      }),
      prisma.avatar.findMany({
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: {
          id: true,
          name: true,
          typeCode: true,
          isActive: true,
          createdAt: true,
          thumbKey: true,
          updatedAt: true,
          sourceType: true,
          category: { select: { name: true } },
          createdBy: { select: { name: true } },
        },
      }),
      prisma.auditLog.findMany({
        where: {
          action: {
            in: ['EVENT_CREATED', 'EVENT_UPDATED', 'EVENT_STATUS_CHANGED', 'EVENT_ASSIGNED', 'EVENT_UNASSIGNED', 'EVENT_PHOTO_CREATED', 'EVENT_PHOTO_DELETED', 'EVENT_EXPORTED'],
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, action: true, entityId: true, details: true, createdAt: true, actor: { select: { name: true } } },
      }),
    ]);

    const statusNow = liveEvents.map((e) => effectiveStatus(e, now));
    // Names for the event activity feed (audit rows reference events or event photos).
    const eventIds = new Set<string>();
    for (const a of eventActivity) {
      const d = (a.details ?? {}) as { eventId?: string };
      if (a.action === 'EVENT_PHOTO_CREATED' || a.action === 'EVENT_PHOTO_DELETED') {
        if (d.eventId) eventIds.add(d.eventId);
      } else if (a.entityId) eventIds.add(a.entityId);
    }
    const eventNames = new Map(
      (await prisma.event.findMany({ where: { id: { in: [...eventIds] } }, select: { id: true, name: true } })).map(
        (e) => [e.id, e.name],
      ),
    );
    const ACTION: Record<string, string> = {
      EVENT_CREATED: 'created event',
      EVENT_UPDATED: 'updated event',
      EVENT_STATUS_CHANGED: 'changed the status of',
      EVENT_ASSIGNED: 'assigned employees to',
      EVENT_UNASSIGNED: 'removed an employee from',
      EVENT_PHOTO_CREATED: 'added a photo to',
      EVENT_PHOTO_DELETED: 'removed a photo from',
      EVENT_EXPORTED: 'exported the gallery of',
    };

    res.json({
      stats: {
        totalEmployees,
        activeEmployees,
        avatarAssets,
        aiGenerated,
        photoCreations,
        totalEvents,
        activeEvents: statusNow.filter((s) => s === 'ACTIVE').length,
        upcomingEvents: statusNow.filter((s) => s === 'UPCOMING').length,
        eventPhotos,
        recognitionPosters: posters,
      },
      recent: {
        employees: recentEmployees.map(({ passwordHash, ...u }) => ({
          ...u,
          status: !passwordHash ? 'INVITE_PENDING' : u.isActive ? 'ACTIVE' : 'DEACTIVATED',
        })),
        events: recentEvents.map((e) => ({
          id: e.id,
          code: e.code,
          name: e.name,
          eventDate: e.eventDate,
          location: e.location,
          status: effectiveStatus(e, now),
          participants: e._count.assignments,
          photos: e._count.photos,
          createdAt: e.createdAt,
        })),
        creations: recentCreations.map((c) => ({
          id: c.id,
          title: c.title,
          createdAt: c.createdAt,
          owner: { id: c.user.id, name: c.user.name, employeeCode: c.user.employeeCode, role: c.user.roleCode },
          avatar: c.avatar?.name ?? (c.generatedAvatarId ? 'AI-generated avatar' : null),
          kind: (c.layout as { kind?: string } | null)?.kind === 'group-anniversary' ? 'poster' : 'photo',
          link: `/creator/creations/${c.id}`,
        })),
        posters: recentPosters.map((p) => ({
          id: p.id,
          title: p.title,
          template: designByKey(p.templateKey)?.name ?? 'Photo template',
          people: (p.participants as { name: string }[]).length,
          createdBy: p.user.name,
          official: p.user.roleCode === 'CREATOR',
          event: p.event?.name ?? null,
          createdAt: p.createdAt,
          link: `/posters/${p.id}`,
        })),
        avatars: recentAvatars.map((a) => ({
          id: a.id,
          name: a.name,
          type: a.typeCode,
          category: a.category.name,
          source: a.sourceType,
          isActive: a.isActive,
          createdBy: a.createdBy.name,
          createdAt: a.createdAt,
          thumbnailUrl: avatarUrls(a).thumbnailUrl,
        })),
        eventActivity: eventActivity.map((a) => {
          const d = (a.details ?? {}) as { eventId?: string };
          const eventId = a.action.startsWith('EVENT_PHOTO') ? d.eventId : a.entityId;
          return {
            id: a.id,
            actor: a.actor?.name ?? 'System',
            text: ACTION[a.action] ?? a.action,
            event: eventId ? (eventNames.get(eventId) ?? 'a deleted event') : null,
            link: eventId && eventNames.has(eventId) ? `/events/${eventId}` : null,
            at: a.createdAt,
          };
        }),
      },
    });
  });

  return router;
}
