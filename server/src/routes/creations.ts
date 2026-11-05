import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { Router, type Request } from 'express';
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { PHOTO_SOURCES } from '../lib/domain.js';
import { HttpError, parse } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { inspectImage, newFileId, saveFile, uploader } from '../lib/images.js';
import { avatarUrls } from '../lib/library-storage.js';
import { photoCreated } from '../lib/activity.js';
import { requirePermission } from '../middleware/auth.js';
import type { Mailer } from '../lib/mailer.js';
import {
  DownloadQuery,
  emailPhoto,
  extOf,
  photoFilename,
  photoInFormat,
  ShareEmailBody,
} from '../lib/share.js';

const CreateFields = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  source: z.enum(PHOTO_SOURCES),
  avatarId: z.string().max(40).optional(),
  /** The user's own AI-generated avatar (instead of a library avatar). */
  generatedAvatarId: z.string().max(40).optional(),
  templateId: z.string().max(40).optional(),
  layout: z
    .string()
    .max(100_000)
    .transform((s, ctx) => {
      try {
        return JSON.parse(s) as Prisma.InputJsonValue;
      } catch {
        ctx.addIssue({ code: 'custom', message: 'layout must be valid JSON' });
        return z.NEVER;
      }
    }),
});

const UpdateBody = z.object({ title: z.string().trim().min(1).max(120) }).strict();

