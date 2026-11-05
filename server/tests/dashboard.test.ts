import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import request from 'supertest';
import { prisma, H, CREATOR, loginAs, newEmployee, jpeg } from './helpers.js';

afterAll(() => prisma.$disconnect());

type Agent = ReturnType<typeof request.agent>;
let creator: Agent;
let emp: Awaited<ReturnType<typeof newEmployee>>;

beforeAll(async () => {
  creator = await loginAs(CREATOR);
  emp = await newEmployee('dash-emp');
  // Some activity: a saved photo and an event assignment.
  await emp.agent
    .post('/api/creations')
    .set(H)
    .field('source', 'UPLOAD')
    .field('layout', '{}')
    .attach('photo', await jpeg(300, 300), 'p.jpg')
    .attach('result', await jpeg(300, 300), 'r.jpg');
  const day = new Date(Date.now() + 4 * 86400_000).toISOString().slice(0, 10);
  const ev = await creator.post('/api/creator/events').set(H).send({
    name: 'Dashboard Day', eventDate: day, startTime: '10:00', endTime: '12:00', timezoneOffset: 0, location: 'HQ', status: 'UPCOMING',
  });
  await creator.post(`/api/creator/events/${ev.body.id}/assignments`).set(H).send({ userIds: [emp.user.id] });
});

describe('Creator Dashboard', () => {
  it('returns all ten counts and the recent activity feeds', async () => {
    const r = await creator.get('/api/creator/dashboard');
    expect(r.status).toBe(200);
    for (const k of [
      'totalEmployees', 'activeEmployees', 'avatarAssets', 'aiGenerated', 'photoCreations',
      'totalEvents', 'activeEvents', 'upcomingEvents', 'eventPhotos', 'recognitionPosters',
    ]) {
      expect(typeof r.body.stats[k], k).toBe('number');
    }
    expect(r.body.stats.totalEmployees).toBeGreaterThanOrEqual(r.body.stats.activeEmployees);
    expect(r.body.recent.employees.some((u: { id: string }) => u.id === emp.user.id)).toBe(true);
    expect(r.body.recent.events[0].name).toBe('Dashboard Day');
    expect(r.body.recent.creations[0]).toMatchObject({ owner: { id: emp.user.id }, link: expect.stringMatching(/^\/creator\/creations\//) });
    expect(r.body.recent.eventActivity.some((a: { event: string }) => a.event === 'Dashboard Day')).toBe(true);
    for (const k of ['posters', 'avatars']) expect(Array.isArray(r.body.recent[k])).toBe(true);
  });

  it('is Creator-only', async () => {
    expect((await emp.agent.get('/api/creator/dashboard')).status).toBe(403);
  });
});

describe('Employee management', () => {
  it('searches by name or Employee ID and shows profile, activity and assignments', async () => {
    expect((await creator.patch(`/api/creator/users/${emp.user.id}`).set(H).send({ employeeCode: 'sage-777', name: 'Dash Employee' })).status).toBe(200);
    const byId = await creator.get('/api/creator/users?q=SAGE-777');
    expect(byId.body.map((u: { id: string }) => u.id)).toEqual([emp.user.id]);
    expect(byId.body[0]).toMatchObject({ name: 'Dash Employee', employeeCode: 'SAGE-777', counts: { creations: 1, events: 1 } });
    const p = await creator.get(`/api/creator/users/${emp.user.id}/profile`);
    expect(p.status).toBe(200);
    expect(p.body.creations).toHaveLength(1);
    expect(p.body.assignments[0]).toMatchObject({ name: 'Dashboard Day', status: 'UPCOMING' });
  });

  it('never lets a Creator grant roles or edit other Creators', async () => {
    expect((await creator.patch(`/api/creator/users/${emp.user.id}`).set(H).send({ role: 'CREATOR' })).status).toBe(400);
    expect((await creator.patch(`/api/creator/users/${emp.user.id}`).set(H).send({ roleCode: 'CREATOR' })).status).toBe(400);
    const me = await prisma.user.findFirstOrThrow({ where: { roleCode: 'CREATOR' } });
    expect((await creator.patch(`/api/creator/users/${me.id}`).set(H).send({ name: 'X' })).status).toBe(403);
    expect((await creator.post('/api/creator/users/invite').set(H).send({ email: 'x@test.local', name: 'X', role: 'CREATOR' })).status).toBe(400);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: emp.user.id } })).roleCode).toBe('EMPLOYEE');
  });

  it('rejects duplicate Employee IDs', async () => {
    const other = await newEmployee('dash-other');
    const r = await creator.patch(`/api/creator/users/${other.user.id}`).set(H).send({ employeeCode: 'SAGE-777' });
    expect(r.status).toBe(409);
  });

  it('employees cannot reach Creator APIs or change their own role', async () => {
    for (const path of ['/api/creator/users', `/api/creator/users/${emp.user.id}/profile`, '/api/creator/analytics', '/api/creator/audit']) {
      expect((await emp.agent.get(path)).status, path).toBe(403);
    }
    expect((await emp.agent.patch('/api/auth/profile').set(H).send({ role: 'CREATOR' })).status).toBe(400);
    expect((await emp.agent.patch('/api/auth/profile').set(H).send({ name: 'Renamed', role: 'CREATOR' })).status).toBe(400);
    const ok = await emp.agent.patch('/api/auth/profile').set(H).send({ name: 'Renamed Employee' });
    expect(ok.status).toBe(200);
    expect(ok.body.user).toMatchObject({ name: 'Renamed Employee', role: 'EMPLOYEE' });
    expect((await emp.agent.get('/api/auth/me')).body.user.permissions).not.toContain('employee.manage');
  });
});
