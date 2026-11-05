import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { Router, type Request } from 'express';
import type { Event, EventPhoto, Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { PHOTO_SOURCES } from '../lib/domain.js';
import { HttpError, parse } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import type { Mailer } from '../lib/mailer.js';
import { inspectImage, makeThumbnail, newFileId, saveFile, uploader } from '../lib/images.js';
import { resolveKey } from '../lib/library-storage.js';
import { canCapture, EMPLOYEE_VISIBLE, eventDir, eventDto, eventKey } from '../lib/events.js';
import { requirePermission } from '../middleware/auth.js';
import { photoCreated } from '../lib/activity.js';
import {
  DownloadQuery,
  emailPhoto,
  extOf,
  photoFilename,
  photoInFormat,
  ShareEmailBody,
} from '../lib/share.js';

const SaveFields = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  source: z.enum(PHOTO_SOURCES),
  avatarId: z.string().max(40).optional(),
  generatedAvatarId: z.string().max(40).optional(),
  /** When the photo was captured/uploaded in the browser (ISO). Defaults to now. */
  capturedAt: z.coerce.date().optional(),
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

export const photoInclude = {
  user: { select: { id: true, name: true } },
  album: { select: { id: true, name: true } },
  event: { select: { code: true, name: true } },
  avatar: { select: { id: true, name: true, typeCode: true } },
  generatedAvatar: { select: { id: true, job: { select: { prompt: true, typeCode: true } } } },
} as const;

type PhotoRow = EventPhoto & {
  user: { id: string; name: string };
  album: { id: string; name: string } | null;
  event: { code: string; name: string };
  avatar: { id: string; name: string; typeCode: string } | null;
  generatedAvatar: { id: string; job: { prompt: string; typeCode: string } } | null;
};

/** "Avatar used" as people read it. */
const avatarInfo = (p: Pick<PhotoRow, 'avatar' | 'generatedAvatar'>) =>
  p.avatar
    ? { kind: 'library' as const, name: p.avatar.name, type: p.avatar.typeCode }
    : p.generatedAvatar
      ? {
          kind: 'generated' as const,
          name: `AI: ${p.generatedAvatar.job.prompt.slice(0, 40)}`,
          type: p.generatedAvatar.job.typeCode,
        }
      : null;

/** File name for downloads, ZIP entries and email attachments. */
export const eventPhotoFilename = (p: PhotoRow, ext: string) =>
  photoFilename({
    context: p.event.code,
    person: p.user.name,
    avatar: p.avatar?.name ?? (p.generatedAvatar ? 'AI-avatar' : null),
    at: p.capturedAt,
    id: p.id,
    ext,
  });

/** Public shape of an event photo. Storage paths are replaced by access-checked URLs. */
export function photoDto(p: PhotoRow, viewer: { userId: string; canSeeOriginal: boolean }) {
  const base = `/api/events/${p.eventId}/photos/${p.id}/image`;
  const mine = p.userId === viewer.userId;
  return {
    id: p.id,
    eventId: p.eventId,
    eventCode: p.event.code,
    eventName: p.event.name,
    avatarUsed: avatarInfo(p),
    title: p.title,
    owner: { id: p.user.id, name: p.user.name },
    mine,
    album: p.album,
    avatarId: p.avatarId,
    generatedAvatarId: p.generatedAvatarId,
    source: p.source,
    capturedAt: p.capturedAt,
    createdAt: p.createdAt,
    thumbUrl: `${base}/thumb`,
    finalUrl: `${base}/final`,
    downloadUrl: `${base}/final?download=1&format=jpg`,
    downloadPngUrl: `${base}/final?download=1&format=png`,
    originalUrl: mine || viewer.canSeeOriginal ? `${base}/original` : null,
  };
}

/**
 * Events for signed-in users. Every route re-checks access on the server:
 *  - Employees: must be assigned, and the event must not be a draft or archived (else 404).
 *  - Creators: may open any event (they manage them).
 * Photos are always looked up together with their event id, so one event's URLs can never
 * reach another event's photos.
 */
export function eventsRouter(prisma: PrismaClient, config: AppConfig, mailer: Mailer): Router {
  const router = Router();
  const upload = uploader(config.MAX_UPLOAD_MB);

  const isCreator = (req: Request) => req.user!.role === 'CREATOR';

  /** Loads an event the caller may enter, or 404s (never reveals that it exists). */
  const enter = async (req: Request, id = String(req.params.id)): Promise<Event> => {
    const e = await prisma.event.findUnique({ where: { id } });
    if (!e) throw new HttpError(404, 'Event not found');
    if (isCreator(req)) return e;
    const assigned = await prisma.eventAssignment.count({
      where: { eventId: e.id, userId: req.user!.id },
    });
    if (!assigned || !EMPLOYEE_VISIBLE.includes(e.status))
      throw new HttpError(404, 'Event not found');
    return e;
  };

  /** Which photos of this event the caller may see. */
  const visibleWhere = (req: Request, e: Event): Prisma.EventPhotoWhereInput =>
    isCreator(req) || e.galleryVisibility === 'PARTICIPANTS'
      ? { eventId: e.id }
      : { eventId: e.id, userId: req.user!.id };

  const findPhoto = async (req: Request, e: Event) => {
    const p = await prisma.eventPhoto.findFirst({
      where: { ...visibleWhere(req, e), id: String(req.params.photoId) },
      include: photoInclude,
    });
    if (!p) throw new HttpError(404, 'Not found');
    return p;
  };

  /** "My Events": only events this user is assigned to (Drafts / Archived hidden). */
  router.get('/mine', async (req, res) => {
    const rows = await prisma.event.findMany({
      where: {
        status: { in: EMPLOYEE_VISIBLE },
        assignments: { some: { userId: req.user!.id } },
      },
      orderBy: { startsAt: 'asc' },
    });
    const out = await Promise.all(
      rows.map(async (e) => ({
        ...eventDto(e),
        photoCount: await prisma.eventPhoto.count({ where: visibleWhere(req, e) }),
        myPhotoCount: await prisma.eventPhoto.count({
          where: { eventId: e.id, userId: req.user!.id },
        }),
      })),
    );
    res.json(out);
  });

  router.get('/:id', async (req, res) => {
    const e = await enter(req);
    const [photoCount, myPhotoCount, participantCount] = await Promise.all([
      prisma.eventPhoto.count({ where: visibleWhere(req, e) }),
      prisma.eventPhoto.count({ where: { eventId: e.id, userId: req.user!.id } }),
      prisma.eventAssignment.count({ where: { eventId: e.id } }),
    ]);
    const assigned = await prisma.eventAssignment.count({
      where: { eventId: e.id, userId: req.user!.id },
    });
    res.json({
      ...eventDto(e),
      photoCount,
      myPhotoCount,
      participantCount,
      // Only assigned participants capture; Creators manage.
      canCapture: !!assigned && canCapture(e),
    });
  });

  router.get('/:id/cover', async (req, res) => {
    const e = await enter(req);
    const key = req.query.thumb ? (e.coverThumbKey ?? e.coverKey) : e.coverKey;
    if (!key) throw new HttpError(404, 'No cover image');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(resolveKey(config, key));
  });

  router.get('/:id/photos', async (req, res) => {
    const e = await enter(req);
    const photos = await prisma.eventPhoto.findMany({
      where: visibleWhere(req, e),
      orderBy: { createdAt: 'desc' },
      include: photoInclude,
    });
    res.json(
      photos.map((p) => photoDto(p, { userId: req.user!.id, canSeeOriginal: isCreator(req) })),
    );
  });

  /** "Save to Event": the event comes from the URL the user is working in — never re-chosen. */
  router.post(
    '/:id/photos',
    upload.fields([
      { name: 'photo', maxCount: 1 },
      { name: 'result', maxCount: 1 },
    ]),
    async (req, res) => {
      const e = await enter(req);
      const assigned = await prisma.eventAssignment.count({
        where: { eventId: e.id, userId: req.user!.id },
      });
      if (!assigned)
        throw new HttpError(403, 'Only assigned participants can add photos to this event');
      if (!canCapture(e)) throw new HttpError(409, 'This event is not accepting new photos');

      const fields = parse(SaveFields, req.body);
      const files = req.files as Record<string, Express.Multer.File[]> | undefined;
      const original = await inspectImage(files?.photo?.[0]?.buffer, ['jpeg', 'png', 'webp']);
      const final = await inspectImage(files?.result?.[0]?.buffer, ['png', 'jpeg', 'webp']);
      if (
        fields.avatarId &&
        !(await prisma.avatar.count({ where: { id: fields.avatarId, isActive: true } }))
      ) {
        throw new HttpError(400, 'Avatar is not available');
      }
      if (
        fields.generatedAvatarId &&
        !(await prisma.generatedAvatar.count({
          where: { id: fields.generatedAvatarId, userId: req.user!.id },
        }))
      ) {
        throw new HttpError(400, 'Generated avatar not found');
      }

      const id = newFileId();
      const dir = path.join(eventDir(config, e.id), 'photos');
      const finalBuf = files!.result![0].buffer;
      await saveFile(dir, `${id}-original.${original.ext}`, files!.photo![0].buffer);
      await saveFile(dir, `${id}-final.${final.ext}`, finalBuf);
      await saveFile(dir, `${id}-thumb.png`, await makeThumbnail(finalBuf, 480));
      const photo = await prisma.eventPhoto.create({
        data: {
          eventId: e.id,
          userId: req.user!.id,
          avatarId: fields.avatarId ?? null,
          generatedAvatarId: fields.generatedAvatarId ?? null,
          title: fields.title ?? 'Event photo',
          source: fields.source,
          originalPath: eventKey(e.id, 'photos', `${id}-original.${original.ext}`),
          finalPath: eventKey(e.id, 'photos', `${id}-final.${final.ext}`),
          thumbPath: eventKey(e.id, 'photos', `${id}-thumb.png`),
          layout: fields.layout,
          capturedAt: fields.capturedAt ?? new Date(),
        },
        include: photoInclude,
      });
      await audit(prisma, req, {
        action: 'EVENT_PHOTO_CREATED',
        entityType: 'EventPhoto',
        entityId: photo.id,
        details: { eventId: e.id, code: e.code },
      });
      await photoCreated(prisma, {
        userId: req.user!.id,
        kind: 'event',
        id: photo.id,
        avatarId: photo.avatarId,
        generatedAvatarId: photo.generatedAvatarId,
        createdAt: photo.createdAt,
        event: { id: e.id, name: e.name, code: e.code },
      }).catch((err) => console.error('photo notification failed', err));
      res.status(201).json(photoDto(photo, { userId: req.user!.id, canSeeOriginal: false }));
    },
  );

  router.get('/:id/photos/:photoId/image/:kind', async (req, res) => {
    const kind = parse(z.enum(['final', 'thumb', 'original']), req.params.kind);
    const e = await enter(req);
    const p = await findPhoto(req, e);
    // The unedited original is only for its owner and Creators.
    if (kind === 'original' && p.userId !== req.user!.id && !isCreator(req)) {
      throw new HttpError(404, 'Not found');
    }
    const key = kind === 'final' ? p.finalPath : kind === 'thumb' ? p.thumbPath : p.originalPath;
    const dl = parse(DownloadQuery, req.query);
    res.setHeader('Cache-Control', 'private, no-store');
    if (!dl.download && !dl.format) {
      res.sendFile(resolveKey(config, key));
      return;
    }
    const out = await photoInFormat(
      await readFile(resolveKey(config, key)),
      dl.format ?? (extOf(key) === 'png' ? 'png' : 'jpg'),
    );
    res.setHeader('Content-Type', out.contentType);
    if (dl.download) res.attachment(eventPhotoFilename(p, out.ext));
    res.send(out.buf);
  });

  /** Employees delete their own event photos (Creators use the management route). */
  router.delete('/:id/photos/:photoId', async (req, res) => {
    const e = await enter(req);
    const p = await prisma.eventPhoto.findFirst({
      where: { id: String(req.params.photoId), eventId: e.id, userId: req.user!.id },
    });
    if (!p) throw new HttpError(404, 'Not found');
    await prisma.eventPhoto.delete({ where: { id: p.id } });
    await Promise.all(
      [p.originalPath, p.finalPath, p.thumbPath].map((k) =>
        rm(path.resolve(config.privateStorage, k), { force: true }),
      ),
    );
    await audit(prisma, req, {
      action: 'EVENT_PHOTO_DELETED',
      entityType: 'EventPhoto',
      entityId: p.id,
      details: { eventId: e.id, by: 'owner' },
    });
    res.status(204).end();
  });

  /**
   * Emails a photo the caller is allowed to see, as an attachment, through the configured mail
   * service. Returns once the mail server accepted it.
   */
  router.post(
    '/:id/photos/:photoId/email',
    requirePermission(prisma, 'creation.email'),
    async (req, res) => {
      const body = parse(ShareEmailBody, req.body);
      const e = await enter(req);
      const p = await findPhoto(req, e);
      const out = await photoInFormat(await readFile(resolveKey(config, p.finalPath)), 'jpg');
      const result = await emailPhoto(prisma, mailer, {
        userId: req.user!.id,
        sender: req.user!.name,
        body,
        context: `Photo from ${e.name} (${e.code}), taken by ${p.user.name} on ${p.capturedAt.toLocaleString()}.`,
        file: {
          buf: out.buf,
          contentType: out.contentType,
          filename: eventPhotoFilename(p, out.ext),
        },
        link: { eventPhotoId: p.id },
      });
      await audit(prisma, req, {
        action: 'EVENT_PHOTO_EMAILED',
        entityType: 'EventPhoto',
        entityId: p.id,
        details: { eventId: e.id, to: body.to, delivery: result.delivery },
      });
      res.json(result);
    },
  );

  return router;
}
