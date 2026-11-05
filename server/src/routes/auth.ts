import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { HttpError, parse } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { ROLE_PERMISSIONS } from '../lib/permissions.js';
import { PreferencesSchema, readPreferences } from '../lib/preferences.js';
import type { Mailer } from '../lib/mailer.js';
import { emailChangeEmail, resetEmail, verificationEmail } from '../lib/emails.js';
import {
  PasswordSchema,
  SESSION_COOKIE,
  burnPasswordCheck,
  createOneTimeToken,
  hashPassword,
  hashToken,
  signSession,
  verifyPassword,
} from '../lib/security.js';
import { employeeJoined } from '../lib/activity.js';
import { requireAuth, sessionCookieOptions, type AuthUser } from '../middleware/auth.js';

const Email = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);
const Token = z.string().min(20).max(200);

const LoginBody = z.object({
  email: Email,
  password: z.string().min(1).max(128),
  remember: z.boolean().optional().default(false),
});

const ChangePasswordBody = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: PasswordSchema,
});

const AcceptInviteBody = z.object({ token: Token, password: PasswordSchema });

/**
 * Public sign-up. `.strict()` turns any extra field — `role`, `roleCode`, `permissions` — into a
 * 400, and the handler hard-codes EMPLOYEE, so self-registration can never create a Creator.
 */
const RegisterBody = z
  .object({
    name: z.string().trim().min(2, 'Enter your full name').max(100),
    email: Email,
    password: PasswordSchema,
  })
  .strict();

const EmailBody = z.object({ email: Email }).strict();
const TokenBody = z.object({ token: Token }).strict();
const ResetBody = z.object({ token: Token, password: PasswordSchema }).strict();

const INVALID_LOGIN = 'Invalid email or password';
const BAD_LINK = 'This link is invalid or has expired';

export function publicUser(u: AuthUser) {
  return { ...u, permissions: ROLE_PERMISSIONS[u.role] };
}

