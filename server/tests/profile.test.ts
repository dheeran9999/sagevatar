import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import type { Mail, Mailer } from '../src/lib/mailer.js';
import { hashPassword } from '../src/lib/security.js';
import { config, prisma, H, CREATOR, loginAs, jpeg } from './helpers.js';

afterAll(() => prisma.$disconnect());

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

const PASSWORD = 'Employee-pass-123';
const domain = config.SIGNUP_EMAIL_DOMAINS[0] ?? 'sageitinc.com';

async function employee(label = 'prof') {
  const email = `${label}-${randomUUID().slice(0, 8)}@${domain}`;
  const user = await prisma.user.create({
    data: {
      email,
      name: label,
      roleCode: 'EMPLOYEE',
      passwordHash: await hashPassword(PASSWORD),
      emailVerifiedAt: new Date(),
      employeeCode: `P-${randomUUID().slice(0, 6).toUpperCase()}`,
    },
  });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').set(H).send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { user, email, agent };
}

describe('Edit Profile (own account)', () => {
  it('shows the profile fields and lets people change their name and phone', async () => {
    const e = await employee();
    const p = await e.agent.get('/api/auth/profile');
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({
      email: e.email,
      role: 'EMPLOYEE',
      employeeCode: e.user.employeeCode,
      department: null,
      designation: null,
      phone: null,
      photo: null,
    });
    expect(p.body.createdAt).toBeTruthy();

    const ok = await e.agent.patch('/api/auth/profile').set(H).send({ name: 'Asha K', phone: '+91 98765 43210' });
    expect(ok.status).toBe(200);
    expect(ok.body.profile).toMatchObject({ name: 'Asha K', phone: '+91 98765 43210' });
    // Clearing the phone is allowed.
    const cleared = await e.agent.patch('/api/auth/profile').set(H).send({ phone: '' });
    expect(cleared.body.profile.phone).toBeNull();
  });

  it('rejects protected fields: role, Employee ID, department, designation, email', async () => {
    const e = await employee();
    for (const body of [
      { role: 'CREATOR' },
      { employeeCode: 'HACK-1' },
      { department: 'Finance' },
      { designation: 'CEO' },
      { email: `x-${randomUUID().slice(0, 6)}@${domain}` },
      { phone: 'call me maybe' },
    ]) {
      const r = await e.agent.patch('/api/auth/profile').set(H).send(body);
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
    const u = await prisma.user.findUniqueOrThrow({ where: { id: e.user.id } });
    expect(u.roleCode).toBe('EMPLOYEE');
    expect(u.employeeCode).toBe(e.user.employeeCode);
  });

  it('changes the company email only after the new address is verified', async () => {
    const e = await employee();
    const next = `moved-${randomUUID().slice(0, 8)}@${domain}`;
    expect(
      (await e.agent.post('/api/auth/profile/email-change').set(H).send({ email: next, password: 'wrong-pass-1' })).status,
    ).toBe(400);
    expect(
      (await e.agent.post('/api/auth/profile/email-change').set(H).send({ email: 'me@gmail.com', password: PASSWORD })).status,
    ).toBe(400);

    const req = await e.agent.post('/api/auth/profile/email-change').set(H).send({ email: next, password: PASSWORD });
    expect(req.status).toBe(202);
    expect(req.body.pendingEmail).toBe(next);
    // Still the old address until confirmed.
    expect((await prisma.user.findUniqueOrThrow({ where: { id: e.user.id } })).email).toBe(e.email);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].to).toBe(next);
    const token = outbox[0].text.match(/\/confirm-email#([A-Za-z0-9_-]+)/)?.[1];
    expect(token).toBeTruthy();

    expect((await request(app).post('/api/auth/confirm-email').set(H).send({ token: 'x'.repeat(43) })).status).toBe(400);
    const done = await request(app).post('/api/auth/confirm-email').set(H).send({ token });
    expect(done.status).toBe(200);
    expect(done.body.email).toBe(next);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: e.user.id } });
    expect(u.email).toBe(next);
    expect(u.pendingEmail).toBeNull();
    // The link is single-use.
    expect((await request(app).post('/api/auth/confirm-email').set(H).send({ token })).status).toBe(400);
  });

  it('keeps notification preferences with appearance settings', async () => {
    const e = await employee();
    const cur = (await e.agent.get('/api/auth/preferences')).body;
    expect(cur.preferences?.notifications ?? cur.notifications).toBeTruthy();
  });
});

describe('Creator profile management', () => {
  it('edits permitted employee details and sees the authorised profile photo', async () => {
    const creator = await loginAs(CREATOR);
    const e = await employee('managed');
    const r = await creator
      .patch(`/api/creator/users/${e.user.id}`)
      .set(H)
      .send({ department: 'Engineering', designation: 'Senior Developer', phone: '+1 555 0100' });
    expect(r.status).toBe(200);
    // Creators still cannot change role or email here.
    expect((await creator.patch(`/api/creator/users/${e.user.id}`).set(H).send({ role: 'CREATOR' })).status).toBe(400);
    expect((await creator.patch(`/api/creator/users/${e.user.id}`).set(H).send({ email: 'a@b.com' })).status).toBe(400);

    // The employee uploads their own photo (self consent) and makes it their profile photo.
    const up = await e.agent
      .post(`/api/people/${e.user.id}/photos`)
      .set(H)
      .attach('photo', await jpeg(320, 320), 'me.jpg');
    expect(up.status).toBe(201);
    const photoId = up.body.id ?? up.body.photo?.id;
    expect(photoId).toBeTruthy();
    const prim = await e.agent.patch(`/api/people/photos/${photoId}`).set(H).send({ isPrimary: true });
    expect(prim.status).toBe(200);

    const mine = (await e.agent.get('/api/auth/profile')).body;
    expect(mine).toMatchObject({ department: 'Engineering', designation: 'Senior Developer' });
    expect(mine.photo?.id).toBe(photoId);

    const view = await creator.get(`/api/creator/users/${e.user.id}/profile`);
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({ department: 'Engineering', designation: 'Senior Developer', phone: '+1 555 0100' });
    expect(view.body.photo?.id).toBe(photoId);
    expect((await creator.get(view.body.photo.url)).status).toBe(200);

    // Another employee cannot read someone else's private (unshared) profile photo.
    const other = await employee('other');
    expect((await other.agent.get(view.body.photo.url)).status).toBe(404);
  });
});
