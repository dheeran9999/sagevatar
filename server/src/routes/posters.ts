import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Router, type Request } from 'express';
import type { GroupPoster, Prisma, PrismaClient } from '@prisma/client';
import sharp from 'sharp';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { HttpError, parse } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import type { Mailer } from '../lib/mailer.js';
import type { AiProviders } from '../lib/ai/openai.js';
import { newFileId, saveFile } from '../lib/images.js';
import { resolveKey } from '../lib/library-storage.js';
import { eventDir, eventKey } from '../lib/events.js';
import {
  DownloadQuery,
  emailPhoto,
  photoFilename,
  photoInFormat,
  ShareEmailBody,
} from '../lib/share.js';
import {
  AdjustSchema,
  AlignmentError,
  FaceBoxSchema,
  NO_ADJUST,
  preparePerson,
  type FaceBox,
} from '../lib/poster/faces.js';
import { renderPoster, renderPreview, type PlacedPerson } from '../lib/poster/render.js';
import { renderPhotoPreview, renderPhotoTemplate } from '../lib/poster/photo.js';
import {
  designByKey,
  ensurePosterTemplates,
  listTemplates,
  slotById,
  type TemplateView,
  templateView,
} from '../lib/poster/templates.js';
import {
  canSaveToEvent,
  eventParticipantIds,
  managesPhotos,
  posterEvent,
  usablePhotoWhere,
} from '../lib/poster/access.js';
import { requirePermission } from '../middleware/auth.js';
import { creatorIds, notify } from '../lib/notify.js';

const Participant = z.object({
  userId: z.string().min(1).max(40),
  photoId: z.string().min(1).max(40),
  slot: z.string().min(1).max(30),
  /** Manual alignment for this poster only (relative to the face box). */
  adjust: AdjustSchema.optional(),
  /** Manual face box for this poster when automatic detection failed. */
  face: FaceBoxSchema.optional(),
});

const CreateBody = z
  .object({
    templateKey: z.string().min(1).max(60),
    title: z.string().trim().min(1).max(120).optional(),
    eventId: z.string().max(40).optional(),
    /** auto = AI scene when available, otherwise the built-in scene. */
    scene: z.enum(['auto', 'ai', 'template']).default('auto'),
    variation: z.number().int().min(0).max(100_000).default(0),
    participants: z.array(Participant).min(1).max(25),
  })
  .strict();

type ParticipantRecord = {
  userId: string;
  name: string;
  photoId: string;
  slot: string;
  slotLabel?: string;
  adjust: z.infer<typeof AdjustSchema>;
  face: FaceBox | null;
  faceSource: string;
  cutout?: 'mask' | 'oval';
};

/** Instructions for the AI realism pass. Identity never depends on this — faces are pasted back. */
export const restylePrompt = (scene: string, n: number) =>
  `Turn this illustrated layout into a natural, photorealistic photograph of ${n} office colleagues ` +
  `celebrating a work anniversary in ${scene}. Keep the composition EXACTLY: the same ${n} people, each ` +
  `in the same position, size and head placement; the two people in the centre cut the cake together, ` +
  `both holding the one cake knife; everyone else stands smiling and clapping beside and behind them. ` +
  `Business-casual clothes with company ID badge lanyards, warm natural light, shallow depth of field. ` +
  `Keep the cake, table, balloons and gifts where they are. Do not add or remove people. ` +
  `Do not write or change any text, letters or logos.`;

const posterKey = (userId: string, file: string) => path.posix.join('posters', userId, file);

