import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { createApp } from '../src/app.js';
import type { Mail, Mailer } from '../src/lib/mailer.js';
import type { AiProviders } from '../src/lib/ai/openai.js';
import { config, prisma, H, CREATOR, newEmployee } from './helpers.js';
import { testPortrait } from './portraits.js';
import { SLOTS } from '../src/lib/poster/templates.js';

afterAll(() => prisma.$disconnect());

const outbox: Mail[] = [];
const mailer: Mailer = {
  mode: 'smtp',
  async send(m) {
    outbox.push(m);
    return { accepted: [String(m.to)], messageId: 'test-1', response: '250 OK' } as never;
  },
};
const app = createApp(prisma, config, mailer, { images: null, embeddings: null });

type Agent = ReturnType<typeof request.agent>;
type Emp = { agent: Agent; user: { id: string; name: string } };
let creator: Agent;
const emps: Emp[] = [];

async function signIn(a: ReturnType<typeof createApp>, creds: { email: string; password: string }) {
  const agent = request.agent(a);
  expect((await agent.post('/api/auth/login').set(H).send(creds)).status).toBe(200);
  return agent;
}

/** Uploads test portrait #i of `subjectId` as `agent`. */
async function addPhoto(
  agent: Agent,
  subjectId: string,
  i: number,
  opts: { consent?: boolean; share?: boolean; face?: boolean; mask?: boolean } = {},
) {
  const t = await testPortrait(i);
  let r = agent.post(`/api/people/${subjectId}/photos`).set(H);
  if (opts.face !== false) r = r.field('face', JSON.stringify(t.face)).field('faceSource', 'auto');
  if (opts.consent) r = r.field('consentConfirmed', 'true');
  if (opts.share) r = r.field('shareWithColleagues', 'true');
  r = r.attach('photo', t.photo, 'portrait.jpg');
  if (opts.mask !== false) r = r.attach('mask', t.mask, 'mask.png');
  return r;
}

async function waitFor(agent: Agent, id: string) {
  for (let i = 0; i < 200; i++) {
    const r = await agent.get(`/api/posters/${id}`);
    if (r.body.status !== 'RUNNING') return r.body;
    await new Promise((res) => setTimeout(res, 100));
  }
  throw new Error('poster did not finish');
}

const SKIN = ['#f1c7a5', '#c68863', '#8d5524', '#e0ac69', '#ffdbac', '#a0673f', '#d9a37f'];
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

let photoIds: string[] = [];

beforeAll(async () => {
  creator = await signIn(app, CREATOR);
  for (let i = 0; i < 6; i++) {
    const e = await newEmployee(`poster-${i}`);
    emps.push({ agent: await signIn(app, e), user: e.user });
  }
  // Each employee uploads their own photo (portrait i); employee 0..3 share with colleagues.
  photoIds = [];
  for (const [i, e] of emps.entries()) {
    const r = await addPhoto(e.agent, 'me', i, { share: i < 4 });
    expect(r.status).toBe(201);
    expect(r.body.consentBasis).toBe('SELF');
    photoIds.push(r.body.id);
  }
});

