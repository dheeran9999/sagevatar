import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';
import { createAiProviders } from '../src/lib/ai/openai.js';
import { createMailer } from '../src/lib/mailer.js';
import type { AppConfig } from '../src/config.js';
import { app as plainApp, config, prisma, H, CREATOR, loginAs, newEmployee } from './helpers.js';

/**
 * A local server that speaks the OpenAI Images + Embeddings API, so the real HTTP client code
 * is exercised end to end without a key or network. (Real OpenAI isn't called in tests.)
 */
interface Seen {
  path: string;
  auth: string | undefined;
  body: Record<string, unknown>;
}
const seen: Seen[] = [];
let stub: Server;
let stubUrl = '';

// Tiny "embedding": words map to concept dimensions, so unrelated wording can still match.
const CONCEPTS: Record<string, string> = {
  valiant: 'hero',
  crusader: 'hero',
  hero: 'hero',
  superhero: 'hero',
  cape: 'hero',
  mask: 'hero',
  executive: 'office',
  office: 'office',
  business: 'office',
  suit: 'office',
  professional: 'office',
};
function embed(text: string) {
  const v = new Array(32).fill(0);
  for (const w of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    const key = CONCEPTS[w] ?? w;
    let h = 0;
    for (const c of key) h = (h * 31 + c.charCodeAt(0)) % 32;
    v[h] += CONCEPTS[w] ? 3 : 0.2;
  }
  return v;
}

const pngFor = (size: string, transparent: boolean) => {
  const [w, h] = size.split('x').map((n) => Math.round(Number(n) / 16));
  const base = sharp({
    create: {
      width: w,
      height: h,
      channels: 4,
      background: transparent ? { r: 0, g: 0, b: 0, alpha: 0 } : '#3b6cf6',
    },
  });
  return (
    transparent
      ? base.composite([
          {
            input: {
              create: {
                width: Math.round(w / 2),
                height: Math.round(h / 2),
                channels: 4,
                background: '#e11d48',
              },
            },
            gravity: 'center',
          },
        ])
      : base
  )
    .png()
    .toBuffer();
};