export function authRouter(prisma: PrismaClient, config: AppConfig, mailer: Mailer): Router {
  const router = Router();

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.LOGIN_RATE_LIMIT_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many attempts. Please try again later.' },
  });

  /** "Remember me" → persistent cookie + long token; otherwise a browser-session cookie. */
  const startSession = (
    res: Response,
    user: { id: string; tokenVersion: number },
    remember = false,
  ) => {
    const token = signSession(
      { sub: user.id, tv: user.tokenVersion },
      config.JWT_SECRET,
      remember ? `${config.REMEMBER_ME_DAYS}d` : config.JWT_EXPIRES_IN,
    );
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions(config, remember));
  };

  const link = (page: string, raw: string) => `${config.CLIENT_ORIGIN}/${page}#${raw}`;

  const sendVerification = async (user: { id: string; email: string; name: string }) => {
    const { raw, hash } = createOneTimeToken();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        verifyTokenHash: hash,
        verifyExpiresAt: new Date(Date.now() + config.VERIFY_TTL_HOURS * 3600_000),
      },
    });
    await mailer.send(
      verificationEmail(user.email, user.name, link('verify-email', raw), config.VERIFY_TTL_HOURS),
    );
  };

  // ---- Login / logout / session -------------------------------------------

  router.post('/login', limiter, async (req: Request, res: Response) => {
    const { email, password, remember } = parse(LoginBody, req.body);
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !user.passwordHash) {
      await burnPasswordCheck(password);
      await audit(prisma, req, {
        action: 'AUTH_LOGIN_FAILED',
        details: { email, reason: user ? 'invite-pending' : 'unknown-email' },
      });
      throw new HttpError(401, INVALID_LOGIN);
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await audit(prisma, req, {
        action: 'AUTH_LOGIN_FAILED',
        actorId: user.id,
        details: { reason: 'locked' },
      });
      throw new HttpError(429, 'Too many failed attempts. Please try again later.');
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      const failed = user.failedLoginCount + 1;
      const lock = failed >= config.MAX_FAILED_LOGINS;
      await prisma.user.update({
        where: { id: user.id },
        data: lock
          ? {
              failedLoginCount: 0,
              lockedUntil: new Date(Date.now() + config.LOCKOUT_MINUTES * 60_000),
            }
          : { failedLoginCount: failed },
      });
      await audit(prisma, req, {
        action: lock ? 'AUTH_LOCKED_OUT' : 'AUTH_LOGIN_FAILED',
        actorId: user.id,
        details: { reason: 'bad-password', attempt: failed },
      });
      throw new HttpError(401, INVALID_LOGIN);
    }

    if (!user.isActive) {
      await audit(prisma, req, {
        action: 'AUTH_LOGIN_FAILED',
        actorId: user.id,
        details: { reason: 'inactive' },
      });
      throw new HttpError(401, INVALID_LOGIN);
    }

    // Only revealed after a correct password, so it can't be used to probe for accounts.
    if (!user.emailVerifiedAt) {
      await audit(prisma, req, {
        action: 'AUTH_LOGIN_FAILED',
        actorId: user.id,
        details: { reason: 'email-unverified' },
      });
      res.status(403).json({
        error: 'Please verify your email address first. Check your inbox for the link.',
        code: 'EMAIL_NOT_VERIFIED',
      });
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    startSession(res, user, remember);
    const authUser: AuthUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.roleCode,
    };
    req.user = authUser;
    await audit(prisma, req, { action: 'AUTH_LOGIN_SUCCESS', details: { remember } });
    res.json({ user: publicUser(authUser) });
  });

  router.post('/logout', async (req, res) => {
    if (req.user) await audit(prisma, req, { action: 'AUTH_LOGOUT' });
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.status(204).end();
  });

  router.get('/me', requireAuth, (req, res) => {
    res.json({ user: publicUser(req.user!) });
  });

  /**
   * Own profile (Edit Profile). People edit only their display name and phone here; email
   * changes go through verification below; role, Employee ID, department and designation are
   * managed by Creators. `.strict()` turns any other field (e.g. `role`) into a 400.
   */
  const profileOf = async (id: string) => {
    const u = await prisma.user.findUniqueOrThrow({
      where: { id },
      select: {
        name: true,
        email: true,
        employeeCode: true,
        department: true,
        designation: true,
        phone: true,
        pendingEmail: true,
        roleCode: true,
        createdAt: true,
        lastLoginAt: true,
      },
    });
    const photo = await prisma.employeePhoto.findFirst({
      where: { userId: id, isActive: true, isPrimary: true },
      select: { id: true },
    });
    const { roleCode, ...rest } = u;
    return {
      ...rest,
      role: roleCode,
      photo: photo
        ? {
            id: photo.id,
            url: `/api/people/photos/${photo.id}/file`,
            thumbUrl: `/api/people/photos/${photo.id}/thumb`,
          }
        : null,
    };
  };
  router.get('/profile', requireAuth, async (req, res) => {
    res.json(await profileOf(req.user!.id));
  });
  const ProfileBody = z
    .object({
      name: z.string().trim().min(1, 'Enter your name').max(100).optional(),
      phone: z
        .union([
          z.literal('').transform(() => null),
          z
            .string()
            .trim()
            .max(32)
            .regex(/^\+?[0-9 ()-]{6,30}$/, 'Enter a phone number with digits, spaces, dashes or a leading +'),
        ])
        .nullable()
        .optional(),
    })
    .strict()
    .refine((b) => Object.keys(b).length > 0, 'Nothing to change');
  router.patch('/profile', requireAuth, async (req, res) => {
    const body = parse(ProfileBody, req.body);
    const u = await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
      },
      select: { name: true },
    });
    req.user = { ...req.user!, name: u.name };
    await audit(prisma, req, { action: 'PROFILE_UPDATED', details: { fields: Object.keys(body) } });
    res.json({ user: publicUser(req.user), profile: await profileOf(req.user.id) });
  });

  /**
   * Company-email change: re-authenticate with the password, then a link is sent to the NEW
   * address; the email only changes once that link is opened. Same company-domain rule as sign-up.
   */
  router.post('/profile/email-change', requireAuth, limiter, async (req, res) => {
    const body = parse(
      z
        .object({
          email: z.string().trim().toLowerCase().email().max(254),
          password: z.string().min(1).max(200),
        })
        .strict(),
      req.body,
    );
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (!user.passwordHash || !(await verifyPassword(body.password, user.passwordHash))) {
      throw new HttpError(400, 'Your password is incorrect');
    }
    if (body.email === user.email) throw new HttpError(400, 'That is already your email address');
    const domain = body.email.split('@')[1];
    if (config.SIGNUP_EMAIL_DOMAINS.length && !config.SIGNUP_EMAIL_DOMAINS.includes(domain)) {
      throw new HttpError(
        400,
        `Use your company email address (${config.SIGNUP_EMAIL_DOMAINS.map((d) => '@' + d).join(', ')})`,
      );
    }
    const clash = await prisma.user.findFirst({
      where: { OR: [{ email: body.email }, { pendingEmail: body.email }], id: { not: user.id } },
      select: { id: true },
    });
    if (clash) throw new HttpError(409, 'That email address is already in use');
    const { raw, hash } = createOneTimeToken();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        pendingEmail: body.email,
        emailChangeTokenHash: hash,
        emailChangeExpiresAt: new Date(Date.now() + config.VERIFY_TTL_HOURS * 3600_000),
      },
    });
    await mailer.send(
      emailChangeEmail(body.email, user.name, link('confirm-email', raw), config.VERIFY_TTL_HOURS),
    );
    await audit(prisma, req, { action: 'EMAIL_CHANGE_REQUESTED', details: { to: body.email } });
    res.status(202).json({ pendingEmail: body.email, emailDelivery: mailer.mode });
  });
  router.delete('/profile/email-change', requireAuth, async (req, res) => {
    await prisma.user.update({
      where: { id: req.user!.id },
      data: { pendingEmail: null, emailChangeTokenHash: null, emailChangeExpiresAt: null },
    });
    res.status(204).end();
  });
  router.post('/confirm-email', limiter, async (req, res) => {
    const { token } = parse(TokenBody, req.body);
    const user = await prisma.user.findUnique({ where: { emailChangeTokenHash: hashToken(token) } });
    if (
      !user ||
      !user.pendingEmail ||
      !user.emailChangeExpiresAt ||
      user.emailChangeExpiresAt < new Date()
    ) {
      throw new HttpError(400, BAD_LINK);
    }
    const clash = await prisma.user.findFirst({
      where: { email: user.pendingEmail, id: { not: user.id } },
      select: { id: true },
    });
    if (clash) throw new HttpError(409, 'That email address is already in use');
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        email: user.pendingEmail,
        emailVerifiedAt: new Date(),
        pendingEmail: null,
        emailChangeTokenHash: null,
        emailChangeExpiresAt: null,
      },
    });
    await audit(prisma, req, {
      action: 'EMAIL_CHANGED',
      actorId: user.id,
      entityType: 'User',
      entityId: user.id,
      details: { from: user.email, to: updated.email },
    });
    res.json({ email: updated.email });
  });

  // ---- Public sign-up (EMPLOYEE only) + email verification ------------------

  /** Tells the Sign Up page which company domains it accepts. */
  router.get('/signup-info', (_req, res) => {
    res.json({ domains: config.SIGNUP_EMAIL_DOMAINS, emailDelivery: mailer.mode });
  });

  router.post('/register', limiter, async (req, res) => {
    const body = parse(RegisterBody, req.body);
    const domain = body.email.split('@')[1];
    if (!config.SIGNUP_EMAIL_DOMAINS.includes(domain)) {
      throw new HttpError(
        400,
        `Use your company email address (${config.SIGNUP_EMAIL_DOMAINS.map((d) => '@' + d).join(', ')})`,
      );
    }
    const local = body.email.split('@')[0];
    if (local.length >= 3 && body.password.toLowerCase().includes(local)) {
      throw new HttpError(400, 'Password must not contain your email address');
    }

    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) {
      // Self-registered but never verified: send a fresh link instead of a dead end.
      if (existing.passwordHash && !existing.emailVerifiedAt && existing.isActive) {
        await sendVerification(existing);
        res.status(409).json({
          error:
            "This email is already registered but not verified yet. We've sent a new verification link.",
          code: 'EMAIL_UNVERIFIED',
        });
        return;
      }
      await audit(prisma, req, {
        action: 'AUTH_REGISTER_REJECTED',
        details: { email: body.email, reason: 'duplicate' },
      });
      throw new HttpError(
        409,
        'An account with this email already exists. Sign in, or use “Forgot password”.',
      );
    }

    const user = await prisma.user.create({
      data: {
        email: body.email,
        name: body.name,
        roleCode: 'EMPLOYEE', // never taken from the request
        passwordHash: await hashPassword(body.password),
      },
    });
    try {
      await sendVerification(user);
    } catch (e) {
      // No half-created accounts: if the email can't go out, let them try again cleanly.
      await prisma.user.delete({ where: { id: user.id } });
      if (e instanceof HttpError) throw e;
      console.error('verification email failed', e);
      throw new HttpError(502, "We couldn't send the verification email. Please try again later.");
    }
    await audit(prisma, req, {
      action: 'AUTH_REGISTERED',
      actorId: user.id,
      entityType: 'User',
      entityId: user.id,
    });
    res.status(201).json({ email: user.email, emailDelivery: mailer.mode });
  });

  router.post('/verify-email', limiter, async (req, res) => {
    const { token } = parse(TokenBody, req.body);
    const user = await prisma.user.findUnique({ where: { verifyTokenHash: hashToken(token) } });
    if (!user || !user.verifyExpiresAt || user.verifyExpiresAt < new Date()) {
      throw new HttpError(400, BAD_LINK);
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date(), verifyTokenHash: null, verifyExpiresAt: null },
    });
    await audit(prisma, req, { action: 'AUTH_EMAIL_VERIFIED', actorId: user.id });
    await employeeJoined(prisma, user.id, 'sign-up').catch((e) => console.error('join notification failed', e));
    res.json({ email: user.email });
  });

  /** Always 202 so it can't be used to discover accounts. */
  router.post('/resend-verification', limiter, async (req, res) => {
    const { email } = parse(EmailBody, req.body);
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && user.passwordHash && !user.emailVerifiedAt && user.isActive) {
      await sendVerification(user).catch((e) => console.error('resend verification failed', e));
    }
    res.status(202).json({ ok: true });
  });

  // ---- Forgot / reset password ---------------------------------------------

  /** Always 202 so it can't be used to discover accounts. */
  router.post('/forgot-password', limiter, async (req, res) => {
    const { email } = parse(EmailBody, req.body);
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && user.passwordHash && user.isActive) {
      const { raw, hash } = createOneTimeToken();
      await prisma.user.update({
        where: { id: user.id },
        data: {
          resetTokenHash: hash,
          resetExpiresAt: new Date(Date.now() + config.RESET_TTL_MINUTES * 60_000),
        },
      });
      try {
        await mailer.send(
          resetEmail(user.email, user.name, link('reset-password', raw), config.RESET_TTL_MINUTES),
        );
        await audit(prisma, req, { action: 'AUTH_PASSWORD_RESET_REQUESTED', actorId: user.id });
      } catch (e) {
        if (e instanceof HttpError && e.status === 503) throw e;
        console.error('reset email failed', e);
        throw new HttpError(502, "We couldn't send the email. Please try again later.");
      }
    }
    res.status(202).json({ ok: true, emailDelivery: mailer.mode });
  });

  const findResetUser = async (raw: string) => {
    const user = await prisma.user.findUnique({ where: { resetTokenHash: hashToken(raw) } });
    if (!user || !user.resetExpiresAt || user.resetExpiresAt < new Date() || !user.isActive) {
      throw new HttpError(400, BAD_LINK);
    }
    return user;
  };

  /** Lets the reset page check the link before showing the form. */
  router.get('/reset-password/:token', limiter, async (req, res) => {
    const user = await findResetUser(String(req.params.token));
    res.json({ email: user.email });
  });

  router.post('/reset-password', limiter, async (req, res) => {
    const body = parse(ResetBody, req.body);
    const user = await findResetUser(body.token);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(body.password),
        resetTokenHash: null,
        resetExpiresAt: null,
        tokenVersion: { increment: 1 }, // sign out every existing session
        failedLoginCount: 0,
        lockedUntil: null,
        // The link reached their inbox, so the address is proven.
        emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
        verifyTokenHash: null,
        verifyExpiresAt: null,
      },
    });
    await audit(prisma, req, { action: 'AUTH_PASSWORD_RESET', actorId: user.id });
    res.json({ email: user.email });
  });

  // ---- Own account ---------------------------------------------------------

  /** Appearance settings belong to the signed-in user only — there is no way to address another user. */
  router.get('/preferences', requireAuth, async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.user!.id },
      select: { preferences: true },
    });
    res.json({ preferences: readPreferences(user.preferences) });
  });

  router.put('/preferences', requireAuth, async (req, res) => {
    // Older clients may not send newer groups (e.g. notifications): keep the saved ones.
    const current = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { preferences: true } });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const preferences = parse(PreferencesSchema, {
      notifications: readPreferences(current.preferences).notifications,
      ...body,
    });
    await prisma.user.update({
      where: { id: req.user!.id },
      data: { preferences: JSON.stringify(preferences) },
    });
    res.json({ preferences });
  });

  router.post('/change-password', requireAuth, limiter, async (req, res) => {
    const body = parse(ChangePasswordBody, req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (!user.passwordHash || !(await verifyPassword(body.currentPassword, user.passwordHash))) {
      throw new HttpError(400, 'Current password is incorrect');
    }
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(body.newPassword),
        tokenVersion: { increment: 1 }, // sign out every other session
      },
    });
    startSession(res, updated);
    await audit(prisma, req, { action: 'AUTH_PASSWORD_CHANGED' });
    res.status(204).end();
  });

  // ---- Invites (Creator-issued) ---------------------------------------------

  /** Lets the accept-invite page show who the invite is for before a password is set. */
  router.get('/invite/:token', limiter, async (req, res) => {
    const user = await findInvitee(prisma, String(req.params.token));
    res.json({ email: user.email, name: user.name });
  });

  router.post('/accept-invite', limiter, async (req, res) => {
    const body = parse(AcceptInviteBody, req.body);
    const invitee = await findInvitee(prisma, body.token);
    const user = await prisma.user.update({
      where: { id: invitee.id },
      data: {
        passwordHash: await hashPassword(body.password),
        inviteTokenHash: null,
        inviteExpiresAt: null,
        tokenVersion: { increment: 1 },
        lastLoginAt: new Date(),
        emailVerifiedAt: new Date(), // the invite link proved the address
      },
    });
    startSession(res, user);
    const authUser: AuthUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.roleCode,
    };
    req.user = authUser;
    await audit(prisma, req, { action: 'AUTH_INVITE_ACCEPTED' });
    await employeeJoined(prisma, authUser.id, 'invite').catch((e) => console.error('join notification failed', e));
    res.json({ user: publicUser(authUser) });
  });

  return router;
}

async function findInvitee(prisma: PrismaClient, rawToken: string) {
  const user = await prisma.user.findUnique({ where: { inviteTokenHash: hashToken(rawToken) } });
  if (!user || !user.inviteExpiresAt || user.inviteExpiresAt < new Date() || !user.isActive) {
    throw new HttpError(400, 'This invitation link is invalid or has expired');
  }
  return user;
}
