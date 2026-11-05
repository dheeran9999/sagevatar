import { Router } from 'express';
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { AppConfig } from '../../config.js';
import { HttpError, parse } from '../../lib/http.js';
import { audit } from '../../lib/audit.js';
import { inspectImage, makeThumbnail, newFileId, saveFile, uploader } from '../../lib/images.js';
import { libraryDir, libraryKey, templateUrls } from '../../lib/library-storage.js';

const present = <
  T extends { id: string; fileKey: string; thumbKey: string | null; updatedAt: Date },
>({
  fileKey: _f,
  ...t
}: T) => ({ ...t, ...templateUrls(t) });

const jsonField = z
  .string()
  .max(20_000)
  .transform((s, ctx) => {
    try {
      return JSON.parse(s) as Prisma.InputJsonValue;
    } catch {
      ctx.addIssue({ code: 'custom', message: 'must be valid JSON' });
      return z.NEVER;
    }
  });

const TemplateCreate = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).optional(),
  layout: jsonField.optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

const TemplateUpdate = z
  .object({
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(300),
    layout: z.record(z.string(), z.unknown()),
    isActive: z.boolean(),
  })
  .partial()
  .strict();

/** Corporate photo templates — branded frames/overlays (permission: template.manage). */
export function templatesRouter(prisma: PrismaClient, config: AppConfig): Router {
  const router = Router();
  const upload = uploader(config.MAX_UPLOAD_MB);

  router.get('/', async (_req, res) => {
    const rows = await prisma.corporateTemplate.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(rows.map(present));
  });

  router.post('/', upload.single('file'), async (req, res) => {
    const body = parse(TemplateCreate, req.body);
    const img = await inspectImage(req.file?.buffer, ['png', 'webp']);
    const id = newFileId();
    const dir = libraryDir(config, 'templates');
    await saveFile(dir, `${id}.${img.ext}`, req.file!.buffer);
    await saveFile(dir, `${id}-thumb.png`, await makeThumbnail(req.file!.buffer, 320));
    const t = await prisma.corporateTemplate.create({
      data: {
        name: body.name,
        description: body.description,
        layout: body.layout ?? {},
        isActive: body.isActive ?? false,
        fileKey: libraryKey('templates', `${id}.${img.ext}`),
        thumbKey: libraryKey('templates', `${id}-thumb.png`),
        mimeType: img.mimeType,
        sizeBytes: img.sizeBytes,
        width: img.width,
        height: img.height,
        createdById: req.user!.id,
      },
    });
    await audit(prisma, req, {
      action: 'TEMPLATE_CREATED',
      entityType: 'CorporateTemplate',
      entityId: t.id,
      details: { name: t.name },
    });
    res.status(201).json(present(t));
  });

  router.patch('/:id', async (req, res) => {
    const body = parse(TemplateUpdate, req.body);
    const id = String(req.params.id);
    if (!(await prisma.corporateTemplate.findUnique({ where: { id } }))) {
      throw new HttpError(404, 'Not found');
    }
    const t = await prisma.corporateTemplate.update({
      where: { id },
      data: { ...body, layout: body.layout as Prisma.InputJsonValue | undefined },
    });
    await audit(prisma, req, {
      action: 'TEMPLATE_UPDATED',
      entityType: 'CorporateTemplate',
      entityId: id,
      details: { ...body, layout: body.layout ? 'updated' : undefined },
    });
    res.json(present(t));
  });

  return router;
}