beforeAll(async () => {
  stub = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      const body = raw ? JSON.parse(raw) : {};
      seen.push({ path: req.url ?? '', auth: req.headers.authorization, body });
      const send = (status: number, json: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(json));
      };
      if (req.headers.authorization !== 'Bearer test-key')
        return send(401, { error: { message: 'bad key' } });
      if (req.url === '/v1/embeddings') {
        const input = body.input as string[];
        return send(200, { data: input.map((t, index) => ({ index, embedding: embed(t) })) });
      }
      if (req.url === '/v1/images/generations') {
        const prompt = String(body.prompt);
        if (prompt.includes('FAILME'))
          return send(500, { error: { message: 'upstream exploded' } });
        if (prompt.includes('BLOCKME'))
          return send(400, {
            error: { message: 'Rejected by safety system', code: 'moderation_blocked' },
          });
        const png = await pngFor(String(body.size), body.background === 'transparent');
        return send(200, { data: [{ b64_json: png.toString('base64') }] });
      }
      send(404, {});
    });
  });
  await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r));
  stubUrl = `http://127.0.0.1:${(stub.address() as AddressInfo).port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((r) => stub.close(() => r()));
  await prisma.$disconnect();
});

const aiConfig = (over: Partial<AppConfig> = {}): AppConfig => ({
  ...config,
  OPENAI_API_KEY: 'test-key',
  OPENAI_BASE_URL: stubUrl,
  aiConfigured: true,
  ...over,
});
const aiApp = (over: Partial<AppConfig> = {}) => {
  const c = aiConfig(over);
  return createApp(prisma, c, createMailer(c), createAiProviders(c));
};

async function agentFor(
  app: ReturnType<typeof createApp>,
  creds: { email: string; password: string },
) {
  const a = request.agent(app);
  const r = await a.post('/api/auth/login').set(H).send(creds);
  expect(r.status).toBe(200);
  return a;
}

async function waitForJob(agent: request.Agent, id: string) {
  for (let i = 0; i < 100; i++) {
    const r = await agent.get(`/api/ai/generations/${id}`);
    if (r.body.status !== 'RUNNING') return r.body;
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error('job did not finish');
}

const GOOD = {
  prompt: 'an original futuristic superhero in a blue and silver suit',
  style: 'SUPERHERO',
  type: 'FULL_BODY',
  count: 2,
};

describe('without an AI key', () => {
  it('reports generation as unavailable but keyword search still works', async () => {
    const { agent } = await newEmployee('noai');
    const status = await agent.get('/api/ai/status');
    expect(status.body.generation.enabled).toBe(false);
    expect(status.body.semanticSearch.enabled).toBe(false);

    const gen = await agent.post('/api/ai/generations').set(H).send(GOOD);
    expect(gen.status).toBe(503);
    expect(gen.body.code).toBe('AI_UNAVAILABLE');

    const s = await agent.get('/api/catalog/search').query({ q: 'superhero' });
    expect(s.status).toBe(200);
    expect(s.body.mode).toBe('keyword');
    expect(s.body.results.length).toBeGreaterThan(0);
    // Best matches first: every superhero ranks above anything else.
    const slugs: string[] = s.body.results.map(
      (r: { category: { slug: string } }) => r.category.slug,
    );
    const firstOther = slugs.findIndex((x) => x !== 'superhero');
    expect(slugs.slice(0, 9).every((x) => x === 'superhero')).toBe(true);
    expect(firstOther === -1 || slugs.slice(firstOther).every((x) => x !== 'superhero')).toBe(true);
  });

  it('returns name, category, type and source — never embeddings', async () => {
    const { agent } = await newEmployee('dto');
    const s = await agent.get('/api/catalog/search').query({ q: 'business professional' });
    const first = s.body.results[0];
    expect(first.category.slug).toBe('business');
    expect(first).toMatchObject({ name: expect.any(String), type: expect.any(String) });
    expect(first.source).toMatchObject({ type: 'ORIGINAL', name: expect.any(String) });
    expect(first.fileUrl).toMatch(/^\/api\/assets\/avatars\//);
    expect(JSON.stringify(s.body)).not.toMatch(/embedding/);
  });

  it('explains rights for protected characters and offers original alternatives', async () => {
    const { agent } = await newEmployee('rights');
    for (const q of ['Batman', 'spider-man']) {
      const s = await agent.get('/api/catalog/search').query({ q });
      expect(s.body.notice.kind).toBe('rights');
      expect(s.body.notice.message).toMatch(/usage rights/);
      expect(s.body.results.length).toBeGreaterThan(0);
      expect(
        s.body.results.every((r: { source: { type: string } }) => r.source.type !== 'LICENSED'),
      ).toBe(true);
    }
  });

  it('requires a session', async () => {
    expect((await request(plainApp).get('/api/catalog/search').query({ q: 'x' })).status).toBe(401);
    expect((await request(plainApp).get('/api/ai/status')).status).toBe(401);
  });
});

describe('semantic search (stub OpenAI embeddings)', () => {
  it('finds avatars by meaning and caches library embeddings', async () => {
    const app = aiApp();
    const { email, password } = await newEmployee('sem');
    const agent = await agentFor(app, { email, password });

    seen.length = 0;
    const s = await agent.get('/api/catalog/search').query({ q: 'valiant crusader' });
    expect(s.status).toBe(200);
    expect(s.body.mode).toBe('semantic');
    const top = s.body.results[0];
    expect(top.category.slug).toBe('superhero');
    expect(top.match.type).toBe('semantic');
    expect(seen.every((x) => x.auth === 'Bearer test-key')).toBe(true);

    const stored = await prisma.avatar.count({ where: { embedding: { not: null } } });
    expect(stored).toBeGreaterThan(0);

    // Second search: only the (new) query is embedded, not the library again.
    seen.length = 0;
    await agent.get('/api/catalog/search').query({ q: 'office executive' });
    const inputs = seen.flatMap((x) => (x.body.input as string[]) ?? []);
    expect(inputs).toEqual(['office executive']);
  });

  it('falls back to keywords if the embedding service fails', async () => {
    const app = aiApp({ OPENAI_API_KEY: 'wrong-key' });
    const { email, password } = await newEmployee('semfail');
    const agent = await agentFor(app, { email, password });
    const s = await agent.get('/api/catalog/search').query({ q: 'superhero' });
    expect(s.status).toBe(200);
    expect(s.body.mode).toBe('keyword');
    expect(s.body.semanticError).toMatch(/API key/);
    expect(s.body.results.length).toBeGreaterThan(0);
  });
});

describe('AI generation (stub OpenAI images)', () => {
  it('generates real images with live progress, private to the owner', async () => {
    const app = aiApp();
    const owner = await newEmployee('gen');
    const other = await newEmployee('peek');
    const a = await agentFor(app, owner);
    const b = await agentFor(app, other);

    const status = await a.get('/api/ai/status');
    expect(status.body.generation).toMatchObject({
      enabled: true,
      provider: 'openai',
      model: 'gpt-image-1',
    });
    expect(JSON.stringify(status.body)).not.toContain('test-key');

    seen.length = 0;
    const started = await a.post('/api/ai/generations').set(H).send(GOOD);
    expect(started.status).toBe(202);
    expect(started.body).toMatchObject({ status: 'RUNNING', count: 2 });

    const job = await waitForJob(a, started.body.id);
    expect(job).toMatchObject({ status: 'SUCCEEDED', completed: 2, failed: 0 });
    expect(job.images).toHaveLength(2);
    expect(job.images[0].source.type).toBe('AI_GENERATED');

    const calls = seen.filter((x) => x.path === '/v1/images/generations');
    expect(calls).toHaveLength(2);
    expect(calls[0].body).toMatchObject({
      model: 'gpt-image-1',
      size: '1024x1536',
      background: 'transparent',
      output_format: 'png',
      n: 1,
    });
    expect(String(calls[0].body.prompt)).toMatch(/full-body standing pose/);
    expect(String(calls[0].body.prompt)).toMatch(
      /does not depict or resemble any existing copyrighted/,
    );

    const file = await a.get(job.images[0].fileUrl);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('image/png');
    const meta = await sharp(file.body).metadata();
    expect(meta.hasAlpha).toBe(true);

    expect((await b.get(job.images[0].fileUrl)).status).toBe(404);
    expect((await b.get(`/api/ai/generations/${job.id}`)).status).toBe(404);
    const creator = await agentFor(app, CREATOR);
    expect((await creator.get(job.images[0].fileUrl)).status).toBe(404);

    const mine = await a.get('/api/ai/images');
    expect(mine.body.map((i: { id: string }) => i.id)).toEqual(
      expect.arrayContaining(job.images.map((i: { id: string }) => i.id)),
    );
    expect((await b.get('/api/ai/images')).body).toEqual([]);
  });

  it('asks for an opaque, landscape image for backgrounds', async () => {
    const app = aiApp();
    const a = await agentFor(app, await newEmployee('bg'));
    seen.length = 0;
    const started = await a.post('/api/ai/generations').set(H).send({
      prompt: 'a bright modern office lobby with plants',
      style: 'CHARACTER_3D',
      type: 'BACKGROUND',
      count: 1,
    });
    const job = await waitForJob(a, started.body.id);
    expect(job.status).toBe('SUCCEEDED');
    expect(seen[0].body).toMatchObject({ size: '1536x1024', background: 'opaque' });
  });

  it('refuses copyrighted characters before calling the AI service', async () => {
    const app = aiApp();
    const a = await agentFor(app, await newEmployee('cr'));
    seen.length = 0;
    const r = await a
      .post('/api/ai/generations')
      .set(H)
      .send({ ...GOOD, prompt: 'Batman flying over the city at night' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/copyrighted character/);
    expect(r.body.error).toMatch(/original/);
    expect(seen).toHaveLength(0);
  });

  it('reports real failures from the AI service', async () => {
    const app = aiApp();
    const a = await agentFor(app, await newEmployee('fail'));
    const failed = await waitForJob(
      a,
      (
        await a
          .post('/api/ai/generations')
          .set(H)
          .send({ ...GOOD, prompt: 'FAILME please', count: 1 })
      ).body.id,
    );
    expect(failed).toMatchObject({ status: 'FAILED', completed: 0, failed: 1 });
    expect(failed.error).toMatch(/upstream exploded/);

    const blocked = await waitForJob(
      a,
      (
        await a
          .post('/api/ai/generations')
          .set(H)
          .send({ ...GOOD, prompt: 'BLOCKME please', count: 1 })
      ).body.id,
    );
    expect(blocked.error).toMatch(/content policy/);
  });

  it('validates input and enforces the daily limit', async () => {
    const app = aiApp({ AI_DAILY_IMAGE_LIMIT: 3 });
    const a = await agentFor(app, await newEmployee('quota'));
    expect(
      (
        await a
          .post('/api/ai/generations')
          .set(H)
          .send({ ...GOOD, prompt: 'short' })
      ).status,
    ).toBe(400);
    expect(
      (
        await a
          .post('/api/ai/generations')
          .set(H)
          .send({ ...GOOD, style: 'PHOTO' })
      ).status,
    ).toBe(400);
    expect(
      (
        await a
          .post('/api/ai/generations')
          .set(H)
          .send({ ...GOOD, count: 9 })
      ).status,
    ).toBe(400);
    expect(
      (
        await a
          .post('/api/ai/generations')
          .set(H)
          .send({ ...GOOD, role: 'CREATOR' })
      ).status,
    ).toBe(400);
    const ok = await a
      .post('/api/ai/generations')
      .set(H)
      .send({ ...GOOD, count: 2 });
    expect(ok.status).toBe(202);
    await waitForJob(a, ok.body.id);
    const over = await a
      .post('/api/ai/generations')
      .set(H)
      .send({ ...GOOD, count: 2 });
    expect(over.status).toBe(429);
  });

  it('can be limited to Creators', async () => {
    const app = aiApp({ AI_EMPLOYEE_GENERATION: false });
    const emp = await agentFor(app, await newEmployee('off'));
    const r = await emp.post('/api/ai/generations').set(H).send(GOOD);
    expect(r.status).toBe(503);
    expect((await emp.get('/api/ai/status')).body.generation.enabled).toBe(false);
    const creator = await agentFor(app, CREATOR);
    expect((await creator.get('/api/ai/status')).body.generation.enabled).toBe(true);
  });
});

describe('publishing AI images to the shared library', () => {
  it('only a Creator, only their own image, once — then everyone can use it', async () => {
    const app = aiApp();
    const creator = await agentFor(app, CREATOR);
    const empCreds = await newEmployee('pub');
    const emp = await agentFor(app, empCreds);
    const category = await prisma.avatarCategory.findUniqueOrThrow({
      where: { slug: 'superhero' },
    });

    const empJob = await waitForJob(
      emp,
      (
        await emp
          .post('/api/ai/generations')
          .set(H)
          .send({ ...GOOD, count: 1 })
      ).body.id,
    );
    const crJob = await waitForJob(
      creator,
      (
        await creator
          .post('/api/ai/generations')
          .set(H)
          .send({ ...GOOD, count: 1 })
      ).body.id,
    );
    const body = { name: 'Silver Comet', categoryId: category.id, tags: ['ai', 'silver'] };

    // Employees cannot touch the shared library.
    expect(
      (await emp.post(`/api/creator/ai-images/${empJob.images[0].id}/publish`).set(H).send(body))
        .status,
    ).toBe(403);
    // Creators cannot publish someone else's private image.
    expect(
      (
        await creator
          .post(`/api/creator/ai-images/${empJob.images[0].id}/publish`)
          .set(H)
          .send(body)
      ).status,
    ).toBe(404);
    // No franchise names.
    expect(
      (
        await creator
          .post(`/api/creator/ai-images/${crJob.images[0].id}/publish`)
          .set(H)
          .send({ ...body, name: 'Iron Man copy' })
      ).status,
    ).toBe(400);

    const pub = await creator
      .post(`/api/creator/ai-images/${crJob.images[0].id}/publish`)
      .set(H)
      .send(body);
    expect(pub.status).toBe(201);
    const again = await creator
      .post(`/api/creator/ai-images/${crJob.images[0].id}/publish`)
      .set(H)
      .send(body);
    expect(again.status).toBe(409);

    const row = await prisma.avatar.findUniqueOrThrow({ where: { id: pub.body.id } });
    expect(row).toMatchObject({
      sourceType: 'AI_GENERATED',
      typeCode: 'FULL_BODY',
      isActive: true,
    });
    expect(row.sourceName).toBe('openai gpt-image-1');
    expect(row.licenseNotes).toContain(GOOD.prompt);

    const catalog = await emp.get('/api/catalog/avatars');
    const listed = catalog.body.find((a: { id: string }) => a.id === pub.body.id);
    expect(listed.source.type).toBe('AI_GENERATED');
    expect((await emp.get(listed.fileUrl)).status).toBe(200);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'AI_AVATAR_PUBLISHED', entityId: pub.body.id },
    });
    expect(audit).not.toBeNull();

    // Leave the shared library as other test files expect it.
    await prisma.avatar.delete({ where: { id: pub.body.id } });
  });

  it('both roles get avatar.generate; only Creators get library.manage', async () => {
    const creator = await loginAs(CREATOR);
    const me = await creator.get('/api/auth/me');
    expect(me.body.user.permissions).toEqual(
      expect.arrayContaining(['avatar.generate', 'library.manage']),
    );
    const { agent } = await newEmployee('perm');
    const emp = await agent.get('/api/auth/me');
    expect(emp.body.user.permissions).toContain('avatar.generate');
    expect(emp.body.user.permissions).not.toContain('library.manage');
  });
});
