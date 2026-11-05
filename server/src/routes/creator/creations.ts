import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { AppConfig } from '../../config.js';
import { HttpError, parse } from '../../lib/http.js';
import { DownloadQuery, extOf, photoFilename, photoInFormat } from '../../lib/share.js';

/**
 * Creator oversight of employees' saved creations (read-only): the "View Creation" target of
 * photo notifications and the employee activity list. Employees never reach this (403).
 */
export function creatorCreationsRouter(prisma: PrismaClient, config: AppConfig): Router {
  const router = Router();

  const find = async (id: string) => {
    const c = await prisma.photoCreation.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, email: true, employeeCode: true, roleCode: true } },
        avatar: { select: { name: true, category: { select: { name: true } } } },
        generatedAvatar: { select: { job: { select: { prompt: true } } } },
        metadata: { select: { source: true, width: true, height: true } },
      },
    });
    if (!c) throw new HttpError(404, 'Creation not found');
    return c;
  };

  router.get('/:id', async (req, res) => {
    const c = await find(String(req.params.id));
    const base = `/api/creator/creations/${c.id}/image`;
    res.json({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt,
      owner: { id: c.user.id, name: c.user.name, email: c.user.email, employeeCode: c.user.employeeCode },
      avatar: c.avatar
        ? `${c.avatar.name} (${c.avatar.category.name})`
        : c.generatedAvatar
          ? `AI-generated: ${c.generatedAvatar.job.prompt.slice(0, 60)}`
          : null,
      kind: (c.layout as { kind?: string } | null)?.kind === 'group-anniversary' ? 'poster' : 'photo',
      source: c.metadata?.source ?? null,
      imageUrl: `${base}/result`,
      originalUrl: `${base}/source`,
      downloadUrl: `${base}/result?download=1&format=jpg`,
    });
  });

  router.get('/:id/image/:kind', async (req, res) => {
    const kind = parse(z.enum(['source', 'result']), req.params.kind);
    const dl = parse(DownloadQuery, req.query);
    const c = await find(String(req.params.id));
    const rel = kind === 'source' ? c.sourcePath : c.resultPath;
    const full = path.resolve(config.privateStorage, rel);
    if (!full.startsWith(path.resolve(config.privateStorage) + path.sep)) throw new HttpError(404, 'Not found');
    res.setHeader('Cache-Control', 'private, no-store');
    if (!dl.download && !dl.format) {
      res.sendFile(full);
      return;
    }
    const out = await photoInFormat(await readFile(full), dl.format ?? (extOf(rel) === 'png' ? 'png' : 'jpg'));
    res.setHeader('Content-Type', out.contentType);
    if (dl.download) {
      res.attachment(photoFilename({ context: 'Personal', person: c.user.name, at: c.createdAt, id: c.id, ext: out.ext }));
    }
    res.send(out.buf);
  });

  return router;
}
