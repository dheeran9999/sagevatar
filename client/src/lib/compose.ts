import type { Avatar, AvatarType } from './api';
import type { FaceGeom } from './facemesh';
import { drawFilterOnFace, type FaceFilter, type FilterAdjust } from './faceFilters';

/**
 * Composition model + renderer. The same `renderScene` draws the on-screen preview and
 * the exported file, so what you see is exactly what you download or email.
 * Only the photo, avatar and person cut-out are drawn — never page decoration.
 */

/**
 * How the avatar meets the photo:
 * - face:  an AR face filter (or a character head) attached to the detected face landmarks;
 * - body:  a full-body avatar fitted onto the detected person (head, height, lean);
 * - place: the avatar stands in the scene at a placement preset (beside, behind, …).
 */
export const STUDIO_MODES = ['face', 'body', 'place'] as const;
export type StudioMode = (typeof STUDIO_MODES)[number];
export const MODE_LABEL: Record<StudioMode, string> = {
  face: 'Face Filter',
  body: 'Full-Body Avatar',
  place: 'Place in Scene',
};

export const PLACEMENTS = ['left', 'right', 'beside', 'behind', 'foreground'] as const;
export type Placement = (typeof PLACEMENTS)[number];

export const PLACEMENT_LABEL: Record<Placement, string> = {
  left: 'Left',
  right: 'Right',
  beside: 'Beside',
  behind: 'Behind person',
  foreground: 'Foreground',
};

export interface Transform {
  /** Avatar centre as fractions of the photo (0..1). */
  x: number;
  y: number;
  /** Avatar height as a fraction of the photo height. */
  scale: number;
  /** Degrees, clockwise. */
  rotation: number;
  flipX: boolean;
  opacity: number;
}

const TYPE_SCALE: Record<AvatarType, number> = {
  FACE: 0.42,
  HALF_BODY: 0.72,
  FULL_BODY: 1,
  BACKGROUND: 1,
};

const BASE: Record<Placement, Pick<Transform, 'x' | 'y' | 'scale'>> = {
  left: { x: 0.2, y: 0.56, scale: 0.9 },
  right: { x: 0.8, y: 0.56, scale: 0.9 },
  beside: { x: 0.7, y: 0.58, scale: 0.86 },
  behind: { x: 0.62, y: 0.5, scale: 1.02 },
  foreground: { x: 0.5, y: 0.8, scale: 0.5 },
};

export const DEFAULT_LOOK = { rotation: 0, flipX: false, opacity: 1 };

/** Starting transform for a placement, sized for the avatar type. */
export function presetFor(placement: Placement, type: AvatarType): Transform {
  const b = BASE[placement];
  const k = TYPE_SCALE[type];
  const scale = Math.min(1.2, b.scale * k);
  // Faces sit at head height unless they're a foreground sticker.
  const y = type === 'FACE' && placement !== 'foreground' ? 0.34 : b.y;
  // Smaller bodies keep their feet on the same "floor" as a full-body avatar.
  const anchored =
    placement === 'foreground' || type === 'FACE' ? y : b.y + b.scale / 2 - scale / 2;
  return { x: b.x, y: anchored, scale, ...DEFAULT_LOOK };
}

/** The avatar's own suggested placement (from the library) mapped to a studio placement. */
export function defaultPlacementFor(avatar: Avatar): Placement {
  switch (avatar.defaultPlacement?.layer) {
    case 'behind':
      return 'behind';
    case 'front':
      return avatar.type === 'FACE' ? 'right' : 'foreground';
    default:
      return 'beside';
  }
}

/** Whether this scene needs the person cut out of the photo. */
export function needsCutout(avatar: Avatar | null, placement: Placement) {
  return !!avatar && (avatar.type === 'BACKGROUND' || placement === 'behind');
}

export function clampTransform(t: Transform): Transform {
  return {
    ...t,
    x: Math.min(1.1, Math.max(-0.1, t.x)),
    y: Math.min(1.1, Math.max(-0.1, t.y)),
    scale: Math.min(1.6, Math.max(0.08, t.scale)),
    rotation: ((((t.rotation + 180) % 360) + 360) % 360) - 180,
    opacity: Math.min(1, Math.max(0.1, t.opacity)),
  };
}