export function posterDto(
  p: GroupPoster & {
    event?: { id: string; code: string; name: string } | null;
    user?: { name: string } | null;
  },
  viewerId?: string,
) {
  const base = `/api/posters/${p.id}`;
  const done = p.status === 'SUCCEEDED';
  const participants = p.participants as ParticipantRecord[];
  return {
    id: p.id,
    title: p.title,
    templateKey: p.templateKey,
    templateName: designByKey(p.templateKey)?.name ?? p.templateKey,
    /** Only the person who generated it can save, email, regenerate or delete it. */
    mine: viewerId ? p.userId === viewerId : true,
    createdBy: p.user?.name ?? null,
    sharedAt: p.sharedAt,
    status: p.status,
    stage: p.stage,
    progress: p.progress,
    error: p.error,
    mode: p.mode,
    modeNote: p.modeNote,
    variation: p.variation,
    participants: participants.map((x) => ({
      userId: x.userId,
      name: x.name,
      photoId: x.photoId,
      slot: x.slot,
      slotLabel: x.slotLabel ?? slotById(x.slot)?.label ?? x.slot,
      adjust: x.adjust,
      face: x.face,
      cutout: x.cutout ?? null,
    })),
    event: p.event ? { id: p.event.id, code: p.event.code, name: p.event.name } : null,
    width: p.width,
    height: p.height,
    savedCreationId: p.creationId,
    savedEventPhotoId: p.eventPhotoId,
    createdAt: p.createdAt,
    finishedAt: p.finishedAt,
    imageUrl: done ? `${base}/image` : null,
    thumbUrl: done ? `${base}/thumb` : null,
    downloadPngUrl: done ? `${base}/image?download=1&format=png` : null,
    downloadJpgUrl: done ? `${base}/image?download=1&format=jpg` : null,
  };
}

const STAGES = {
  validating: 'Validating employee photographs',
  template: 'Loading the anniversary template',
  faces: 'Aligning faces',
  scene: 'Generating the photorealistic scene (AI)',
  compose: 'Compositing the group',
  saving: 'Saving the poster',
  done: 'Done',
  failed: 'Failed',
} as const;

/**
 * "Happy Work Anniversary – Group Cake Cutting" posters.
 * Posters are private to the person who generated them (404 for anyone else).
 */
