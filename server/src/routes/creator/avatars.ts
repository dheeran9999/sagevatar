import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { Router, type Request } from 'express';
import type { Avatar, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { AppConfig } from '../../config.js';
import { AVATAR_TYPES, type AvatarType } from '../../lib/domain.js';
import { HttpError, parse } from '../../lib/http.js';
import { audit } from '../../lib/audit.js';
import { PROTECTED_TERMS } from '../../lib/copyright.js';
import {
  hasTransparency,
  inspectImage,
  makeThumbnail,
  newFileId,
  saveFile,
  uploader,
  type ImageFormat,
} from '../../lib/images.js';
import {
  avatarUrls,
  libraryDir,
  libraryKey,
  normalizeTags,
  removeKeys,
  resolveKey,
  splitTags,
} from '../../lib/library-storage.js';
import { PlacementSchema } from '../../lib/schemas.js';

const SOURCES = ['ORIGINAL', 'IN_HOUSE', 'LICENSED', 'PUBLIC_DOMAIN'] as const;
/** AI_GENERATED is only set by publishing a generated image; edits may keep it. */
const EDIT_SOURCES = [...SOURCES, 'AI_GENERATED'] as const;
const STYLES = ['PROFESSIONAL', 'CASUAL', 'THEMED'] as const;

/** Character avatars must be cut-outs; backgrounds can be any photo format. */
const FORMATS: Record<AvatarType, ImageFormat[]> = {
  FACE: ['png', 'webp'],
  HALF_BODY: ['png', 'webp'],
  FULL_BODY: ['png', 'webp'],
  BACKGROUND: ['png', 'webp', 'jpeg'],
};

const optionalUrl = z
  .string()
  .trim()
  .max(500)
  .transform((v) => v || undefined)
  .pipe(z.string().url('Enter a full URL starting with https://').optional())
  .optional();
const optionalDate = z
  .string()
  .trim()
  .transform((v) => (v ? new Date(v) : null))
  .refine((d) => d === null || !Number.isNaN(d.getTime()), 'Enter a valid date')
  .optional();

const LicenseFields = {
  sourceType: z.enum(SOURCES),
  sourceName: z.string().trim().max(120).default(''),
  sourceUrl: optionalUrl,
  licenseName: z
    .string()
    .trim()
    .min(2, 'Enter the licence (e.g. “Original work”, “Adobe Stock Standard”)')
    .max(120),
  licenseUrl: optionalUrl,
  licenseNotes: z.string().trim().max(1000).default(''),
  attribution: z.string().trim().max(200).default(''),
  licenseExpiresAt: optionalDate,
};

/** Multipart text fields arrive as strings. */
const AvatarCreate = z
  .object({
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(500).default(''),
    tags: z.string().max(400).default(''),
    style: z.enum(STYLES).default('CASUAL'),
    categoryId: z.string().min(1).max(40),
    type: z.enum(AVATAR_TYPES),
    isActive: z.enum(['true', 'false']).optional(),
    rightsConfirmed: z.literal('true', {
      error: 'Confirm that SageIT has the right to use this image',
    }),
    ...LicenseFields,
  })
  .superRefine(licenseRules);

const AvatarUpdate = z
  .object({
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(500),
    tags: z.array(z.string().max(40)).max(20),
    style: z.enum(STYLES),
    categoryId: z.string().min(1).max(40),
    type: z.enum(AVATAR_TYPES),
    defaultPlacement: PlacementSchema,
    isActive: z.boolean(),
    sourceType: z.enum(EDIT_SOURCES),
    sourceName: z.string().trim().max(120),
    sourceUrl: z.string().trim().url().max(500).nullable(),
    licenseName: z.string().trim().min(2).max(120),
    licenseUrl: z.string().trim().url().max(500).nullable(),
    licenseNotes: z.string().trim().max(1000),
    attribution: z.string().trim().max(200),
    licenseExpiresAt: z.string().datetime({ offset: true }).or(z.string().date()).nullable(),
  })
  .partial()
  .strict();

type LicenseInput = {
  sourceType: (typeof EDIT_SOURCES)[number];
  sourceName?: string;
  licenseUrl?: string | null;
  licenseNotes?: string;
  licenseExpiresAt?: Date | null;
};

function licenseRules(v: LicenseInput, ctx: z.RefinementCtx) {
  if (v.sourceType !== 'ORIGINAL' && !v.sourceName?.trim()) {
    ctx.addIssue({
      code: 'custom',
      path: ['sourceName'],
      message: 'Enter the author, studio or vendor',
    });
  }
  if (v.sourceType === 'LICENSED' && !v.licenseUrl && !v.licenseNotes?.trim()) {
    ctx.addIssue({
      code: 'custom',
      path: ['licenseNotes'],
      message: 'For licensed assets, add the licence URL or a reference (order / agreement number)',
    });
  }
  if (v.licenseExpiresAt && v.licenseExpiresAt < new Date()) {
    ctx.addIssue({
      code: 'custom',
      path: ['licenseExpiresAt'],
      message: 'This licence has already expired',
    });
  }
}

function guardProtectedCharacters(sourceType: string, ...texts: string[]) {
  if (sourceType !== 'LICENSED' && texts.some((t) => PROTECTED_TERMS.test(t))) {
    throw new HttpError(
      400,
      'This looks like a third-party character. Add it only if SageIT holds a licence, and record it as “Licensed” with the licence details.',
    );
  }
}

function expired(a: Pick<Avatar, 'licenseExpiresAt'>) {
  return !!a.licenseExpiresAt && a.licenseExpiresAt < new Date();
}

const detailInclude = {
  category: { select: { id: true, name: true, slug: true } },
  createdBy: { select: { name: true } },
  rightsConfirmedBy: { select: { name: true } },
  _count: { select: { creations: true } },
} as const;

type AvatarWithDetail = Avatar & {
  category: { id: string; name: string; slug: string };
  createdBy: { name: string };
  rightsConfirmedBy: { name: string } | null;
  _count: { creations: number };
};

/** Creator view of an avatar: storage keys hidden, URLs, usage and licence status added. */
function present(a: AvatarWithDetail) {
  const { fileKey: _f, thumbKey: _t, _count, tags, ...rest } = a;
  return {
    ...rest,
    tags: splitTags(tags),
    usageCount: _count.creations,
    licenseExpired: expired(a),
    ...avatarUrls(a),
  };
}

/** Avatar library administration (mounted under /api/creator/library/avatars). */
export function avatarsRouter(prisma: PrismaClient, config: AppConfig): Router {
  const router = Router();
  const upload = uploader(config.MAX_UPLOAD_MB);

  const load = async (req: Request) => {
    const a = await prisma.avatar.findUnique({
      where: { id: String(req.params.id) },
      include: detailInclude,
    });
    if (!a) throw new HttpError(404, 'Not found');
    return a;
  };

  router.get('/', async (_req, res) => {
    const avatars = await prisma.avatar.findMany({
      orderBy: [
        { category: { sortOrder: 'asc' } },
        { type: { sortOrder: 'asc' } },
        { name: 'asc' },
      ],
      include: detailInclude,
    });
    res.json(avatars.map(present));
  });

  router.get('/:id', async (req, res) => {
    res.json(present(await load(req)));
  });

  router.post('/', upload.single('file'), async (req, res) => {
    const body = parse(AvatarCreate, req.body);
    guardProtectedCharacters(body.sourceType, body.name, body.description, body.tags);
    const buf = req.file?.buffer;
    const img = await inspectImage(buf, FORMATS[body.type]);
    if (body.type !== 'BACKGROUND' && !(await hasTransparency(buf!))) {
      throw new HttpError(
        400,
        'Character avatars need a transparent background (PNG or WebP with transparency).',
      );
    }
    const [category, type] = await Promise.all([
      prisma.avatarCategory.findUnique({ where: { id: body.categoryId } }),
      prisma.avatarType.findUnique({ where: { code: body.type } }),
    ]);
    if (!category) throw new HttpError(400, 'Unknown category');

    const id = newFileId();
    const dir = libraryDir(config, 'avatars');
    const fileName = `${id}.${img.ext}`;
    await saveFile(dir, fileName, buf!);
    // Animated files are their own thumbnail so the tray shows the motion.
    let thumbKey: string | null = null;
    if (!img.isAnimated) {
      await saveFile(dir, `${id}-thumb.png`, await makeThumbnail(buf!));
      thumbKey = libraryKey('avatars', `${id}-thumb.png`);
    }

    const avatar = await prisma.avatar.create({
      data: {
        name: body.name,
        description: body.description,
        tags: normalizeTags(body.tags),
        style: body.style,
        typeCode: body.type,
        categoryId: category.id,
        fileKey: libraryKey('avatars', fileName),
        thumbKey,
        mimeType: img.mimeType,
        sizeBytes: img.sizeBytes,
        isAnimated: img.isAnimated,
        width: img.width,
        height: img.height,
        defaultPlacement: type!.defaultPlacement ?? {},
        isActive: body.isActive === 'true', // new assets start hidden unless asked otherwise
        sourceType: body.sourceType,
        sourceName: body.sourceName || (body.sourceType === 'ORIGINAL' ? 'SageIT' : ''),
        sourceUrl: body.sourceUrl ?? null,
        licenseName: body.licenseName,
        licenseUrl: body.licenseUrl ?? null,
        licenseNotes: body.licenseNotes,
        attribution: body.attribution,
        licenseExpiresAt: body.licenseExpiresAt ?? null,
        rightsConfirmedAt: new Date(),
        rightsConfirmedById: req.user!.id,
        createdById: req.user!.id,
      },
      include: detailInclude,
    });
    await audit(prisma, req, {
      action: 'AVATAR_CREATED',
      entityType: 'Avatar',
      entityId: avatar.id,
      details: {
        name: avatar.name,
        type: avatar.typeCode,
        categoryId: category.id,
        sourceType: avatar.sourceType,
        licenseName: avatar.licenseName,
      },
    });
    res.status(201).json(present(avatar));
  });

  router.patch('/:id', async (req, res) => {
    const body = parse(AvatarUpdate, req.body);
    const current = await load(req);
    const sourceType = body.sourceType ?? current.sourceType;
    guardProtectedCharacters(
      sourceType,
      body.name ?? current.name,
      body.description ?? current.description,
      (body.tags ?? []).join(','),
    );

    if (
      body.categoryId &&
      !(await prisma.avatarCategory.count({ where: { id: body.categoryId } }))
    ) {
      throw new HttpError(400, 'Unknown category');
    }
    // Moving a background into a character type needs a real cut-out.
    if (body.type && body.type !== 'BACKGROUND' && current.typeCode === 'BACKGROUND') {
      const buf = await readFile(resolveKey(config, current.fileKey));
      if (!(await hasTransparency(buf))) {
        throw new HttpError(
          400,
          'This image has no transparent background, so it can only be a Background avatar.',
        );
      }
    }
    const expiresAt =
      body.licenseExpiresAt === undefined
        ? current.licenseExpiresAt
        : body.licenseExpiresAt
          ? new Date(body.licenseExpiresAt)
          : null;
    const nextLicense = {
      sourceType,
      sourceName: body.sourceName ?? current.sourceName,
      licenseUrl: body.licenseUrl === undefined ? current.licenseUrl : body.licenseUrl,
      licenseNotes: body.licenseNotes ?? current.licenseNotes,
      licenseExpiresAt: null as Date | null, // expiry checked separately (past dates are allowed to be recorded)
    };
    const issues: string[] = [];
    licenseRules(nextLicense, {
      addIssue: (i: { message?: string }) => issues.push(i.message ?? 'Invalid licence'),
    } as unknown as z.RefinementCtx);
    if (issues.length) throw new HttpError(400, issues[0]);

    const willBeActive = body.isActive ?? current.isActive;
    if (willBeActive && expiresAt && expiresAt < new Date()) {
      throw new HttpError(
        409,
        'The licence for this avatar has expired. Renew it before activating.',
      );
    }
    if (body.isActive && !current.rightsConfirmedAt) {
      throw new HttpError(409, 'Confirm usage rights for this avatar before activating it.');
    }

    const { type, tags, licenseExpiresAt: _e, ...rest } = body;
    const avatar = await prisma.avatar.update({
      where: { id: current.id },
      data: {
        ...rest,
        ...(type ? { typeCode: type } : {}),
        ...(tags ? { tags: normalizeTags(tags) } : {}),
        ...(body.licenseExpiresAt !== undefined ? { licenseExpiresAt: expiresAt } : {}),
      },
      include: detailInclude,
    });
    await audit(prisma, req, {
      action: 'AVATAR_UPDATED',
      entityType: 'Avatar',
      entityId: avatar.id,
      details: JSON.parse(JSON.stringify(body)),
    });
    res.json(present(avatar));
  });

  /**
   * Safe removal: only inactive avatars that no saved creation references.
   * Avatars in use should be deactivated instead (their creations keep working).
   */
  router.delete('/:id', async (req, res) => {
    const a = await load(req);
    if (a.isActive) throw new HttpError(409, 'Deactivate this avatar before removing it.');
    if (a._count.creations > 0) {
      throw new HttpError(
        409,
        `This avatar is used in ${a._count.creations} saved creation(s). Keep it deactivated instead of removing it.`,
      );
    }
    await prisma.avatar.delete({ where: { id: a.id } });
    await removeKeys(config, [a.fileKey, a.thumbKey]);
    await audit(prisma, req, {
      action: 'AVATAR_DELETED',
      entityType: 'Avatar',
      entityId: a.id,
      details: { name: a.name, sourceType: a.sourceType, licenseName: a.licenseName },
    });
    res.status(204).end();
  });

  /** Removes files in the avatar folder that no avatar references (older than an hour). */
  router.post('/cleanup', async (req, res) => {
    const dir = libraryDir(config, 'avatars');
    const rows = await prisma.avatar.findMany({ select: { fileKey: true, thumbKey: true } });
    const referenced = new Set(rows.flatMap((r) => [r.fileKey, r.thumbKey]).filter(Boolean));
    let files: string[] = [];
    try {
      files = await readdir(dir);
    } catch {
      /* folder not created yet */
    }
    const cutoff = Date.now() - 60 * 60 * 1000;
    const orphans: string[] = [];
    for (const f of files) {
      const key = libraryKey('avatars', f);
      if (referenced.has(key)) continue;
      const info = await stat(path.join(dir, f));
      if (info.isFile() && info.mtimeMs < cutoff) orphans.push(key);
    }
    await removeKeys(config, orphans);
    await audit(prisma, req, { action: 'LIBRARY_CLEANUP', details: { removed: orphans.length } });
    res.json({ removed: orphans.length, kept: files.length - orphans.length });
  });

  return router;
}
