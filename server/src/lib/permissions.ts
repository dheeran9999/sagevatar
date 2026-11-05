import type { Role } from './domain.js';

/**
 * Single source of truth for what each role may do. The API enforces these;
 * the client receives the list from /api/auth/me and only uses it to shape the UI.
 */
export const PERMISSIONS = [
  // Shared by both roles
  'studio.use',
  'photo.capture',
  'photo.upload',
  'avatar.browse',
  'avatar.generate',
  'event.participate',
  'creation.manageOwn',
  'creation.download',
  'creation.email',
  /** Group anniversary posters: own photos, published templates, permitted colleagues. */
  'poster.create',
  // Creator only
  'library.manage',
  'event.manage',
  'template.manage',
  'employee.manage',
  'analytics.view',
  'audit.view',
  /** Use and manage every authorised employee photo; upload photos for employees. */
  'people.photos.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const SHARED: Permission[] = [
  'studio.use',
  'photo.capture',
  'photo.upload',
  'avatar.browse',
  'avatar.generate',
  'event.participate',
  'creation.manageOwn',
  'creation.download',
  'creation.email',
  'poster.create',
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  EMPLOYEE: SHARED,
  CREATOR: [
    ...SHARED,
    'library.manage',
    'event.manage',
    'template.manage',
    'employee.manage',
    'analytics.view',
    'audit.view',
    'people.photos.manage',
  ],
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
