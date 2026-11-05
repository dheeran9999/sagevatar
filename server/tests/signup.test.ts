import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { SMTPServer } from 'smtp-server';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { createMailer, type Mail, type Mailer } from '../src/lib/mailer.js';
import { config, prisma, H, CREATOR } from './helpers.js';

afterAll(() => prisma.$disconnect());

/** Captures mail in memory so tests can follow the links. */
const outbox: Mail[] = [];
const capture: Mailer = {
  mode: 'smtp',
  async send(m) {
    outbox.push(m);
  },
};
const app = createApp(prisma, config, capture);
beforeEach(() => {
  outbox.length = 0;
});

const email = (label = 'new') => `${label}-${randomUUID().slice(0, 8)}@sageitinc.com`;
const PASSWORD = 'Strong-pass-123';
const tokenFrom = (m: Mail | undefined, page: string) => {
  const match = m?.text.match(new RegExp(`/${page}#([A-Za-z0-9_-]+)`));
  if (!match) throw new Error(`no ${page} link in mail`);
  return match[1];
};
const register = (body: Record<string, unknown>) =>
  request(app).post('/api/auth/register').set(H).send(body);
const login = (e: string, password = PASSWORD, remember = false) =>
  request(app).post('/api/auth/login').set(H).send({ email: e, password, remember });

describe('sign up', () => {
  it('creates an unverified EMPLOYEE and emails a verification link', async () => {
    const e = email();
    const res = await register({ name: 'New Person', email: e, password: PASSWORD });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ email: e, emailDelivery: 'smtp' });

    const user = await prisma.user.findUniqueOrThrow({ where: { email: e } });
    expect(user.roleCode).toBe('EMPLOYEE');
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.passwordHash).not.toContain(PASSWORD);

    expect(outbox).toHaveLength(1);
    expect(outbox[0].to).toBe(e);
    expect(outbox[0].subject).toMatch(/verify/i);
    expect(outbox[0].html).toContain('/verify-email#');
    // Only the hash is stored.
    expect(user.verifyTokenHash).not.toBe(tokenFrom(outbox[0], 'verify-email'));
  });

  it('blocks login until the email is verified, then lets the Employee in', async () => {
    const e = email();
    await register({ name: 'Verify Me', email: e, password: PASSWORD });
    const token = tokenFrom(outbox[0], 'verify-email');

    const before = await login(e);
    expect(before.status).toBe(403);
    expect(before.body.code).toBe('EMAIL_NOT_VERIFIED');
    expect(String(before.headers['set-cookie'] ?? '')).not.toContain('sa_session=ey');

    const verified = await request(app).post('/api/auth/verify-email').set(H).send({ token });
    expect(verified.status).toBe(200);
    expect(verified.body.email).toBe(e);

    const after = await login(e);
    expect(after.status).toBe(200);
    expect(after.body.user.role).toBe('EMPLOYEE');
    expect(after.body.user.permissions).not.toContain('library.manage');

    // Links are single-use.
    const again = await request(app).post('/api/auth/verify-email').set(H).send({ token });
    expect(again.status).toBe(400);
  });

  it('never accepts a role from the client', async () => {
    for (const extra of [{ role: 'CREATOR' }, { roleCode: 'CREATOR' }, { permissions: ['x'] }]) {
      const e = email('role');
      const res = await register({ name: 'Sneaky', email: e, password: PASSWORD, ...extra });
      expect(res.status).toBe(400);
      expect(await prisma.user.findUnique({ where: { email: e } })).toBeNull();
    }
  });

  it('validates required fields, email format, company domain and password strength', async () => {
    expect((await register({})).status).toBe(400);
    expect(
      (await register({ name: 'A B', email: 'not-an-email', password: PASSWORD })).status,
    ).toBe(400);
    const outside = await register({ name: 'Out Side', email: 'x@gmail.com', password: PASSWORD });
    expect(outside.status).toBe(400);
    expect(outside.body.error).toMatch(/company email/i);

    for (const weak of [
      'short1A!',
      'alllowercase-123',
      'ALLUPPER-123',
      'NoNumbers-here',
      'NoSymbol1234',
    ]) {
      const res = await register({ name: 'Weak Pass', email: email('weak'), password: weak });
      expect(res.status, weak).toBe(400);
    }
    const local = `jordan${randomUUID().slice(0, 4)}`;
    const containsEmail = await register({
      name: 'Jordan',
      email: `${local}@sageitinc.com`,
      password: `X-${local}-99`,
    });
    expect(containsEmail.status).toBe(400);
    expect(outbox).toHaveLength(0);
  });

  it('prevents duplicate accounts', async () => {
    const e = email('dup');
    await register({ name: 'First One', email: e, password: PASSWORD });
    await request(app)
      .post('/api/auth/verify-email')
      .set(H)
      .send({ token: tokenFrom(outbox[0], 'verify-email') });

    const dup = await register({ name: 'Second One', email: e.toUpperCase(), password: PASSWORD });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatch(/already exists/i);
    expect(await prisma.user.count({ where: { email: e } })).toBe(1);
  });

  it('re-sends a fresh link when an unverified address registers again', async () => {
    const e = email('again');
    await register({ name: 'Again', email: e, password: PASSWORD });
    const first = tokenFrom(outbox[0], 'verify-email');
    const res = await register({ name: 'Again', email: e, password: PASSWORD });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EMAIL_UNVERIFIED');
    const second = tokenFrom(outbox[1], 'verify-email');
    expect(second).not.toBe(first);
    expect(
      (await request(app).post('/api/auth/verify-email').set(H).send({ token: first })).status,
    ).toBe(400);
    expect(
      (await request(app).post('/api/auth/verify-email').set(H).send({ token: second })).status,
    ).toBe(200);
  });

  it('rejects expired verification links', async () => {
    const e = email('exp');
    await register({ name: 'Expired', email: e, password: PASSWORD });
    await prisma.user.update({
      where: { email: e },
      data: { verifyExpiresAt: new Date(Date.now() - 1000) },
    });
    const res = await request(app)
      .post('/api/auth/verify-email')
      .set(H)
      .send({ token: tokenFrom(outbox[0], 'verify-email') });
    expect(res.status).toBe(400);
  });

  it('resend-verification answers the same way for unknown addresses', async () => {
    const unknown = await request(app)
      .post('/api/auth/resend-verification')
      .set(H)
      .send({ email: email('ghost') });
    expect(unknown.status).toBe(202);
    expect(outbox).toHaveLength(0);

    const e = email('resend');
    await register({ name: 'Resend', email: e, password: PASSWORD });
    const known = await request(app)
      .post('/api/auth/resend-verification')
      .set(H)
      .send({ email: e });
    expect(known.status).toBe(202);
    expect(outbox).toHaveLength(2);
  });

  it('needs the CSRF header', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'No Header', email: email(), password: PASSWORD });
    expect(res.status).toBe(403);
  });

  it('a self-registered Employee cannot reach Creator APIs', async () => {
    const e = email('limits');
    await register({ name: 'Limited', email: e, password: PASSWORD });
    await request(app)
      .post('/api/auth/verify-email')
      .set(H)
      .send({ token: tokenFrom(outbox[0], 'verify-email') });
    const agent = request.agent(app);
    await agent.post('/api/auth/login').set(H).send({ email: e, password: PASSWORD });
    for (const url of [
      '/api/creator/users',
      '/api/creator/library/avatars',
      '/api/creator/audit',
    ]) {
      expect((await agent.get(url)).status, url).toBe(403);
    }
    const invite = await agent
      .post('/api/creator/users/invite')
      .set(H)
      .send({ email: email('x'), name: 'X' });
    expect(invite.status).toBe(403);
  });
});

