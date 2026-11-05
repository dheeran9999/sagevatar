import { randomUUID } from 'node:crypto';
import request from 'supertest';
import sharp from 'sharp';
import { PrismaClient } from '@prisma/client';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/lib/security.js';

export const config = loadConfig(process.env);
export const prisma = new PrismaClient();
export const app = createApp(prisma, config);

/** Header every state-changing request must carry (CSRF guard). */
export const H = { 'x-sageavatar-request': '1' };

export const CREATOR = {
  email: process.env.SEED_CREATOR_EMAIL!,
  password: process.env.SEED_CREATOR_PASSWORD!,
};
export const EMPLOYEE = {
  email: process.env.SEED_EMPLOYEE_EMAIL!,
  password: process.env.SEED_EMPLOYEE_PASSWORD!,
};

export async function loginAs(creds: { email: string; password: string }) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').set(H).send(creds);
  if (res.status !== 200) throw new Error(`login failed for ${creds.email}: ${res.status}`);
  return agent;
}

/** Creates a fresh, active employee and returns a signed-in agent for them. */
export async function newEmployee(label = 'emp') {
  const email = `${label}-${randomUUID().slice(0, 8)}@test.local`;
  const password = 'Employee-pass-123';
  const user = await prisma.user.create({
    data: {
      email,
      name: label,
      roleCode: 'EMPLOYEE',
      passwordHash: await hashPassword(password),
      emailVerifiedAt: new Date(),
    },
  });
  return { user, email, password, agent: await loginAs({ email, password }) };
}

export function png(width = 64, height = 64, color = '#14b8a6') {
  return sharp({ create: { width, height, channels: 4, background: color } })
    .png()
    .toBuffer();
}

export function jpeg(width = 64, height = 64) {
  return sharp({ create: { width, height, channels: 3, background: '#7c5cff' } })
    .jpeg()
    .toBuffer();
}

export const svg = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><script>alert(1)</script></svg>',
);

/** A transparent PNG with an opaque figure in the middle — a valid character cut-out. */
export function pngCutout(width = 120, height = 160) {
  return sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      {
        input: {
          create: {
            width: Math.round(width / 2),
            height: Math.round(height / 2),
            channels: 4,
            background: '#7c5cff',
          },
        },
        gravity: 'centre',
      },
    ])
    .png()
    .toBuffer();
}

export const LICENSE = {
  sourceType: 'IN_HOUSE',
  sourceName: 'SageIT Design',
  licenseName: 'Internal work',
  rightsConfirmed: 'true',
};

/** Multipart avatar upload with sensible licence defaults (override any field). */
export function uploadAvatar(
  agent: ReturnType<typeof request.agent>,
  fields: Record<string, string>,
  file: Buffer,
  filename = 'avatar.png',
) {
  let r = agent.post('/api/creator/library/avatars').set(H);
  for (const [k, v] of Object.entries({ ...LICENSE, ...fields })) r = r.field(k, v);
  return r.attach('file', file, filename);
}
