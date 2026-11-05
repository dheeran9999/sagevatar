/**
 * Activity notifications. Each one fires only AFTER the thing it reports was saved
 * (never on opening the camera or picking an avatar) and goes only to the right people.
 */
import type { PrismaClient } from '@prisma/client';
import { creatorIds, notify } from './notify.js';

const when = (d: Date) =>
  d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

async function employee(prisma: PrismaClient, userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, employeeCode: true, roleCode: true },
  });
}

async function avatarLabel(prisma: PrismaClient, avatarId: string | null, generatedAvatarId: string | null) {
  if (avatarId) {
    const a = await prisma.avatar.findUnique({
      where: { id: avatarId },
      select: { name: true, category: { select: { name: true } } },
    });
    if (a) return `${a.name} (${a.category.name})`;
  }
  if (generatedAvatarId) {
    const g = await prisma.generatedAvatar.findUnique({
      where: { id: generatedAvatarId },
      select: { job: { select: { prompt: true } } },
    });
    if (g) return `AI-generated: ${g.job.prompt.slice(0, 50)}`;
  }
  return 'No avatar';
}

/**
 * An Employee saved an avatar photograph (personal or in an event) → every Creator is told who,
 * which avatar, which event and when, with a link to view it.
 */
export async function photoCreated(
  prisma: PrismaClient,
  p: {
    userId: string;
    kind: 'personal' | 'event';
    id: string;
    avatarId: string | null;
    generatedAvatarId: string | null;
    createdAt: Date;
    event?: { id: string; name: string; code: string } | null;
  },
) {
  const u = await employee(prisma, p.userId);
  if (!u || u.roleCode !== 'EMPLOYEE') return; // Creators' own work isn't "employee activity"
  const recipients = await creatorIds(prisma);
  const avatar = await avatarLabel(prisma, p.avatarId, p.generatedAvatarId);
  await notify(prisma, recipients, {
    type: 'PHOTO_CREATED',
    title: 'New Employee Photo Created!',
    body: `${u.name} created a new avatar photograph${p.event ? ` in ${p.event.name}` : ''}.`,
    link: p.kind === 'event' ? `/events/${p.event!.id}?photo=${p.id}` : `/creator/creations/${p.id}`,
    eventId: p.event?.id ?? null,
    actorId: u.id,
    data: {
      Employee: u.name,
      'Employee ID': u.employeeCode ?? u.email,
      Activity: 'Created a new avatar photograph',
      Avatar: avatar,
      ...(p.event ? { Event: `${p.event.name} (${p.event.code})` } : {}),
      Created: when(p.createdAt),
    },
    dedupeKey: `${p.kind}-photo:${p.id}`,
  });
}

/** An AI generation job finished → its owner; and Creators see Employees' generation activity. */
export async function aiGenerationFinished(prisma: PrismaClient, jobId: string) {
  const job = await prisma.aiGenerationJob.findUnique({
    where: { id: jobId },
    include: { user: { select: { id: true, name: true, email: true, employeeCode: true, roleCode: true } } },
  });
  if (!job || job.status === 'RUNNING') return;
  const ok = job.completed;
  const data = {
    Description: job.prompt.slice(0, 80),
    Style: job.style,
    Type: job.typeCode,
    Images: `${ok} of ${job.count} generated`,
  };
  await notify(prisma, [job.userId], {
    type: 'AI_GENERATION_DONE',
    title: ok ? 'Your AI avatars are ready' : 'AI avatar generation failed',
    body: ok
      ? `${ok} new avatar${ok > 1 ? 's are' : ' is'} ready to use in the Studio.`
      : `No images were generated${job.error ? `: ${job.error.slice(0, 120)}` : '.'}`,
    link: '/?ai=1',
    data,
    dedupeKey: `ai-done:${job.id}`,
  });
  if (job.user.roleCode === 'EMPLOYEE' && ok) {
    await notify(prisma, await creatorIds(prisma), {
      type: 'AI_GENERATION_ACTIVITY',
      title: 'Employee generated AI avatars',
      body: `${job.user.name} generated ${ok} AI avatar${ok > 1 ? 's' : ''}.`,
      link: `/creator/employees?user=${job.user.id}`,
      actorId: job.user.id,
      data: { Employee: job.user.name, 'Employee ID': job.user.employeeCode ?? job.user.email, ...data },
      dedupeKey: `ai-activity:${job.id}`,
    });
  }
}

/** A new Employee account became active (invite accepted / email verified). */
export async function employeeJoined(prisma: PrismaClient, userId: string, via: 'invite' | 'sign-up') {
  const u = await employee(prisma, userId);
  if (!u || u.roleCode !== 'EMPLOYEE') return;
  await notify(prisma, [u.id], {
    type: 'ACCOUNT_WELCOME',
    title: 'Welcome to SageVatar!',
    body: 'Your account is ready. Capture photos with avatars, join your events and celebrate your colleagues.',
    link: '/',
    dedupeKey: 'welcome',
  });
  await notify(prisma, await creatorIds(prisma), {
    type: 'EMPLOYEE_JOINED',
    title: 'New employee joined',
    body: `${u.name} ${via === 'invite' ? 'accepted their invitation' : 'signed up and verified their email'}.`,
    link: `/creator/employees?user=${u.id}`,
    actorId: u.id,
    data: { Employee: u.name, Email: u.email, 'Joined via': via === 'invite' ? 'Invitation' : 'Sign-up' },
    dedupeKey: `joined:${u.id}`,
  });
}