describe('forgot / reset password', () => {
  async function verifiedUser() {
    const e = email('reset');
    await register({ name: 'Reset Me', email: e, password: PASSWORD });
    await request(app)
      .post('/api/auth/verify-email')
      .set(H)
      .send({ token: tokenFrom(outbox[0], 'verify-email') });
    outbox.length = 0;
    return e;
  }

  it('answers the same way for unknown addresses and sends nothing', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .set(H)
      .send({ email: email('nobody') });
    expect(res.status).toBe(202);
    expect(outbox).toHaveLength(0);
  });

  it('emails a single-use link that sets a new password and signs out old sessions', async () => {
    const e = await verifiedUser();
    const agent = request.agent(app);
    await agent.post('/api/auth/login').set(H).send({ email: e, password: PASSWORD });
    expect((await agent.get('/api/auth/me')).status).toBe(200);

    const asked = await request(app).post('/api/auth/forgot-password').set(H).send({ email: e });
    expect(asked.status).toBe(202);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].subject).toMatch(/reset/i);
    const token = tokenFrom(outbox[0], 'reset-password');

    const check = await request(app).get(`/api/auth/reset-password/${token}`);
    expect(check.status).toBe(200);
    expect(check.body.email).toBe(e);

    const weak = await request(app)
      .post('/api/auth/reset-password')
      .set(H)
      .send({ token, password: 'weak' });
    expect(weak.status).toBe(400);

    const NEW = 'Brand-new-pass-77';
    const done = await request(app)
      .post('/api/auth/reset-password')
      .set(H)
      .send({ token, password: NEW });
    expect(done.status).toBe(200);

    expect((await agent.get('/api/auth/me')).status).toBe(401);
    expect((await login(e, PASSWORD)).status).toBe(401);
    expect((await login(e, NEW)).status).toBe(200);

    const reuse = await request(app)
      .post('/api/auth/reset-password')
      .set(H)
      .send({ token, password: 'Another-pass-88' });
    expect(reuse.status).toBe(400);
  });

  it('rejects invalid and expired reset links', async () => {
    expect((await request(app).get('/api/auth/reset-password/' + 'x'.repeat(43))).status).toBe(400);
    const e = await verifiedUser();
    await request(app).post('/api/auth/forgot-password').set(H).send({ email: e });
    await prisma.user.update({
      where: { email: e },
      data: { resetExpiresAt: new Date(Date.now() - 1000) },
    });
    const token = tokenFrom(outbox[0], 'reset-password');
    expect((await request(app).get(`/api/auth/reset-password/${token}`)).status).toBe(400);
  });

  it('a reset also clears a lockout', async () => {
    const e = await verifiedUser();
    await prisma.user.update({
      where: { email: e },
      data: { lockedUntil: new Date(Date.now() + 600_000) },
    });
    await request(app).post('/api/auth/forgot-password').set(H).send({ email: e });
    const token = tokenFrom(outbox[0], 'reset-password');
    await request(app)
      .post('/api/auth/reset-password')
      .set(H)
      .send({ token, password: 'Unlocked-pass-55' });
    expect((await login(e, 'Unlocked-pass-55')).status).toBe(200);
  });
});

