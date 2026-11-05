import { existsSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import type TestAgent from 'supertest/lib/agent.js';
import sharp from 'sharp';
import { libraryDir, resolveKey } from '../src/lib/library-storage.js';
import {
  app,
  config,
  prisma,
  H,
  CREATOR,
  EMPLOYEE,
  loginAs,
  newEmployee,
  png,
  pngCutout,
  uploadAvatar,
} from './helpers.js';
import request from 'supertest';

afterAll(() => prisma.$disconnect());

let creator: TestAgent;
let categoryId: string;
beforeAll(async () => {
  creator = await loginAs(CREATOR);
  categoryId = (await prisma.avatarCategory.findUniqueOrThrow({ where: { slug: 'corporate' } })).id;
});

const jpeg = () =>
  sharp({ create: { width: 640, height: 360, channels: 3, background: '#1d4ed8' } })
    .jpeg()
    .toBuffer();

describe('upload validation', () => {
  it('requires a transparent background for character avatars', async () => {
    const opaque = await uploadAvatar(
      creator,
      { name: 'Opaque', categoryId, type: 'FULL_BODY' },
      await png(100, 200),
    );
    expect(opaque.status).toBe(400);
    expect(opaque.body.error).toMatch(/transparent/i);
    const jpg = await uploadAvatar(
      creator,
      { name: 'Jpeg face', categoryId, type: 'FACE' },
      await jpeg(),
      'f.jpg',
    );
    expect(jpg.status).toBe(400);
  });

  it('accepts transparent PNG/WebP cut-outs and JPEG backgrounds', async () => {
    const webp = await sharp(await pngCutout(200, 300))
      .webp({ lossless: true })
      .toBuffer();
    const a = await uploadAvatar(
      creator,
      { name: 'Webp cut-out', categoryId, type: 'HALF_BODY' },
      webp,
      'a.webp',
    );
    expect(a.status).toBe(201);
    expect(a.body.mimeType).toBe('image/webp');
    const bg = await uploadAvatar(
      creator,
      { name: 'Lobby photo', categoryId, type: 'BACKGROUND' },
      await jpeg(),
      'bg.jpg',
    );
    expect(bg.status).toBe(201);
    expect(bg.body.mimeType).toBe('image/jpeg');
  });

  it('records name, description, tags, style and full licence details', async () => {
    const res = await uploadAvatar(
      creator,
      {
        name: 'Office Owl',
        description: 'Friendly owl mascot in a cardigan',
        tags: 'Owl, Mascot, owl ,cardigan',
        style: 'CASUAL',
        categoryId,
        type: 'FULL_BODY',
        sourceType: 'LICENSED',
        sourceName: 'Studio Pixel Ltd',
        sourceUrl: 'https://example.com/owl',
        licenseName: 'Commercial use licence',
        licenseUrl: 'https://example.com/licence',
        licenseNotes: 'PO-4411',
        attribution: 'Owl by Studio Pixel',
        licenseExpiresAt: '2099-01-01',
      },
      await pngCutout(),
    );
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: 'Office Owl',
      tags: ['owl', 'mascot', 'cardigan'],
      style: 'CASUAL',
      sourceType: 'LICENSED',
      sourceName: 'Studio Pixel Ltd',
      licenseName: 'Commercial use licence',
      attribution: 'Owl by Studio Pixel',
      usageCount: 0,
      isActive: false,
    });
    expect(res.body.rightsConfirmedBy.name).toBe('Studio Creator');
    expect(res.body).not.toHaveProperty('fileKey');
    const row = await prisma.avatar.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.fileKey.startsWith('library/avatars/')).toBe(true);
    expect(existsSync(resolveKey(config, row.fileKey))).toBe(true);
    expect(existsSync(path.join(config.publicStorage, 'avatars'))).toBe(false);
  });

  it('requires rights confirmation and licence information', async () => {
    const cut = await pngCutout();
    const noRights = await uploadAvatar(
      creator,
      { name: 'No rights', categoryId, type: 'FACE', rightsConfirmed: 'false' },
      cut,
    );
    expect(noRights.status).toBe(400);
    const noLicence = await uploadAvatar(
      creator,
      { name: 'No licence', categoryId, type: 'FACE', licenseName: '' },
      cut,
    );
    expect(noLicence.status).toBe(400);
    const licensedNoRef = await uploadAvatar(
      creator,
      { name: 'Vague licence', categoryId, type: 'FACE', sourceType: 'LICENSED', licenseNotes: '' },
      cut,
    );
    expect(licensedNoRef.status).toBe(400);
    const expired = await uploadAvatar(
      creator,
      { name: 'Old licence', categoryId, type: 'FACE', licenseExpiresAt: '2001-01-01' },
      cut,
    );
    expect(expired.status).toBe(400);
  });

  it('blocks well-known franchise characters unless recorded as licensed', async () => {
    const cut = await pngCutout();
    for (const name of ['Spider-Man pose', 'Batman cowl', 'Iron Man suit']) {
      const res = await uploadAvatar(
        creator,
        { name, categoryId, type: 'FACE', sourceType: 'ORIGINAL' },
        cut,
      );
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/licen[cs]e/i);
    }
    const tagged = await uploadAvatar(
      creator,
      { name: 'Red hero', tags: 'spiderman', categoryId, type: 'FACE' },
      cut,
    );
    expect(tagged.status).toBe(400);
  });
});

