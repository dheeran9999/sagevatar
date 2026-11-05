import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Router, type Request } from 'express';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { AVATAR_TYPES, type AvatarType } from '../lib/domain.js';
import { HttpError, parse } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import {
  hasTransparency,
  inspectImage,
  makeThumbnail,
  newFileId,
  saveFile,
} from '../lib/images.js';
import { removeKeys, resolveKey } from '../lib/library-storage.js';
import type { AiProviders } from '../lib/ai/openai.js';
import { aiGenerationFinished } from '../lib/activity.js';
import {
  buildPrompt,
  GENERATION_STYLES,
  guardPrompt,
  isTransparentType,
  SIZE,
  STYLE_KEYS,
  type GenerationStyle,
} from '../lib/ai/prompts.js';

const GenerateBody = z
  .object({
    prompt: z
      .string()
      .trim()
      .min(10, 'Describe the avatar in at least a few words')
      .max(1000, 'Keep the description under 1000 characters'),
    style: z.enum(STYLE_KEYS as [GenerationStyle, ...GenerationStyle[]]),
    type: z.enum(AVATAR_TYPES),
    count: z.coerce.number().int().min(1).max(4).default(2),
  })
  .strict();

const Id = z.object({ id: z.string().min(1).max(40) });

export const aiKey = (userId: string, file: string) => path.posix.join('ai', userId, file);

export const generatedUrls = (g: { id: string }) => ({
  fileUrl: `/api/ai/images/${g.id}/file`,
  thumbnailUrl: `/api/ai/images/${g.id}/thumb`,
});

type ImageRow = {
  id: string;
  width: number;
  height: number;
  createdAt: Date;
  publishedAvatarId: string | null;
  job: { prompt: string; style: string; typeCode: string; model: string; provider: string };
};

/** Shape the Studio uses — the same fields as a library avatar, plus where it came from. */
export const imageDto = (g: ImageRow) => ({
  id: g.id,
  name: `AI: ${g.job.prompt.slice(0, 40)}${g.job.prompt.length > 40 ? '…' : ''}`,
  description: g.job.prompt,
  type: g.job.typeCode as AvatarType,
  style: g.job.style,
  styleLabel: GENERATION_STYLES[g.job.style as GenerationStyle]?.label ?? g.job.style,
  width: g.width,
  height: g.height,
  isAnimated: false,
  createdAt: g.createdAt,
  publishedAvatarId: g.publishedAvatarId,
  source: {
    type: 'AI_GENERATED',
    name: `${g.job.provider} ${g.job.model}`,
    license: 'Generated for you — personal use',
  },
  ...generatedUrls(g),
});

const imageSelect = {
  id: true,
  width: true,
  height: true,
  createdAt: true,
  publishedAvatarId: true,
  job: { select: { prompt: true, style: true, typeCode: true, model: true, provider: true } },
} as const;

/**
 * AI Avatar Generator. Both roles may generate (Employees only when AI_EMPLOYEE_GENERATION is
 * on). Generated images are private to their owner; only a Creator can publish one to the
 * shared library (see routes/creator/library.ts).
 */
