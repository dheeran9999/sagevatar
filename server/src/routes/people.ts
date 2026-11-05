import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Router, type Request } from 'express';
import type { EmployeePhoto, Prisma, PrismaClient } from '@prisma/client';
import sharp from 'sharp';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { HttpError, parse } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { inspectImage, makeThumbnail, newFileId, saveFile, uploader } from '../lib/images.js';
import { removeKeys, resolveKey } from '../lib/library-storage.js';
import { FaceBoxSchema } from '../lib/poster/faces.js';
import {
  canEditPhoto,
  eventParticipantIds,
  managesPhotos,
  posterEvent,
  usablePhotoWhere,
} from '../lib/poster/access.js';
import { requirePermission } from '../middleware/auth.js';

const MIN_PHOTO_PX = 200;

const jsonField = <T extends z.ZodType>(schema: T) =>
  z
    .string()
    .max(2000)
    .transform((s, ctx) => {
      try {
        return JSON.parse(s) as unknown;
      } catch {
        ctx.addIssue({ code: 'custom', message: 'must be valid JSON' });
        return z.NEVER;
      }
    })
    .pipe(schema);

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const UploadFields = z.object({
  face: jsonField(FaceBoxSchema.nullable()).optional(),
  faceSource: z.enum(['auto', 'manual', 'none']).default('none'),
  /** Required when a Creator uploads a photo of someone else. */
  consentConfirmed: bool.optional(),
  /** Only the person in the photo can choose to share it with colleagues. */
  shareWithColleagues: bool.optional(),
  makePrimary: bool.optional(),
});

const PhotoPatch = z
  .object({
    face: FaceBoxSchema.nullable().optional(),
    faceSource: z.enum(['auto', 'manual', 'none']).optional(),
    shareWithColleagues: z.boolean().optional(),
    isPrimary: z.literal(true).optional(),
  })
  .strict();

const ListQuery = z.object({
  q: z.string().trim().max(80).optional(),
  eventId: z.string().max(40).optional(),
  take: z.coerce.number().int().min(1).max(100).default(60),
});

const CodeBody = z
  .object({
    employeeCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9-]{1,23}$/, 'Use letters, numbers and dashes (2–24 characters)')
      .nullable(),
  })
  .strict();

export const peopleKey = (userId: string, file: string) => path.posix.join('people', userId, file);

export function photoDto(p: EmployeePhoto & { uploadedBy?: { name: string } | null }, viewer: { id: string; manages: boolean }) {
  const base = `/api/people/photos/${p.id}`;
  const v = p.updatedAt.getTime().toString(36);
  return {
    id: p.id,
    userId: p.userId,
    fileUrl: `${base}/file?v=${v}`,
    thumbUrl: `${base}/thumb?v=${v}`,
    hasMask: !!p.maskKey,
    maskUrl: p.maskKey ? `${base}/mask?v=${v}` : null,
    width: p.width,
    height: p.height,
    face: p.face as z.infer<typeof FaceBoxSchema> | null,
    faceSource: p.faceSource,
    isPrimary: p.isPrimary,
    consentBasis: p.consentBasis,
    consentConfirmedAt: p.consentConfirmedAt,
    shareWithColleagues: p.shareWithColleagues,
    uploadedBy: p.uploadedBy?.name ?? null,
    createdAt: p.createdAt,
    canEdit: p.userId === viewer.id || viewer.manages,
    canShare: p.userId === viewer.id,
  };
}

/**
 * Employee directory + authorised employee photographs for group designs.
 * Photos live in private storage and are streamed only to people allowed to use them.
 */
