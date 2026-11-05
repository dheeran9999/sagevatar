import path from 'node:path';
import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import sharp from 'sharp';
import { z } from 'zod';
import type { AppConfig } from '../../config.js';
import { HttpError, parse } from '../../lib/http.js';
import { audit } from '../../lib/audit.js';
import { inspectImage, newFileId, saveFile, uploader } from '../../lib/images.js';
import { removeKeys } from '../../lib/library-storage.js';
import {
  ensurePosterTemplates,
  listTemplates,
  PhotoSlotsSchema,
  SLOTS,
} from '../../lib/poster/templates.js';

const TemplatePatch = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    description: z.string().trim().max(300).optional(),
    heading: z.string().trim().min(3).max(60).optional(),
    maxParticipants: z.number().int().min(1).max(SLOTS.length + 9).optional(),
    isPublished: z.boolean().optional(),
    showNames: z.boolean().optional(),
    /** Photo templates only: the faces to replace. */
    faceSlots: PhotoSlotsSchema.optional(),
  })
  .strict();

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const PhotoTemplateFields = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).default(''),
  faceSlots: z
    .string()
    .max(20_000)
    .transform((s, ctx) => {
      try {
        return JSON.parse(s) as unknown;
      } catch {
        ctx.addIssue({ code: 'custom', message: 'faceSlots must be valid JSON' });
        return z.NEVER;
      }
    })
    .pipe(PhotoSlotsSchema),
  showNames: bool.default(true),
  rightsConfirmed: bool,
});

const BrandingBody = z
  .object({
    companyName: z.string().trim().min(1).max(40),
    tagline: z.string().trim().max(80).default(''),
  })
  .strict();

