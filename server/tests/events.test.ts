import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import type { Mail, Mailer } from '../src/lib/mailer.js';
import { config, prisma, H, CREATOR, jpeg, png, newEmployee } from './helpers.js';

afterAll(() => prisma.$disconnect());

/** Captures notification / photo emails so tests can check them. */
const outbox: Mail[] = [];
const mailer: Mailer = {
  mode: 'smtp',
  async send(m) {
    outbox.push(m);
  },
};
const app = createApp(prisma, config, mailer);

type Agent = ReturnType<typeof request.agent>;
let creator: Agent;
let A: { agent: Agent; user: { id: string; email: string } };
let B: { agent: Agent; user: { id: string; email: string } };
let C: { agent: Agent; user: { id: string; email: string } }; // never assigned

async function signIn(creds: { email: string; password: string }) {
  const agent = request.agent(app);
  const r = await agent.post('/api/auth/login').set(H).send(creds);
  expect(r.status).toBe(200);
  return agent;
}

beforeAll(async () => {
  creator = await signIn(CREATOR);
  for (const [label, set] of [
    ['eva', (v: typeof A) => (A = v)],
    ['evb', (v: typeof B) => (B = v)],
    ['evc', (v: typeof C) => (C = v)],
  ] as const) {
    const e = await newEmployee(label);
    set({ agent: await signIn(e), user: e.user });
  }
});

const today = new Date();
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const EVENT = {
  name: 'Annual Day 2026',
  eventDate: ymd(new Date(today.getTime() + 7 * 86400_000)),
  startTime: '10:00',
  endTime: '18:00',
  timezoneOffset: 0,
  location: 'Hyderabad HQ, Atrium',
  description: 'Company celebration',
  instructions: 'Use the corporate avatars only.',
};

async function createEvent(over: Record<string, unknown> = {}) {
  const r = await creator
    .post('/api/creator/events')
    .set(H)
    .send({ ...EVENT, ...over });
  expect(r.status).toBe(201);
  return r.body as { id: string; code: string; status: string };
}

async function savePhoto(agent: Agent, eventId: string, extra: Record<string, string> = {}) {
  let req = agent
    .post(`/api/events/${eventId}/photos`)
    .set(H)
    .field('source', 'CAMERA')
    .field('layout', JSON.stringify({ version: 1 }))
    .field('capturedAt', '2026-11-04T10:15:00.000Z');
  for (const [k, v] of Object.entries(extra)) req = req.field(k, v);
  return req
    .attach('photo', await jpeg(), { filename: 'o.jpg', contentType: 'image/jpeg' })
    .attach('result', await png(), { filename: 'r.png', contentType: 'image/png' });
}

describe('creating events (Creator)', () => {
  it('requires name, date, start/end time and location; end after start', async () => {
    const missing = await creator.post('/api/creator/events').set(H).send({ name: 'X' });
    expect(missing.status).toBe(400);
    const backwards = await creator
      .post('/api/creator/events')
      .set(H)
      .send({ ...EVENT, startTime: '18:00', endTime: '10:00' });
    expect(backwards.status).toBe(400);
    expect(backwards.body.error).toMatch(/End time must be after/);
  });

  it('generates a unique Event ID and starts as a draft', async () => {
    const a = await createEvent();
    const b = await createEvent();
    expect(a.code).toMatch(/^EVT-\d{6}-[2-9A-HJ-NP-Z]{4}$/);
    expect(a.code).not.toBe(b.code);
    expect(a.status).toBe('DRAFT');
  });

  it('is Creator-only', async () => {
    expect((await A.agent.post('/api/creator/events').set(H).send(EVENT)).status).toBe(403);
    expect((await A.agent.get('/api/creator/events')).status).toBe(403);
  });
});

