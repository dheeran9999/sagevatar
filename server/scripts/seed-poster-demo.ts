/**
 * DEV ONLY: adds six clearly-labelled test employees ("Test Portrait A" … "F") with SYNTHETIC
 * test portraits (drawn faces, not real people) so the group-poster workflow can be tried
 * end to end. Re-runnable. `--remove` deletes them again (and their photos).
 *
 *   npx tsx --env-file=.env scripts/seed-poster-demo.ts [--remove]
 */
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { loadConfig } from '../src/config.js';
import { saveFile, makeThumbnail } from '../src/lib/images.js';
import { removeKeys } from '../src/lib/library-storage.js';
import { testPortrait } from '../tests/portraits.js';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to add demo people in production.');
  process.exit(1);
}
const prisma = new PrismaClient();
const config = loadConfig();
const EMAIL = (i: number) => `test-portrait-${String.fromCharCode(97 + i)}@sageavatar.local`;

async function main() {
  const creator = await prisma.user.findFirstOrThrow({ where: { roleCode: 'CREATOR' } });
  if (process.argv.includes('--remove')) {
    for (let i = 0; i < 6; i++) {
      const u = await prisma.user.findUnique({ where: { email: EMAIL(i) }, include: { employeePhotos: true } });
      if (!u) continue;
      await removeKeys(config, u.employeePhotos.flatMap((p) => [p.fileKey, p.thumbKey, p.maskKey]));
      await prisma.user.delete({ where: { id: u.id } });
    }
    console.log('Removed the test portrait employees.');
    return;
  }
  for (let i = 0; i < 6; i++) {
    const t = await testPortrait(i);
    const u = await prisma.user.upsert({
      where: { email: EMAIL(i) },
      update: {},
      create: {
        email: EMAIL(i),
        name: `Test Portrait ${t.label}`,
        roleCode: 'EMPLOYEE',
        employeeCode: `TEST-${100 + i}`,
        emailVerifiedAt: new Date(),
      },
    });
    if (await prisma.employeePhoto.count({ where: { userId: u.id, isActive: true } })) continue;
    const dir = path.join(config.privateStorage, 'people', u.id);
    const id = `demo-${i}-${Date.now()}`;
    await saveFile(dir, `${id}.jpg`, t.photo);
    await saveFile(dir, `${id}-thumb.png`, await makeThumbnail(t.photo, 320));
    await saveFile(dir, `${id}-mask.png`, t.mask);
    await prisma.employeePhoto.create({
      data: {
        userId: u.id,
        uploadedById: creator.id,
        fileKey: `people/${u.id}/${id}.jpg`,
        thumbKey: `people/${u.id}/${id}-thumb.png`,
        maskKey: `people/${u.id}/${id}-mask.png`,
        mimeType: 'image/jpeg',
        width: 720,
        height: 900,
        sizeBytes: t.photo.length,
        sha256: 'synthetic-test-portrait',
        face: t.face,
        faceSource: 'manual',
        isPrimary: true,
        consentBasis: 'CREATOR_CONFIRMED',
        consentConfirmedAt: new Date(),
        shareWithColleagues: false,
      },
    });
  }
  console.log('Added 6 test portrait employees (Test Portrait A–F, Employee IDs TEST-100…105).');
}

main().finally(() => prisma.$disconnect());
