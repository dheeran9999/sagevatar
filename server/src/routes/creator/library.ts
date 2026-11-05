import { Router } from 'express';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { AppConfig } from '../../config.js';
import { AVATAR_TYPES } from '../../lib/domain.js';
import { PlacementSchema } from '../../lib/schemas.js';
import { avatarsRouter } from './avatars.js';
import { HttpError, parse, slugify } from '../../lib/http.js';
import { audit } from '../../lib/audit.js';

const CategoryCreate = z
  .object({
    name: z.string().trim().min(2).max(60),
    description: z.string().trim().max(300).optional(),
    sortOrder: z.number().int().min(0).max(1000).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
const CategoryUpdate = CategoryCreate.partial().strict();

const TypeUpdate = z
  .object({
    name: z.string().trim().min(2).max(40),
    description: z.string().trim().max(300),
    defaultPlacement: PlacementSchema,
    sortOrder: z.number().int().min(0).max(1000),
    isActive: z.boolean(),
  })
  .partial()
  .strict();

const uniqueViolation = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/** Avatar library management (permission: library.manage). */
export function libraryRouter(prisma: PrismaClient, config: AppConfig): Router {
  const router = Router();

  // ---- Categories ----

  router.get('/categories', async (_req, res) => {
    res.json(
      await prisma.avatarCategory.findMany({
        orderBy: { sortOrder: 'asc' },
        include: { _count: { select: { avatars: true } } },
      }),
    );
  });

  router.post('/categories', async (req, res) => {
    const body = parse(CategoryCreate, req.body);
    try {
      const cat = await prisma.avatarCategory.create({
        data: { ...body, slug: slugify(body.name) },
      });
      await audit(prisma, req, {
        action: 'CATEGORY_CREATED',
        entityType: 'AvatarCategory',
        entityId: cat.id,
        details: { name: cat.name },
      });
      res.status(201).json(cat);
    } catch (e) {
      if (uniqueViolation(e)) throw new HttpError(409, 'A category with this name already exists');
      throw e;
    }
  });

  router.patch('/categories/:id', async (req, res) => {
    const body = parse(CategoryUpdate, req.body);
    const id = String(req.params.id);
    if (!(await prisma.avatarCategory.findUnique({ where: { id } }))) {
      throw new HttpError(404, 'Not found');
    }
    try {
      const cat = await prisma.avatarCategory.update({
        where: { id },
        data: { ...body, ...(body.name ? { slug: slugify(body.name) } : {}) },
      });
      await audit(prisma, req, {
        action: 'CATEGORY_UPDATED',
        entityType: 'AvatarCategory',
        entityId: id,
        details: body,
      });
      res.json(cat);
    } catch (e) {
      if (uniqueViolation(e)) throw new HttpError(409, 'A category with this name already exists');
      throw e;
    }
  });

  // ---- Avatar types (fixed set of four; editable labels and defaults) ----

  router.get('/avatar-types', async (_req, res) => {
    res.json(await prisma.avatarType.findMany({ orderBy: { sortOrder: 'asc' } }));
  });

  router.patch('/avatar-types/:code', async (req, res) => {
    const code = parse(z.enum(AVATAR_TYPES), req.params.code);
    const body = parse(TypeUpdate, req.body);
    const t = await prisma.avatarType.update({ where: { code }, data: body });
    await audit(prisma, req, {
      action: 'AVATAR_TYPE_UPDATED',
      entityType: 'AvatarType',
      entityId: code,
      details: body,
    });
    res.json(t);
  });

  // ---- Avatars (upload, edit, licensing, safe delete) ----
  router.use('/avatars', avatarsRouter(prisma, config));

  return router;
}