export function peopleRouter(prisma: PrismaClient, config: AppConfig): Router {
  const router = Router();
  const upload = uploader(config.MAX_UPLOAD_MB);
  const viewer = (req: Request) => ({ id: req.user!.id, manages: managesPhotos(req.user!) });

  const participantsOf = async (req: Request, eventId?: string) => {
    if (!eventId) return null;
    await posterEvent(prisma, req.user!, eventId);
    return managesPhotos(req.user!) ? null : eventParticipantIds(prisma, eventId);
  };

  /** A photo the caller may USE (view / place in a poster); 404 otherwise. */
  const usablePhoto = async (req: Request) => {
    const p = await prisma.employeePhoto.findFirst({
      where: { id: String(req.params.photoId), ...usablePhotoWhere(req.user!) },
      include: { uploadedBy: { select: { name: true } } },
    });
    if (!p) throw new HttpError(404, 'Photo not found');
    return p;
  };

  // ---- Photos ---------------------------------------------------------------

  router.get('/photos/:photoId/:variant', async (req, res) => {
    const variant = parse(z.enum(['file', 'thumb', 'mask']), req.params.variant);
    const p = await usablePhoto(req);
    const key = variant === 'file' ? p.fileKey : variant === 'thumb' ? p.thumbKey : p.maskKey;
    if (!key) throw new HttpError(404, 'Not found');
    const buf = await readFile(resolveKey(config, key)).catch(() => {
      throw new HttpError(404, 'Not found');
    });
    res.setHeader('Content-Type', variant === 'file' ? p.mimeType : 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(buf);
  });

  router.patch('/photos/:photoId', async (req, res) => {
    const body = parse(PhotoPatch, req.body);
    const p = await usablePhoto(req);
    if (!canEditPhoto(req.user!, p)) throw new HttpError(403, 'Only the person in the photo or a Creator can change it');
    if (body.shareWithColleagues !== undefined && p.userId !== req.user!.id) {
      throw new HttpError(403, 'Only the person in the photo can choose to share it with colleagues');
    }
    const data: Prisma.EmployeePhotoUpdateInput = {};
    if (body.face !== undefined) {
      data.face = body.face ?? undefined;
      data.faceSource = body.face ? (body.faceSource ?? 'manual') : 'none';
      if (body.face === null) data.face = { set: null } as never;
    }
    if (body.shareWithColleagues !== undefined) data.shareWithColleagues = body.shareWithColleagues;
    const updated = await prisma.$transaction(async (tx) => {
      if (body.isPrimary) {
        await tx.employeePhoto.updateMany({ where: { userId: p.userId }, data: { isPrimary: false } });
        data.isPrimary = true;
      }
      return tx.employeePhoto.update({
        where: { id: p.id },
        data,
        include: { uploadedBy: { select: { name: true } } },
      });
    });
    await audit(prisma, req, {
      action: 'EMPLOYEE_PHOTO_UPDATED',
      entityType: 'EmployeePhoto',
      entityId: p.id,
      details: { fields: Object.keys(body) },
    });
    res.json(photoDto(updated, viewer(req)));
  });

  /** Withdraw a photo: files are deleted and it can never be used again. */
  router.delete('/photos/:photoId', async (req, res) => {
    const p = await usablePhoto(req);
    if (!canEditPhoto(req.user!, p)) throw new HttpError(403, 'Only the person in the photo or a Creator can remove it');
    await prisma.employeePhoto.update({
      where: { id: p.id },
      data: { isActive: false, isPrimary: false, shareWithColleagues: false },
    });
    await removeKeys(config, [p.fileKey, p.thumbKey, p.maskKey]);
    await audit(prisma, req, {
      action: 'EMPLOYEE_PHOTO_WITHDRAWN',
      entityType: 'EmployeePhoto',
      entityId: p.id,
      details: { subjectId: p.userId },
    });
    res.status(204).end();
  });

  // ---- People ---------------------------------------------------------------

  /**
   * Search people by name, email or Employee ID. Creators see every active user;
   * Employees see themselves plus colleagues who shared at least one photo (in an event:
   * only its participants).
   */
  router.get('/', async (req, res) => {
    const q = parse(ListQuery, req.query);
    const me = req.user!;
    const participants = await participantsOf(req, q.eventId);
    const usable = usablePhotoWhere(me, participants);
    const and: Prisma.UserWhereInput[] = [{ isActive: true }];
    if (q.q) {
      and.push({
        OR: [
          { name: { contains: q.q } },
          { email: { contains: q.q.toLowerCase() } },
          { employeeCode: { contains: q.q.toUpperCase() } },
        ],
      });
    }
    if (!managesPhotos(me)) {
      and.push({
        OR: [{ id: me.id }, { employeePhotos: { some: { ...usable, userId: { not: me.id } } } }],
      });
    } else if (q.eventId) {
      and.push({ eventAssignments: { some: { eventId: q.eventId } } });
    }
    const users = await prisma.user.findMany({
      where: { AND: and },
      orderBy: { name: 'asc' },
      take: q.take,
      select: {
        id: true,
        name: true,
        email: true,
        employeeCode: true,
        roleCode: true,
        employeePhotos: {
          where: usable,
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
          select: { id: true, updatedAt: true },
        },
      },
    });
    res.json({
      canManage: managesPhotos(me),
      items: users.map((u) => ({
        id: u.id,
        name: u.name,
        // Emails are only shown to Creators (directory management).
        email: managesPhotos(me) || u.id === me.id ? u.email : null,
        employeeCode: u.employeeCode,
        role: u.roleCode,
        isSelf: u.id === me.id,
        photoCount: u.employeePhotos.length,
        primaryPhoto: u.employeePhotos[0]
          ? {
              id: u.employeePhotos[0].id,
              thumbUrl: `/api/people/photos/${u.employeePhotos[0].id}/thumb?v=${u.employeePhotos[0].updatedAt.getTime().toString(36)}`,
            }
          : null,
      })),
    });
  });

  const subjectId = (req: Request) => (req.params.userId === 'me' ? req.user!.id : String(req.params.userId));

  router.get('/:userId/photos', async (req, res) => {
    const id = subjectId(req);
    const eventId = typeof req.query.eventId === 'string' ? req.query.eventId : undefined;
    const participants = await participantsOf(req, eventId);
    const photos = await prisma.employeePhoto.findMany({
      where: { userId: id, ...usablePhotoWhere(req.user!, participants) },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
      include: { uploadedBy: { select: { name: true } } },
    });
    res.json(photos.map((p) => photoDto(p, viewer(req))));
  });

  router.post(
    '/:userId/photos',
    upload.fields([
      { name: 'photo', maxCount: 1 },
      { name: 'mask', maxCount: 1 },
    ]),
    async (req, res) => {
      const me = req.user!;
      const id = subjectId(req);
      const self = id === me.id;
      if (!self && !managesPhotos(me)) {
        throw new HttpError(403, 'You can only add photos of yourself');
      }
      const subject = await prisma.user.findFirst({ where: { id, isActive: true }, select: { id: true, name: true } });
      if (!subject) throw new HttpError(404, 'Person not found');

      const fields = parse(UploadFields, req.body);
      if (!self && fields.consentConfirmed !== true) {
        throw new HttpError(
          422,
          `Confirm that ${subject.name} has authorised the use of this photograph before uploading it.`,
        );
      }
      if (!self && fields.shareWithColleagues) {
        throw new HttpError(403, 'Only the person in the photo can choose to share it with colleagues');
      }

      const files = req.files as Record<string, Express.Multer.File[]> | undefined;
      const photoBuf = files?.photo?.[0]?.buffer;
      const img = await inspectImage(photoBuf, ['jpeg', 'png', 'webp']);
      // Use the displayed (EXIF-oriented) size — face boxes and masks are measured on it.
      const oriented = await sharp(photoBuf!).rotate().metadata();
      const width = oriented.autoOrient?.width ?? oriented.width ?? img.width;
      const height = oriented.autoOrient?.height ?? oriented.height ?? img.height;
      if (Math.min(width, height) < MIN_PHOTO_PX) {
        throw new HttpError(400, `Photos must be at least ${MIN_PHOTO_PX} × ${MIN_PHOTO_PX} pixels`);
      }
      if (img.isAnimated) throw new HttpError(400, 'Animated images are not supported');
      let maskBuf: Buffer | null = null;
      if (files?.mask?.[0]) {
        await inspectImage(files.mask[0].buffer, ['png']);
        maskBuf = await sharp(files.mask[0].buffer)
          .resize(width, height, { fit: 'fill' })
          .toColourspace('b-w')
          .png()
          .toBuffer();
      }

      const fileId = newFileId();
      const dir = path.join(config.privateStorage, 'people', id);
      const fileKey = peopleKey(id, `${fileId}.${img.ext}`);
      const thumbKey = peopleKey(id, `${fileId}-thumb.png`);
      const maskKey = maskBuf ? peopleKey(id, `${fileId}-mask.png`) : null;
      try {
        await saveFile(dir, path.basename(fileKey), photoBuf!);
        await saveFile(dir, path.basename(thumbKey), await makeThumbnail(await sharp(photoBuf!).rotate().toBuffer(), 320));
        if (maskBuf && maskKey) await saveFile(dir, path.basename(maskKey), maskBuf);
      } catch {
        await removeKeys(config, [fileKey, thumbKey, maskKey]);
        throw new HttpError(507, 'The photo could not be stored. Please try again.');
      }

      const hasPrimary = await prisma.employeePhoto.count({ where: { userId: id, isActive: true, isPrimary: true } });
      const makePrimary = fields.makePrimary === true || !hasPrimary;
      const face = fields.face ?? null;
      const created = await prisma.$transaction(async (tx) => {
        if (makePrimary) await tx.employeePhoto.updateMany({ where: { userId: id }, data: { isPrimary: false } });
        return tx.employeePhoto.create({
          data: {
            userId: id,
            uploadedById: me.id,
            fileKey,
            thumbKey,
            maskKey,
            mimeType: img.mimeType,
            width,
            height,
            sizeBytes: img.sizeBytes,
            sha256: img.sha256,
            face: face ?? undefined,
            faceSource: face ? fields.faceSource === 'none' ? 'auto' : fields.faceSource : 'none',
            isPrimary: makePrimary,
            consentBasis: self ? 'SELF' : 'CREATOR_CONFIRMED',
            consentConfirmedAt: new Date(),
            shareWithColleagues: self ? (fields.shareWithColleagues ?? false) : false,
          },
          include: { uploadedBy: { select: { name: true } } },
        });
      });
      await audit(prisma, req, {
        action: 'EMPLOYEE_PHOTO_ADDED',
        entityType: 'EmployeePhoto',
        entityId: created.id,
        details: { subjectId: id, consentBasis: created.consentBasis, faceSource: created.faceSource, mask: !!maskKey },
      });
      res.status(201).json(photoDto(created, viewer(req)));
    },
  );

  router.put('/:userId/employee-code', requirePermission(prisma, 'people.photos.manage'), async (req, res) => {
    const body = parse(CodeBody, req.body);
    const id = subjectId(req);
    const clash = body.employeeCode
      ? await prisma.user.findFirst({ where: { employeeCode: body.employeeCode, id: { not: id } }, select: { id: true } })
      : null;
    if (clash) throw new HttpError(409, `Employee ID ${body.employeeCode} is already used by someone else`);
    const u = await prisma.user.update({
      where: { id },
      data: { employeeCode: body.employeeCode },
      select: { id: true, employeeCode: true },
    }).catch(() => {
      throw new HttpError(404, 'Person not found');
    });
    await audit(prisma, req, { action: 'EMPLOYEE_CODE_SET', entityType: 'User', entityId: id, details: { employeeCode: u.employeeCode } });
    res.json(u);
  });

  return router;
}
