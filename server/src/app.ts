import { mkdirSync } from 'node:fs';
import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import type { PrismaClient } from '@prisma/client';
import type { AppConfig } from './config.js';
import { HttpError } from './lib/http.js';
import { csrfGuard, loadUser, requireAuth, requirePermission } from './middleware/auth.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { createMailer, type Mailer } from './lib/mailer.js';
import { createAiProviders, type AiProviders } from './lib/ai/openai.js';
import { aiRouter } from './routes/ai.js';
import { publishAiRouter } from './routes/creator/publish-ai.js';
import { eventsRouter } from './routes/events.js';
import { creatorEventsRouter } from './routes/creator/events.js';
import { notificationsRouter } from './routes/notifications.js';
import { catalogRouter } from './routes/catalog.js';
import { assetsRouter } from './routes/assets.js';
import { creationsRouter } from './routes/creations.js';
import { usersRouter } from './routes/creator/users.js';
import { libraryRouter } from './routes/creator/library.js';
import { templatesRouter } from './routes/creator/templates.js';
import { analyticsRouter, auditRouter } from './routes/creator/insights.js';
import { peopleRouter } from './routes/people.js';
import { postersRouter } from './routes/posters.js';
import { posterAdminRouter } from './routes/creator/poster-admin.js';
import { creatorCreationsRouter } from './routes/creator/creations.js';
import { dashboardRouter } from './routes/creator/dashboard.js';

export function createApp(
  prisma: PrismaClient,
  config: AppConfig,
  mailer: Mailer = createMailer(config),
  ai: AiProviders = createAiProviders(config),
) {
  mkdirSync(config.publicStorage, { recursive: true });
  mkdirSync(config.privateStorage, { recursive: true });

  const app = express();
  const perm = (p: Parameters<typeof requirePermission>[1]) => requirePermission(prisma, p);

  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  // Media is served to the SPA on another origin in dev, so allow cross-origin image loads.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: config.CLIENT_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use('/api', csrfGuard, loadUser(prisma, config));

  app.use('/api/health', healthRouter(prisma, config));
  app.use('/api/auth', authRouter(prisma, config, mailer));

  // ---- Both roles ----
  // All stored files are private: library assets via /api/assets (signed-in users),
  // personal photos via /api/creations/:id/image (owner only). Nothing is served statically.
  app.use('/api/assets', requireAuth, assetsRouter(prisma, config));
  app.use('/api/catalog', requireAuth, perm('avatar.browse'), catalogRouter(prisma, ai.embeddings));
  app.use('/api/ai', requireAuth, perm('avatar.generate'), aiRouter(prisma, config, ai));
  app.use(
    '/api/events',
    requireAuth,
    perm('event.participate'),
    eventsRouter(prisma, config, mailer),
  );
  app.use('/api/notifications', requireAuth, notificationsRouter(prisma));
  app.use(
    '/api/creations',
    requireAuth,
    perm('creation.manageOwn'),
    creationsRouter(prisma, config, mailer),
  );

  // Group anniversary posters: employee photos + generation (both roles, access rules inside).
  app.use('/api/people', requireAuth, perm('poster.create'), peopleRouter(prisma, config));
  app.use('/api/posters', requireAuth, perm('poster.create'), postersRouter(prisma, config, ai, mailer));

  // ---- Creator only ----
  app.use('/api/creator/posters', perm('template.manage'), posterAdminRouter(prisma, config));
  app.use('/api/creator/users', perm('employee.manage'), usersRouter(prisma, config));
  app.use('/api/creator/creations', perm('employee.manage'), creatorCreationsRouter(prisma, config));
  app.use('/api/creator/ai-images', perm('library.manage'), publishAiRouter(prisma, config));
  app.use('/api/creator/events', perm('event.manage'), creatorEventsRouter(prisma, config, mailer));
  app.use('/api/creator/library', perm('library.manage'), libraryRouter(prisma, config));
  app.use('/api/creator/templates', perm('template.manage'), templatesRouter(prisma, config));
  app.use('/api/creator/analytics', perm('analytics.view'), analyticsRouter(prisma));
  app.use('/api/creator/dashboard', perm('analytics.view'), dashboardRouter(prisma));
  app.use('/api/creator/audit', perm('audit.view'), auditRouter(prisma));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, details: err.details });
      return;
    }
    if (err instanceof multer.MulterError) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      res
        .status(status)
        .json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : err.message });
      return;
    }
    const status = typeof err?.status === 'number' ? err.status : 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
  };
  app.use(onError);

  return app;
}
