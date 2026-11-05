import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { inflateRawSync } from 'node:zlib';
import { SMTPServer } from 'smtp-server';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';
import { createMailer } from '../src/lib/mailer.js';
import { config, prisma, H, CREATOR, jpeg, png, newEmployee } from './helpers.js';

/**
 * Photo output & sharing, end to end:
 *  - email goes over real SMTP to a local capture server; the attachment is decoded and compared
 *    byte-for-byte with the downloadable photo;
 *  - downloads are real images in the requested format;
 *  - ZIP exports are unpacked and checked.
 */

// ---- local SMTP server ---------------------------------------------------------
const received: { rcpt: string[]; raw: string }[] = [];
let smtp: SMTPServer;
let smtpPort = 0;

beforeAll(async () => {
  smtp = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS', 'AUTH'],
    logger: false,
    onRcptTo(addr, _s, cb) {
      if (addr.address.startsWith('blocked@')) {
        const err = Object.assign(new Error('Mailbox unavailable'), { responseCode: 550 });
        return cb(err);
      }
      cb();
    },
    onData(stream, session, cb) {
      let raw = '';
      stream.on('data', (c: Buffer) => (raw += c.toString('utf8')));
      stream.on('end', () => {
        received.push({ rcpt: session.envelope.rcptTo.map((r) => r.address), raw });
        cb();
      });
    },
  });
  await new Promise<void>((r) => smtp.listen(0, '127.0.0.1', r));
  smtpPort = (smtp.server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((r) => smtp.close(() => r()));
  await prisma.$disconnect();
});

const smtpApp = () => {
  const c = {
    ...config,
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: smtpPort,
    SMTP_SECURE: false,
    SMTP_USER: '',
    emailConfigured: true,
  };
  return createApp(prisma, c, createMailer(c));
};

async function signIn(
  app: ReturnType<typeof createApp>,
  creds: { email: string; password: string },
) {
  const agent = request.agent(app);
  expect((await agent.post('/api/auth/login').set(H).send(creds)).status).toBe(200);
  return agent;
}

async function createCreation(
  agent: ReturnType<typeof request.agent>,
  extra: Record<string, string> = {},
  source = 'CAMERA',
) {
  let r = agent
    .post('/api/creations')
    .set(H)
    .field('source', source)
    .field('layout', JSON.stringify({ version: 1 }));
  for (const [k, v] of Object.entries(extra)) r = r.field(k, v);
  const res = await r
    .attach('photo', await jpeg(320, 240), { filename: 'o.jpg', contentType: 'image/jpeg' })
    .attach('result', await png(320, 240), { filename: 'r.png', contentType: 'image/png' });
  expect(res.status).toBe(201);
  return res.body as { id: string };
}

/** Pulls the base64 attachment out of a raw MIME message. */
function attachmentOf(raw: string) {
  const m = raw.match(
    /Content-Disposition: attachment;[\s\S]*?\r?\n\r?\n([A-Za-z0-9+/=\r\n]+?)\r?\n--/,
  );
  if (!m) throw new Error('no attachment in message');
  return Buffer.from(m[1].replace(/\s+/g, ''), 'base64');
}