describe('remember me', () => {
  it('sets a persistent cookie only when asked', async () => {
    const plain = await request(app).post('/api/auth/login').set(H).send(CREATOR);
    const remembered = await request(app)
      .post('/api/auth/login')
      .set(H)
      .send({ ...CREATOR, remember: true });
    expect(plain.status).toBe(200);
    expect(String(plain.headers['set-cookie'])).not.toMatch(/Max-Age|Expires/i);
    expect(String(remembered.headers['set-cookie'])).toMatch(/Max-Age=2592000/);
  });
});

describe('real SMTP delivery path', () => {
  it('sends the verification email over SMTP (local capture server)', async () => {
    const received: string[] = [];
    const server = new SMTPServer({
      authOptional: true,
      disabledCommands: ['STARTTLS', 'AUTH'],
      logger: false,
      onData(stream, _session, cb) {
        let raw = '';
        stream.on('data', (c: Buffer) => (raw += c.toString('utf8')));
        stream.on('end', () => {
          received.push(raw);
          cb();
        });
      },
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.server.address() as AddressInfo).port;
    try {
      const smtpApp = createApp(
        prisma,
        config,
        createMailer({
          ...config,
          SMTP_HOST: '127.0.0.1',
          SMTP_PORT: port,
          SMTP_SECURE: false,
          SMTP_USER: '',
          emailConfigured: true,
        }),
      );
      const e = email('smtp');
      const res = await request(smtpApp)
        .post('/api/auth/register')
        .set(H)
        .send({ name: 'Smtp Person', email: e, password: PASSWORD });
      expect(res.status).toBe(201);
      expect(received).toHaveLength(1);

      // Undo quoted-printable soft line breaks, then follow the link.
      const raw = received[0].replace(/=\r?\n/g, '').replace(/=3D/g, '=');
      expect(raw).toMatch(new RegExp(`^To: ${e}`, 'mi'));
      expect(raw).toMatch(/^Subject: Verify your SageVatar email address/m);
      const token = raw.match(/\/verify-email#([A-Za-z0-9_-]+)/)![1];
      const ok = await request(smtpApp).post('/api/auth/verify-email').set(H).send({ token });
      expect(ok.status).toBe(200);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('does not leave an account behind when the SMTP server is unreachable', async () => {
    const broken = createApp(
      prisma,
      config,
      createMailer({ ...config, SMTP_HOST: '127.0.0.1', SMTP_PORT: 1, emailConfigured: true }),
    );
    const e = email('nomail');
    const res = await request(broken)
      .post('/api/auth/register')
      .set(H)
      .send({ name: 'No Mail', email: e, password: PASSWORD });
    expect(res.status).toBe(502);
    expect(await prisma.user.findUnique({ where: { email: e } })).toBeNull();
  });
});
