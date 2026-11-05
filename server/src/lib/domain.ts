/** Only two roles exist in SageVatar. */
export const ROLES = ['CREATOR', 'EMPLOYEE'] as const;
export type Role = (typeof ROLES)[number];

export const AVATAR_TYPES = ['FACE', 'HALF_BODY', 'FULL_BODY', 'BACKGROUND'] as const;
export type AvatarType = (typeof AVATAR_TYPES)[number];

export const EMAIL_STATUSES = ['QUEUED', 'SENT', 'FAILED'] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

export const PHOTO_SOURCES = ['CAMERA', 'UPLOAD'] as const;

export const PLACEMENT_LAYERS = ['behind', 'beside', 'front', 'background'] as const;

/** Where an avatar sits relative to the person when first dropped onto the canvas. */
export interface Placement {
  /** behind = drawn under the segmented person; beside/front = drawn over the photo. */
  layer: (typeof PLACEMENT_LAYERS)[number];
  /** Anchor as fractions of the canvas (0..1). */
  x: number;
  y: number;
  /** Avatar height as a fraction of canvas height. */
  scale: number;
}
