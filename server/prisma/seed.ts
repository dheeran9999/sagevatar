/**
 * Development seed: the two roles, the four avatar types, one CREATOR, one EMPLOYEE,
 * four categories and the original starter collection (12 characters × face/half/full
 * + 8 backgrounds = 44 avatars), stored in PRIVATE storage with source/licence records.
 * Safe to re-run. Refuses to run in production — provision Creators with
 * `npm run creator:provision` instead.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient, type Prisma } from '@prisma/client';
import { AVATAR_TYPES, type AvatarType } from '../src/lib/domain.js';
import { hashPassword } from '../src/lib/security.js';
import { loadConfig } from '../src/config.js';
import {
  libraryDir,
  libraryKey,
  normalizeTags,
  relocateLegacyLibraryFiles,
  removeKeys,
} from '../src/lib/library-storage.js';
import {
  CHARACTERS,
  SCENES,
  renderCharacter,
  renderScene,
  type CategorySlug,
} from './starter-art.js';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed demo accounts in production.');
  process.exit(1);
}

const prisma = new PrismaClient();

const CATEGORIES: { slug: CategorySlug; name: string; sortOrder: number }[] = [
  { slug: 'anime', name: 'Anime', sortOrder: 1 },
  { slug: 'superhero', name: 'Superhero', sortOrder: 2 },
  { slug: 'business', name: 'Business', sortOrder: 3 },
  { slug: 'corporate', name: 'Corporate', sortOrder: 4 },
];

/** Earlier seeds combined these; rename only if a Creator hasn't renamed it since. */
const LEGACY_NAMES: Record<string, string> = { business: 'Business & Corporate' };

