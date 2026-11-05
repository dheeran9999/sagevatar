/**
 * Secure, out-of-band Creator provisioning. There is deliberately no API or UI that
 * can create a Creator or change anyone's role — this script needs shell access to
 * the server and its database.
 *
 *   npm run creator:provision -w server -- --email jane@sageitinc.com --name "Jane Doe"
 *
 * Prints a one-time setup link (valid INVITE_TTL_HOURS). The person sets their own
 * password; no password ever passes through the operator.
 */
import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { loadConfig } from '../src/config.js';
import { createOneTimeToken } from '../src/lib/security.js';

const { values } = parseArgs({
  options: { email: { type: 'string' }, name: { type: 'string' } },
});

const input = z
  .object({
    email: z.string().trim().toLowerCase().email(),
    name: z.string().trim().min(1).max(100),
  })
  .safeParse(values);

if (!input.success) {
  console.error(
    'Usage: npm run creator:provision -w server -- --email <email> --name "<full name>"',
  );
  process.exit(1);
}

const config = loadConfig();
const prisma = new PrismaClient();

try {
  const existing = await prisma.user.findUnique({ where: { email: input.data.email } });
  if (existing) {
    console.error(
      `An account for ${existing.email} already exists (${existing.roleCode}). ` +
        'Roles are never changed in place; use a different email address.',
    );
    process.exit(1);
  }
  const { raw, hash } = createOneTimeToken();
  const user = await prisma.user.create({
    data: {
      email: input.data.email,
      name: input.data.name,
      roleCode: 'CREATOR',
      inviteTokenHash: hash,
      inviteExpiresAt: new Date(Date.now() + config.INVITE_TTL_HOURS * 3600_000),
    },
  });
  await prisma.auditLog.create({
    data: {
      action: 'CREATOR_PROVISIONED',
      entityType: 'User',
      entityId: user.id,
      details: { email: user.email, via: 'cli' },
    },
  });
  console.log(`Creator account created for ${user.email}.`);
  console.log(`Send this one-time setup link privately (expires in ${config.INVITE_TTL_HOURS}h):`);
  console.log(`  ${config.CLIENT_ORIGIN}/accept-invite#${raw}`);
} finally {
  await prisma.$disconnect();
}
