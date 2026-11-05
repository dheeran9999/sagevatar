import { readFile } from 'node:fs/promises';
import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { AppConfig } from '../../config.js';
import { HttpError, parse } from '../../lib/http.js';
import { audit } from '../../lib/audit.js';
import { protectedTermIn } from '../../lib/copyright.js';
import { makeThumbnail, newFileId, saveFile } from '../../lib/images.js';
import { libraryDir, libraryKey, normalizeTags, resolveKey } from '../../lib/library-storage.js';

const PublishBody = z
  .object({
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(500).default(''),
    tags: z.array(z.string().max(40)).max(20).default([]),
    categoryId: z.string().min(1).max(40),
    style: z.enum(['PROFESSIONAL', 'CASUAL', 'THEMED']).default('THEMED'),
    isActive: z.boolean().default(true),
  })
  .strict();

/**
 * Creator only (library.manage): publishes one of the Creator's OWN generated images to the
 * shared avatar library, recorded as source AI_GENERATED with the prompt and model, and with
 * the Creator recorded as the person who confirmed it is fit for use.
 */
export function publishAiRouter(prisma: PrismaClient, config: AppConfig): Router {
  const router = Router();

  router.post('/:id/publish', async (req, res) => {
    const body = parse(PublishBody, req.body);
    const term = protectedTermIn(`${body.name} ${body.description} ${body.tags.join(' ')}`);
    if (term) {
      throw new HttpError(400, `Don't name AI images after “${term}” — use an original name.`);
    }
    const g = await prisma.generatedAvatar.findFirst({
      where: { id: String(req.params.id), userId: req.user!.id },
      include: { job: true },
    });
    if (!g) throw new HttpError(404, 'Not found');
    if (g.publishedAvatarId) throw new HttpError(409, 'This image is already in the library');

    const [category, type] = await Promise.all([
      prisma.avatarCategory.findUnique({ where: { id: body.categoryId } }),
      prisma.avatarType.findUnique({ where: { code: g.job.typeCode } }),
    ]);
    if (!category) throw new HttpError(400, 'Unknown category');

    const buf = await readFile(resolveKey(config, g.fileKey));
    const id = newFileId();
    const ext = g.mimeType === 'image/webp' ? 'webp' : g.mimeType === 'image/jpeg' ? 'jpg' : 'png';
    const dir = libraryDir(config, 'avatars');
    await saveFile(dir, `${id}.${ext}`, buf);
    await saveFile(dir, `${id}-thumb.png`, await makeThumbnail(buf));

    const avatar = await prisma.avatar.create({
      data: {
        name: body.name,
        description: body.description,
        tags: normalizeTags(body.tags),
        style: body.style,
        typeCode: g.job.typeCode,
        categoryId: category.id,
        fileKey: libraryKey('avatars', `${id}.${ext}`),
        thumbKey: libraryKey('avatars', `${id}-thumb.png`),
        mimeType: g.mimeType,
        sizeBytes: g.sizeBytes,
        isAnimated: false,
        width: g.width,
        height: g.height,
        defaultPlacement: type?.defaultPlacement ?? {},
        isActive: body.isActive,
        sourceType: 'AI_GENERATED',
        sourceName: `${g.job.provider} ${g.job.model}`,
        licenseName: 'AI-generated for SageIT internal use',
        licenseNotes: `Prompt: ${g.job.prompt}\nStyle: ${g.job.style}\nGenerated ${g.createdAt.toISOString()}`,
        attribution: '',
        rightsConfirmedAt: new Date(),
        rightsConfirmedById: req.user!.id,
        createdById: req.user!.id,
      },
    });
    await prisma.generatedAvatar.update({
      where: { id: g.id },
      data: { publishedAvatarId: avatar.id },
    });
    await audit(prisma, req, {
      action: 'AI_AVATAR_PUBLISHED',
      entityType: 'Avatar',
      entityId: avatar.id,
      details: { generatedId: g.id, model: g.job.model, categoryId: category.id },
    });
    res.status(201).json({ id: avatar.id, name: avatar.name, isActive: avatar.isActive });
  });

  return router;
}