const TYPE_INFO: Record<AvatarType, { name: string; description: string; sortOrder: number }> = {
  FACE: { name: 'Face', description: 'Head-only avatar placed near the person.', sortOrder: 1 },
  HALF_BODY: {
    name: 'Half Body',
    description: 'Waist-up avatar placed beside the person.',
    sortOrder: 2,
  },
  FULL_BODY: {
    name: 'Full Body',
    description: 'Full-length avatar, can stand behind the person.',
    sortOrder: 3,
  },
  BACKGROUND: {
    name: 'Background',
    description: 'Scene that replaces the photo background.',
    sortOrder: 4,
  },
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} in server/.env`);
  return v;
}

async function upsertUser(
  email: string,
  password: string,
  name: string,
  roleCode: 'CREATOR' | 'EMPLOYEE',
) {
  const passwordHash = await hashPassword(password);
  return prisma.user.upsert({
    where: { email },
    update: {
      name,
      roleCode,
      passwordHash,
      isActive: true,
      failedLoginCount: 0,
      lockedUntil: null,
      emailVerifiedAt: new Date(),
    },
    create: { email, name, roleCode, passwordHash, emailVerifiedAt: new Date() },
  });
}

async function main() {
  await prisma.role.upsert({
    where: { code: 'CREATOR' },
    update: {},
    create: {
      code: 'CREATOR',
      name: 'Creator',
      description: 'Manages the avatar library, templates and employee accounts.',
    },
  });
  await prisma.role.upsert({
    where: { code: 'EMPLOYEE' },
    update: {},
    create: {
      code: 'EMPLOYEE',
      name: 'Employee',
      description: 'Creates, downloads and emails personal photo compositions.',
    },
  });

  const creator = await upsertUser(
    requireEnv('SEED_CREATOR_EMAIL').toLowerCase(),
    requireEnv('SEED_CREATOR_PASSWORD'),
    'Studio Creator',
    'CREATOR',
  );
  await upsertUser(
    requireEnv('SEED_EMPLOYEE_EMAIL').toLowerCase(),
    requireEnv('SEED_EMPLOYEE_PASSWORD'),
    'Demo Employee',
    'EMPLOYEE',
  );

  const config = loadConfig(process.env);
  relocateLegacyLibraryFiles(config);
  const avatarDir = libraryDir(config, 'avatars');
  mkdirSync(avatarDir, { recursive: true });

  const categories: Record<string, string> = {};
  for (const c of CATEGORIES) {
    let category = await prisma.avatarCategory.upsert({
      where: { slug: c.slug },
      update: {},
      create: c,
    });
    if (LEGACY_NAMES[c.slug] && category.name === LEGACY_NAMES[c.slug]) {
      category = await prisma.avatarCategory.update({
        where: { id: category.id },
        data: { name: c.name },
      });
    }
    categories[c.slug] = category.id;
  }

  // Avatar types (placements from the starter frames).
  for (const type of AVATAR_TYPES) {
    const placement =
      type === 'BACKGROUND'
        ? renderScene(SCENES[0]).placement
        : renderCharacter(CHARACTERS[0], type).placement;
    await prisma.avatarType.upsert({
      where: { code: type },
      update: {},
      create: { code: type, ...TYPE_INFO[type], defaultPlacement: { ...placement } },
    });
  }

  const license = {
    sourceType: 'ORIGINAL' as const,
    sourceName: 'SageAvatar Studio starter collection',
    licenseName: 'Original work — SageIT internal use',
    licenseNotes:
      'Generated in code for this project (prisma/starter-art.ts). Superhero characters are original, genre-inspired designs — no franchise characters or artwork.',
    rightsConfirmedAt: new Date(),
    rightsConfirmedById: creator.id,
  };

  const upsertAvatar = async (
    fileName: string,
    svg: string,
    data: Omit<
      Prisma.AvatarUncheckedCreateInput,
      'fileKey' | 'thumbKey' | 'createdById' | 'mimeType' | 'isAnimated'
    >,
  ) => {
    writeFileSync(path.join(avatarDir, fileName), svg, 'utf8');
    const fileKey = libraryKey('avatars', fileName);
    const fields = {
      ...data,
      ...license,
      fileKey,
      thumbKey: null,
      mimeType: 'image/svg+xml',
      isAnimated: true,
      sizeBytes: Buffer.byteLength(svg),
    };
    const existing = await prisma.avatar.findUnique({ where: { fileKey } });
    // Re-running refreshes the art and details but never re-activates something a Creator switched off.
    if (existing)
      await prisma.avatar.update({
        where: { id: existing.id },
        data: { ...fields, isActive: existing.isActive },
      });
    else
      await prisma.avatar.create({ data: { ...fields, isActive: true, createdById: creator.id } });
  };

  let count = 0;
  const TYPE_LABEL: Record<Exclude<AvatarType, 'BACKGROUND'>, string> = {
    FACE: 'Face',
    HALF_BODY: 'Half Body',
    FULL_BODY: 'Full Body',
  };
  for (const ch of CHARACTERS) {
    for (const type of ['FACE', 'HALF_BODY', 'FULL_BODY'] as const) {
      const art = renderCharacter(ch, type);
      await upsertAvatar(`${ch.slug}-${type.toLowerCase()}.svg`, art.svg, {
        name: `${ch.name} · ${TYPE_LABEL[type]}`,
        description: ch.description,
        tags: normalizeTags([...ch.tags, ch.expression, ch.pose, ch.outfit.kind]),
        style: ch.style,
        typeCode: type,
        width: art.width,
        height: art.height,
        defaultPlacement: { ...art.placement },
        categoryId: categories[ch.category],
      });
      count++;
    }
  }
  for (const sc of SCENES) {
    const art = renderScene(sc);
    await upsertAvatar(`scene-${sc.slug}.svg`, art.svg, {
      name: sc.name,
      description: sc.description,
      tags: normalizeTags([...sc.tags, 'background']),
      style: sc.style,
      typeCode: 'BACKGROUND',
      width: art.width,
      height: art.height,
      defaultPlacement: { ...art.placement },
      categoryId: categories[sc.category],
    });
    count++;
  }

  // Retire the first-generation placeholders: remove if unused, otherwise keep them deactivated.
  const legacyKeys = CATEGORIES.flatMap((c) =>
    AVATAR_TYPES.map((t) => libraryKey('avatars', `${c.slug}-${t.toLowerCase()}.svg`)),
  );
  const legacy = await prisma.avatar.findMany({
    where: { fileKey: { in: legacyKeys } },
    include: { _count: { select: { creations: true } } },
  });
  let retired = 0;
  for (const a of legacy) {
    if (a._count.creations === 0) {
      await prisma.avatar.delete({ where: { id: a.id } });
      await removeKeys(config, [a.fileKey, a.thumbKey]);
    } else {
      await prisma.avatar.update({ where: { id: a.id }, data: { isActive: false } });
    }
    retired++;
  }

  console.log(
    `Seeded 2 users, ${CATEGORIES.length} categories, ${count} starter avatars${retired ? `, retired ${retired} old placeholders` : ''} → ${avatarDir}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
