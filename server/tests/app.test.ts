import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { loadConfig } from '../src/config.js';
import { app, prisma, loginAs, EMPLOYEE } from './helpers.js';

afterAll(() => prisma.$disconnect());

describe('config', () => {
  it('rejects a short JWT secret', () => {
    expect(() =>
      loadConfig({ DATABASE_URL: 'file:./x.db', JWT_SECRET: 'short' } as NodeJS.ProcessEnv),
    ).toThrow(/JWT_SECRET/);
  });

  it('reports email as not configured when SMTP fields are blank', () => {
    const c = loadConfig({
      DATABASE_URL: 'file:./x.db',
      JWT_SECRET: 'x'.repeat(40),
    } as NodeJS.ProcessEnv);
    expect(c.emailConfigured).toBe(false);
  });
});

describe('GET /api/health', () => {
  it('reports database ok without authentication', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.database).toBe('ok');
  });
});

describe('database reference data', () => {
  it('contains exactly the two roles', async () => {
    const roles = await prisma.role.findMany({ orderBy: { code: 'asc' } });
    expect(roles.map((r) => r.code)).toEqual(['CREATOR', 'EMPLOYEE']);
  });

  it('contains the four avatar types', async () => {
    expect(await prisma.avatarType.count()).toBe(4);
  });

  it('stores passwords as bcrypt hashes, never plain text', async () => {
    const u = await prisma.user.findUniqueOrThrow({ where: { email: EMPLOYEE.email } });
    expect(u.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    expect(u.passwordHash).not.toContain(EMPLOYEE.password);
  });
});

describe('catalog (signed in)', () => {
  it('lists the four seeded categories in order', async () => {
    const agent = await loginAs(EMPLOYEE);
    const res = await agent.get('/api/catalog/categories');
    expect(res.status).toBe(200);
    expect(res.body.map((c: { slug: string }) => c.slug)).toEqual([
      'anime',
      'superhero',
      'business',
      'corporate',
    ]);
  });

  it('ships the 44-item original starter collection, all with licence records', async () => {
    const starter = await prisma.avatar.findMany({
      where: { sourceName: 'SageAvatar Studio starter collection' },
    });
    expect(starter).toHaveLength(44);
    for (const a of starter) {
      expect(a.sourceType).toBe('ORIGINAL');
      expect(a.licenseName).not.toBe('');
      expect(a.rightsConfirmedAt).not.toBeNull();
      expect(a.description).not.toBe('');
      expect(a.fileKey.startsWith('library/avatars/')).toBe(true);
    }
    // 12 characters x 3 crops + 2 backgrounds per category.
    expect(starter.filter((a) => a.typeCode === 'BACKGROUND')).toHaveLength(8);
    expect(new Set(starter.map((a) => a.style))).toEqual(
      new Set(['PROFESSIONAL', 'CASUAL', 'THEMED']),
    );
  });

  it('lists active avatars covering all four types', async () => {
    const agent = await loginAs(EMPLOYEE);
    const res = await agent.get('/api/catalog/avatars');
    expect(res.status).toBe(200);
    const seeded = res.body;
    expect(seeded.length).toBeGreaterThanOrEqual(44);
    expect(seeded[0].fileUrl.startsWith('/api/assets/avatars/')).toBe(true);
    expect(seeded[0]).not.toHaveProperty('fileKey');
    expect(new Set(seeded.map((a: { type: string }) => a.type))).toEqual(
      new Set(['FACE', 'HALF_BODY', 'FULL_BODY', 'BACKGROUND']),
    );
  });

  it('filters by category and type', async () => {
    const agent = await loginAs(EMPLOYEE);
    const res = await agent.get('/api/catalog/avatars?category=superhero&type=FULL_BODY');
    expect(res.body.map((a: { name: string }) => a.name).sort()).toEqual([
      'Arc Sentinel · Full Body',
      'Captain Nova · Full Body',
      'Night Lynx · Full Body',
    ]);
    for (const a of res.body) expect(a.defaultPlacement.layer).toBe('behind');
  });

  it('searches names, descriptions and tags', async () => {
    const agent = await loginAs(EMPLOYEE);
    const byTag = await agent.get('/api/catalog/avatars?q=lanyard');
    expect(byTag.body.length).toBeGreaterThan(0);
    for (const a of byTag.body) expect(a.name.startsWith('Alex')).toBe(true);
    const none = await agent.get('/api/catalog/avatars?q=zzzz-nothing');
    expect(none.body).toHaveLength(0);
  });

  it('rejects an unknown avatar type', async () => {
    const agent = await loginAs(EMPLOYEE);
    expect((await agent.get('/api/catalog/avatars?type=MANAGER')).status).toBe(400);
  });

  it('serves library assets from private storage to signed-in users only', async () => {
    const a = await prisma.avatar.findFirstOrThrow({
      where: { fileKey: 'library/avatars/hana-face.svg' },
    });
    const url = '/api/assets/avatars/' + a.id + '/file';
    expect((await request(app).get(url)).status).toBe(401);
    const agent = await loginAs(EMPLOYEE);
    const res = await agent.get(url);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/svg/);
    expect(res.headers['cache-control']).toMatch(/private/);
    // SVGs are sandboxed: no script can run.
    expect(res.headers['content-security-policy']).toMatch(/sandbox/);
    // No public static route for stored files.
    expect((await request(app).get('/media/avatars/hana-face.svg')).status).toBe(404);
  });

  it('returns JSON 404 for unknown API routes', async () => {
    expect((await request(app).get('/api/nope')).status).toBe(404);
  });
});
