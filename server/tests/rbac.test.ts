import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';
import {
  app,
  prisma,
  H,
  CREATOR,
  EMPLOYEE,
  loginAs,
  newEmployee,
  png,
  pngCutout,
  svg,
  uploadAvatar,
} from './helpers.js';

afterAll(() => prisma.$disconnect());

/** Every Creator-only endpoint. */
const CREATOR_ROUTES: [method: 'get' | 'post' | 'patch' | 'delete', path: string][] = [
  ['get', '/api/creator/users'],
  ['post', '/api/creator/users/invite'],
  ['post', '/api/creator/users/some-id/reinvite'],
  ['patch', '/api/creator/users/some-id'],
  ['get', '/api/creator/library/categories'],
  ['post', '/api/creator/library/categories'],
  ['patch', '/api/creator/library/categories/some-id'],
  ['get', '/api/creator/library/avatar-types'],
  ['patch', '/api/creator/library/avatar-types/FACE'],
  ['get', '/api/creator/library/avatars'],
  ['post', '/api/creator/library/avatars'],
  ['patch', '/api/creator/library/avatars/some-id'],
  ['get', '/api/creator/library/avatars/some-id'],
  ['delete', '/api/creator/library/avatars/some-id'],
  ['post', '/api/creator/library/avatars/cleanup'],
  ['get', '/api/creator/templates'],
  ['post', '/api/creator/templates'],
  ['patch', '/api/creator/templates/some-id'],
  ['get', '/api/creator/analytics'],
  ['get', '/api/creator/audit'],
];

describe('unauthenticated access', () => {
  it.each([
    ...CREATOR_ROUTES,
    ['get', '/api/catalog/avatars'],
    ['get', '/api/creations'],
    ['post', '/api/creations'],
  ] as const)('%s %s → 401', async (method, path) => {
    const res = await request(app)[method](path).set(H).send({});
    expect(res.status).toBe(401);
  });
});

describe('Employee is blocked from every Creator API', () => {
  let employee: TestAgent;
  beforeAll(async () => {
    employee = await loginAs(EMPLOYEE);
  });

  it.each(CREATOR_ROUTES)('%s %s → 403', async (method, path) => {
    const res = await employee[method](path).set(H).send({ name: 'x', isActive: true });
    expect(res.status).toBe(403);
  });

  it('cannot upload a global avatar asset even with a valid file', async () => {
    const cat = await prisma.avatarCategory.findFirstOrThrow();
    const res = await employee
      .post('/api/creator/library/avatars')
      .set(H)
      .field('name', 'Sneaky')
      .field('categoryId', cat.id)
      .field('type', 'FACE')
      .attach('file', await png(), 'a.png');
    expect(res.status).toBe(403);
    expect(await prisma.avatar.count({ where: { name: 'Sneaky' } })).toBe(0);
  });

  it('records denied attempts in the audit log', async () => {
    const before = await prisma.auditLog.count({ where: { action: 'ACCESS_DENIED' } });
    await employee.get('/api/creator/analytics');
    expect(await prisma.auditLog.count({ where: { action: 'ACCESS_DENIED' } })).toBe(before + 1);
  });

  it('can use the shared Studio APIs', async () => {
    expect((await employee.get('/api/catalog/avatars')).status).toBe(200);
    expect((await employee.get('/api/catalog/templates')).status).toBe(200);
    expect((await employee.get('/api/creations')).status).toBe(200);
  });
});

describe('role assignment rules', () => {
  it('invite rejects any attempt to pass a role', async () => {
    const creator = await loginAs(CREATOR);
    const res = await creator
      .post('/api/creator/users/invite')
      .set(H)
      .send({ email: 'boss@test.local', name: 'Boss', role: 'CREATOR' });
    expect(res.status).toBe(400);
    expect(await prisma.user.findUnique({ where: { email: 'boss@test.local' } })).toBeNull();
  });

  it('user updates reject a role field', async () => {
    const creator = await loginAs(CREATOR);
    const e = await newEmployee('promote');
    const res = await creator
      .patch(`/api/creator/users/${e.user.id}`)
      .set(H)
      .send({ role: 'CREATOR' });
    expect(res.status).toBe(400);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: e.user.id } });
    expect(after.roleCode).toBe('EMPLOYEE');
  });

  it('a Creator cannot deactivate or modify another Creator (including themselves)', async () => {
    const creator = await loginAs(CREATOR);
    const me = await prisma.user.findUniqueOrThrow({ where: { email: CREATOR.email } });
    const res = await creator.patch(`/api/creator/users/${me.id}`).set(H).send({ isActive: false });
    expect(res.status).toBe(403);
  });

  it('there is no self-service endpoint that changes a role', async () => {
    const e = await newEmployee('self');
    for (const [m, p] of [
      ['patch', '/api/auth/me'],
      ['post', '/api/auth/me'],
      ['patch', `/api/users/${e.user.id}`],
    ] as const) {
      const res = await e.agent[m](p).set(H).send({ role: 'CREATOR' });
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
    expect((await prisma.user.findUniqueOrThrow({ where: { id: e.user.id } })).roleCode).toBe(
      'EMPLOYEE',
    );
  });
});

