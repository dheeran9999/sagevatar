import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { SESSION_COOKIE } from '../src/lib/security.js';
import { app, config, prisma, H, CREATOR, EMPLOYEE, loginAs, newEmployee } from './helpers.js';

afterAll(() => prisma.$disconnect());

describe('login', () => {
  it('sets an httpOnly, SameSite=Strict session cookie and returns permissions', async () => {
    const res = await request(app).post('/api/auth/login').set(H).send(EMPLOYEE);
    expect(res.status).toBe(200);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(res.body.user.role).toBe('EMPLOYEE');
    expect(res.body.user.permissions).toContain('studio.use');
    expect(res.body.user.permissions).not.toContain('library.manage');
    expect(res.body.user).not.toHaveProperty('passwordHash');
  });

  it('gives Creators the management permissions', async () => {
    const res = await request(app).post('/api/auth/login').set(H).send(CREATOR);
    expect(res.body.user.role).toBe('CREATOR');
    expect(res.body.user.permissions).toEqual(
      expect.arrayContaining(['library.manage', 'employee.manage', 'analytics.view']),
    );
  });

  it('uses the same message for wrong password and unknown email', async () => {
    const a = await request(app)
      .post('/api/auth/login')
      .set(H)
      .send({ ...EMPLOYEE, password: 'nope-nope-1' });
    const b = await request(app)
      .post('/api/auth/login')
      .set(H)
      .send({ email: 'ghost@x.io', password: 'nope-nope-1' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error).toBe(b.body.error);
  });

  it('is case-insensitive on email', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set(H)
      .send({ ...EMPLOYEE, email: EMPLOYEE.email.toUpperCase() });
    expect(res.status).toBe(200);
  });

  it('rejects state-changing requests without the CSRF header', async () => {
    const res = await request(app).post('/api/auth/login').send(EMPLOYEE);
    expect(res.status).toBe(403);
  });

  it('locks the account after repeated failures, even for the right password', async () => {
    const e = await newEmployee('lock');
    for (let i = 0; i < config.MAX_FAILED_LOGINS; i++) {
      await request(app)
        .post('/api/auth/login')
        .set(H)
        .send({ email: e.email, password: 'wrong-pass-1' });
    }
    const res = await request(app)
      .post('/api/auth/login')
      .set(H)
      .send({ email: e.email, password: e.password });
    expect(res.status).toBe(429);
    const logs = await prisma.auditLog.count({
      where: { actorId: e.user.id, action: 'AUTH_LOCKED_OUT' },
    });
    expect(logs).toBe(1);
  });

  it('rate-limits the login endpoint', async () => {
    const strict = createApp(prisma, { ...config, LOGIN_RATE_LIMIT_MAX: 2 });
    const send = () =>
      request(strict)
        .post('/api/auth/login')
        .set(H)
        .send({ email: 'x@y.io', password: 'whatever-1' });
    await send();
    await send();
    expect((await send()).status).toBe(429);
  });
});

describe('sessions', () => {
  it('/me requires a session', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
  });

  it('rejects a forged session cookie', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `${SESSION_COOKIE}=eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.`);
    expect(res.status).toBe(401);
  });

  it('logout ends the session', async () => {
    const agent = await loginAs(EMPLOYEE);
    expect((await agent.get('/api/auth/me')).status).toBe(200);
    expect((await agent.post('/api/auth/logout').set(H)).status).toBe(204);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('changing password revokes other sessions but keeps the current one', async () => {
    const e = await newEmployee('pwchange');
    const other = await loginAs(e);
    const res = await e.agent
      .post('/api/auth/change-password')
      .set(H)
      .send({ currentPassword: e.password, newPassword: 'Brand-new-pass-9' });
    expect(res.status).toBe(204);
    expect((await e.agent.get('/api/auth/me')).status).toBe(200);
    expect((await other.get('/api/auth/me')).status).toBe(401);
  });

  it('enforces the password policy', async () => {
    const e = await newEmployee('weak');
    const res = await e.agent
      .post('/api/auth/change-password')
      .set(H)
      .send({ currentPassword: e.password, newPassword: 'short' });
    expect(res.status).toBe(400);
  });
});

describe('invitations', () => {
  it('a Creator invites an Employee who sets a password and signs in as EMPLOYEE', async () => {
    const creator = await loginAs(CREATOR);
    const inv = await creator
      .post('/api/creator/users/invite')
      .set(H)
      .send({ email: 'New.Hire@Test.local', name: 'New Hire' });
    expect(inv.status).toBe(201);
    expect(inv.body.user.role).toBe('EMPLOYEE');
    expect(inv.body.user.status).toBe('INVITE_PENDING');
    const token = new URL(inv.body.inviteUrl).hash.slice(1);

    // The raw token is never stored.
    const stored = await prisma.user.findUniqueOrThrow({ where: { email: 'new.hire@test.local' } });
    expect(stored.inviteTokenHash).not.toBe(token);

    // Cannot log in before accepting.
    const early = await request(app)
      .post('/api/auth/login')
      .set(H)
      .send({ email: 'new.hire@test.local', password: 'Whatever-123' });
    expect(early.status).toBe(401);

    expect((await request(app).get(`/api/auth/invite/${token}`)).body.email).toBe(
      'new.hire@test.local',
    );

    const accept = request.agent(app);
    const res = await accept
      .post('/api/auth/accept-invite')
      .set(H)
      .send({ token, password: 'Welcome-aboard-1' });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('EMPLOYEE');
    expect((await accept.get('/api/auth/me')).status).toBe(200);

    // One-time: the same link cannot be used again.
    const again = await request(app)
      .post('/api/auth/accept-invite')
      .set(H)
      .send({ token, password: 'Welcome-aboard-2' });
    expect(again.status).toBe(400);
  });

  it('rejects expired invitations', async () => {
    const creator = await loginAs(CREATOR);
    const inv = await creator
      .post('/api/creator/users/invite')
      .set(H)
      .send({ email: 'late@test.local', name: 'Late' });
    await prisma.user.update({
      where: { email: 'late@test.local' },
      data: { inviteExpiresAt: new Date(Date.now() - 1000) },
    });
    const token = new URL(inv.body.inviteUrl).hash.slice(1);
    const res = await request(app)
      .post('/api/auth/accept-invite')
      .set(H)
      .send({ token, password: 'Welcome-aboard-1' });
    expect(res.status).toBe(400);
  });

  it('rejects duplicate emails', async () => {
    const creator = await loginAs(CREATOR);
    const res = await creator
      .post('/api/creator/users/invite')
      .set(H)
      .send({ email: EMPLOYEE.email, name: 'Dup' });
    expect(res.status).toBe(409);
  });
});
