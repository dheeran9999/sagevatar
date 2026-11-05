import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { AppConfig } from '../config.js';
import type { Role } from '../lib/domain.js';
import { can, type Permission } from '../lib/permissions.js';
import { SESSION_COOKIE, verifySession } from '../lib/security.js';
import { audit } from '../lib/audit.js';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/** Without "remember me" the cookie has no maxAge, so it ends when the browser closes. */
export function sessionCookieOptions(config: AppConfig, remember = false) {
  return {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'strict' as const,
    path: '/',
    ...(remember ? { maxAge: config.REMEMBER_ME_DAYS * 24 * 3600 * 1000 } : {}),
  };
}

/**
 * Resolves the session cookie to a user. The role is always re-read from the
 * database, so deactivation, role data and revocation take effect immediately.
 */
export function loadUser(prisma: PrismaClient, config: AppConfig): RequestHandler {
  return async (req, res, next) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) return next();
    const claims = verifySession(token, config.JWT_SECRET);
    const user = claims
      ? await prisma.user.findUnique({
          where: { id: claims.sub },
          select: {
            id: true,
            email: true,
            name: true,
            roleCode: true,
            isActive: true,
            tokenVersion: true,
          },
        })
      : null;
    if (!user || !claims || !user.isActive || user.tokenVersion !== claims.tv) {
      res.clearCookie(SESSION_COOKIE, { path: '/' });
      return next();
    }
    req.user = { id: user.id, email: user.email, name: user.name, role: user.roleCode };
    next();
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  next();
}

/** 403 unless the signed-in user's role grants `permission`. Denials are audited. */
export function requirePermission(prisma: PrismaClient, permission: Permission): RequestHandler {
  return async (req, res, next) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (!can(req.user.role, permission)) {
      await audit(prisma, req, {
        action: 'ACCESS_DENIED',
        details: { permission, method: req.method, path: req.originalUrl.split('?')[0] },
      });
      res.status(403).json({ error: 'You do not have permission to do this' });
      return;
    }
    next();
  };
}

/**
 * CSRF defence in depth (on top of SameSite=Strict): state-changing API calls must
 * carry a custom header, which a cross-site form or image tag cannot add.
 */
export const CSRF_HEADER = 'x-sageavatar-request';
export function csrfGuard(req: Request, res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get(CSRF_HEADER) !== '1') {
    res.status(403).json({ error: 'Missing request header' });
    return;
  }
  next();
}