export function aiRouter(prisma: PrismaClient, config: AppConfig, ai: AiProviders): Router {
  const router = Router();

  const startOfDay = () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  };

  const availability = (req: Request) => {
    if (!ai.images) {
      return {
        enabled: false,
        reason: 'AI generation is not configured on this server (OPENAI_API_KEY is not set).',
      };
    }
    if (req.user!.role === 'EMPLOYEE' && !config.AI_EMPLOYEE_GENERATION) {
      return { enabled: false, reason: 'AI generation is currently available to Creators only.' };
    }
    return { enabled: true, reason: null };
  };

  const usedToday = async (userId: string) => {
    const r = await prisma.aiGenerationJob.aggregate({
      where: { userId, createdAt: { gte: startOfDay() } },
      _sum: { count: true },
    });
    return r._sum.count ?? 0;
  };

  router.get('/status', async (req, res) => {
    const a = availability(req);
    res.json({
      generation: {
        ...a,
        provider: ai.images ? 'openai' : null,
        model: ai.images?.model ?? null,
        dailyLimit: config.AI_DAILY_IMAGE_LIMIT,
        usedToday: await usedToday(req.user!.id),
      },
      semanticSearch: { enabled: !!ai.embeddings, model: ai.embeddings?.model ?? null },
      styles: STYLE_KEYS.map((k) => ({ value: k, label: GENERATION_STYLES[k].label })),
    });
  });

  /** Starts a job and returns at once; images are generated in the background (progress is polled). */
  router.post('/generations', async (req, res) => {
    const a = availability(req);
    if (!a.enabled) {
      res.status(503).json({ error: a.reason, code: 'AI_UNAVAILABLE' });
      return;
    }
    const body = parse(GenerateBody, req.body);
    guardPrompt(body.prompt);
    const used = await usedToday(req.user!.id);
    if (used + body.count > config.AI_DAILY_IMAGE_LIMIT) {
      throw new HttpError(
        429,
        `Daily AI limit reached (${config.AI_DAILY_IMAGE_LIMIT} images). ${Math.max(0, config.AI_DAILY_IMAGE_LIMIT - used)} left today.`,
      );
    }
    const userId = req.user!.id;
    const job = await prisma.aiGenerationJob.create({
      data: {
        userId,
        prompt: body.prompt,
        style: body.style,
        typeCode: body.type,
        count: body.count,
        provider: ai.images!.provider,
        model: ai.images!.model,
      },
    });
    await audit(prisma, req, {
      action: 'AI_GENERATION_STARTED',
      entityType: 'AiGenerationJob',
      entityId: job.id,
      details: { style: body.style, type: body.type, count: body.count },
    });
    void runJob(job.id, userId, body.prompt, body.style, body.type, body.count);
    res.status(202).json(await jobDto(job.id, userId));
  });

  const runJob = async (
    jobId: string,
    userId: string,
    description: string,
    style: GenerationStyle,
    type: AvatarType,
    count: number,
  ) => {
    const prompt = buildPrompt(description, style, type);
    const transparent = isTransparentType(type);
    const errors: string[] = [];
    await Promise.all(
      Array.from({ length: count }, async () => {
        try {
          const buf = await ai.images!.generate(prompt, { size: SIZE[type], transparent });
          const img = await inspectImage(buf, ['png', 'webp', 'jpeg']);
          if (transparent && !(await hasTransparency(buf))) {
            throw new HttpError(
              502,
              'The AI service returned an image without a transparent background',
            );
          }
          const id = newFileId();
          const dir = path.join(config.privateStorage, 'ai', userId);
          await saveFile(dir, `${id}.${img.ext}`, buf);
          await saveFile(dir, `${id}-thumb.png`, await makeThumbnail(buf));
          await prisma.$transaction([
            prisma.generatedAvatar.create({
              data: {
                jobId,
                userId,
                fileKey: aiKey(userId, `${id}.${img.ext}`),
                thumbKey: aiKey(userId, `${id}-thumb.png`),
                mimeType: img.mimeType,
                width: img.width,
                height: img.height,
                sizeBytes: img.sizeBytes,
              },
            }),
            prisma.aiGenerationJob.update({
              where: { id: jobId },
              data: { completed: { increment: 1 } },
            }),
          ]);
        } catch (e) {
          errors.push((e as Error).message);
          await prisma.aiGenerationJob
            .update({ where: { id: jobId }, data: { failed: { increment: 1 } } })
            .catch(() => {});
        }
      }),
    );
    const ok = count - errors.length;
    await prisma.aiGenerationJob
      .update({
        where: { id: jobId },
        data: {
          status: ok === count ? 'SUCCEEDED' : ok > 0 ? 'PARTIAL' : 'FAILED',
          error: errors[0] ?? null,
          finishedAt: new Date(),
        },
      })
      .catch(() => {});
    await aiGenerationFinished(prisma, jobId).catch((e) => console.error('AI notification failed', e));
  };

  const jobDto = async (id: string, userId: string) => {
    const job = await prisma.aiGenerationJob.findFirst({
      where: { id, userId },
      include: { images: { select: imageSelect, orderBy: { createdAt: 'asc' } } },
    });
    if (!job) throw new HttpError(404, 'Not found');
    return {
      id: job.id,
      status: job.status,
      count: job.count,
      completed: job.completed,
      failed: job.failed,
      error: job.error,
      prompt: job.prompt,
      style: job.style,
      type: job.typeCode,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt,
      images: job.images.map(imageDto),
    };
  };

  /** Real progress: how many images have actually come back from the AI service. */
  router.get('/generations/:id', async (req, res) => {
    const { id } = parse(Id, req.params);
    res.json(await jobDto(id, req.user!.id));
  });

  /** The signed-in user's own generated images (newest first). */
  router.get('/images', async (req, res) => {
    const images = await prisma.generatedAvatar.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 24,
      select: imageSelect,
    });
    res.json(images.map(imageDto));
  });

  const ownImage = async (req: Request) => {
    const { id } = parse(Id, req.params);
    const g = await prisma.generatedAvatar.findFirst({ where: { id, userId: req.user!.id } });
    // 404 (not 403) so other people's image ids can't be probed.
    if (!g) throw new HttpError(404, 'Not found');
    return g;
  };

  router.get('/images/:id/:variant', async (req, res) => {
    const variant = req.params.variant;
    if (variant !== 'file' && variant !== 'thumb') throw new HttpError(404, 'Not found');
    const g = await ownImage(req);
    const key = variant === 'thumb' ? g.thumbKey : g.fileKey;
    const buf = await readFile(resolveKey(config, key)).catch(() => {
      throw new HttpError(404, 'Not found');
    });
    res.setHeader('Content-Type', variant === 'thumb' ? 'image/png' : g.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(buf);
  });

  router.delete('/images/:id', async (req, res) => {
    const g = await ownImage(req);
    await prisma.generatedAvatar.delete({ where: { id: g.id } });
    await removeKeys(config, [g.fileKey, g.thumbKey]);
    res.status(204).end();
  });

  return router;
}