describe('editing and activation', () => {
  it('edits details and licensing, and audits the change', async () => {
    const up = await uploadAvatar(
      creator,
      { name: 'Draft', categoryId, type: 'FACE' },
      await pngCutout(),
    );
    const res = await creator
      .patch(`/api/creator/library/avatars/${up.body.id}`)
      .set(H)
      .send({
        name: 'Final',
        description: 'Updated',
        tags: ['Hello', 'World'],
        style: 'PROFESSIONAL',
        attribution: 'By SageIT',
      });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: 'Final',
      tags: ['hello', 'world'],
      style: 'PROFESSIONAL',
      attribution: 'By SageIT',
    });
    expect(
      await prisma.auditLog.count({ where: { action: 'AVATAR_UPDATED', entityId: up.body.id } }),
    ).toBe(1);
  });

  it('refuses to activate an avatar whose licence has expired', async () => {
    const up = await uploadAvatar(
      creator,
      { name: 'Expiring', categoryId, type: 'FACE', licenseExpiresAt: '2099-01-01' },
      await pngCutout(),
    );
    await prisma.avatar.update({
      where: { id: up.body.id },
      data: { licenseExpiresAt: new Date('2001-01-01') },
    });
    const res = await creator
      .patch(`/api/creator/library/avatars/${up.body.id}`)
      .set(H)
      .send({ isActive: true });
    expect(res.status).toBe(409);
  });

  it('won’t turn an opaque background into a character avatar', async () => {
    const bg = await uploadAvatar(
      creator,
      { name: 'Bg only', categoryId, type: 'BACKGROUND' },
      await jpeg(),
      'b.jpg',
    );
    const res = await creator
      .patch(`/api/creator/library/avatars/${bg.body.id}`)
      .set(H)
      .send({ type: 'FACE' });
    expect(res.status).toBe(400);
  });
});

describe('safe removal', () => {
  it('only removes inactive, unused avatars — and deletes their files', async () => {
    const up = await uploadAvatar(
      creator,
      { name: 'Removable', categoryId, type: 'FACE', isActive: 'true' },
      await pngCutout(),
    );
    const row = await prisma.avatar.findUniqueOrThrow({ where: { id: up.body.id } });

    const whileActive = await creator.delete(`/api/creator/library/avatars/${row.id}`).set(H);
    expect(whileActive.status).toBe(409);

    await creator.patch(`/api/creator/library/avatars/${row.id}`).set(H).send({ isActive: false });
    const ok = await creator.delete(`/api/creator/library/avatars/${row.id}`).set(H);
    expect(ok.status).toBe(204);
    expect(await prisma.avatar.count({ where: { id: row.id } })).toBe(0);
    expect(existsSync(resolveKey(config, row.fileKey))).toBe(false);
    expect(
      await prisma.auditLog.count({ where: { action: 'AVATAR_DELETED', entityId: row.id } }),
    ).toBe(1);
  });

  it('keeps avatars that saved creations use', async () => {
    const up = await uploadAvatar(
      creator,
      { name: 'In use', categoryId, type: 'FACE', isActive: 'true' },
      await pngCutout(),
    );
    const e = await newEmployee('lib-user');
    const made = await e.agent
      .post('/api/creations')
      .set(H)
      .field('source', 'UPLOAD')
      .field('avatarId', up.body.id)
      .field('layout', '{}')
      .attach(
        'photo',
        await sharp({ create: { width: 300, height: 300, channels: 3, background: '#888' } })
          .jpeg()
          .toBuffer(),
        'p.jpg',
      )
      .attach('result', await png(300, 300), 'r.png');
    expect(made.status).toBe(201);
    await creator
      .patch(`/api/creator/library/avatars/${up.body.id}`)
      .set(H)
      .send({ isActive: false });
    const res = await creator.delete(`/api/creator/library/avatars/${up.body.id}`).set(H);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/used in 1/);
  });

  it('cleans up orphaned files without touching referenced ones', async () => {
    const dir = libraryDir(config, 'avatars');
    const orphan = path.join(dir, 'orphan-test.png');
    writeFileSync(orphan, await png());
    const old = new Date(Date.now() - 2 * 3600 * 1000);
    utimesSync(orphan, old, old);
    const res = await creator.post('/api/creator/library/avatars/cleanup').set(H);
    expect(res.status).toBe(200);
    expect(res.body.removed).toBeGreaterThanOrEqual(1);
    expect(existsSync(orphan)).toBe(false);
    expect(existsSync(path.join(dir, 'hana-face.svg'))).toBe(true);
  });
});

describe('employee access', () => {
  it('cannot see hidden avatars or any licence internals', async () => {
    const employee = await loginAs(EMPLOYEE);
    const list = (await employee.get('/api/catalog/avatars')).body as Record<string, unknown>[];
    expect(
      list.every((a) => !('licenseNotes' in a) && !('fileKey' in a) && !('rightsConfirmedBy' in a)),
    ).toBe(true);
    const hidden = await prisma.avatar.findFirstOrThrow({ where: { isActive: false } });
    expect((await employee.get(`/api/assets/avatars/${hidden.id}/file`)).status).toBe(404);
    expect((await request(app).get(`/api/assets/avatars/${hidden.id}/file`)).status).toBe(401);
  });
});
