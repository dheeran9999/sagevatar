import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { app, prisma, H, newEmployee } from './helpers.js';
import { DEFAULT_PREFERENCES, readPreferences } from '../src/lib/preferences.js';

afterAll(() => prisma.$disconnect());

const custom = {
  theme: 'light',
  accent: 'emerald-green',
  glass: 'strong',
  animations: false,
  motion: 'reduced',
  backgroundEffects: false,
  density: 'compact',
};

describe('appearance preferences', () => {
  it('requires a session', async () => {
    expect((await request(app).get('/api/auth/preferences')).status).toBe(401);
    expect((await request(app).put('/api/auth/preferences').set(H).send(custom)).status).toBe(401);
  });

  it('returns defaults, then persists per user', async () => {
    const a = await newEmployee('pref-a');
    const b = await newEmployee('pref-b');

    const first = await a.agent.get('/api/auth/preferences');
    expect(first.status).toBe(200);
    expect(first.body.preferences).toEqual(DEFAULT_PREFERENCES);

    const saved = await a.agent.put('/api/auth/preferences').set(H).send(custom);
    expect(saved.status).toBe(200);
    // An older client that doesn't send `notifications` still saves; the group keeps its defaults.
    expect((await a.agent.get('/api/auth/preferences')).body.preferences).toEqual({
      ...custom,
      notifications: DEFAULT_PREFERENCES.notifications,
    });

    // Another user's settings are untouched.
    expect((await b.agent.get('/api/auth/preferences')).body.preferences).toEqual(
      DEFAULT_PREFERENCES,
    );
  });

  it('rejects unknown values and extra fields', async () => {
    const { agent } = await newEmployee('pref-bad');
    const bad = await agent
      .put('/api/auth/preferences')
      .set(H)
      .send({ ...custom, accent: 'neon-green' });
    expect(bad.status).toBe(400);
    const extra = await agent
      .put('/api/auth/preferences')
      .set(H)
      .send({ ...custom, role: 'CREATOR' });
    expect(extra.status).toBe(400);
    const me = await agent.get('/api/auth/me');
    expect(me.body.user.role).toBe('EMPLOYEE');
  });

  it('needs the CSRF header to save', async () => {
    const { agent } = await newEmployee('pref-csrf');
    expect((await agent.put('/api/auth/preferences').send(custom)).status).toBe(403);
  });

  it('keeps valid stored fields when others are corrupt', () => {
    expect(readPreferences('{"theme":"light","accent":"nope"}')).toEqual({
      ...DEFAULT_PREFERENCES,
      theme: 'light',
    });
    expect(readPreferences('not json')).toEqual(DEFAULT_PREFERENCES);
  });
});
