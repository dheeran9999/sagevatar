import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { AppConfig } from '../../config.js';
import { HttpError, parse } from '../../lib/http.js';
import { audit } from '../../lib/audit.js';
import { createOneTimeToken } from '../../lib/security.js';

// `.strict()` makes any extra field — e.g. `role` — a 400, so roles can never be set here.
const InviteBody = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    name: z.string().trim().min(1).max(100),
  })
  .strict();

/**
 * Permitted employee details a Creator may edit. `.strict()`: role, email or anything else
 * is a 400 — a Creator can never grant Creator privileges.
 */
const EditBody = z
  .object({
    isActive: z.boolean().optional(),
    name: z.string().trim().min(1).max(100).optional(),
    employeeCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9-]{1,23}$/, 'Employee ID: letters, numbers and dashes (2–24 characters)')
      .nullable()
      .optional(),
    department: z.string().trim().max(80).nullable().optional(),
    designation: z.string().trim().max(80).nullable().optional(),
    phone: z
      .string()
      .trim()
      .max(32)
      .regex(/^\+?[0-9 ()-]{6,30}$/, 'Enter a phone number with digits, spaces, dashes or a leading +')
      .nullable()
      .optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change');

const ListQuery = z.object({ q: z.string().trim().max(80).optional() });

const userSelect = {
  id: true,
  email: true,
  name: true,
  roleCode: true,
  isActive: true,
  createdAt: true,
  lastLoginAt: true,
  inviteExpiresAt: true,
  passwordHash: true,
  emailVerifiedAt: true,
  employeeCode: true,
  department: true,
  designation: true,
  phone: true,
  pendingEmail: true,
} as const;

type Row = {
  passwordHash: string | null;
  inviteExpiresAt: Date | null;
  roleCode: string;
  emailVerifiedAt: Date | null;
};

const present = <T extends Row>({ passwordHash, roleCode, emailVerifiedAt, ...u }: T) => ({
  ...u,
  role: roleCode,
  status: !passwordHash
    ? 'INVITE_PENDING'
    : emailVerifiedAt
      ? 'ACTIVE_ACCOUNT'
      : 'EMAIL_UNVERIFIED',
});

/**
 * Employee account management (permission: employee.manage).
 * Creators can only ever create or (de)activate EMPLOYEE accounts. Creator accounts
 * are provisioned out-of-band with `npm run creator:provision` on the server.
 */
