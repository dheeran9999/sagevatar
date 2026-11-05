/* eslint-disable @typescript-eslint/no-explicit-any -- loosely-typed JSON from the live API */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import type { Mail, Mailer } from '../src/lib/mailer.js';
import { config, prisma, H, CREATOR, newEmployee, jpeg } from './helpers.js';
import { testPortrait } from './portraits.js';

/**
 * End-to-end notification flow over real HTTP and the real live stream (SSE):
 * Creator, Employee A and Employee B, each with an open stream.
 */
const outbox: Mail[] = [];
const mailer: Mailer = {
  mode: 'smtp',
  async send(m) {
    outbox.push(m);
    return { accepted: [String(m.to)], messageId: 'x', response: '250' } as never;
  },
};
const app = createApp(prisma, config, mailer, { images: null, embeddings: null });
let server: Server;
let base = '';

type Live = { events: { event: string; data: any }[]; close: () => void };
type Who = { id: string; name: string; cookie: string; live: Live };

async function login(email: string, password: string) {
  const r = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...H },
    body: JSON.stringify({ email, password }),
  });
  expect(r.status).toBe(200);
  const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const { user } = (await r.json()) as { user: { id: string; name: string } };
  return { ...user, cookie };
}

/** Opens the user's live stream and records every event it delivers. */
async function stream(cookie: string): Promise<Live> {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/notifications/stream`, { headers: { cookie }, signal: ctrl.signal });
  expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
  const events: Live['events'] = [];
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /^event: (.+)$/m.exec(chunk)?.[1];
          const data = /^data: (.+)$/m.exec(chunk)?.[1];
          if (ev && data) events.push({ event: ev, data: JSON.parse(data) });
        }
      }
    } catch {
      /* aborted */
    }
  })();
  await until(() => events.some((e) => e.event === 'hello'));
  return { events, close: () => ctrl.abort() };
}

async function until(fn: () => boolean, ms = 4000) {
  const t = Date.now();
  while (!fn()) {
    if (Date.now() - t > ms) throw new Error('timed out waiting for a live notification');
    await new Promise((r) => setTimeout(r, 25));
  }
}

const api = (who: Who, path: string, init: RequestInit = {}) =>
  fetch(`${base}${path}`, { ...init, headers: { cookie: who.cookie, ...H, ...(init.headers ?? {}) } });
const json = async (who: Who, path: string, method = 'GET', body?: unknown) => {
  const r = await api(who, path, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
  });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
};
const notifs = (w: Who, type: string) => w.live.events.filter((e) => e.event === 'notification' && e.data.notification.type === type);

let creator: Who;
let A: Who;
let B: Who;
let eventId = '';

beforeAll(async () => {
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const c = await login(CREATOR.email, CREATOR.password);
  const a = await newEmployee('employee-a');
  const b = await newEmployee('employee-b');
  await prisma.user.update({ where: { id: a.user.id }, data: { name: 'Employee A', employeeCode: `SAGE-${a.user.id.slice(-4).toUpperCase()}` } });
  await prisma.user.update({ where: { id: b.user.id }, data: { name: 'Employee B' } });
  const la = await login(a.email, a.password);
  const lb = await login(b.email, b.password);
  creator = { ...c, live: await stream(c.cookie) };
  A = { ...la, live: await stream(la.cookie) };
  B = { ...lb, live: await stream(lb.cookie) };
});

afterAll(async () => {
  for (const w of [creator, A, B]) w?.live.close();
  server?.close();
  await prisma.$disconnect();
});

const day = new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10);

describe('Creator → Employee: event assignment', () => {
  it('only the assigned employee gets an instant popup with event, Creator, date and location', async () => {
    const ev = await json(creator, '/api/creator/events', 'POST', {
      name: 'SageIT Annual Day 2026',
      eventDate: day,
      startTime: '10:00',
      endTime: '17:00',
      timezoneOffset: 0,
      location: 'Hyderabad HQ',
      status: 'UPCOMING',
    });
    expect(ev.status).toBe(201);
    eventId = ev.body.id;
    const sent = outbox.length;
    expect((await json(creator, `/api/creator/events/${eventId}/assignments`, 'POST', { userIds: [A.id] })).status).toBe(200);

    await until(() => notifs(A, 'EVENT_ASSIGNED').length === 1);
    const n = notifs(A, 'EVENT_ASSIGNED')[0].data;
    expect(n.notification.title).toBe('New Event Assigned!');
    expect(n.notification.body).toBe('You have been assigned to SageIT Annual Day 2026.');
    expect(n.notification.data).toMatchObject({ Event: 'SageIT Annual Day 2026', 'Assigned by': creator.name, Where: 'Hyderabad HQ' });
    expect(n.notification.data.When).toContain(day);
    expect(n.notification.link).toBe(`/events/${eventId}`);
    expect(n.unread).toBe(1);
    // Email invitation went to A only.
    expect(outbox.slice(sent).map((m) => m.to)).toEqual([expect.stringContaining('employee-a')]);

    await new Promise((r) => setTimeout(r, 150));
    expect(notifs(B, 'EVENT_ASSIGNED')).toHaveLength(0);
    expect((await json(B, '/api/notifications')).body.items.filter((x: any) => x.type === 'EVENT_ASSIGNED')).toHaveLength(0);
  });

  it('never duplicates, and a draft announces assignments when it is published', async () => {
    await json(creator, `/api/creator/events/${eventId}/assignments`, 'POST', { userIds: [A.id] });
    const draft = await json(creator, '/api/creator/events', 'POST', {
      name: 'Draft Offsite', eventDate: day, startTime: '09:00', endTime: '11:00', timezoneOffset: 0, location: 'Goa',
    });
    await json(creator, `/api/creator/events/${draft.body.id}/assignments`, 'POST', { userIds: [B.id] });
    await new Promise((r) => setTimeout(r, 150));
    expect(notifs(B, 'EVENT_ASSIGNED')).toHaveLength(0); // drafts are silent
    await json(creator, `/api/creator/events/${draft.body.id}`, 'PATCH', { status: 'UPCOMING' });
    await until(() => notifs(B, 'EVENT_ASSIGNED').length === 1);
    expect(notifs(A, 'EVENT_ASSIGNED')).toHaveLength(1);
    expect(await prisma.notification.count({ where: { userId: A.id, type: 'EVENT_ASSIGNED' } })).toBe(1);
  });
});

describe('Employee → Creator: photo saved', () => {
  it('a saved personal photo tells the Creator who made it (not opening the camera)', async () => {
    const before = notifs(creator, 'PHOTO_CREATED').length;
    const form = new FormData();
    form.append('source', 'CAMERA');
    form.append('layout', '{}');
    form.append('photo', new Blob([new Uint8Array(await jpeg(300, 300))], { type: 'image/jpeg' }), 'p.jpg');
    form.append('result', new Blob([new Uint8Array(await jpeg(300, 300))], { type: 'image/jpeg' }), 'r.jpg');
    const r = await api(A, '/api/creations', { method: 'POST', body: form });
    expect(r.status).toBe(201);
    const created = await r.json();
    await until(() => notifs(creator, 'PHOTO_CREATED').length === before + 1);
    const n = notifs(creator, 'PHOTO_CREATED').at(-1)!.data.notification;
    expect(n.title).toBe('New Employee Photo Created!');
    expect(n.data).toMatchObject({
      Employee: A.name,
      'Employee ID': expect.stringMatching(/^SAGE-/),
      Activity: 'Created a new avatar photograph',
      Avatar: 'No avatar',
    });
    expect(n.link).toBe(`/creator/creations/${created.id}`);
    // "View Creation" works for the Creator, not for other employees.
    expect((await json(creator, `/api/creator/creations/${created.id}`)).body.owner.name).toBe(A.name);
    expect((await json(B, `/api/creator/creations/${created.id}`)).status).toBe(403);
    expect(A.live.events.filter((e) => e.event === 'notification' && e.data.notification.type === 'PHOTO_CREATED')).toHaveLength(0);
  });

  it('an event photo by Employee B identifies B and the event', async () => {
    await json(creator, `/api/creator/events/${eventId}/assignments`, 'POST', { userIds: [B.id] });
    const before = notifs(creator, 'PHOTO_CREATED').length;
    const form = new FormData();
    form.append('source', 'UPLOAD');
    form.append('layout', '{}');
    form.append('photo', new Blob([new Uint8Array(await jpeg(300, 300))], { type: 'image/jpeg' }), 'p.jpg');
    form.append('result', new Blob([new Uint8Array(await jpeg(300, 300))], { type: 'image/jpeg' }), 'r.jpg');
    expect((await api(B, `/api/events/${eventId}/photos`, { method: 'POST', body: form })).status).toBe(201);
    await until(() => notifs(creator, 'PHOTO_CREATED').length === before + 1);
    const n = notifs(creator, 'PHOTO_CREATED').at(-1)!.data.notification;
    expect(n.data.Employee).toBe(B.name);
    expect(n.data.Event).toContain('SageIT Annual Day 2026');
    expect(n.link).toMatch(new RegExp(`^/events/${eventId}\\?photo=`));
  });
});

describe('Recognition posters', () => {
  it('an official poster notifies only the people in it, who can then open it', async () => {
    const ids: string[] = [];
    for (const [i, w] of [A, B].entries()) {
      const t = await testPortrait(i);
      const f = new FormData();
      f.append('face', JSON.stringify(t.face));
      f.append('photo', new Blob([new Uint8Array(t.photo)], { type: 'image/jpeg' }), 'me.jpg');
      const r = await api(w, '/api/people/me/photos', { method: 'POST', body: f });
      ids.push((await r.json()).id);
    }
    const start = await json(creator, '/api/posters', 'POST', {
      templateKey: 'sageit-green-blue',
      participants: [
        { userId: A.id, photoId: ids[0], slot: 'cut-left' },
        { userId: B.id, photoId: ids[1], slot: 'cut-right' },
      ],
    });
    expect(start.status).toBe(202);
    for (let i = 0; i < 100 && (await json(creator, `/api/posters/${start.body.id}`)).body.status === 'RUNNING'; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    // Not shared yet → participants can't open it.
    expect((await json(A, `/api/posters/${start.body.id}`)).status).toBe(404);
    expect((await json(creator, `/api/posters/${start.body.id}/save-creation`, 'POST')).status).toBe(201);
    await until(() => notifs(A, 'POSTER_SHARED').length === 1 && notifs(B, 'POSTER_SHARED').length === 1);
    const n = notifs(A, 'POSTER_SHARED')[0].data.notification;
    expect(n.link).toBe(`/posters/${start.body.id}`);
    expect(n.data.Recognition).toContain('Work Anniversary');
    const view = await json(A, `/api/posters/${start.body.id}`);
    expect(view.status).toBe(200);
    expect(view.body.mine).toBe(false);
    expect((await api(A, `/api/posters/${start.body.id}/image`)).status).toBe(200);
    // Participants can view, but not email/save/delete the Creator's poster.
    expect((await api(A, `/api/posters/${start.body.id}`, { method: 'DELETE' })).status).toBe(404);
    // Someone not in it still can't.
    const other = await newEmployee('outsider');
    const o = await login(other.email, other.password);
    expect((await fetch(`${base}/api/posters/${start.body.id}`, { headers: { cookie: o.cookie } })).status).toBe(404);
    // Saving again doesn't notify again.
    await json(creator, `/api/posters/${start.body.id}/save-creation`, 'POST');
    await new Promise((r) => setTimeout(r, 150));
    expect(notifs(A, 'POSTER_SHARED')).toHaveLength(1);
    expect(notifs(creator, 'POSTER_SHARED')).toHaveLength(0);
  });
});

describe('Notification center: persistence, read state, isolation', () => {
  it('unread notifications persist; marking read updates counts and other tabs', async () => {
    const list = await json(A, '/api/notifications');
    const unread = list.body.unread;
    expect(unread).toBeGreaterThanOrEqual(2);
    expect(list.body.items.every((x: any) => x.readAt === null)).toBe(true);
    const first = list.body.items[0];
    const r = await json(A, '/api/notifications/read', 'POST', { ids: [first.id] });
    expect(r.body.unread).toBe(unread - 1);
    await until(() => A.live.events.some((e) => e.event === 'read' && e.data.unread === unread - 1));
    // Still read after "refresh".
    expect((await json(A, '/api/notifications')).body.items.find((x: any) => x.id === first.id).readAt).not.toBeNull();
    expect((await json(A, '/api/notifications?category=poster')).body.items.every((x: any) => x.category === 'poster')).toBe(true);
    expect((await json(A, '/api/notifications/read-all', 'POST')).body.unread).toBe(0);
  });

  it("users can't read or mark anyone else's notifications", async () => {
    const bItem = (await json(B, '/api/notifications')).body.items[0];
    const r = await json(A, '/api/notifications/read', 'POST', { ids: [bItem.id] });
    expect(r.body.updated).toBe(0);
    expect((await json(B, '/api/notifications')).body.items[0].readAt).toBeNull();
    const aIds = new Set((await json(A, '/api/notifications?take=100')).body.items.map((x: any) => x.id));
    expect(aIds.has(bItem.id)).toBe(false);
    expect((await fetch(`${base}/api/notifications/stream`)).status).toBe(401);
  });
});