export function postersRouter(
  prisma: PrismaClient,
  config: AppConfig,
  ai: AiProviders,
  mailer: Mailer,
): Router {
  const router = Router();
  const previewCache = new Map<string, Buffer>();

  const branding = async () => {
    const b = await prisma.posterBranding.findUnique({ where: { id: 'default' } });
    return (
      b ?? {
        id: 'default',
        companyName: 'SageIT',
        tagline: '',
        logoKey: null,
        updatedAt: new Date(0),
        updatedById: null,
      }
    );
  };
  const logoBuf = async (key: string | null) =>
    key ? await readFile(resolveKey(config, key)).catch(() => null) : null;

  const aiAvailability = (req: Request) => {
    if (!ai.images)
      return {
        enabled: false,
        reason: 'AI image generation is not configured (OPENAI_API_KEY is not set).',
      };
    if (req.user!.role === 'EMPLOYEE' && !config.AI_EMPLOYEE_GENERATION) {
      return { enabled: false, reason: 'AI scenes are available to Creators only.' };
    }
    return { enabled: true, reason: null };
  };

  const own = async (req: Request) => {
    const p = await prisma.groupPoster.findFirst({
      where: { id: String(req.params.id), userId: req.user!.id },
      include: { event: { select: { id: true, code: true, name: true } } },
    });
    if (!p) throw new HttpError(404, 'Poster not found');
    return p;
  };

  /**
   * View access: the person who generated it; Creators (oversight); and the people IN an
   * official poster once a Creator shared it with them. Everyone else gets 404.
   */
  const viewable = async (req: Request) => {
    const me = req.user!;
    const p = await prisma.groupPoster.findUnique({
      where: { id: String(req.params.id) },
      include: { event: { select: { id: true, code: true, name: true } }, user: { select: { name: true } } },
    });
    const inIt = !!p && !!p.sharedAt && (p.participants as ParticipantRecord[]).some((x) => x.userId === me.id);
    if (!p || !(p.userId === me.id || managesPhotos(me) || inIt)) throw new HttpError(404, 'Poster not found');
    return p;
  };

  /**
   * After a poster is saved: an official (Creator) poster is shared with the people in it;
   * an Employee's poster is reported to the Creators. Each happens once per poster.
   */
  const announce = async (req: Request, p: GroupPoster & { event?: { name: string; code: string } | null }) => {
    const me = req.user!;
    const people = p.participants as ParticipantRecord[];
    const data = {
      Recognition: p.title,
      Template: designByKey(p.templateKey)?.name ?? (p.mode === 'photo' ? 'Photo template' : p.templateKey),
      'Created by': me.name,
      People: people.map((x) => x.name).join(', '),
      ...(p.event ? { Event: `${p.event.name} (${p.event.code})` } : {}),
    };
    if (managesPhotos(me)) {
      if (!p.sharedAt) await prisma.groupPoster.update({ where: { id: p.id }, data: { sharedAt: new Date() } });
      await notify(
        prisma,
        people.map((x) => x.userId).filter((id) => id !== me.id),
        {
          type: 'POSTER_SHARED',
          title: 'You’re in a new recognition poster! 🎉',
          body: `${me.name} created “${p.title}” featuring you.`,
          link: `/posters/${p.id}`,
          eventId: p.eventId,
          actorId: me.id,
          data,
          dedupeKey: `poster:${p.id}`,
        },
      );
    } else {
      await notify(prisma, await creatorIds(prisma), {
        type: 'POSTER_CREATED',
        title: 'Employee created a group anniversary poster',
        body: `${me.name} created “${p.title}”.`,
        link: `/posters/${p.id}`,
        eventId: p.eventId,
        actorId: me.id,
        data,
        dedupeKey: `poster-created:${p.id}`,
      });
    }
  };

  // ---- Templates & branding --------------------------------------------------

  router.get('/status', async (req, res) => {
    const b = await branding();
    res.json({
      ai: aiAvailability(req),
      branding: {
        companyName: b.companyName,
        tagline: b.tagline,
        logoUrl: b.logoKey
          ? `/api/posters/branding/logo?v=${b.updatedAt.getTime().toString(36)}`
          : null,
      },
      canUseAllPhotos: managesPhotos(req.user!),
    });
  });

  router.get('/branding/logo', async (_req, res) => {
    const b = await branding();
    const buf = await logoBuf(b.logoKey);
    if (!buf) throw new HttpError(404, 'No logo uploaded');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(buf);
  });

  router.get('/templates', async (req, res) => {
    res.json(await listTemplates(prisma, managesPhotos(req.user!)));
  });

  /** A real render of the design with dashed placeholders where people go (no faces). */
  router.get('/templates/:key/preview', async (req, res) => {
    await ensurePosterTemplates(prisma);
    const row = await prisma.posterTemplate.findUnique({ where: { key: String(req.params.key) } });
    const view = row && templateView(row);
    if (!row || !view || (!row.isPublished && !managesPhotos(req.user!)))
      throw new HttpError(404, 'Template not found');
    const b = await branding();
    const cacheKey = `${row.key}:${row.updatedAt.getTime()}:${b.updatedAt.getTime()}`;
    let buf = previewCache.get(cacheKey);
    if (!buf) {
      buf =
        view.kind === 'photo'
          ? await renderPhotoPreview(
              await readFile(resolveKey(config, row.photoKey!)),
              view.canvas,
              view.slots,
            )
          : await renderPreview(
              designByKey(row.key)!,
              row.heading,
              b.companyName,
              b.tagline,
              await logoBuf(b.logoKey),
            );
      previewCache.set(cacheKey, buf);
    }
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=600');
    res.send(buf);
  });

  /** The base photograph of a photo template (for the positions map). */
  router.get('/templates/:key/photo', async (req, res) => {
    const row = await prisma.posterTemplate.findUnique({ where: { key: String(req.params.key) } });
    if (
      !row ||
      row.kind !== 'photo' ||
      !row.photoKey ||
      (!row.isPublished && !managesPhotos(req.user!))
    ) {
      throw new HttpError(404, 'Template not found');
    }
    const buf = await sharp(await readFile(resolveKey(config, row.photoKey)))
      .rotate()
      .resize(1200)
      .jpeg({ quality: 85 })
      .toBuffer();
    res.setHeader('Cache-Control', 'private, max-age=600');
    res.type('jpeg').send(buf);
  });

  // ---- Generate ---------------------------------------------------------------

  router.get('/', async (req, res) => {
    const rows = await prisma.groupPoster.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { event: { select: { id: true, code: true, name: true } } },
    });
    res.json(rows.map((r) => posterDto(r, req.user!.id)));
  });

  router.post('/', async (req, res) => {
    const me = req.user!;
    const body = parse(CreateBody, req.body);

    // Template
    await ensurePosterTemplates(prisma);
    const row = await prisma.posterTemplate.findUnique({ where: { key: body.templateKey } });
    const tpl = row && templateView(row);
    if (!row || !tpl || (!row.isPublished && !managesPhotos(me))) {
      throw new HttpError(404, 'This template is not available');
    }

    // Event context
    const event = body.eventId ? await posterEvent(prisma, me, body.eventId) : null;
    const participantsInEvent =
      event && !managesPhotos(me) ? await eventParticipantIds(prisma, event.id) : null;

    // Participants: count, uniqueness, slots
    const n = body.participants.length;
    if (n < tpl.minParticipants) {
      throw new HttpError(422, `Select at least ${tpl.minParticipants} people for "${tpl.name}".`);
    }
    if (n > tpl.maxParticipants) {
      throw new HttpError(
        422,
        `Too many participants for "${tpl.name}": it has room for ${tpl.maxParticipants} people, ${n} were selected.`,
      );
    }
    const dup = (xs: string[]) => xs.find((x, i) => xs.indexOf(x) !== i);
    if (dup(body.participants.map((p) => p.userId)))
      throw new HttpError(422, 'Each person can appear only once.');
    if (dup(body.participants.map((p) => p.photoId)))
      throw new HttpError(422, 'Each photo can be used only once.');
    if (dup(body.participants.map((p) => p.slot)))
      throw new HttpError(422, 'Two people were given the same position.');
    const slotIds = body.participants.map((p) => p.slot);
    const unknown = slotIds.find((s) => !tpl.slots.some((t) => t.id === s));
    if (unknown) throw new HttpError(422, `"${unknown}" is not a position in this template.`);
    const cutters = tpl.slots.filter((s) => s.role === 'cutter');
    if (cutters.some((c) => !slotIds.includes(c.id))) {
      throw new HttpError(
        422,
        cutters.length === 2
          ? 'Put two people in the cake-cutting positions.'
          : 'Fill every cake-cutting position.',
      );
    }

    // Photos: exist, belong to the person, usable by the caller, have a face
    const photos = await prisma.employeePhoto.findMany({
      where: { id: { in: body.participants.map((p) => p.photoId) } },
      include: { user: { select: { id: true, name: true, isActive: true } } },
    });
    const usableIds = new Set(
      (
        await prisma.employeePhoto.findMany({
          where: {
            id: { in: photos.map((p) => p.id) },
            ...usablePhotoWhere(me, participantsInEvent),
          },
          select: { id: true },
        })
      ).map((p) => p.id),
    );
    const problems: { userId: string; photoId: string; message: string }[] = [];
    const records: ParticipantRecord[] = [];
    for (const p of body.participants) {
      const photo = photos.find((x) => x.id === p.photoId);
      if (!photo || !photo.isActive || photo.userId !== p.userId) {
        problems.push({
          ...p,
          message: 'This photo is missing or has been withdrawn. Choose another photo.',
        });
        continue;
      }
      if (!photo.user.isActive) {
        problems.push({ ...p, message: `${photo.user.name}'s account is deactivated.` });
        continue;
      }
      if (!usableIds.has(photo.id)) {
        problems.push({
          ...p,
          message: `You don't have permission to use ${photo.user.name}'s photo${event ? ' in this event' : ''}.`,
        });
        continue;
      }
      const face = (p.face ?? (photo.face as FaceBox | null)) || null;
      if (!face) {
        problems.push({
          ...p,
          message: `No face was found in ${photo.user.name}'s photo. Adjust the face position manually or choose another photo.`,
        });
        continue;
      }
      records.push({
        userId: p.userId,
        name: photo.user.name,
        photoId: photo.id,
        slot: p.slot,
        slotLabel: tpl.slots.find((s) => s.id === p.slot)?.label,
        adjust: p.adjust ?? NO_ADJUST,
        face,
        faceSource: p.face ? 'manual' : photo.faceSource,
      });
    }
    if (problems.length) {
      res.status(422).json({ error: problems[0].message, code: 'PARTICIPANT_PROBLEMS', problems });
      return;
    }

    const avail = aiAvailability(req);
    const isPhoto = tpl.kind === 'photo';
    const useAi = !isPhoto && body.scene !== 'template' && avail.enabled;
    const modeNote = isPhoto
      ? 'Faces were replaced in the template photograph; everything else in the photo is unchanged.'
      : body.scene === 'template'
        ? null
        : !avail.enabled
          ? `${avail.reason} The built-in template scene was used.`
          : null;
    const names = records.map((r) => r.name);
    const poster = await prisma.groupPoster.create({
      data: {
        userId: me.id,
        templateKey: row.key,
        eventId: event?.id ?? null,
        title:
          body.title ??
          `Work Anniversary – ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` +${names.length - 3}` : ''}`,
        mode: isPhoto ? 'photo' : useAi ? 'ai' : 'template',
        modeNote,
        variation: body.variation,
        participants: records as unknown as Prisma.InputJsonValue,
        stage: STAGES.validating,
        progress: 5,
      },
    });
    await audit(prisma, req, {
      action: 'POSTER_GENERATION_STARTED',
      entityType: 'GroupPoster',
      entityId: poster.id,
      details: {
        template: row.key,
        participants: records.length,
        mode: poster.mode,
        eventId: event?.id ?? null,
      },
    });
    void run(
      poster.id,
      me.id,
      tpl,
      row.photoKey,
      records,
      useAi,
      body.variation,
      event?.name ?? null,
    );
    res
      .status(202)
      .json(
        posterDto({
          ...poster,
          event: event ? { id: event.id, code: event.code, name: event.name } : null,
        }),
      );
  });

  const step = (id: string, stage: string, progress: number) =>
    prisma.groupPoster.update({ where: { id }, data: { stage, progress } }).catch(() => undefined);

  /** The generation pipeline. Every stage writes real progress the client polls. */
  const run = async (
    id: string,
    userId: string,
    tpl: TemplateView,
    photoKey: string | null,
    records: ParticipantRecord[],
    useAi: boolean,
    variation: number,
    eventName: string | null,
  ) => {
    let modeNote: string | null = null;
    let mode = tpl.kind === 'photo' ? 'photo' : useAi ? 'ai' : 'template';
    const heading = tpl.heading;
    const written: string[] = [];
    try {
      await step(id, STAGES.template, 10);
      const design = designByKey(tpl.key);
      const b = await branding();
      const logo = await logoBuf(b.logoKey);

      // Faces: each participant's ORIGINAL photo (and mask) → aligned cut-out.
      const people: PlacedPerson[] = [];
      for (const [i, r] of records.entries()) {
        await step(
          id,
          `${STAGES.faces} (${i + 1} of ${records.length}): ${r.name}`,
          15 + Math.round((45 * i) / records.length),
        );
        const photo = await prisma.employeePhoto.findUnique({ where: { id: r.photoId } });
        if (!photo || !photo.isActive)
          throw new HttpError(409, `${r.name}'s photo was withdrawn during generation.`);
        const src = await readFile(resolveKey(config, photo.fileKey)).catch(() => {
          throw new HttpError(500, `${r.name}'s photo file is missing from storage.`);
        });
        const mask = photo.maskKey
          ? await readFile(resolveKey(config, photo.maskKey)).catch(() => null)
          : null;
        const slot = tpl.slots.find((s) => s.id === r.slot)!;
        try {
          const prepared = await preparePerson(src, mask, r.face, r.adjust, slot.faceHeight);
          r.cutout = prepared.cutout;
          people.push({ name: r.name, slot, person: prepared });
        } catch (e) {
          if (e instanceof AlignmentError)
            throw new HttpError(422, `Face alignment failed for ${r.name}: ${e.message}`);
          throw new HttpError(
            422,
            `${r.name}'s photo could not be read (${(e as Error).message.slice(0, 80)}).`,
          );
        }
      }

      let png: Buffer;
      let scene: Buffer;
      if (tpl.kind === 'photo') {
        await step(id, 'Replacing the faces in the template photo', 70);
        const base = await readFile(resolveKey(config, photoKey!)).catch(() => {
          throw new HttpError(500, 'The template photograph is missing from storage.');
        });
        ({ png, scene } = await renderPhotoTemplate({
          photo: base,
          canvas: tpl.canvas,
          people: people.map((p) => ({ ...p, person: p.person! })),
          showNames: tpl.showNames,
          colours: { accent: tpl.palette.accent, heading: tpl.palette.heading },
        }));
      } else {
        // Optional AI photo-realism. Faces are pasted back from the originals afterwards.
        const restyle =
          design && useAi && ai.images?.edit
            ? async (layout: Buffer) => {
                await step(id, STAGES.scene, 62);
                const out = await ai.images!.edit!(
                  restylePrompt(design.aiScene, records.length),
                  layout,
                  {
                    size: '1536x1024',
                  },
                );
                await sharp(out).metadata();
                await step(id, STAGES.compose, 86);
                return out;
              }
            : undefined;

        await step(id, STAGES.compose, 64);
        const now = new Date();
        const month = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });
        const result = await renderPoster({
          design: design!,
          heading,
          companyName: b.companyName,
          tagline: b.tagline,
          footer: `${b.companyName} · ${eventName ?? month}`,
          logo,
          people,
          variation,
          restyle,
        });
        ({ png, scene } = result);
        if (useAi && !result.restyled) {
          mode = 'template';
          modeNote = `The AI photo-realism service failed (${result.restyleError ?? 'unknown error'}). The template composition was used instead — faces are unaffected.`;
        }
      }

      await step(id, STAGES.saving, 94);
      const dir = path.join(config.privateStorage, 'posters', userId);
      const resultKey = posterKey(userId, `${id}.png`);
      const thumbKey = posterKey(userId, `${id}-thumb.jpg`);
      const sceneKey = posterKey(userId, `${id}-scene.png`);
      try {
        await saveFile(dir, path.basename(resultKey), png);
        written.push(resultKey);
        await saveFile(
          dir,
          path.basename(thumbKey),
          await sharp(png).resize(640).jpeg({ quality: 85 }).toBuffer(),
        );
        written.push(thumbKey);
        await saveFile(dir, path.basename(sceneKey), scene);
        written.push(sceneKey);
      } catch {
        throw new HttpError(
          507,
          'The poster could not be saved (storage error). Please try again.',
        );
      }
      await prisma.groupPoster.update({
        where: { id },
        data: {
          status: 'SUCCEEDED',
          stage: STAGES.done,
          progress: 100,
          mode,
          ...(modeNote ? { modeNote } : {}),
          resultKey,
          thumbKey,
          sceneKey,
          width: tpl.canvas.width,
          height: tpl.canvas.height,
          participants: records as unknown as Prisma.InputJsonValue,
          finishedAt: new Date(),
        },
      });
    } catch (e) {
      await Promise.all(
        written.map((k) => rm(resolveKey(config, k), { force: true }).catch(() => undefined)),
      );
      const message =
        e instanceof HttpError
          ? e.message
          : `Poster generation failed: ${(e as Error).message.slice(0, 200)}`;
      if (!(e instanceof HttpError)) console.error('poster generation failed', e);
      await prisma.groupPoster
        .update({
          where: { id },
          data: {
            status: 'FAILED',
            stage: STAGES.failed,
            error: message,
            finishedAt: new Date(),
            participants: records as unknown as Prisma.InputJsonValue,
          },
        })
        .catch(() => undefined);
    }
  };

  router.get('/:id', async (req, res) => {
    res.json(posterDto(await viewable(req), req.user!.id));
  });

  const filename = (p: GroupPoster & { event?: { code: string } | null }, ext: string) => {
    const names = (p.participants as ParticipantRecord[]).map((x) => x.name);
    // Full names (first names repeat); photoFilename trims the part to a safe length.
    return photoFilename({
      context: p.event?.code ?? 'Personal',
      person: `${names.slice(0, 2).join(' ')}${names.length > 2 ? ` plus${names.length - 2}` : ''}`,
      avatar: 'Work-Anniversary',
      at: p.createdAt,
      id: p.id,
      ext,
    });
  };

  const resultOf = async (p: GroupPoster) => {
    if (p.status !== 'SUCCEEDED' || !p.resultKey)
      throw new HttpError(409, 'The poster is not ready yet');
    return readFile(resolveKey(config, p.resultKey)).catch(() => {
      throw new HttpError(404, 'The poster file is missing');
    });
  };

  router.get('/:id/image', async (req, res) => {
    const dl = parse(DownloadQuery, req.query);
    const p = await viewable(req);
    const buf = await resultOf(p);
    res.setHeader('Cache-Control', 'private, no-store');
    if (!dl.download && !dl.format) {
      res.type('png').send(buf);
      return;
    }
    const out = await photoInFormat(buf, dl.format ?? 'png');
    res.setHeader('Content-Type', out.contentType);
    if (dl.download) res.attachment(filename(p, out.ext));
    res.send(out.buf);
  });

  router.get('/:id/thumb', async (req, res) => {
    const p = await viewable(req);
    if (!p.thumbKey) throw new HttpError(404, 'Not found');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.type('jpeg').send(await readFile(resolveKey(config, p.thumbKey)));
  });

  router.post('/:id/email', requirePermission(prisma, 'creation.email'), async (req, res) => {
    const body = parse(ShareEmailBody, req.body);
    const p = await own(req);
    const out = await photoInFormat(await resultOf(p), 'jpg');
    const result = await emailPhoto(prisma, mailer, {
      userId: req.user!.id,
      sender: req.user!.name,
      body,
      context: `${p.title}${p.event ? ` · ${p.event.name} (${p.event.code})` : ''}`,
      file: { buf: out.buf, contentType: out.contentType, filename: filename(p, out.ext) },
      link: { groupPosterId: p.id },
    });
    await audit(prisma, req, {
      action: 'POSTER_EMAILED',
      entityType: 'GroupPoster',
      entityId: p.id,
      details: { to: body.to, delivery: result.delivery },
    });
    res.json(result);
  });

  const metadataLayout = (p: GroupPoster, req: Request) =>
    ({
      kind: 'group-anniversary',
      posterId: p.id,
      templateKey: p.templateKey,
      mode: p.mode,
      variation: p.variation,
      participants: (p.participants as ParticipantRecord[]).map((x) => ({
        userId: x.userId,
        name: x.name,
        photoId: x.photoId,
        slot: x.slot,
      })),
      createdBy: { id: req.user!.id, name: req.user!.name },
    }) as Prisma.InputJsonValue;

  /** Save to My Creations (personal history). Idempotent. */
  router.post('/:id/save-creation', async (req, res) => {
    const p = await own(req);
    const png = await resultOf(p);
    if (p.creationId && (await prisma.photoCreation.count({ where: { id: p.creationId } }))) {
      res.json({ creationId: p.creationId, already: true });
      return;
    }
    const userId = req.user!.id;
    const fileId = newFileId();
    const dir = path.join(config.privateStorage, 'creations', userId);
    const rel = (n: string) => path.posix.join('creations', userId, n);
    const sourcePath = rel(`${fileId}-source.png`);
    const resultPath = rel(`${fileId}-result.png`);
    try {
      await mkdir(dir, { recursive: true });
      await copyFile(resolveKey(config, p.sceneKey!), path.join(dir, path.basename(sourcePath)));
      await saveFile(dir, path.basename(resultPath), png);
    } catch {
      throw new HttpError(507, 'Could not save to My Creations (storage error). Please try again.');
    }
    const creation = await prisma.photoCreation.create({
      data: {
        title: p.title.slice(0, 120),
        sourcePath,
        resultPath,
        layout: metadataLayout(p, req),
        userId,
        metadata: {
          create: {
            source: 'UPLOAD',
            width: p.width ?? 2000,
            height: p.height ?? 1500,
            mimeType: 'image/png',
            sizeBytes: png.length,
            sha256: createHash('sha256').update(png).digest('hex'),
            userAgent: req.get('user-agent')?.slice(0, 300),
          },
        },
      },
    });
    await prisma.groupPoster.update({ where: { id: p.id }, data: { creationId: creation.id } });
    await audit(prisma, req, {
      action: 'POSTER_SAVED',
      entityType: 'GroupPoster',
      entityId: p.id,
      details: { to: 'creations', creationId: creation.id },
    });
    await announce(req, p).catch((e) => console.error('poster notification failed', e));
    res.status(201).json({ creationId: creation.id, already: false });
  });

  /** Save to the gallery of the event the poster was made in. Idempotent. */
  router.post('/:id/save-event', async (req, res) => {
    const p = await own(req);
    if (!p.eventId) throw new HttpError(409, 'This poster was not made inside an event');
    const png = await resultOf(p);
    const e = await posterEvent(prisma, req.user!, p.eventId);
    if (p.eventPhotoId && (await prisma.eventPhoto.count({ where: { id: p.eventPhotoId } }))) {
      res.json({ eventPhotoId: p.eventPhotoId, eventId: e.id, already: true });
      return;
    }
    if (!(await canSaveToEvent(prisma, req.user!, e))) {
      throw new HttpError(409, 'This event is not accepting new photos');
    }
    const fid = newFileId();
    const dir = path.join(eventDir(config, e.id), 'photos');
    try {
      await mkdir(dir, { recursive: true });
      await copyFile(resolveKey(config, p.sceneKey!), path.join(dir, `${fid}-original.png`));
      await saveFile(dir, `${fid}-final.png`, png);
      await saveFile(
        dir,
        `${fid}-thumb.png`,
        await sharp(png).resize(480, 480, { fit: 'inside' }).png().toBuffer(),
      );
    } catch {
      throw new HttpError(
        507,
        'Could not save to the event gallery (storage error). Please try again.',
      );
    }
    const photo = await prisma.eventPhoto.create({
      data: {
        eventId: e.id,
        userId: req.user!.id,
        title: p.title.slice(0, 120),
        source: 'UPLOAD',
        originalPath: eventKey(e.id, 'photos', `${fid}-original.png`),
        finalPath: eventKey(e.id, 'photos', `${fid}-final.png`),
        thumbPath: eventKey(e.id, 'photos', `${fid}-thumb.png`),
        layout: metadataLayout(p, req),
        capturedAt: p.finishedAt ?? new Date(),
      },
    });
    await prisma.groupPoster.update({ where: { id: p.id }, data: { eventPhotoId: photo.id } });
    await audit(prisma, req, {
      action: 'POSTER_SAVED',
      entityType: 'GroupPoster',
      entityId: p.id,
      details: { to: 'event', eventId: e.id, code: e.code, eventPhotoId: photo.id },
    });
    await announce(req, p).catch((e) => console.error('poster notification failed', e));
    res.status(201).json({ eventPhotoId: photo.id, eventId: e.id, already: false });
  });

  router.delete('/:id', async (req, res) => {
    const p = await own(req);
    await prisma.groupPoster.delete({ where: { id: p.id } });
    await Promise.all(
      [p.resultKey, p.thumbKey, p.sceneKey]
        .filter((k): k is string => !!k)
        .map((k) => rm(resolveKey(config, k), { force: true })),
    );
    res.status(204).end();
  });

  return router;
}