describe('email sharing over real SMTP', () => {
  it('delivers the actual final photo as an attachment and records the provider acceptance', async () => {
    const app = smtpApp();
    const emp = await newEmployee('share');
    const agent = await signIn(app, emp);
    const c = await createCreation(agent);

    received.length = 0;
    const r = await agent
      .post(`/api/creations/${c.id}/email`)
      .set(H)
      .send({ to: 'friend@example.com', subject: 'Our team photo', message: 'Here it is!' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      status: 'SENT',
      delivery: 'smtp',
      acceptedBy: ['friend@example.com'],
    });
    expect(r.body.messageId).toMatch(/@/);

    expect(received).toHaveLength(1);
    expect(received[0].rcpt).toEqual(['friend@example.com']);
    const raw = received[0].raw;
    expect(raw).toMatch(/^Subject: Our team photo/m);
    expect(raw).toMatch(/filename="?SageVatar_Personal_/);

    // The attachment IS the photo: identical to the JPG download of the same creation.
    const attached = attachmentOf(raw);
    const download = await agent
      .get(`/api/creations/${c.id}/image/result?download=1&format=jpg`)
      .buffer(true);
    expect(Buffer.compare(attached, download.body as Buffer)).toBe(0);
    expect((await sharp(attached).metadata()).format).toBe('jpeg');

    const log = await prisma.emailActivity.findFirstOrThrow({ where: { creationId: c.id } });
    expect(log).toMatchObject({
      status: 'SENT',
      delivery: 'smtp',
      recipient: 'friend@example.com',
    });
    expect(log.providerMessageId).toBe(r.body.messageId);
  });

  it('reports a recipient the mail server refuses, and logs the failure', async () => {
    const app = smtpApp();
    const agent = await signIn(app, await newEmployee('refused'));
    const c = await createCreation(agent);
    const r = await agent
      .post(`/api/creations/${c.id}/email`)
      .set(H)
      .send({ to: 'blocked@example.com', subject: 'Hi' });
    expect(r.status).toBe(422);
    expect(r.body.error).toMatch(/refused to deliver to blocked@example.com/);
    const log = await prisma.emailActivity.findFirstOrThrow({ where: { creationId: c.id } });
    expect(log.status).toBe('FAILED');
  });

  it('handles an unreachable mail server', async () => {
    const c0 = { ...config, SMTP_HOST: '127.0.0.1', SMTP_PORT: 1, emailConfigured: true };
    const app = createApp(prisma, c0, createMailer(c0));
    const agent = await signIn(app, await newEmployee('down'));
    const c = await createCreation(agent);
    const r = await agent
      .post(`/api/creations/${c.id}/email`)
      .set(H)
      .send({ to: 'x@example.com', subject: 'Hi' });
    expect(r.status).toBe(502);
    expect(r.body.error).toMatch(/Couldn’t reach the mail server/);
  });

  it('says "dev-outbox" (not delivered) when SMTP is not configured', async () => {
    const { agent } = await newEmployee('outbox');
    const c = await createCreation(agent);
    const r = await agent
      .post(`/api/creations/${c.id}/email`)
      .set(H)
      .send({ to: 'x@example.com', subject: 'Hi' });
    expect(r.status).toBe(200);
    expect(r.body.delivery).toBe('dev-outbox');
  });

  it('validates the recipient and requires a subject', async () => {
    const { agent } = await newEmployee('valid');
    const c = await createCreation(agent);
    for (const body of [
      { to: 'not-an-email', subject: 'x' },
      { to: 'a@b.co\r\nBcc: evil@x.io', subject: 'x' },
      { to: 'a@b.co', subject: '' },
      { to: 'a@b.co' },
    ]) {
      expect((await agent.post(`/api/creations/${c.id}/email`).set(H).send(body)).status).toBe(400);
    }
  });
});

describe('downloads', () => {
  it('serves the actual combined photo as JPG or PNG at full stored resolution', async () => {
    const { agent } = await newEmployee('dl');
    const c = await createCreation(agent);
    const asPng = await agent
      .get(`/api/creations/${c.id}/image/result?download=1&format=png`)
      .buffer(true);
    const asJpg = await agent
      .get(`/api/creations/${c.id}/image/result?download=1&format=jpg`)
      .buffer(true);
    expect(asPng.headers['content-type']).toBe('image/png');
    expect(asJpg.headers['content-type']).toBe('image/jpeg');
    expect(asPng.headers['content-disposition']).toMatch(/\.png"?$/);
    expect(asJpg.headers['content-disposition']).toMatch(/\.jpg"?$/);
    const [p, j] = await Promise.all([sharp(asPng.body).metadata(), sharp(asJpg.body).metadata()]);
    expect([p.format, p.width, p.height]).toEqual(['png', 320, 240]);
    expect([j.format, j.width, j.height]).toEqual(['jpeg', 320, 240]);
    expect((await agent.get(`/api/creations/${c.id}/image/result?format=gif`)).status).toBe(400);
  });
});

describe('My Creations search and filters', () => {
  it('returns avatar info and filters by search, source, avatar kind and date', async () => {
    const { agent, user } = await newEmployee('filters');
    const avatar = await prisma.avatar.findFirstOrThrow({
      where: { isActive: true, typeCode: 'FULL_BODY' },
    });
    const job = await prisma.aiGenerationJob.create({
      data: {
        userId: user.id,
        prompt: 'silver comet hero',
        style: 'SUPERHERO',
        typeCode: 'FACE',
        count: 1,
        provider: 'openai',
        model: 'gpt-image-1',
        status: 'SUCCEEDED',
      },
    });
    const gen = await prisma.generatedAvatar.create({
      data: {
        jobId: job.id,
        userId: user.id,
        fileKey: `ai/${user.id}/x.png`,
        thumbKey: `ai/${user.id}/x-t.png`,
        mimeType: 'image/png',
        width: 10,
        height: 10,
        sizeBytes: 1,
      },
    });
    await createCreation(agent, { avatarId: avatar.id, title: 'With library avatar' });
    await createCreation(agent, { generatedAvatarId: gen.id, title: 'With AI avatar' }, 'UPLOAD');
    await createCreation(agent, { title: 'No avatar' });

    const all = await agent.get('/api/creations');
    expect(all.body.total).toBe(3);
    const lib = all.body.items.find((i: { title: string }) => i.title === 'With library avatar');
    expect(lib.avatarUsed).toMatchObject({ kind: 'library', name: avatar.name, type: 'FULL_BODY' });
    expect(JSON.stringify(all.body)).not.toMatch(/thumbKey|resultPath|sourcePath/);

    const byName = await agent.get('/api/creations').query({ q: avatar.name.split(' ')[0] });
    expect(byName.body.items.map((i: { title: string }) => i.title)).toEqual([
      'With library avatar',
    ]);
    expect((await agent.get('/api/creations').query({ q: 'silver comet' })).body.total).toBe(1);
    expect(
      (await agent.get('/api/creations').query({ source: 'UPLOAD' })).body.items[0].title,
    ).toBe('With AI avatar');
    expect(
      (await agent.get('/api/creations').query({ avatarKind: 'none' })).body.items[0].title,
    ).toBe('No avatar');
    expect(
      (await agent.get('/api/creations').query({ avatarType: 'FACE' })).body.items[0].avatarUsed
        .kind,
    ).toBe('generated');
    expect(
      (
        await agent
          .get('/api/creations')
          .query({ from: new Date(Date.now() + 86400_000).toISOString() })
      ).body.total,
    ).toBe(0);
    expect((await agent.get('/api/creations').query({ sort: 'oldest' })).body.items[0].title).toBe(
      'With library avatar',
    );

    // Someone else's generated avatar can't be referenced.
    const other = await newEmployee('filters-other');
    let r = other.agent
      .post('/api/creations')
      .set(H)
      .field('source', 'CAMERA')
      .field('layout', '{}')
      .field('generatedAvatarId', gen.id);
    r = r
      .attach('photo', await jpeg(), { filename: 'o.jpg', contentType: 'image/jpeg' })
      .attach('result', await png(), { filename: 'r.png', contentType: 'image/png' });
    expect((await r).status).toBe(400);
  });
});

/** Minimal ZIP reader (central directory) — enough to verify exported archives. */
function readZip(buf: Buffer) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files: Record<string, Buffer> = {};
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    files[name] = method === 8 ? inflateRawSync(data) : Buffer.from(data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

describe('event album ZIP export (Creator)', () => {
  it('exports the real final photos in album folders with a manifest', async () => {
    const creator = await signIn(createApp(prisma, config), CREATOR);
    const emp = await newEmployee('zipper');
    const ev = (
      await creator
        .post('/api/creator/events')
        .set(H)
        .send({
          name: 'Zip Day',
          eventDate: new Date(Date.now() + 86400_000).toISOString().slice(0, 10),
          startTime: '09:00',
          endTime: '17:00',
          location: 'HQ',
          status: 'UPCOMING',
        })
    ).body;
    await creator
      .post(`/api/creator/events/${ev.id}/assignments`)
      .set(H)
      .send({ userIds: [emp.user.id] });
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const r = await emp.agent
        .post(`/api/events/${ev.id}/photos`)
        .set(H)
        .field('source', 'CAMERA')
        .field('layout', '{}')
        .attach('photo', await jpeg(), { filename: 'o.jpg', contentType: 'image/jpeg' })
        .attach('result', await jpeg(200, 150), { filename: 'r.jpg', contentType: 'image/jpeg' });
      ids.push(r.body.id);
    }
    const albums = (
      await creator.post(`/api/creator/events/${ev.id}/albums`).set(H).send({ name: 'Stage' })
    ).body.albums;
    await creator
      .put(`/api/creator/events/${ev.id}/photos/${ids[0]}/album`)
      .set(H)
      .send({ albumId: albums[0].id });

    // Employees can't export.
    expect((await emp.agent.get(`/api/creator/events/${ev.id}/export.zip`)).status).toBe(403);

    const res = await creator
      .get(`/api/creator/events/${ev.id}/export.zip`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toMatch(new RegExp(`${ev.code}_photos\\.zip`));
    const files = readZip(res.body as Buffer);
    const names = Object.keys(files);
    expect(names).toContain('manifest.csv');
    expect(names.filter((n) => n.startsWith('Stage/'))).toHaveLength(1);
    expect(names.filter((n) => n.startsWith('Unsorted/'))).toHaveLength(1);
    expect(
      names.every((n) => n === 'manifest.csv' || n.includes(`SageVatar_${ev.code}_zipper`)),
    ).toBe(true);
    const photoFile = files[names.find((n) => n.startsWith('Stage/'))!];
    expect((await sharp(photoFile).metadata()).format).toBe('jpeg');
    const stored = await prisma.eventPhoto.findUniqueOrThrow({ where: { id: ids[0] } });
    const original = await creator
      .get(`/api/events/${ev.id}/photos/${stored.id}/image/final`)
      .buffer(true);
    expect(Buffer.compare(photoFile, original.body as Buffer)).toBe(0);
    const manifest = files['manifest.csv'].toString('utf8').trim().split('\n');
    expect(manifest).toHaveLength(3);
    expect(manifest[0]).toMatch(/^photo_id,file,album,employee,captured_at/);

    // One album only.
    const albumZip = await creator
      .get(`/api/creator/events/${ev.id}/export.zip?albumId=${albums[0].id}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(
      Object.keys(readZip(albumZip.body as Buffer)).filter((n) => n !== 'manifest.csv'),
    ).toHaveLength(1);
  });
});