describe('assignments, visibility and the photo workflow', () => {
  let ev: { id: string; code: string };
  let photoId: string;

  it('assigns employees, prevents duplicates, and keeps drafts hidden and silent', async () => {
    ev = await createEvent();
    outbox.length = 0;
    const r = await creator
      .post(`/api/creator/events/${ev.id}/assignments`)
      .set(H)
      .send({ userIds: [A.user.id, B.user.id] });
    expect(r.status).toBe(200);
    expect(r.body.added).toHaveLength(2);

    const dup = await creator
      .post(`/api/creator/events/${ev.id}/assignments`)
      .set(H)
      .send({ userIds: [A.user.id, A.user.id] });
    expect(dup.body.added).toEqual([]);
    expect(dup.body.alreadyAssigned).toEqual([A.user.id]);
    expect(await prisma.eventAssignment.count({ where: { eventId: ev.id } })).toBe(2);

    // Only active Employees can be assigned.
    const creatorRow = await prisma.user.findUniqueOrThrow({ where: { email: CREATOR.email } });
    const bad = await creator
      .post(`/api/creator/events/${ev.id}/assignments`)
      .set(H)
      .send({ userIds: [creatorRow.id] });
    expect(bad.status).toBe(400);

    // Draft: no notifications, invisible to employees.
    expect(outbox).toHaveLength(0);
    expect(
      (await A.agent.get('/api/events/mine')).body.find((e: { id: string }) => e.id === ev.id),
    ).toBeUndefined();
    expect((await A.agent.get(`/api/events/${ev.id}`)).status).toBe(404);
  });

  it('publishing notifies assigned employees in-app and by email', async () => {
    outbox.length = 0;
    const r = await creator
      .patch(`/api/creator/events/${ev.id}`)
      .set(H)
      .send({ status: 'UPCOMING' });
    expect(r.status).toBe(200);
    expect(outbox.map((m) => m.to).sort()).toEqual([A.user.email, B.user.email].sort());
    expect(outbox[0].subject).toMatch(/New Event Assigned!/);
    expect(outbox[0].text).toMatch(/assigned to Annual Day 2026/);
    const n = await A.agent.get('/api/notifications');
    expect(n.body.unread).toBeGreaterThan(0);
    expect(n.body.items[0]).toMatchObject({ type: 'EVENT_ASSIGNED', link: `/events/${ev.id}` });
  });

  it('My Events lists only assigned events with the card details', async () => {
    const mine = await A.agent.get('/api/events/mine');
    const card = mine.body.find((e: { id: string }) => e.id === ev.id);
    expect(card).toMatchObject({
      name: 'Annual Day 2026',
      code: ev.code,
      location: EVENT.location,
      status: 'UPCOMING',
      photoCount: 0,
      startTime: '10:00',
      canCapture: true,
    });
    expect(
      (await C.agent.get('/api/events/mine')).body.find((e: { id: string }) => e.id === ev.id),
    ).toBeUndefined();
  });

  it('blocks unassigned employees from entering (404)', async () => {
    expect((await C.agent.get(`/api/events/${ev.id}`)).status).toBe(404);
    expect((await C.agent.get(`/api/events/${ev.id}/photos`)).status).toBe(404);
    expect((await savePhoto(C.agent, ev.id)).status).toBe(404);
  });

  it('saves a photo to the open event with a full record, separate from personal creations', async () => {
    const avatar = await prisma.avatar.findFirstOrThrow({ where: { isActive: true } });
    const r = await savePhoto(A.agent, ev.id, { avatarId: avatar.id });
    expect(r.status).toBe(201);
    photoId = r.body.id;
    const row = await prisma.eventPhoto.findUniqueOrThrow({ where: { id: photoId } });
    expect(row).toMatchObject({
      eventId: ev.id,
      userId: A.user.id,
      avatarId: avatar.id,
      source: 'CAMERA',
    });
    expect(row.capturedAt.toISOString()).toBe('2026-11-04T10:15:00.000Z');
    expect(row.originalPath).toMatch(new RegExp(`^events/${ev.id}/photos/.+-original\\.jpg$`));
    expect(row.finalPath).toMatch(/-final\.png$/);
    expect(r.body.eventCode).toBe(ev.code);

    // Personal history is untouched.
    expect((await A.agent.get('/api/creations')).body.total).toBe(0);
  });

  it('shares the gallery with participants (default) but keeps originals for the owner', async () => {
    const list = await B.agent.get(`/api/events/${ev.id}/photos`);
    expect(list.body.map((p: { id: string }) => p.id)).toContain(photoId);
    const p = list.body.find((x: { id: string }) => x.id === photoId);
    expect(p.mine).toBe(false);
    expect(p.originalUrl).toBeNull();
    expect((await B.agent.get(p.finalUrl)).status).toBe(200);
    const dl = await B.agent.get(p.downloadUrl);
    expect(dl.headers['content-disposition']).toMatch(
      new RegExp(`attachment; filename="?SageVatar_${ev.code}_`),
    );
    expect(
      (await B.agent.get(`/api/events/${ev.id}/photos/${photoId}/image/original`)).status,
    ).toBe(404);
    expect(
      (await A.agent.get(`/api/events/${ev.id}/photos/${photoId}/image/original`)).status,
    ).toBe(200);
    expect((await C.agent.get(p.finalUrl)).status).toBe(404);
  });

  it('prevents cross-event photo access', async () => {
    const other = await createEvent({ status: 'UPCOMING' });
    await creator
      .post(`/api/creator/events/${other.id}/assignments`)
      .set(H)
      .send({ userIds: [B.user.id] });
    // B is assigned to both events, but a photo id only works under its own event.
    expect(
      (await B.agent.get(`/api/events/${other.id}/photos/${photoId}/image/final`)).status,
    ).toBe(404);
    expect((await B.agent.get(`/api/events/${other.id}/photos`)).body).toEqual([]);
  });

  it('private galleries: employees see only their own photos; Creators see all', async () => {
    await creator
      .patch(`/api/creator/events/${ev.id}`)
      .set(H)
      .send({ galleryVisibility: 'PRIVATE' });
    expect((await B.agent.get(`/api/events/${ev.id}/photos`)).body).toEqual([]);
    expect((await B.agent.get(`/api/events/${ev.id}/photos/${photoId}/image/final`)).status).toBe(
      404,
    );
    expect((await A.agent.get(`/api/events/${ev.id}/photos`)).body).toHaveLength(1);
    expect((await creator.get(`/api/creator/events/${ev.id}/photos`)).body).toHaveLength(1);
    await creator
      .patch(`/api/creator/events/${ev.id}`)
      .set(H)
      .send({ galleryVisibility: 'PARTICIPANTS' });
  });

  it('emails a permitted photo with the image attached', async () => {
    outbox.length = 0;
    const r = await B.agent
      .post(`/api/events/${ev.id}/photos/${photoId}/email`)
      .set(H)
      .send({ to: 'friend@example.com', subject: 'Townhall photo', message: 'Look!' });
    expect(r.status).toBe(200);
    expect(outbox[0].to).toBe('friend@example.com');
    expect(outbox[0].attachments?.[0].filename).toMatch(new RegExp(`^SageVatar_${ev.code}_`));
    expect(outbox[0].attachments?.[0].content.length).toBeGreaterThan(0);
    expect(
      (
        await C.agent
          .post(`/api/events/${ev.id}/photos/${photoId}/email`)
          .set(H)
          .send({ to: 'x@example.com', subject: 'x' })
      ).status,
    ).toBe(404);
  });

  it('details changes notify participants', async () => {
    outbox.length = 0;
    await creator
      .patch(`/api/creator/events/${ev.id}`)
      .set(H)
      .send({ location: 'Bengaluru Office' });
    expect(outbox).toHaveLength(2);
    expect(outbox[0].subject).toMatch(/Event details changed/);
    const n = await B.agent.get('/api/notifications');
    expect(n.body.items[0]).toMatchObject({ type: 'EVENT_UPDATED' });
    // Users only ever see their own notifications.
    expect(n.body.items.every((x: { link: string }) => x.link.startsWith('/events/'))).toBe(true);
    const read = await B.agent.post('/api/notifications/read-all').set(H).send({});
    expect(read.body.updated).toBeGreaterThan(0);
    expect((await B.agent.get('/api/notifications')).body.unread).toBe(0);
    expect((await A.agent.get('/api/notifications')).body.unread).toBeGreaterThan(0);
  });

  it('albums: create, move photos within the event, keep photos when deleted', async () => {
    const r = await creator
      .post(`/api/creator/events/${ev.id}/albums`)
      .set(H)
      .send({ name: 'Stage' });
    expect(r.status).toBe(201);
    const albumId = r.body.albums[0].id;
    expect(
      (await creator.post(`/api/creator/events/${ev.id}/albums`).set(H).send({ name: 'Stage' }))
        .status,
    ).toBe(409);
    expect(
      (
        await creator
          .put(`/api/creator/events/${ev.id}/photos/${photoId}/album`)
          .set(H)
          .send({ albumId })
      ).status,
    ).toBe(204);
    expect((await prisma.eventPhoto.findUniqueOrThrow({ where: { id: photoId } })).albumId).toBe(
      albumId,
    );
    const del = await creator.delete(`/api/creator/events/${ev.id}/albums/${albumId}`).set(H);
    expect(del.body.albums).toEqual([]);
    expect(await prisma.eventPhoto.count({ where: { id: photoId } })).toBe(1);
    expect(
      (await A.agent.post(`/api/creator/events/${ev.id}/albums`).set(H).send({ name: 'Mine' }))
        .status,
    ).toBe(403);
  });

  it('employees delete only their own photos; Creators can remove any (audited)', async () => {
    expect((await B.agent.delete(`/api/events/${ev.id}/photos/${photoId}`).set(H)).status).toBe(
      404,
    );
    const own = await savePhoto(B.agent, ev.id);
    expect((await B.agent.delete(`/api/events/${ev.id}/photos/${own.body.id}`).set(H)).status).toBe(
      204,
    );

    const r = await creator.delete(`/api/creator/events/${ev.id}/photos/${photoId}`).set(H);
    expect(r.status).toBe(204);
    expect(await prisma.eventPhoto.count({ where: { id: photoId } })).toBe(0);
    expect(
      await prisma.auditLog.count({ where: { action: 'EVENT_PHOTO_DELETED', entityId: photoId } }),
    ).toBe(1);
  });

  it('cancel / complete notify participants and stop new photos; archive hides the event', async () => {
    outbox.length = 0;
    await creator.patch(`/api/creator/events/${ev.id}`).set(H).send({ status: 'CANCELLED' });
    expect(outbox[0].subject).toMatch(/Event cancelled/);
    expect((await savePhoto(A.agent, ev.id)).status).toBe(409);

    outbox.length = 0;
    await creator.patch(`/api/creator/events/${ev.id}`).set(H).send({ status: 'COMPLETED' });
    expect(outbox[0].subject).toMatch(/Event completed/);
    expect((await A.agent.get(`/api/events/${ev.id}`)).body.canCapture).toBe(false);
    expect((await A.agent.get(`/api/events/${ev.id}/photos`)).status).toBe(200);

    await creator.patch(`/api/creator/events/${ev.id}`).set(H).send({ status: 'ARCHIVED' });
    expect((await A.agent.get(`/api/events/${ev.id}`)).status).toBe(404);
    expect((await creator.get(`/api/creator/events/${ev.id}`)).status).toBe(200);
  });

  it('removing an assignment revokes access', async () => {
    const e2 = await createEvent({ status: 'UPCOMING' });
    await creator
      .post(`/api/creator/events/${e2.id}/assignments`)
      .set(H)
      .send({ userIds: [A.user.id] });
    expect((await A.agent.get(`/api/events/${e2.id}`)).status).toBe(200);
    expect(
      (await creator.delete(`/api/creator/events/${e2.id}/assignments/${A.user.id}`).set(H)).status,
    ).toBe(200);
    expect((await A.agent.get(`/api/events/${e2.id}`)).status).toBe(404);
    expect(
      (await creator.delete(`/api/creator/events/${e2.id}/assignments/${A.user.id}`).set(H)).status,
    ).toBe(404);
  });

  it('an upcoming event becomes Active while it is running', async () => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const start = new Date(now.getTime() - 3600_000);
    const end = new Date(now.getTime() + 3600_000);
    const sameDay = ymd(start) === ymd(end);
    const e = await createEvent({
      status: 'UPCOMING',
      eventDate: ymd(start),
      startTime: `${pad(start.getUTCHours())}:${pad(start.getUTCMinutes())}`,
      endTime: sameDay ? `${pad(end.getUTCHours())}:${pad(end.getUTCMinutes())}` : '23:59',
    });
    expect(e.status).toBe('ACTIVE');
  });

  it('cover images are private to people who may enter the event', async () => {
    const e = await createEvent({ status: 'UPCOMING' });
    await creator
      .post(`/api/creator/events/${e.id}/assignments`)
      .set(H)
      .send({ userIds: [A.user.id] });
    const up = await creator
      .post(`/api/creator/events/${e.id}/cover`)
      .set(H)
      .attach('cover', await jpeg(), { filename: 'c.jpg', contentType: 'image/jpeg' });
    expect(up.status).toBe(200);
    expect(up.body.coverUrl).toMatch(new RegExp(`^/api/events/${e.id}/cover`));
    expect((await A.agent.get(up.body.coverUrl)).status).toBe(200);
    expect((await C.agent.get(up.body.coverUrl)).status).toBe(404);
    expect((await request(app).get(up.body.coverUrl)).status).toBe(401);
  });
});