export interface Scene {
  photo: CanvasImageSource & { width: number; height: number };
  /** Person-only image (transparent elsewhere), same size as photo. */
  cutout: CanvasImageSource | null;
  avatar: { image: CanvasImageSource; width: number; height: number; type: AvatarType } | null;
  placement: Placement;
  transform: Transform;
  /** Defaults to 'place' (the original behaviour). */
  mode?: StudioMode;
  /** Face mode: the filter and the faces (photo pixels) it is applied to. */
  filter?: { filter: FaceFilter; faces: FaceGeom[]; adjust: FilterAdjust } | null;
  /** Body mode options. */
  body?: {
    /** 'replace' draws over a person-removed background; 'overlay' over the photo. */
    style: 'overlay' | 'replace';
    /** The photo with the person removed (replace style). */
    background: CanvasImageSource | null;
    /** The person's own face at photo size, drawn back on top ("Keep my face"). */
    facePatch: CanvasImageSource | null;
  } | null;
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  img: Scene['avatar'] & object,
  w: number,
  h: number,
) {
  const k = Math.max(w / img.width, h / img.height);
  const dw = img.width * k;
  const dh = img.height * k;
  ctx.drawImage(img.image, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

function drawAvatar(
  ctx: CanvasRenderingContext2D,
  a: Scene['avatar'] & object,
  t: Transform,
  w: number,
  h: number,
) {
  const dh = t.scale * h;
  const dw = dh * (a.width / a.height);
  ctx.save();
  ctx.globalAlpha = t.opacity;
  ctx.translate(t.x * w, t.y * h);
  ctx.rotate((t.rotation * Math.PI) / 180);
  if (t.flipX) ctx.scale(-1, 1);
  ctx.drawImage(a.image, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
}

/**
 * Draws the scene at the canvas's current size.
 * - Background avatar: scene image → person cut-out.
 * - Behind person: photo → avatar → person cut-out.
 * - Left / Right / Beside / Foreground: photo → avatar.
 * Without a cut-out (not ready or failed), "behind" degrades to drawing over the photo.
 */
export function renderScene(ctx: CanvasRenderingContext2D, scene: Scene, t = 0) {
  const { width: w, height: h } = ctx.canvas;
  ctx.clearRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  const a = scene.avatar;
  const mode = scene.mode ?? 'place';

  // Face filter: photo → filter on every targeted face (landmarks are in photo pixels).
  if (mode === 'face') {
    ctx.drawImage(scene.photo, 0, 0, w, h);
    const f = scene.filter;
    if (f) {
      const k = w / scene.photo.width;
      for (const face of f.faces) drawFilterOnFace(ctx, f.filter, face, f.adjust, t, k);
    }
    return;
  }

  // Full-body avatar: (person-removed) photo → fitted avatar → optionally the real face.
  if (mode === 'body' && a && a.type !== 'BACKGROUND') {
    const b = scene.body;
    const bg = b?.style === 'replace' && b.background ? b.background : scene.photo;
    ctx.drawImage(bg, 0, 0, w, h);
    drawAvatar(ctx, a, scene.transform, w, h);
    if (b?.facePatch) ctx.drawImage(b.facePatch, 0, 0, w, h);
    return;
  }

  if (a?.type === 'BACKGROUND') {
    drawCover(ctx, a, w, h);
    ctx.drawImage(scene.cutout ?? scene.photo, 0, 0, w, h);
    return;
  }

  ctx.drawImage(scene.photo, 0, 0, w, h);
  if (!a) return;
  drawAvatar(ctx, a, scene.transform, w, h);
  if (scene.placement === 'behind' && scene.cutout) {
    ctx.drawImage(scene.cutout, 0, 0, w, h);
  }
}

/** Renders the scene at full photo resolution and encodes it. */
export async function exportScene(
  scene: Scene,
  type = 'image/jpeg',
  quality = 0.92,
): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = scene.photo.width;
  c.height = scene.photo.height;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available in this browser.');
  renderScene(ctx, scene);
  return new Promise((resolve, reject) =>
    c.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Couldn’t create the image.'))),
      type,
      quality,
    ),
  );
}

/** Loads an avatar image for canvas drawing (same-origin, so the canvas stays exportable). */
export function loadAvatarImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('This avatar image couldn’t be loaded.'));
    img.src = src;
  });
}
