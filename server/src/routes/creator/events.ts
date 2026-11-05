import { rm } from 'node:fs/promises';
import path from 'node:path';
import { Router, type Request } from 'express';
import { Prisma, type Event, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { AppConfig } from '../../config.js';
import { HttpError, parse } from '../../lib/http.js';
import { audit } from '../../lib/audit.js';
import type { Mailer } from '../../lib/mailer.js';
import { inspectImage, makeThumbnail, newFileId, saveFile, uploader } from '../../lib/images.js';
import { removeKeys } from '../../lib/library-storage.js';
import {
  EventEdit,
  EventFields,
  eventDir,
  eventDto,
  eventKey,
  instants,
  newEventCode,
  notifyUsers,
  eventDetails,
  when,
} from '../../lib/events.js';
import { eventPhotoFilename, photoDto, photoInclude } from '../events.js';
import { ZipArchive } from 'archiver';
import { createReadStream } from 'node:fs';
import { resolveKey } from '../../lib/library-storage.js';

/** Only the fields sent are changed — no defaults, so an edit never resets other fields. */
const EventUpdate = EventEdit.extend({
  timezoneOffset: EventFields.shape.timezoneOffset,
}).strict();
const AssignBody = z
  .object({ userIds: z.array(z.string().min(1).max(40)).min(1).max(200) })
  .strict();
const AlbumBody = z
  .object({
    name: z.string().trim().min(1).max(60),
    description: z.string().trim().max(300).default(''),
  })
  .strict();
const MoveBody = z.object({ albumId: z.string().max(40).nullable() }).strict();
const ListQuery = z.object({
  status: z.enum(['DRAFT', 'UPCOMING', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'ARCHIVED']).optional(),
});

/** Fields whose change is worth telling participants about. */
const NOTIFY_FIELDS = [
  'name',
  'eventDate',
  'startTime',
  'endTime',
  'location',
  'instructions',
  'description',
] as const;

/**
 * Event management (permission: event.manage — Creators only). Creators manage all events in the
 * organisation. Employees can only ever be assigned; nothing here changes roles.
 */
export function creatorEventsRouter(
  prisma: PrismaClient,
  config: AppConfig,
  mailer: Mailer,
): Router {
  const router = Router();
  const upload = uploader(config.MAX_UPLOAD_MB);

  const findEvent = async (req: Request) => {
    const e = await prisma.event.findUnique({ where: { id: String(req.params.id) } });
    if (!e) throw new HttpError(404, 'Event not found');
    return e;
  };

  const assigneeIds = async (eventId: string) =>
    (await prisma.eventAssignment.findMany({ where: { eventId }, select: { userId: true } })).map(
      (a) => a.userId,
    );

  const detail = async (id: string) => {
    const e = await prisma.event.findUniqueOrThrow({
      where: { id },
      include: {
        createdBy: { select: { name: true } },
        assignments: {
          orderBy: { createdAt: 'asc' },
          include: { user: { select: { id: true, name: true, email: true, isActive: true } } },
        },
        albums: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          include: { _count: { select: { photos: true } } },
        },
        _count: { select: { photos: true } },
      },
    });
    const perPerson = await prisma.eventPhoto.groupBy({
      by: ['userId'],
      where: { eventId: id },
      _count: true,
    });
    const counts = new Map(perPerson.map((p) => [p.userId, p._count]));
    return {
      ...eventDto(e),
      createdBy: e.createdBy.name,
      photoCount: e._count.photos,
      participants: e.assignments.map((a) => ({
        userId: a.user.id,
        name: a.user.name,
        email: a.user.email,
        isActive: a.user.isActive,
        assignedAt: a.createdAt,
        photoCount: counts.get(a.user.id) ?? 0,
      })),
      albums: e.albums.map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        photoCount: a._count.photos,
      })),
    };
  };

  router.get('/', async (req, res) => {
    const q = parse(ListQuery, req.query);
    const events = await prisma.event.findMany({
      where: q.status ? { status: q.status } : {},
      orderBy: [{ startsAt: 'desc' }],
      include: {
        createdBy: { select: { name: true } },
        _count: { select: { photos: true, assignments: true } },
      },
    });
    res.json(
      events.map((e) => ({
        ...eventDto(e),
        createdBy: e.createdBy.name,
        photoCount: e._count.photos,
        participantCount: e._count.assignments,
      })),
    );
  });

  router.post('/', async (req, res) => {
    const f = parse(EventFields.strict(), req.body);
    const t = instants(f);
    if (!t?.valid) throw new HttpError(400, 'End time must be after the start time');
    const e = await prisma.event.create({
      data: {
        code: await newEventCode(prisma, f.eventDate),
        name: f.name,
        description: f.description,
        instructions: f.instructions,
        location: f.location,
        eventDate: f.eventDate,
        startTime: f.startTime,
        endTime: f.endTime,
        startsAt: t.startsAt,
        endsAt: t.endsAt,
        status: f.status,
        galleryVisibility: f.galleryVisibility,
        createdById: req.user!.id,
      },
    });
    await audit(prisma, req, {
      action: 'EVENT_CREATED',
      entityType: 'Event',
      entityId: e.id,
      details: { code: e.code, status: e.status },
    });
    res.status(201).json(await detail(e.id));
  });

  router.get('/:id', async (req, res) => {
    const e = await findEvent(req);
    res.json(await detail(e.id));
  });

  router.patch('/:id', async (req, res) => {
    const before = await findEvent(req);
    const f = parse(EventUpdate, req.body);
    const merged = {
      eventDate: f.eventDate ?? before.eventDate,
      startTime: f.startTime ?? before.startTime,
      endTime: f.endTime ?? before.endTime,
      timezoneOffset: f.timezoneOffset,
    };
    const timing = f.eventDate || f.startTime || f.endTime ? instants(merged) : null;
    if (timing && !timing.valid) throw new HttpError(400, 'End time must be after the start time');
    const { timezoneOffset: _tz, ...fields } = f;
    const after = await prisma.event.update({
      where: { id: before.id },
      data: { ...fields, ...(timing ? { startsAt: timing.startsAt, endsAt: timing.endsAt } : {}) },
    });

    const changed = NOTIFY_FIELDS.filter((k) => f[k] !== undefined && f[k] !== before[k]);
    await audit(prisma, req, {
      action: f.status && f.status !== before.status ? 'EVENT_STATUS_CHANGED' : 'EVENT_UPDATED',
      entityType: 'Event',
      entityId: after.id,
      details: { changed, from: before.status, to: after.status },
    });
    await notifyForUpdate(before, after, changed, req.user!.id, req.user!.name);
    res.json(await detail(after.id));
  });

  /** Tells participants what changed. Drafts are silent; publishing a draft announces it. */
  const notifyForUpdate = async (
    before: Event,
    after: Event,
    changed: readonly string[],
    actor: string,
    actorName: string,
  ) => {
    const ids = await assigneeIds(after.id);
    if (!ids.length) return;
    const statusChanged = before.status !== after.status;
    if (statusChanged && after.status === 'CANCELLED') {
      return notifyUsers(prisma, mailer, config, ids, {
        type: 'EVENT_CANCELLED',
        title: `Event cancelled: ${after.name}`,
        body: `${after.name} (${after.code}) on ${when(after)} has been cancelled.`,
        eventId: after.id,
        actorId: actor,
        data: eventDetails(after),
        dedupeKey: `event-cancelled:${after.id}`,
      });
    }
    if (statusChanged && after.status === 'COMPLETED') {
      return notifyUsers(prisma, mailer, config, ids, {
        type: 'EVENT_COMPLETED',
        title: `Event completed: ${after.name}`,
        body: `${after.name} (${after.code}) is complete. Its photo gallery stays available.`,
        eventId: after.id,
        actorId: actor,
        data: eventDetails(after),
        dedupeKey: `event-completed:${after.id}`,
      });
    }
    if (
      statusChanged &&
      before.status === 'DRAFT' &&
      ['UPCOMING', 'ACTIVE'].includes(after.status)
    ) {
      return notifyUsers(prisma, mailer, config, ids, {
        type: 'EVENT_ASSIGNED',
        title: 'New Event Assigned!',
        body: `You have been assigned to ${after.name}.`,
        eventId: after.id,
        actorId: actor,
        data: eventDetails(after, actorName),
        dedupeKey: `event-assigned:${after.id}`,
      });
    }
    if (changed.length && !['DRAFT', 'ARCHIVED'].includes(after.status)) {
      return notifyUsers(prisma, mailer, config, ids, {
        type: 'EVENT_UPDATED',
        title: `Event details changed: ${after.name}`,
        body: `${after.name} (${after.code}) was updated (${changed.join(', ')}). Now: ${when(after)} at ${after.location}.`,
        eventId: after.id,
        actorId: actor,
        data: eventDetails(after),
      });
    }
  };

  // ---- Cover image ----------------------------------------------------------

  router.post('/:id/cover', upload.single('cover'), async (req, res) => {
    const e = await findEvent(req);
    const img = await inspectImage(req.file?.buffer, ['jpeg', 'png', 'webp']);
    const id = newFileId();
    const dir = eventDir(config, e.id);
    await saveFile(dir, `cover-${id}.${img.ext}`, req.file!.buffer);
    await saveFile(dir, `cover-${id}-thumb.png`, await makeThumbnail(req.file!.buffer, 640));
    await prisma.event.update({
      where: { id: e.id },
      data: {
        coverKey: eventKey(e.id, `cover-${id}.${img.ext}`),
        coverThumbKey: eventKey(e.id, `cover-${id}-thumb.png`),
      },
    });
    await removeKeys(config, [e.coverKey, e.coverThumbKey]);
    await audit(prisma, req, {
      action: 'EVENT_UPDATED',
      entityType: 'Event',
      entityId: e.id,
      details: { changed: ['cover'] },
    });
    res.json(await detail(e.id));
  });

  router.delete('/:id/cover', async (req, res) => {
    const e = await findEvent(req);
    await prisma.event.update({
      where: { id: e.id },
      data: { coverKey: null, coverThumbKey: null },
    });
    await removeKeys(config, [e.coverKey, e.coverThumbKey]);
    res.json(await detail(e.id));
  });

  // ---- Participants -----------------------------------------------------------

  router.post('/:id/assignments', async (req, res) => {
    const e = await findEvent(req);
    const { userIds } = parse(AssignBody, req.body);
    const unique = [...new Set(userIds)];
    const users = await prisma.user.findMany({
      where: { id: { in: unique }, roleCode: 'EMPLOYEE', isActive: true },
      select: { id: true },
    });
    const valid = new Set(users.map((u) => u.id));
    const invalid = unique.filter((id) => !valid.has(id));
    if (invalid.length) {
      throw new HttpError(
        400,
        'Only active Employee accounts can be assigned to events',
        invalid.map((id) => ({ path: 'userIds', message: id })),
      );
    }
    const existing = new Set(await assigneeIds(e.id));
    const fresh = unique.filter((id) => !existing.has(id));
    if (fresh.length) {
      await prisma.eventAssignment.createMany({
        data: fresh.map((userId) => ({ eventId: e.id, userId, assignedById: req.user!.id })),
      });
      await audit(prisma, req, {
        action: 'EVENT_ASSIGNED',
        entityType: 'Event',
        entityId: e.id,
        details: { userIds: fresh },
      });
      if (!['DRAFT', 'ARCHIVED', 'CANCELLED'].includes(e.status)) {
        await notifyUsers(prisma, mailer, config, fresh, {
          type: 'EVENT_ASSIGNED',
          title: 'New Event Assigned!',
          body: `You have been assigned to ${e.name}.`,
          eventId: e.id,
          actorId: req.user!.id,
          data: eventDetails(e, req.user!.name),
          dedupeKey: `event-assigned:${e.id}`,
        });
      }
    }
    res.json({
      added: fresh,
      alreadyAssigned: unique.filter((id) => existing.has(id)),
      event: await detail(e.id),
    });
  });

  router.delete('/:id/assignments/:userId', async (req, res) => {
    const e = await findEvent(req);
    const userId = String(req.params.userId);
    const r = await prisma.eventAssignment.deleteMany({ where: { eventId: e.id, userId } });
    if (!r.count) throw new HttpError(404, 'That person is not assigned to this event');
    await audit(prisma, req, {
      action: 'EVENT_UNASSIGNED',
      entityType: 'Event',
      entityId: e.id,
      details: { userId },
    });
    // Their photos stay in the event gallery (Creators can remove them individually).
    res.json(await detail(e.id));
  });

  // ---- Gallery & albums -----------------------------------------------------

  router.get('/:id/photos', async (req, res) => {
    const e = await findEvent(req);
    const photos = await prisma.eventPhoto.findMany({
      where: { eventId: e.id },
      orderBy: { createdAt: 'desc' },
      include: photoInclude,
    });
    res.json(photos.map((p) => photoDto(p, { userId: req.user!.id, canSeeOriginal: true })));
  });

  /**
   * Exports the event's photos (or one album) as a ZIP: the final images in album folders,
   * named meaningfully, plus manifest.csv. Streamed, so large events don't sit in memory.
   */
  router.get('/:id/export.zip', async (req, res) => {
    const e = await findEvent(req);
    const albumId = typeof req.query.albumId === 'string' ? req.query.albumId : undefined;
    const photos = await prisma.eventPhoto.findMany({
      where: {
        eventId: e.id,
        ...(albumId === 'none' ? { albumId: null } : albumId ? { albumId } : {}),
      },
      orderBy: { capturedAt: 'asc' },
      include: photoInclude,
    });
    if (!photos.length) throw new HttpError(404, 'There are no photos to export');
    const album = albumId && albumId !== 'none' ? photos[0].album?.name : null;
    const zipName = `${e.code}${album ? '_' + album.replace(/[^\w-]+/g, '-') : ''}_photos.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.attachment(zipName);
    const zip = new ZipArchive({ zlib: { level: 1 } });
    zip.on('warning', (w) => console.warn('zip warning', w));
    zip.on('error', (err) => {
      console.error('zip failed', err);
      res.destroy(err);
    });
    zip.pipe(res);

    const csv = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const rows = ['photo_id,file,album,employee,captured_at,created_at,avatar,event_id,event_code'];
    for (const p of photos) {
      const folder = (p.album?.name ?? 'Unsorted').replace(/[\\/:*?"<>|]+/g, '-');
      const file = `${folder}/${eventPhotoFilename(p, path.extname(p.finalPath).slice(1))}`;
      zip.append(createReadStream(resolveKey(config, p.finalPath)), {
        name: file,
        date: p.capturedAt,
      });
      rows.push(
        [
          p.id,
          file,
          p.album?.name ?? '',
          p.user.name,
          p.capturedAt.toISOString(),
          p.createdAt.toISOString(),
          p.avatar?.name ?? (p.generatedAvatar ? 'AI-generated' : ''),
          e.id,
          e.code,
        ]
          .map(csv)
          .join(','),
      );
    }
    zip.append(rows.join('\n') + '\n', { name: 'manifest.csv' });
    await audit(prisma, req, {
      action: 'EVENT_EXPORTED',
      entityType: 'Event',
      entityId: e.id,
      details: { photos: photos.length, albumId: albumId ?? null },
    });
    await zip.finalize();
  });

  /** Removes unwanted content: database row first, then the stored files. Audited. */
  router.delete('/:id/photos/:photoId', async (req, res) => {
    const e = await findEvent(req);
    const p = await prisma.eventPhoto.findFirst({
      where: { id: String(req.params.photoId), eventId: e.id },
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
      details: { eventId: e.id, ownerId: p.userId, by: 'creator' },
    });
    res.status(204).end();
  });

  router.post('/:id/albums', async (req, res) => {
    const e = await findEvent(req);
    const body = parse(AlbumBody, req.body);
    try {
      const count = await prisma.eventAlbum.count({ where: { eventId: e.id } });
      await prisma.eventAlbum.create({ data: { ...body, eventId: e.id, sortOrder: count } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new HttpError(409, 'An album with this name already exists');
      }
      throw err;
    }
    await audit(prisma, req, {
      action: 'EVENT_ALBUM_CHANGED',
      entityType: 'Event',
      entityId: e.id,
      details: { created: body.name },
    });
    res.status(201).json(await detail(e.id));
  });

  router.patch('/:id/albums/:albumId', async (req, res) => {
    const e = await findEvent(req);
    const body = parse(AlbumBody.partial().strict(), req.body);
    const r = await prisma.eventAlbum.updateMany({
      where: { id: String(req.params.albumId), eventId: e.id },
      data: body,
    });
    if (!r.count) throw new HttpError(404, 'Album not found');
    res.json(await detail(e.id));
  });

  /** Deleting an album keeps its photos (they move back to "Unsorted"). */
  router.delete('/:id/albums/:albumId', async (req, res) => {
    const e = await findEvent(req);
    const r = await prisma.eventAlbum.deleteMany({
      where: { id: String(req.params.albumId), eventId: e.id },
    });
    if (!r.count) throw new HttpError(404, 'Album not found');
    await audit(prisma, req, {
      action: 'EVENT_ALBUM_CHANGED',
      entityType: 'Event',
      entityId: e.id,
      details: { deleted: req.params.albumId },
    });
    res.json(await detail(e.id));
  });

  router.put('/:id/photos/:photoId/album', async (req, res) => {
    const e = await findEvent(req);
    const { albumId } = parse(MoveBody, req.body);
    if (albumId && !(await prisma.eventAlbum.count({ where: { id: albumId, eventId: e.id } }))) {
      throw new HttpError(400, 'That album belongs to a different event');
    }
    const r = await prisma.eventPhoto.updateMany({
      where: { id: String(req.params.photoId), eventId: e.id },
      data: { albumId },
    });
    if (!r.count) throw new HttpError(404, 'Not found');
    res.status(204).end();
  });

  return router;
}