describe('employee photographs and permission', () => {
  it('employees can only add photos of themselves', async () => {
    const r = await addPhoto(emps[0].agent, emps[1].user.id, 0);
    expect(r.status).toBe(403);
  });

  it('a Creator must confirm authorisation when uploading for someone else', async () => {
    const no = await addPhoto(creator, emps[5].user.id, 5);
    expect(no.status).toBe(422);
    expect(no.body.error).toMatch(/authorised/);
    const yes = await addPhoto(creator, emps[5].user.id, 5, { consent: true });
    expect(yes.status).toBe(201);
    expect(yes.body.consentBasis).toBe('CREATOR_CONFIRMED');
    expect(yes.body.shareWithColleagues).toBe(false);
    // Creators cannot opt someone into sharing.
    const share = await creator.patch(`/api/people/photos/${yes.body.id}`).set(H).send({ shareWithColleagues: true });
    expect(share.status).toBe(403);
  });

  it('rejects invalid image formats and tiny photos', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"/>');
    const bad = await emps[0].agent.post('/api/people/me/photos').set(H).attach('photo', svg, 'x.svg');
    expect(bad.status).toBe(400);
    const tiny = await sharp({ create: { width: 80, height: 80, channels: 3, background: '#888' } }).jpeg().toBuffer();
    const small = await emps[0].agent.post('/api/people/me/photos').set(H).attach('photo', tiny, 't.jpg');
    expect(small.status).toBe(400);
  });

  it("employees see colleagues' photos only when shared", async () => {
    const list = await emps[0].agent.get('/api/people');
    const ids = list.body.items.map((u: { id: string }) => u.id);
    expect(ids).toContain(emps[1].user.id); // shared
    expect(ids).not.toContain(emps[4].user.id); // not shared
    expect((await emps[0].agent.get(`/api/people/photos/${photoIds[4]}/thumb`)).status).toBe(404);
    expect((await emps[0].agent.get(`/api/people/photos/${photoIds[1]}/thumb`)).status).toBe(200);
    // Creators see everyone and can search by Employee ID.
    expect((await creator.put(`/api/people/${emps[2].user.id}/employee-code`).set(H).send({ employeeCode: 'sit-4242' })).status).toBe(200);
    const byCode = await creator.get('/api/people?q=SIT-4242');
    expect(byCode.body.items.map((u: { id: string }) => u.id)).toEqual([emps[2].user.id]);
    // Employees can't set Employee IDs.
    expect((await emps[0].agent.put(`/api/people/${emps[0].user.id}/employee-code`).set(H).send({ employeeCode: 'X-1' })).status).toBe(403);
  });
});

