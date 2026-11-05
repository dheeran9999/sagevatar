import type { Event, EmployeePhoto, Prisma, PrismaClient } from '@prisma/client';
import type { AuthUser } from '../../middleware/auth.js';
import { can } from '../permissions.js';
import { HttpError } from '../http.js';
import { EMPLOYEE_VISIBLE, canCapture } from '../events.js';

/**
 * Who may use whose photograph in a group poster.
 *
 *  - Creators (people.photos.manage): every active photo. A photo only exists once permission
 *    is recorded — uploaded by the person themselves, or by a Creator who confirmed it.
 *  - Employees: their own photos, and a colleague's photo ONLY when that colleague has turned on
 *    "share with colleagues" for it. Inside an event, colleagues must also be assigned to it.
 *  - Withdrawn photos are never usable.
 */
export const managesPhotos = (u: AuthUser) => can(u.role, 'people.photos.manage');

export function usablePhotoWhere(
  u: AuthUser,
  eventParticipantIds?: string[] | null,
): Prisma.EmployeePhotoWhereInput {
  if (managesPhotos(u)) return { isActive: true };
  const colleagues: Prisma.EmployeePhotoWhereInput = { shareWithColleagues: true };
  if (eventParticipantIds) colleagues.userId = { in: eventParticipantIds };
  return { isActive: true, OR: [{ userId: u.id }, colleagues] };
}

export const canEditPhoto = (u: AuthUser, p: Pick<EmployeePhoto, 'userId'>) =>
  p.userId === u.id || managesPhotos(u);

/**
 * The event a poster is made in. Creators may use any event that isn't archived;
 * Employees only events they're assigned to and can see. Others get 404.
 */
export async function posterEvent(prisma: PrismaClient, u: AuthUser, eventId: string): Promise<Event> {
  const e = await prisma.event.findUnique({ where: { id: eventId } });
  if (!e) throw new HttpError(404, 'Event not found');
  if (managesPhotos(u)) {
    if (e.status === 'ARCHIVED') throw new HttpError(409, 'This event is archived');
    return e;
  }
  const assigned = await prisma.eventAssignment.count({ where: { eventId, userId: u.id } });
  if (!assigned || !EMPLOYEE_VISIBLE.includes(e.status)) throw new HttpError(404, 'Event not found');
  return e;
}

/** Can this user add a poster to the event's gallery right now? */
export async function canSaveToEvent(prisma: PrismaClient, u: AuthUser, e: Event) {
  if (managesPhotos(u)) return !['CANCELLED', 'ARCHIVED'].includes(e.status);
  const assigned = await prisma.eventAssignment.count({ where: { eventId: e.id, userId: u.id } });
  return !!assigned && canCapture(e);
}

export async function eventParticipantIds(prisma: PrismaClient, eventId: string) {
  const rows = await prisma.eventAssignment.findMany({ where: { eventId }, select: { userId: true } });
  return rows.map((r) => r.userId);
}
