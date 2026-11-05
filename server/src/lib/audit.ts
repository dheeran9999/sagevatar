import type { Request } from 'express';
import type { Prisma, PrismaClient } from '@prisma/client';
import { clientInfo } from './http.js';

export type AuditAction =
  | 'AUTH_LOGIN_SUCCESS'
  | 'AUTH_LOGIN_FAILED'
  | 'AUTH_LOCKED_OUT'
  | 'AUTH_LOGOUT'
  | 'AUTH_PASSWORD_CHANGED'
  | 'PROFILE_UPDATED'
  | 'EMAIL_CHANGE_REQUESTED'
  | 'EMAIL_CHANGED'
  | 'AUTH_INVITE_ACCEPTED'
  | 'AUTH_REGISTERED'
  | 'AUTH_REGISTER_REJECTED'
  | 'AUTH_EMAIL_VERIFIED'
  | 'AUTH_PASSWORD_RESET_REQUESTED'
  | 'AUTH_PASSWORD_RESET'
  | 'CREATOR_PROVISIONED'
  | 'ACCESS_DENIED'
  | 'EMPLOYEE_INVITED'
  | 'EMPLOYEE_REINVITED'
  | 'USER_ACTIVATED'
  | 'USER_DEACTIVATED'
  | 'CATEGORY_CREATED'
  | 'CATEGORY_UPDATED'
  | 'AVATAR_TYPE_UPDATED'
  | 'AVATAR_CREATED'
  | 'AVATAR_UPDATED'
  | 'AVATAR_DELETED'
  | 'LIBRARY_CLEANUP'
  | 'TEMPLATE_CREATED'
  | 'TEMPLATE_UPDATED'
  | 'CREATION_CREATED'
  | 'CREATION_UPDATED'
  | 'CREATION_DELETED'
  | 'CREATION_EMAILED'
  | 'AI_GENERATION_STARTED'
  | 'AI_AVATAR_PUBLISHED'
  | 'EVENT_CREATED'
  | 'EVENT_UPDATED'
  | 'EVENT_STATUS_CHANGED'
  | 'EVENT_ASSIGNED'
  | 'EVENT_UNASSIGNED'
  | 'EVENT_ALBUM_CHANGED'
  | 'EVENT_PHOTO_CREATED'
  | 'EVENT_PHOTO_DELETED'
  | 'EVENT_PHOTO_EMAILED'
  | 'EVENT_EXPORTED'
  | 'EMPLOYEE_PHOTO_ADDED'
  | 'EMPLOYEE_PHOTO_UPDATED'
  | 'EMPLOYEE_PHOTO_WITHDRAWN'
  | 'EMPLOYEE_CODE_SET'
  | 'EMPLOYEE_UPDATED'
  | 'POSTER_GENERATION_STARTED'
  | 'POSTER_SAVED'
  | 'POSTER_EMAILED'
  | 'POSTER_TEMPLATE_UPDATED'
  | 'POSTER_BRANDING_UPDATED';

export interface AuditEntry {
  action: AuditAction;
  actorId?: string | null;
  entityType?: string;
  entityId?: string;
  details?: Prisma.InputJsonValue;
}

/**
 * Writes an audit row. Failures are logged but never break the user's request.
 * Never put passwords, tokens or image data in `details`.
 */
export async function audit(prisma: PrismaClient, req: Request, entry: AuditEntry) {
  try {
    await prisma.auditLog.create({
      data: {
        action: entry.action,
        actorId: entry.actorId ?? req.user?.id ?? null,
        entityType: entry.entityType,
        entityId: entry.entityId,
        details: entry.details,
        ...clientInfo(req),
      },
    });
  } catch (err) {
    console.error('audit log write failed', entry.action, err);
  }
}