const ListQuery = z.object({
  take: z.coerce.number().int().min(1).max(60).default(24),
  skip: z.coerce.number().int().min(0).default(0),
  /** Search title and avatar name. */
  q: z.string().trim().max(80).optional(),
  source: z.enum(PHOTO_SOURCES).optional(),
  avatarType: z.enum(['FACE', 'HALF_BODY', 'FULL_BODY', 'BACKGROUND']).optional(),
  /** 'library' | 'generated' | 'none' */
  avatarKind: z.enum(['library', 'generated', 'none']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  sort: z.enum(['newest', 'oldest']).default('newest'),
});

const listSelect = {
  id: true,
  title: true,
  createdAt: true,
  updatedAt: true,
  avatarId: true,
  generatedAvatarId: true,
  templateId: true,
  metadata: { select: { source: true, width: true, height: true } },
  avatar: { select: { id: true, name: true, typeCode: true, thumbKey: true, updatedAt: true } },
  generatedAvatar: { select: { id: true, job: { select: { prompt: true, typeCode: true } } } },
} as const;

type ListRow = Prisma.PhotoCreationGetPayload<{ select: typeof listSelect }>;

/** Adds image URLs and a plain "avatar used" summary; storage paths never leave the server. */
const creationDto = ({ avatar, generatedAvatar, ...c }: ListRow) => ({
  ...c,
  thumbnailUrl: `/api/creations/${c.id}/image/result`,
  avatarUsed: avatar
    ? {
        kind: 'library' as const,
        id: avatar.id,
        name: avatar.name,
        type: avatar.typeCode,
        thumbnailUrl: avatarUrls(avatar).thumbnailUrl,
      }
    : generatedAvatar
      ? {
          kind: 'generated' as const,
          id: generatedAvatar.id,
          name: `AI: ${generatedAvatar.job.prompt.slice(0, 40)}`,
          type: generatedAvatar.job.typeCode,
          thumbnailUrl: `/api/ai/images/${generatedAvatar.id}/thumb`,
        }
      : null,
});

/**
 * A user's own photo history. Every query is scoped by userId, and records that
 * belong to someone else return 404 (not 403) so IDs cannot be probed.
 * Creators get exactly the same personal scope — no cross-user access.
 */
export function creationsRouter(prisma: PrismaClient, config: AppConfig, mailer: Mailer): Router {
  const router = Router();
  const upload = uploader(config.MAX_UPLOAD_MB);

  const findOwn = async (req: Request) => {
    const c = await prisma.photoCreation.findFirst({
      where: { id: String(req.params.id), userId: req.user!.id },
    });
    if (!c) throw new HttpError(404, 'Not found');
    return c;
  };

  /** The avatar's name for file names ('AI-avatar' for the user's own generated ones). */
  const avatarNameOf = async (c: { avatarId: string | null; generatedAvatarId: string | null }) =>
    c.avatarId
      ? ((await prisma.avatar.findUnique({ where: { id: c.avatarId }, select: { name: true } }))
          ?.name ?? null)
      : c.generatedAvatarId
        ? 'AI-avatar'
        : null;

  router.get('/', async (req, res) => {
    const q = parse(ListQuery, req.query);
    // Every condition is ANDed; the user's own id is always one of them.
    const and: Prisma.PhotoCreationWhereInput[] = [{ userId: req.user!.id }];
    if (q.q) {
      and.push({
        OR: [
          { title: { contains: q.q } },
          { avatar: { name: { contains: q.q } } },
          { generatedAvatar: { job: { prompt: { contains: q.q } } } },
        ],
      });
    }
    if (q.source) and.push({ metadata: { source: q.source } });
    if (q.avatarType) {
      and.push({
        OR: [
          { avatar: { typeCode: q.avatarType } },
          { generatedAvatar: { job: { typeCode: q.avatarType } } },
        ],
      });
    }
    if (q.avatarKind === 'library') and.push({ avatarId: { not: null } });
    if (q.avatarKind === 'generated') and.push({ generatedAvatarId: { not: null } });
    if (q.avatarKind === 'none') and.push({ avatarId: null, generatedAvatarId: null });
    if (q.from) and.push({ createdAt: { gte: q.from } });
    if (q.to) and.push({ createdAt: { lte: q.to } });
    const where: Prisma.PhotoCreationWhereInput = { AND: and };

    const [items, total] = await Promise.all([
      prisma.photoCreation.findMany({
        where,
        orderBy: { createdAt: q.sort === 'oldest' ? 'asc' : 'desc' },
        take: q.take,
        skip: q.skip,
        select: listSelect,
      }),
      prisma.photoCreation.count({ where }),
    ]);
    res.json({ items: items.map(creationDto), total });
  });

  router.post(
    '/',
    upload.fields([
      { name: 'photo', maxCount: 1 },
      { name: 'result', maxCount: 1 },
    ]),
    async (req, res) => {
      const fields = parse(CreateFields, req.body);
      const files = req.files as Record<string, Express.Multer.File[]> | undefined;
      const photo = await inspectImage(files?.photo?.[0]?.buffer, ['jpeg', 'png', 'webp']);
      const result = await inspectImage(files?.result?.[0]?.buffer, ['png', 'jpeg', 'webp']);

      if (fields.avatarId) {
        const ok = await prisma.avatar.count({ where: { id: fields.avatarId, isActive: true } });
        if (!ok) throw new HttpError(400, 'Avatar is not available');
      }
      if (
        fields.generatedAvatarId &&
        !(await prisma.generatedAvatar.count({
          where: { id: fields.generatedAvatarId, userId: req.user!.id },
        }))
      ) {
        throw new HttpError(400, 'Generated avatar not found');
      }
      if (fields.templateId) {
        const ok = await prisma.corporateTemplate.count({
          where: { id: fields.templateId, isActive: true },
        });
        if (!ok) throw new HttpError(400, 'Template is not available');
      }

      const userId = req.user!.id;
      const fileId = newFileId();
      const rel = (name: string) => path.posix.join('creations', userId, name);
      const sourcePath = rel(`${fileId}-source.${photo.ext}`);
      const resultPath = rel(`${fileId}-result.${result.ext}`);
      await saveFile(
        path.join(config.privateStorage, 'creations', userId),
        path.basename(sourcePath),
        files!.photo[0].buffer,
      );
      await saveFile(
        path.join(config.privateStorage, 'creations', userId),
        path.basename(resultPath),
        files!.result[0].buffer,
      );

      const creation = await prisma.photoCreation.create({
        data: {
          title: fields.title,
          sourcePath,
          resultPath,
          layout: fields.layout,
          userId,
          avatarId: fields.avatarId,
          generatedAvatarId: fields.generatedAvatarId,
          templateId: fields.templateId,
          metadata: {
            create: {
              source: fields.source,
              width: photo.width,
              height: photo.height,
              mimeType: photo.mimeType,
              sizeBytes: photo.sizeBytes,
              sha256: photo.sha256,
              userAgent: req.get('user-agent')?.slice(0, 300),
            },
          },
        },
        select: listSelect,
      });
      await audit(prisma, req, {
        action: 'CREATION_CREATED',
        entityType: 'PhotoCreation',
        entityId: creation.id,
      });
      // Only after the photo is saved: tell the Creators (employee activity).
      await photoCreated(prisma, {
        userId,
        kind: 'personal',
        id: creation.id,
        avatarId: creation.avatarId,
        generatedAvatarId: creation.generatedAvatarId,
        createdAt: creation.createdAt,
      }).catch((e) => console.error('photo notification failed', e));
      res.status(201).json(creationDto(creation));
    },
  );

  router.get('/:id', async (req, res) => {
    const c = await findOwn(req);
    const row = await prisma.photoCreation.findUniqueOrThrow({
      where: { id: c.id },
      select: { ...listSelect, layout: true },
    });
    res.json({ ...creationDto(row), layout: row.layout });
  });

  /**
   * Streams a private image to its owner only.
   * `?download=1` downloads it with a meaningful name; `&format=jpg|png` picks the format
   * (full stored resolution — the actual combined photograph, nothing else).
   */
  router.get('/:id/image/:kind', async (req, res) => {
    const kind = parse(z.enum(['source', 'result']), req.params.kind);
    const dl = parse(DownloadQuery, req.query);
    const c = await findOwn(req);
    const rel = kind === 'source' ? c.sourcePath : c.resultPath;
    const full = path.resolve(config.privateStorage, rel);
    if (!full.startsWith(path.resolve(config.privateStorage) + path.sep)) {
      throw new HttpError(404, 'Not found');
    }
    res.setHeader('Cache-Control', 'private, no-store');
    if (!dl.download && !dl.format) {
      res.sendFile(full);
      return;
    }
    const out = await photoInFormat(
      await readFile(full),
      dl.format ?? (extOf(rel) === 'png' ? 'png' : 'jpg'),
    );
    const avatar = await avatarNameOf(c);
    res.setHeader('Content-Type', out.contentType);
    if (dl.download) {
      res.attachment(
        photoFilename({
          context: kind === 'source' ? 'Personal-original' : 'Personal',
          avatar,
          at: c.createdAt,
          id: c.id,
          ext: out.ext,
        }),
      );
    }
    res.send(out.buf);
  });

  router.patch('/:id', async (req, res) => {
    const body = parse(UpdateBody, req.body);
    const c = await findOwn(req);
    const updated = await prisma.photoCreation.update({
      where: { id: c.id },
      data: body,
      select: listSelect,
    });
    await audit(prisma, req, {
      action: 'CREATION_UPDATED',
      entityType: 'PhotoCreation',
      entityId: c.id,
    });
    res.json(creationDto(updated));
  });

  /**
   * Emails the creation's final photo as an attachment through the configured mail service.
   * Returns once the mail server accepted it; failures come back as clear errors.
   */
  router.post('/:id/email', requirePermission(prisma, 'creation.email'), async (req, res) => {
    const body = parse(ShareEmailBody, req.body);
    const c = await findOwn(req);
    const out = await photoInFormat(
      await readFile(path.resolve(config.privateStorage, c.resultPath)),
      'jpg',
    );
    const result = await emailPhoto(prisma, mailer, {
      userId: req.user!.id,
      sender: req.user!.name,
      body,
      context: `Photo: ${c.title}`,
      file: {
        buf: out.buf,
        contentType: out.contentType,
        filename: photoFilename({
          context: 'Personal',
          avatar: await avatarNameOf(c),
          at: c.createdAt,
          id: c.id,
          ext: out.ext,
        }),
      },
      link: { creationId: c.id },
    });
    await audit(prisma, req, {
      action: 'CREATION_EMAILED',
      entityType: 'PhotoCreation',
      entityId: c.id,
      details: { to: body.to, delivery: result.delivery },
    });
    res.json(result);
  });

  router.delete('/:id', async (req, res) => {
    const c = await findOwn(req);
    await prisma.photoCreation.delete({ where: { id: c.id } });
    await Promise.all(
      [c.sourcePath, c.resultPath].map((p) =>
        rm(path.resolve(config.privateStorage, p), { force: true }),
      ),
    );
    await audit(prisma, req, {
      action: 'CREATION_DELETED',
      entityType: 'PhotoCreation',
      entityId: c.id,
    });
    res.status(204).end();
  });

  return router;
}