describe('Generate with Image', () => {
  const five = () =>
    [0, 1, 2, 3, 4].map((i) => ({ userId: emps[i].user.id, photoId: photoIds[i], slot: SLOTS[i].id }));

  it('lists the published designs with previews', async () => {
    const t = await creator.get('/api/posters/templates');
    expect(t.body.map((x: { key: string }) => x.key)).toEqual([
      'sageit-green-blue',
    ]);
    const prev = await emps[0].agent.get(t.body[0].previewUrl);
    expect(prev.status).toBe(200);
    expect(prev.headers['content-type']).toBe('image/jpeg');
  });

  it("composes every selected person's real face into their own slot", async () => {
    const start = await creator.post('/api/posters').set(H).send({ templateKey: 'sageit-green-blue', participants: five() });
    expect(start.status).toBe(202);
    expect(start.body.status).toBe('RUNNING');
    expect(start.body.mode).toBe('template'); // no AI configured → template fallback
    expect(start.body.modeNote).toMatch(/not configured/);
    const done = await waitFor(creator, start.body.id);
    expect(done.status).toBe('SUCCEEDED');
    expect(done.progress).toBe(100);
    expect(done.participants.map((p: { cutout: string }) => p.cutout)).toEqual(['mask', 'mask', 'mask', 'mask', 'mask']);

    const img = await creator.get(done.imageUrl).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    const { data, info } = await sharp(img.body as Buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([2000, 1500]);
    // The cheek of each slot shows that participant's own skin colour (portrait i ↔ slot i).
    for (let i = 0; i < 5; i++) {
      const s = SLOTS[i];
      const x = Math.round(s.x + s.faceHeight * 0.3);
      const y = Math.round(s.y + s.faceHeight * 0.12);
      const at = (y * info.width + x) * 3;
      const got = [data[at], data[at + 1], data[at + 2]];
      const want = rgb(SKIN[i]);
      const dist = Math.hypot(got[0] - want[0], got[1] - want[1], got[2] - want[2]);
      expect(dist, `slot ${s.id} should show portrait ${i}`).toBeLessThan(30);
    }
  });

  it('validates group size, cutters and duplicates', async () => {
    const one = await creator.post('/api/posters').set(H).send({ templateKey: 'sageit-green-blue', participants: five().slice(0, 1) });
    expect(one.status).toBe(422);
    const noCutters = five().map((p, i) => ({ ...p, slot: SLOTS[i + 2].id }));
    const r1 = await creator.post('/api/posters').set(H).send({ templateKey: 'sageit-green-blue', participants: noCutters });
    expect(r1.status).toBe(422);
    expect(r1.body.error).toMatch(/cake-cutting/);
    const dupe = five();
    dupe[1] = { ...dupe[1], userId: dupe[0].userId, photoId: dupe[0].photoId };
    expect((await creator.post('/api/posters').set(H).send({ templateKey: 'sageit-green-blue', participants: dupe })).status).toBe(422);

    // Creator lowers the template limit → too many participants.
    expect((await creator.patch('/api/creator/posters/templates/sageit-green-blue').set(H).send({ maxParticipants: 3 })).status).toBe(200);
    const many = await creator.post('/api/posters').set(H).send({ templateKey: 'sageit-green-blue', participants: five() });
    expect(many.status).toBe(422);
    expect(many.body.error).toMatch(/Too many participants.*room for 3/);
    await creator.patch('/api/creator/posters/templates/sageit-green-blue').set(H).send({ maxParticipants: 11 });
  });

  it('asks for manual alignment when no face was detected, and accepts it', async () => {
    const t = await testPortrait(6);
    const noFace = await addPhoto(emps[0].agent, 'me', 6, { face: false, mask: false });
    expect(noFace.body.faceSource).toBe('none');
    const parts = [
      { userId: emps[0].user.id, photoId: noFace.body.id, slot: 'cut-left' },
      { userId: emps[1].user.id, photoId: photoIds[1], slot: 'cut-right' },
    ];
    const fail = await emps[0].agent.post('/api/posters').set(H).send({ templateKey: 'sageit-green-blue', participants: parts });
    expect(fail.status).toBe(422);
    expect(fail.body.code).toBe('PARTICIPANT_PROBLEMS');
    expect(fail.body.problems[0].message).toMatch(/No face was found/);

    parts[0] = { ...parts[0], face: t.face } as never;
    const ok = await emps[0].agent.post('/api/posters').set(H).send({ templateKey: 'sageit-green-blue', participants: parts });
    expect(ok.status).toBe(202);
    const done = await waitFor(emps[0].agent, ok.body.id);
    expect(done.status).toBe('SUCCEEDED');
    expect(done.participants[0].cutout).toBe('oval'); // no mask → feathered face oval
  });

  it("employees can't use a colleague's unshared photo", async () => {
    const parts = [
      { userId: emps[0].user.id, photoId: photoIds[0], slot: 'cut-left' },
      { userId: emps[4].user.id, photoId: photoIds[4], slot: 'cut-right' },
    ];
    const r = await emps[0].agent.post('/api/posters').set(H).send({ templateKey: 'sageit-green-blue', participants: parts });
    expect(r.status).toBe(422);
    expect(r.body.error).toMatch(/permission/);
  });

  it('withdrawn photos can no longer be used', async () => {
    const extra = await addPhoto(emps[3].agent, 'me', 3, { share: true });
    expect((await emps[3].agent.delete(`/api/people/photos/${extra.body.id}`).set(H)).status).toBe(204);
    const parts = [
      { userId: emps[0].user.id, photoId: photoIds[0], slot: 'cut-left' },
      { userId: emps[3].user.id, photoId: extra.body.id, slot: 'cut-right' },
    ];
    const r = await creator.post('/api/posters').set(H).send({ templateKey: 'sageit-green-blue', participants: parts });
    expect(r.status).toBe(422);
    expect(r.body.error).toMatch(/withdrawn/);
  });

  it('downloads, emails, saves to My Creations; posters are private', async () => {
    const start = await creator.post('/api/posters').set(H).send({ templateKey: 'sageit-green-blue', participants: five().slice(0, 3), variation: 2 });
    const done = await waitFor(creator, start.body.id);
    expect(done.status).toBe('SUCCEEDED');

    const jpg = await creator.get(done.downloadJpgUrl);
    expect(jpg.headers['content-type']).toBe('image/jpeg');
    expect(jpg.headers['content-disposition']).toMatch(/SageVatar_Personal_.*Work-Anniversary_.*\.jpg/);
    const pngDl = await creator.get(done.downloadPngUrl);
    expect(pngDl.headers['content-type']).toBe('image/png');

    const mail = await creator.post(`/api/posters/${done.id}/email`).set(H).send({ to: 'team@sageitinc.com', subject: 'Happy anniversary!' });
    expect(mail.status).toBe(200);
    expect(outbox.at(-1)?.attachments?.[0]?.filename).toMatch(/Work-Anniversary/);

    const saved = await creator.post(`/api/posters/${done.id}/save-creation`).set(H);
    expect(saved.status).toBe(201);
    const again = await creator.post(`/api/posters/${done.id}/save-creation`).set(H);
    expect(again.body.already).toBe(true);
    const mine = await creator.get(`/api/creations/${saved.body.creationId}`);
    expect(mine.status).toBe(200);
    expect(mine.body.layout.kind).toBe('group-anniversary');
    expect(mine.body.layout.participants).toHaveLength(3);

    // Not inside an event → no event gallery.
    expect((await creator.post(`/api/posters/${done.id}/save-event`).set(H)).status).toBe(409);
    // Someone else can't see it.
    expect((await emps[4].agent.get(`/api/posters/${done.id}`)).status).toBe(404);
  });

  it('saves to the event gallery with participant and creator metadata', async () => {
    const d = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10);
    const ev = await creator.post('/api/creator/events').set(H).send({
      name: 'Anniversary Week', eventDate: d, startTime: '10:00', endTime: '12:00', timezoneOffset: 0,
      location: 'HQ', status: 'UPCOMING',
    });
    expect(ev.status).toBe(201);
    const start = await creator.post('/api/posters').set(H).send({ templateKey: 'sageit-green-blue', participants: five().slice(0, 2), eventId: ev.body.id });
    const done = await waitFor(creator, start.body.id);
    expect(done.event.code).toBe(ev.body.code);
    const saved = await creator.post(`/api/posters/${done.id}/save-event`).set(H);
    expect(saved.status).toBe(201);
    const photo = await prisma.eventPhoto.findUniqueOrThrow({ where: { id: saved.body.eventPhotoId } });
    expect(photo.eventId).toBe(ev.body.id);
    const layout = photo.layout as { kind: string; createdBy: { name: string }; participants: unknown[] };
    expect(layout.kind).toBe('group-anniversary');
    expect(layout.participants).toHaveLength(2);
    const dl = await creator.get(done.downloadPngUrl);
    expect(dl.headers['content-disposition']).toContain(ev.body.code);
  });

  it('keeps Creator-only template and branding management away from Employees', async () => {
    expect((await emps[0].agent.patch('/api/creator/posters/templates/sageit-green-blue').set(H).send({ isPublished: false })).status).toBe(403);
    expect((await emps[0].agent.put('/api/creator/posters/branding').set(H).send({ companyName: 'X' })).status).toBe(403);
    // Unpublished templates disappear for Employees.
    await creator.patch('/api/creator/posters/templates/sageit-green-blue').set(H).send({ isPublished: false });
    const list = await emps[0].agent.get('/api/posters/templates');
    expect(list.body).toEqual([]);
    await creator.patch('/api/creator/posters/templates/sageit-green-blue').set(H).send({ isPublished: true });
  });
});