describe('deactivation', () => {
  it('immediately revokes the employee’s existing session and blocks login', async () => {
    const creator = await loginAs(CREATOR);
    const e = await newEmployee('deact');
    expect((await e.agent.get('/api/auth/me')).status).toBe(200);

    const res = await creator
      .patch(`/api/creator/users/${e.user.id}`)
      .set(H)
      .send({ isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);

    expect((await e.agent.get('/api/auth/me')).status).toBe(401);
    const login = await request(app)
      .post('/api/auth/login')
      .set(H)
      .send({ email: e.email, password: e.password });
    expect(login.status).toBe(401);

    await creator.patch(`/api/creator/users/${e.user.id}`).set(H).send({ isActive: true });
    const again = await request(app)
      .post('/api/auth/login')
      .set(H)
      .send({ email: e.email, password: e.password });
    expect(again.status).toBe(200);
  });
});

describe('Creator library management', () => {
  let creator: TestAgent;
  beforeAll(async () => {
    creator = await loginAs(CREATOR);
  });

  it('creates, renames and deactivates a category', async () => {
    const c = await creator
      .post('/api/creator/library/categories')
      .set(H)
      .send({ name: 'Festive', sortOrder: 9 });
    expect(c.status).toBe(201);
    expect(c.body.slug).toBe('festive');
    const dup = await creator
      .post('/api/creator/library/categories')
      .set(H)
      .send({ name: 'Festive' });
    expect(dup.status).toBe(409);
    const u = await creator
      .patch(`/api/creator/library/categories/${c.body.id}`)
      .set(H)
      .send({ name: 'Festive Season', isActive: false });
    expect(u.body.slug).toBe('festive-season');
    expect(u.body.isActive).toBe(false);
  });

  it('relabels an avatar type but cannot invent a new one', async () => {
    const ok = await creator
      .patch('/api/creator/library/avatar-types/HALF_BODY')
      .set(H)
      .send({ name: 'Half Body (waist up)' });
    expect(ok.status).toBe(200);
    const bad = await creator
      .patch('/api/creator/library/avatar-types/MANAGER')
      .set(H)
      .send({ name: 'x' });
    expect(bad.status).toBe(400);
  });

  it('uploads an avatar that stays hidden from employees until activated', async () => {
    const cat = await prisma.avatarCategory.findUniqueOrThrow({ where: { slug: 'business' } });
    const up = await uploadAvatar(
      creator,
      { name: 'Teal Exec', categoryId: cat.id, type: 'HALF_BODY' },
      await pngCutout(120, 160),
    );
    expect(up.status).toBe(201);
    expect(up.body.isActive).toBe(false);
    expect(up.body.width).toBe(120);

    const employee = await loginAs(EMPLOYEE);
    const names = async () =>
      (await employee.get('/api/catalog/avatars')).body.map((a: { name: string }) => a.name);
    expect(await names()).not.toContain('Teal Exec');
    // Private storage: no anonymous access; employees can't fetch hidden assets; creators can.
    expect((await request(app).get(up.body.fileUrl)).status).toBe(401);
    expect((await employee.get(up.body.fileUrl)).status).toBe(404);
    expect((await creator.get(up.body.fileUrl)).status).toBe(200);

    await creator
      .patch(`/api/creator/library/avatars/${up.body.id}`)
      .set(H)
      .send({ isActive: true });
    expect(await names()).toContain('Teal Exec');

    expect((await employee.get(up.body.fileUrl)).status).toBe(200);
  });

  it('rejects SVG and non-image uploads', async () => {
    const cat = await prisma.avatarCategory.findFirstOrThrow();
    for (const [buf, name] of [
      [svg, 'x.svg'],
      [Buffer.from('not an image at all'), 'x.png'],
    ] as const) {
      const res = await uploadAvatar(
        creator,
        { name: 'Bad', categoryId: cat.id, type: 'FACE' },
        buf,
        name,
      );
      expect(res.status).toBe(400);
    }
  });

  it('hides avatars whose category is deactivated', async () => {
    const employee = await loginAs(EMPLOYEE);
    const anime = await prisma.avatarCategory.findUniqueOrThrow({ where: { slug: 'anime' } });
    await creator
      .patch(`/api/creator/library/categories/${anime.id}`)
      .set(H)
      .send({ isActive: false });
    const list = (await employee.get('/api/catalog/avatars')).body;
    expect(list.some((a: { category: { slug: string } }) => a.category.slug === 'anime')).toBe(
      false,
    );
    await creator
      .patch(`/api/creator/library/categories/${anime.id}`)
      .set(H)
      .send({ isActive: true });
  });

  it('manages corporate templates', async () => {
    const t = await creator
      .post('/api/creator/templates')
      .set(H)
      .field('name', 'SageIT Frame')
      .field('layout', JSON.stringify({ photoArea: { x: 0.05, y: 0.05, w: 0.9, h: 0.8 } }))
      .attach('file', await png(400, 300), 'frame.png');
    expect(t.status).toBe(201);
    expect(t.body.isActive).toBe(false);
    const on = await creator
      .patch(`/api/creator/templates/${t.body.id}`)
      .set(H)
      .send({ isActive: true });
    expect(on.body.isActive).toBe(true);
    const employee = await loginAs(EMPLOYEE);
    const list = (await employee.get('/api/catalog/templates')).body;
    expect(list.map((x: { name: string }) => x.name)).toContain('SageIT Frame');
  });

  it('views analytics and the audit trail', async () => {
    const a = await creator.get('/api/creator/analytics');
    expect(a.status).toBe(200);
    expect(a.body.users.employees).toBeGreaterThan(0);
    expect(Object.keys(a.body.creations.perDay)).toHaveLength(14);

    const log = await creator.get('/api/creator/audit?action=AVATAR_CREATED');
    expect(log.status).toBe(200);
    expect(log.body.items.length).toBeGreaterThan(0);
    expect(log.body.items[0].actor.email).toBe(CREATOR.email);
  });
});
