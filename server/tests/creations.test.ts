import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';
import { app, config, prisma, H, CREATOR, loginAs, newEmployee, png, jpeg } from './helpers.js';

afterAll(() => prisma.$disconnect());

async function createPhoto(agent: TestAgent, title = 'Team day') {
  const avatar = await prisma.avatar.findFirstOrThrow({ where: { isActive: true } });
  return agent
    .post('/api/creations')
    .set(H)
    .field('title', title)
    .field('source', 'CAMERA')
    .field('avatarId', avatar.id)
    .field(
      'layout',
      JSON.stringify({
        layers: [{ avatarId: avatar.id, x: 0.7, y: 0.5, scale: 0.9, rotation: 0 }],
      }),
    )
    .attach('photo', await jpeg(320, 240), 'photo.jpg')
    .attach('result', await png(320, 240), 'result.png');
}

describe('personal photo history', () => {
  it('stores a creation with metadata in private storage', async () => {
    const a = await newEmployee('alice');
    const res = await createPhoto(a.agent);
    expect(res.status).toBe(201);
    expect(res.body.metadata).toMatchObject({ source: 'CAMERA', width: 320, height: 240 });

    const row = await prisma.photoCreation.findUniqueOrThrow({
      where: { id: res.body.id },
      include: { metadata: true },
    });
    expect(row.metadata?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(row.sourcePath.startsWith(`creations/${a.user.id}/`)).toBe(true);
    expect(existsSync(path.join(config.privateStorage, row.resultPath))).toBe(true);
    // Response never exposes storage paths.
    expect(res.body).not.toHaveProperty('sourcePath');
    expect(res.body).not.toHaveProperty('resultPath');
  });

  it('lets the owner list, view, download, rename and delete', async () => {
    const a = await newEmployee('owner');
    const { body: c } = await createPhoto(a.agent, 'Mine');

    const list = await a.agent.get('/api/creations');
    expect(list.body.total).toBe(1);

    const img = await a.agent.get(`/api/creations/${c.id}/image/result`);
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.headers['cache-control']).toBe('private, no-store');

    const dl = await a.agent.get(`/api/creations/${c.id}/image/result?download=1`);
    // Meaningful name: SageVatar_Personal_<date>_<id6>.<ext>
    expect(dl.headers['content-disposition']).toMatch(
      /^attachment; filename="?SageVatar_Personal_([\w-]+_)?\d{4}-\d{2}-\d{2}_\d{2}-\d{2}_\w{6}\.png"?$/,
    );

    const ren = await a.agent.patch(`/api/creations/${c.id}`).set(H).send({ title: 'Renamed' });
    expect(ren.body.title).toBe('Renamed');

    const row = await prisma.photoCreation.findUniqueOrThrow({ where: { id: c.id } });
    expect((await a.agent.delete(`/api/creations/${c.id}`).set(H)).status).toBe(204);
    expect(await prisma.photoCreation.count({ where: { id: c.id } })).toBe(0);
    expect(existsSync(path.join(config.privateStorage, row.resultPath))).toBe(false);
  });

  it('hides one employee’s photos from another employee (404, not 403)', async () => {
    const a = await newEmployee('a');
    const b = await newEmployee('b');
    const { body: c } = await createPhoto(a.agent);

    expect((await b.agent.get('/api/creations')).body.total).toBe(0);
    expect((await b.agent.get(`/api/creations/${c.id}`)).status).toBe(404);
    expect((await b.agent.get(`/api/creations/${c.id}/image/result`)).status).toBe(404);
    expect((await b.agent.get(`/api/creations/${c.id}/image/source`)).status).toBe(404);
    expect((await b.agent.patch(`/api/creations/${c.id}`).set(H).send({ title: 'x' })).status).toBe(
      404,
    );
    expect((await b.agent.delete(`/api/creations/${c.id}`).set(H)).status).toBe(404);
    expect(await prisma.photoCreation.count({ where: { id: c.id } })).toBe(1);
  });

  it('Creators cannot see employees’ private photos either', async () => {
    const a = await newEmployee('private');
    const { body: c } = await createPhoto(a.agent);
    const creator = await loginAs(CREATOR);
    expect((await creator.get(`/api/creations/${c.id}/image/result`)).status).toBe(404);
    const mine = (await creator.get('/api/creations')).body.items.map((x: { id: string }) => x.id);
    expect(mine).not.toContain(c.id);
  });

  it('private files are not reachable through public /media', async () => {
    const a = await newEmployee('media');
    const { body: c } = await createPhoto(a.agent);
    const row = await prisma.photoCreation.findUniqueOrThrow({ where: { id: c.id } });
    for (const p of [
      `/media/${row.resultPath}`,
      `/media/../private/${row.resultPath}`,
      `/media/%2e%2e/private/${row.resultPath}`,
    ]) {
      // 404 (not found) or 403 (traversal rejected) — either way nothing is served.
      const res = await request(app).get(p);
      expect([403, 404]).toContain(res.status);
      expect(res.headers['content-type'] ?? '').not.toMatch(/^image\//);
    }
    expect((await request(app).get(`/api/creations/${c.id}/image/result`)).status).toBe(401);
  });

  it('email endpoint validates input and ownership (delivery is covered in sharing.test.ts)', async () => {
    const a = await newEmployee('mail-a');
    const b = await newEmployee('mail-b');
    const { body: c } = await createPhoto(a.agent);
    const bad = await a.agent
      .post(`/api/creations/${c.id}/email`)
      .set(H)
      .send({ to: 'nope', subject: 'Hi' });
    expect(bad.status).toBe(400);
    const noSubject = await a.agent
      .post(`/api/creations/${c.id}/email`)
      .set(H)
      .send({ to: 'x@y.io' });
    expect(noSubject.status).toBe(400);
    const other = await b.agent
      .post(`/api/creations/${c.id}/email`)
      .set(H)
      .send({ to: 'x@y.io', subject: 'Hi' });
    expect(other.status).toBe(404);
  });

  it('validates uploads', async () => {
    const a = await newEmployee('val');
    const noFiles = await a.agent
      .post('/api/creations')
      .set(H)
      .field('source', 'UPLOAD')
      .field('layout', '{}');
    expect(noFiles.status).toBe(400);

    const badLayout = await a.agent
      .post('/api/creations')
      .set(H)
      .field('source', 'UPLOAD')
      .field('layout', '{not json')
      .attach('photo', await jpeg(), 'p.jpg')
      .attach('result', await png(), 'r.png');
    expect(badLayout.status).toBe(400);

    const fake = await a.agent
      .post('/api/creations')
      .set(H)
      .field('source', 'UPLOAD')
      .field('layout', '{}')
      .attach('photo', Buffer.from('MZ fake exe'), 'p.jpg')
      .attach('result', await png(), 'r.png');
    expect(fake.status).toBe(400);
  });
});