describe('AI photo-realism pass', () => {
  const sceneApp = (fail: boolean) => {
    const ai: AiProviders = {
      embeddings: null,
      images: {
        provider: 'openai',
        model: 'stub-image',
        async generate() {
          throw new Error('not used');
        },
        async edit(prompt, image, opts) {
          expect(prompt).toMatch(/Keep the composition EXACTLY/);
          expect(prompt).toMatch(/Do not write or change any text/);
          expect(opts).toEqual({ size: '1536x1024' });
          const m = await sharp(image).metadata();
          expect([m.width, m.height]).toEqual([1536, 1024]);
          if (fail) throw new Error('upstream 503');
          // A "restyled" photo that has lost every face — the originals must be pasted back.
          return sharp({ create: { width: 1536, height: 1024, channels: 3, background: '#335577' } }).png().toBuffer();
        },
      },
    };
    return createApp(prisma, config, mailer, ai);
  };

  it('pastes every original face back over the AI-restyled photo', async () => {
    const agent = await signIn(sceneApp(false), CREATOR);
    const parts = [0, 1, 2].map((i) => ({ userId: emps[i].user.id, photoId: photoIds[i], slot: SLOTS[i].id }));
    const start = await agent.post('/api/posters').set(H).send({ templateKey: 'sageit-green-blue', participants: parts });
    expect(start.body.mode).toBe('ai');
    const done = await waitFor(agent, start.body.id);
    expect(done.status).toBe('SUCCEEDED');
    expect(done.mode).toBe('ai');
    const img = await agent.get(done.imageUrl).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    const { data, info } = await sharp(img.body as Buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < 3; i++) {
      const s = SLOTS[i];
      const at = (Math.round(s.y + s.faceHeight * 0.12) * info.width + Math.round(s.x + s.faceHeight * 0.3)) * 3;
      const want = rgb(SKIN[i]);
      const dist = Math.hypot(data[at] - want[0], data[at + 1] - want[1], data[at + 2] - want[2]);
      expect(dist, `slot ${s.id} keeps portrait ${i}'s face`).toBeLessThan(30);
    }
  });

  it('falls back to the template composition when the AI service fails', async () => {
    const agent = await signIn(sceneApp(true), CREATOR);
    const parts = [0, 1].map((i) => ({ userId: emps[i].user.id, photoId: photoIds[i], slot: SLOTS[i].id }));
    const start = await agent.post('/api/posters').set(H).send({ templateKey: 'sageit-green-blue', participants: parts });
    const done = await waitFor(agent, start.body.id);
    expect(done.status).toBe('SUCCEEDED');
    expect(done.mode).toBe('template');
    expect(done.modeNote).toMatch(/photo-realism service failed.*upstream 503/);
  });
});

