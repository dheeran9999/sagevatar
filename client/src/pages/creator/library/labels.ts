import type { AssetSource, AvatarStyle, AvatarType } from '../../../lib/api';

export const SOURCE_LABEL: Record<AssetSource, string> = {
  ORIGINAL: 'Original',
  IN_HOUSE: 'In-house',
  LICENSED: 'Licensed',
  PUBLIC_DOMAIN: 'Public domain',
  AI_GENERATED: 'AI-generated',
};

export const STYLE_LABEL: Record<AvatarStyle, string> = {
  PROFESSIONAL: 'Professional',
  CASUAL: 'Casual',
  THEMED: 'Themed',
};

export const TYPE_LABEL: Record<AvatarType, string> = {
  FACE: 'Face',
  HALF_BODY: 'Half Body',
  FULL_BODY: 'Full Body',
  BACKGROUND: 'Background',
};

export const formatBytes = (n: number | null | undefined) =>
  n == null
    ? '—'
    : n < 1024 * 1024
      ? `${Math.round(n / 1024)} KB`
      : `${(n / 1024 / 1024).toFixed(1)} MB`;
