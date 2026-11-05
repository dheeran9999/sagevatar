import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { AppConfig } from '../config.js';

export function healthRouter(prisma: PrismaClient, config: AppConfig): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    let database: 'ok' | 'error' = 'ok';
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'error';
    }
    res.status(database === 'ok' ? 200 : 503).json({
      status: database === 'ok' ? 'ok' : 'degraded',
      database,
      // Only reports whether SMTP settings are present — not that sending works.
      email: config.emailConfigured ? 'configured-untested' : 'not-configured',
      time: new Date().toISOString(),
    });
  });

  return router;
}