describe('photo templates (replace the faces in an uploaded photo)', () => {
  /** A synthetic "group photo": four test portraits side by side (not real people). */
  async function groupPhoto() {
    const tiles = await Promise.all([7, 8, 9, 10].map((i) => testPortrait(i)));
    const W = 720 * 4;
    const H = 900;
    const photo = await sharp({ create: { width: W, height: H, channels: 3, background: '#e5e7eb' } })
      .composite(tiles.map((t, i) => ({ input: t.photo, left: i * 720, top: 0 })))
      .jpeg({ quality: 92 })
      .toBuffer();
    const faceSlots = tiles.map((t, i) => ({
      id: `face-${i + 1}`,
      label: `Person ${i + 1}`,
      role: i === 1 || i === 2 ? 'cutter' : 'stand',
      x: (i * 720 + t.face.x * 720) / W,
      y: t.face.y,
      w: (t.face.w * 720) / W,
      h: t.face.h,
    }));
    return { photo, faceSlots, W, H };
  }
  const hueOf = (px: number[]) => px[0] / Math.max(1, px[1]);

  it('Creators upload a photo template with marked faces; rights must be confirmed', async () => {
    const g = await groupPhoto();
    const noRights = await creator
      .post('/api/creator/posters/photo-templates')
      .set(H)
      .field('name', 'SageIT office cake cutting')
      .field('faceSlots', JSON.stringify(g.faceSlots))
      .field('rightsConfirmed', 'false')
      .attach('photo', g.photo, 'group.jpg');
    expect(noRights.status, JSON.stringify(noRights.body)).toBe(422);
    expect(
      (await emps[0].agent.post('/api/creator/posters/photo-templates').set(H).field('name', 'x')).status,
    ).toBe(403);

    const ok = await creator
      .post('/api/creator/posters/photo-templates')
      .set(H)
      .field('name', 'SageIT office cake cutting')
      .field('faceSlots', JSON.stringify(g.faceSlots))
      .field('rightsConfirmed', 'true')
      .attach('photo', g.photo, 'group.jpg');
    expect(ok.status).toBe(201);
    expect(ok.body.kind).toBe('photo');
    expect(ok.body.slots.map((s: { id: string }) => s.id)).toEqual(['face-2', 'face-3', 'face-1', 'face-4']);
    expect(ok.body.minParticipants).toBe(2);
    expect((await emps[0].agent.get(ok.body.photoUrl)).status).toBe(200);
    expect((await emps[0].agent.get(ok.body.previewUrl)).headers['content-type']).toBe('image/jpeg');

    // Generate: three employees replace faces 1–3; face 4 is left as it was.
    const parts = [
      { userId: emps[0].user.id, photoId: photoIds[0], slot: 'face-2' },
      { userId: emps[1].user.id, photoId: photoIds[1], slot: 'face-3' },
      { userId: emps[2].user.id, photoId: photoIds[2], slot: 'face-1' },
    ];
    const missingCutter = await creator
      .post('/api/posters')
      .set(H)
      .send({ templateKey: ok.body.key, participants: [parts[0], { ...parts[2] }] });
    expect(missingCutter.status).toBe(422);
    expect(
      (await creator.post('/api/posters').set(H).send({ templateKey: ok.body.key, participants: [{ ...parts[0], slot: 'cut-left' }, parts[1]] })).status,
    ).toBe(422);

    const start = await creator.post('/api/posters').set(H).send({ templateKey: ok.body.key, participants: parts });
    expect(start.status).toBe(202);
    expect(start.body.mode).toBe('photo');
    const done = await waitFor(creator, start.body.id);
    expect(done.status).toBe('SUCCEEDED');
    expect([done.width, done.height]).toEqual([2000, Math.round((2000 * g.H) / g.W)]);
    expect(done.participants.map((p: { slotLabel: string }) => p.slotLabel)).toEqual(['Person 2', 'Person 3', 'Person 1']);

    const img = await creator.get(done.imageUrl).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    const out = await sharp(img.body as Buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const orig = await sharp(g.photo).resize(out.info.width, out.info.height, { fit: 'fill' }).removeAlpha().raw().toBuffer();
    const at = (buf: Buffer, slot: (typeof g.faceSlots)[number]) => {
      const x = Math.round((slot.x + slot.w * 0.72) * out.info.width);
      const y = Math.round((slot.y + slot.h * 0.62) * out.info.height);
      const i = (y * out.info.width + x) * 3;
      return [buf[i], buf[i + 1], buf[i + 2]];
    };
    const want = [SKIN[0], SKIN[1], SKIN[2]].map(rgb);
    for (const [k, slotIdx] of [1, 2, 0].entries()) {
      const got = at(out.data, g.faceSlots[slotIdx]);
      // The employee's own skin tone (hue), not the template person's.
      expect(Math.abs(hueOf(got) - hueOf(want[k])), `face ${slotIdx + 1} shows participant ${k}`).toBeLessThan(0.08);
    }
    // The unselected face 4 is unchanged.
    const f4 = g.faceSlots[3];
    const d4 = Math.hypot(...at(out.data, f4).map((v, i) => v - at(orig, f4)[i]));
    expect(d4).toBeLessThan(12);
  });
});
