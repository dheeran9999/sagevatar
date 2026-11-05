import { existsSync } from 'node:fs';
import { Router, type Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { HttpError, parse } from '../lib/http.js';
import { can } from '../lib/permissions.js';
import { resolveKey } from '../lib/library-storage.js';

const Variant = z.enum(['file', 'thumb']);

/**
 * Streams library assets from private storage. Requires a session.
 * Employees only receive assets that are live in the Studio (active avatar in an active
 * category and type / active template); Creators can preview everything. Anything else is 404.
 */
export function assetsRouter(prisma: PrismaClient, config: AppConfig): Router {
  const router = Router();

  const send = (res: Response, key: string | null, mimeType: string) => {
    if (!key) throw new HttpError(404, 'Not found');
    const full = resolveKey(config, key);
    if (!existsSync(full)) throw new HttpError(404, 'Not found');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (mimeType === 'image/svg+xml') {
      // SVGs are images only — no script, no external loads.
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      );
    }
    res.type(mimeType).sendFile(full);
  };

  router.get('/avatars/:id/:variant', async (req, res) => {
    const variant = parse(Variant, req.params.variant);
    const a = await prisma.avatar.findUnique({
      where: { id: String(req.params.id) },
      include: { category: { select: { isActive: true } }, type: { select: { isActive: true } } },
    });
    const visible =
      a &&
      (can(req.user!.role, 'library.manage') ||
        (a.isActive && a.category.isActive && a.type.isActive));
    if (!a || !visible) throw new HttpError(404, 'Not found');
    if (variant === 'thumb' && a.thumbKey && a.thumbKey !== a.fileKey) {
      return send(res, a.thumbKey, a.thumbKey.endsWith('.png') ? 'image/png' : a.mimeType);
    }
    send(res, a.fileKey, a.mimeType);
  });

  router.get('/templates/:id/:variant', async (req, res) => {
    const variant = parse(Variant, req.params.variant);
    const t = await prisma.corporateTemplate.findUnique({ where: { id: String(req.params.id) } });
    const visible = t && (can(req.user!.role, 'template.manage') || t.isActive);
    if (!t || !visible) throw new HttpError(404, 'Not found');
    if (variant === 'thumb' && t.thumbKey) return send(res, t.thumbKey, 'image/png');
    send(res, t.fileKey, t.mimeType);
  });

  return router;
}