export function usersRouter(prisma: PrismaClient, config: AppConfig): Router {
  const router = Router();

  const issueInvite = async (userId: string) => {
    const { raw, hash } = createOneTimeToken();
    const expiresAt = new Date(Date.now() + config.INVITE_TTL_HOURS * 3600_000);
    await prisma.user.update({
      where: { id: userId },
      data: { inviteTokenHash: hash, inviteExpiresAt: expiresAt },
    });
    return { inviteUrl: `${config.CLIENT_ORIGIN}/accept-invite#${raw}`, expiresAt };
  };

  /** All accounts; `?q=` searches name, email and Employee ID. */
  router.get('/', async (req, res) => {
    const { q } = parse(ListQuery, req.query);
    const users = await prisma.user.findMany({
      where: q
        ? {
            OR: [
              { name: { contains: q } },
              { email: { contains: q.toLowerCase() } },
              { employeeCode: { contains: q.toUpperCase() } },
            ],
          }
        : undefined,
      orderBy: [{ roleCode: 'asc' }, { name: 'asc' }],
      select: { ...userSelect, _count: { select: { creations: true, eventPhotos: true, eventAssignments: true } } },
    });
    res.json(
      users.map(({ _count, ...u }) => ({
        ...present(u),
        counts: { creations: _count.creations, eventPhotos: _count.eventPhotos, events: _count.eventAssignments },
      })),
    );
  });

  /** An employee's profile, creation activity and event assignments. */
  router.get('/:id/profile', async (req, res) => {
    const target = await loadEmployee(String(req.params.id));
    const id = target.id;
    const [invitedBy, creations, eventPhotos, assignments, aiImages, photos, posters] = await Promise.all([
      prisma.user.findUnique({ where: { id }, select: { invitedBy: { select: { name: true } } } }),
      prisma.photoCreation.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          title: true,
          createdAt: true,
          layout: true,
          avatar: { select: { name: true } },
          generatedAvatarId: true,
        },
      }),
      prisma.eventPhoto.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, title: true, createdAt: true, eventId: true, event: { select: { name: true, code: true } }, avatar: { select: { name: true } } },
      }),
      prisma.eventAssignment.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
        select: {
          createdAt: true,
          event: { select: { id: true, code: true, name: true, eventDate: true, location: true, status: true, startsAt: true, endsAt: true } },
        },
      }),
      prisma.generatedAvatar.count({ where: { userId: id } }),
      prisma.employeePhoto.count({ where: { userId: id, isActive: true } }),
      prisma.groupPoster.count({ where: { userId: id, status: 'SUCCEEDED' } }),
    ]);
    const { effectiveStatus } = await import('../../lib/events.js');
    // The employee's chosen profile photo (consented; streamed through the authorised photo route).
    const primary = await prisma.employeePhoto.findFirst({
      where: { userId: id, isActive: true, isPrimary: true },
      select: { id: true },
    });
    res.json({
      ...present(target),
      photo: primary
        ? { id: primary.id, url: '/api/people/photos/' + primary.id + '/file', thumbUrl: '/api/people/photos/' + primary.id + '/thumb' }
        : null,
      invitedBy: invitedBy?.invitedBy?.name ?? null,
      counts: {
        creations: await prisma.photoCreation.count({ where: { userId: id } }),
        eventPhotos: await prisma.eventPhoto.count({ where: { userId: id } }),
        events: assignments.length,
        aiImages,
        recognitionPhotos: photos,
        posters,
      },
      creations: creations.map((c) => ({
        id: c.id,
        title: c.title,
        createdAt: c.createdAt,
        avatar: c.avatar?.name ?? (c.generatedAvatarId ? 'AI-generated avatar' : null),
        kind: (c.layout as { kind?: string } | null)?.kind === 'group-anniversary' ? 'poster' : 'photo',
        thumbUrl: `/api/creator/creations/${c.id}/image/result`,
        link: `/creator/creations/${c.id}`,
      })),
      eventPhotos: eventPhotos.map((p) => ({
        id: p.id,
        title: p.title,
        createdAt: p.createdAt,
        event: p.event,
        avatar: p.avatar?.name ?? null,
        thumbUrl: `/api/events/${p.eventId}/photos/${p.id}/image/thumb`,
        link: `/events/${p.eventId}?photo=${p.id}`,
      })),
      assignments: assignments.map((a) => ({
        assignedAt: a.createdAt,
        id: a.event.id,
        code: a.event.code,
        name: a.event.name,
        eventDate: a.event.eventDate,
        location: a.event.location,
        status: effectiveStatus(a.event),
      })),
    });
  });

  router.post('/invite', async (req, res) => {
    const body = parse(InviteBody, req.body);
    if (await prisma.user.findUnique({ where: { email: body.email } })) {
      throw new HttpError(409, 'An account with this email already exists');
    }
    const user = await prisma.user.create({
      data: { ...body, roleCode: 'EMPLOYEE', invitedById: req.user!.id },
      select: userSelect,
    });
    const invite = await issueInvite(user.id);
    await audit(prisma, req, {
      action: 'EMPLOYEE_INVITED',
      entityType: 'User',
      entityId: user.id,
      details: { email: user.email },
    });
    // The link is returned once so the Creator can share it until email is configured.
    res.status(201).json({ user: present(user), ...invite });
  });

  const loadEmployee = async (id: string) => {
    const target = await prisma.user.findUnique({ where: { id }, select: userSelect });
    if (!target) throw new HttpError(404, 'Not found');
    if (target.roleCode !== 'EMPLOYEE') {
      throw new HttpError(403, 'Creator accounts cannot be managed from the app');
    }
    return target;
  };

  router.post('/:id/reinvite', async (req, res) => {
    const target = await loadEmployee(String(req.params.id));
    if (target.passwordHash) throw new HttpError(409, 'This employee has already joined');
    const invite = await issueInvite(target.id);
    await audit(prisma, req, {
      action: 'EMPLOYEE_REINVITED',
      entityType: 'User',
      entityId: target.id,
    });
    res.json(invite);
  });

  router.patch('/:id', async (req, res) => {
    const body = parse(EditBody, req.body);
    const target = await loadEmployee(String(req.params.id));
    if (body.employeeCode) {
      const clash = await prisma.user.findFirst({
        where: { employeeCode: body.employeeCode, id: { not: target.id } },
        select: { id: true },
      });
      if (clash) throw new HttpError(409, `Employee ID ${body.employeeCode} is already used by someone else`);
    }
    const updated = await prisma.user.update({
      where: { id: target.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.employeeCode !== undefined ? { employeeCode: body.employeeCode } : {}),
        ...(body.department !== undefined ? { department: body.department || null } : {}),
        ...(body.designation !== undefined ? { designation: body.designation || null } : {}),
        ...(body.phone !== undefined ? { phone: body.phone || null } : {}),
        ...(body.isActive !== undefined
          ? {
              isActive: body.isActive,
              // Revoke existing sessions immediately on deactivation.
              ...(body.isActive ? {} : { tokenVersion: { increment: 1 } }),
            }
          : {}),
      },
      select: userSelect,
    });
    if (body.isActive !== undefined && body.isActive !== target.isActive) {
      await audit(prisma, req, {
        action: body.isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
        entityType: 'User',
        entityId: target.id,
      });
    }
    if (body.name !== undefined || body.employeeCode !== undefined) {
      await audit(prisma, req, {
        action: 'EMPLOYEE_UPDATED',
        entityType: 'User',
        entityId: target.id,
        details: { name: body.name, employeeCode: body.employeeCode },
      });
    }
    res.json(present(updated));
  });

  return router;
}