/** Creator only (template.manage): official poster templates and corporate branding. */
export function posterAdminRouter(prisma: PrismaClient, config: AppConfig): Router {
  const router = Router();
  const upload = uploader(config.MAX_UPLOAD_MB);

  const brandingDto = (b: { companyName: string; tagline: string; logoKey: string | null; updatedAt: Date }) => ({
    companyName: b.companyName,
    tagline: b.tagline,
    logoUrl: b.logoKey ? `/api/posters/branding/logo?v=${b.updatedAt.getTime().toString(36)}` : null,
  });
  const current = async () =>
    (await prisma.posterBranding.findUnique({ where: { id: 'default' } })) ??
    prisma.posterBranding.create({ data: { id: 'default' } });

  router.get('/templates', async (_req, res) => {
    res.json(await listTemplates(prisma, true));
  });

  router.patch('/templates/:key', async (req, res) => {
    const body = parse(TemplatePatch, req.body);
    await ensurePosterTemplates(prisma);
    const key = String(req.params.key);
    const row = await prisma.posterTemplate.findUnique({ where: { key } });
    if (!row) throw new HttpError(404, 'Template not found');
    if (body.faceSlots && row.kind !== 'photo') throw new HttpError(400, 'Only photo templates have editable faces');
    const { faceSlots, ...rest } = body;
    await prisma.posterTemplate.update({
      where: { key },
      data: {
        ...rest,
        ...(faceSlots
          ? { faceSlots, maxParticipants: Math.min(body.maxParticipants ?? faceSlots.length, faceSlots.length) }
          : {}),
        updatedById: req.user!.id,
      },
    });
    await audit(prisma, req, { action: 'POSTER_TEMPLATE_UPDATED', entityType: 'PosterTemplate', entityId: key, details: body });
    res.json((await listTemplates(prisma, true)).find((t) => t.key === key));
  });

  /**
   * A photo template: a celebration photograph whose marked faces are replaced by the selected
   * employees' faces. The Creator must confirm the rights to use the photograph.
   */
  router.post('/photo-templates', upload.single('photo'), async (req, res) => {
    const f = parse(PhotoTemplateFields, req.body);
    if (!f.rightsConfirmed) {
      throw new HttpError(422, 'Confirm that SageIT has the rights to use this photograph and the people in it.');
    }
    const img = await inspectImage(req.file?.buffer, ['jpeg', 'png', 'webp']);
    const meta = await sharp(req.file!.buffer).rotate().metadata();
    const width = meta.autoOrient?.width ?? meta.width ?? img.width;
    const height = meta.autoOrient?.height ?? meta.height ?? img.height;
    if (width < 800) throw new HttpError(400, 'Use a photo at least 800 pixels wide for a sharp poster');
    const id = newFileId();
    const key = `photo-${id.slice(0, 8)}`;
    const fileKey = path.posix.join('branding', 'templates', `${id}.${img.ext}`);
    await saveFile(path.join(config.privateStorage, 'branding', 'templates'), path.basename(fileKey), req.file!.buffer);
    await prisma.posterTemplate.create({
      data: {
        key,
        kind: 'photo',
        name: f.name,
        description: f.description,
        photoKey: fileKey,
        photoWidth: width,
        photoHeight: height,
        faceSlots: f.faceSlots,
        maxParticipants: f.faceSlots.length,
        showNames: f.showNames,
        sortOrder: -1,
        rightsConfirmedAt: new Date(),
        updatedById: req.user!.id,
      },
    });
    await audit(prisma, req, {
      action: 'POSTER_TEMPLATE_UPDATED',
      entityType: 'PosterTemplate',
      entityId: key,
      details: { created: 'photo', faces: f.faceSlots.length },
    });
    res.status(201).json((await listTemplates(prisma, true)).find((t) => t.key === key));
  });

  /** Removes a photo template (posters already generated from it keep their images). */
  router.delete('/templates/:key', async (req, res) => {
    const row = await prisma.posterTemplate.findUnique({ where: { key: String(req.params.key) } });
    if (!row) throw new HttpError(404, 'Template not found');
    if (row.kind !== 'photo') throw new HttpError(400, 'Built-in designs can be unpublished, not deleted');
    await prisma.posterTemplate.delete({ where: { key: row.key } });
    await removeKeys(config, [row.photoKey]);
    await audit(prisma, req, { action: 'POSTER_TEMPLATE_UPDATED', entityType: 'PosterTemplate', entityId: row.key, details: { deleted: true } });
    res.status(204).end();
  });

  router.get('/branding', async (_req, res) => {
    res.json(brandingDto(await current()));
  });

  router.put('/branding', async (req, res) => {
    const body = parse(BrandingBody, req.body);
    await current();
    const b = await prisma.posterBranding.update({ where: { id: 'default' }, data: { ...body, updatedById: req.user!.id } });
    await audit(prisma, req, { action: 'POSTER_BRANDING_UPDATED', entityType: 'PosterBranding', entityId: 'default', details: body });
    res.json(brandingDto(b));
  });

  /** The approved company logo (PNG/WebP/JPEG; stored as PNG, transparency kept). */
  router.post('/branding/logo', upload.single('logo'), async (req, res) => {
    await inspectImage(req.file?.buffer, ['png', 'webp', 'jpeg']);
    const png = await sharp(req.file!.buffer).resize(800, 400, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    const key = path.posix.join('branding', `logo-${newFileId()}.png`);
    await saveFile(path.join(config.privateStorage, 'branding'), path.basename(key), png);
    const before = await current();
    const b = await prisma.posterBranding.update({ where: { id: 'default' }, data: { logoKey: key, updatedById: req.user!.id } });
    await removeKeys(config, [before.logoKey]);
    await audit(prisma, req, { action: 'POSTER_BRANDING_UPDATED', entityType: 'PosterBranding', entityId: 'default', details: { logo: 'uploaded' } });
    res.json(brandingDto(b));
  });

  router.delete('/branding/logo', async (req, res) => {
    const before = await current();
    const b = await prisma.posterBranding.update({ where: { id: 'default' }, data: { logoKey: null, updatedById: req.user!.id } });
    await removeKeys(config, [before.logoKey]);
    await audit(prisma, req, { action: 'POSTER_BRANDING_UPDATED', entityType: 'PosterBranding', entityId: 'default', details: { logo: 'removed' } });
    res.json(brandingDto(b));
  });

  return router;
}
