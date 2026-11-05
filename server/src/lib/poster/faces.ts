/**
 * Face-aware compositing for group posters.
 *
 * Every participant's face comes from their ORIGINAL photograph: the face region (plus hair and
 * shoulders when a person mask exists) is cut out, aligned (centre, size, roll angle) and scaled
 * into the participant's slot. Nothing is synthesised over the face, so identity is preserved
 * pixel for pixel (only resized/rotated).
 */
import sharp, { type Sharp } from 'sharp';
import { z } from 'zod';

export const FaceBoxSchema = z.object({
  x: z.number().min(-0.5).max(1.5),
  y: z.number().min(-0.5).max(1.5),
  w: z.number().min(0.01).max(1.5),
  h: z.number().min(0.01).max(1.5),
  /** Head roll in degrees (positive = clockwise), from eye keypoints when available. */
  angle: z.number().min(-60).max(60).optional(),
});
export type FaceBox = z.infer<typeof FaceBoxSchema>;

/** Per-poster manual alignment, relative to the detected face. */
export const AdjustSchema = z.object({
  /** Offsets in face sizes (−1 … 1). */
  dx: z.number().min(-1).max(1).default(0),
  dy: z.number().min(-1).max(1).default(0),
  /** >1 = the face appears larger (tighter crop). */
  zoom: z.number().min(0.5).max(2).default(1),
  /** Extra rotation in degrees. */
  rotate: z.number().min(-45).max(45).default(0),
});
export type Adjust = z.infer<typeof AdjustSchema>;
export const NO_ADJUST: Adjust = { dx: 0, dy: 0, zoom: 1, rotate: 0 };

/** Thrown when a face can't be placed reliably; the UI asks the user to adjust it manually. */
export class AlignmentError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export interface PreparedPerson {
  /** Transparent PNG: the person's real head (and shoulders when masked). */
  png: Buffer;
  /**
   * Same size and anchor as `png`, but only the face and hair (feathered oval, intersected with
   * the person mask). Pasted back over an AI-restyled photo so identity always comes from the
   * original photograph.
   */
  facePng: Buffer;
  width: number;
  height: number;
  /** Where the face centre sits inside `png`. */
  anchorX: number;
  anchorY: number;
  /** Average colours sampled from the photo, for the drawn body and hands. */
  skin: string;
  clothing: string | null;
  /** 'mask' = segmentation cut-out; 'oval' = feathered face oval (no mask available). */
  cutout: 'mask' | 'oval';
}

/** Minimum face size in the source photo, in pixels, for a sharp result. */
export const MIN_FACE_PX = 48;

const hex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;

/**
 * Cuts the participant out of their photo and scales it so the face is `faceHeight` px tall.
 * @param photo original photograph bytes (EXIF orientation is applied)
 * @param mask optional greyscale person mask for the (oriented) photo
 */
export async function preparePerson(
  photo: Buffer,
  mask: Buffer | null,
  face: FaceBox | null,
  adjust: Adjust,
  faceHeight: number,
): Promise<PreparedPerson> {
  if (!face) {
    throw new AlignmentError('No face was detected in this photo. Adjust the face position manually.');
  }
  const oriented = sharp(photo, { failOn: 'error' }).rotate();
  const { data: rgb, info } = await oriented
    .clone()
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;

  const F0 = Math.max(face.w * W, face.h * H);
  if (F0 < MIN_FACE_PX) {
    throw new AlignmentError(
      `The face in this photo is too small (${Math.round(F0)} px). Use a closer, higher-resolution photo.`,
    );
  }
  const F = F0 / adjust.zoom;
  const cx = (face.x + face.w / 2) * W + adjust.dx * F0;
  const cy = (face.y + face.h / 2) * H + adjust.dy * F0;
  if (cx < 0 || cy < 0 || cx > W || cy > H) {
    throw new AlignmentError('The face position is outside the photo. Reset the face adjustment.');
  }
  const angle = (face.angle ?? 0) + adjust.rotate;

  // 1. A square around the face (padded so it can extend past the photo edges).
  const S = Math.round(4.4 * F);
  const pad = S;
  const left = Math.round(cx - S / 2) + pad;
  const top = Math.round(cy - S / 2) + pad;

  const square = async (img: Sharp, channels: 1 | 3) => {
    const bg = channels === 1 ? { r: 0, g: 0, b: 0, alpha: 1 } : { r: 128, g: 128, b: 128, alpha: 1 };
    // Two passes: within one pipeline sharp would extract before extending.
    const padded = await img
      .extend({ top: pad, bottom: pad, left: pad, right: pad, background: bg })
      .raw()
      .toBuffer({ resolveWithObject: true });
    let s = sharp(
      await sharp(padded.data, { raw: padded.info })
        .extract({ left, top, width: S, height: S })
        .raw()
        .toBuffer(),
      { raw: { width: S, height: S, channels: padded.info.channels } },
    );
    if (Math.abs(angle) > 0.5) {
      // Rotate the opposite way to level the head, then take the centre back out.
      const rotated = await s.rotate(-angle, { background: bg }).toBuffer({ resolveWithObject: true });
      const ox = Math.round((rotated.info.width - S) / 2);
      const oy = Math.round((rotated.info.height - S) / 2);
      s = sharp(rotated.data).extract({ left: ox, top: oy, width: S, height: S });
    }
    return s;
  };

  const k = faceHeight / F;
  const N = Math.max(8, Math.round(S * k));
  const photoSq = await square(
    sharp(rgb, { raw: { width: W, height: H, channels: 3 } }),
    3,
  );
  const px = await photoSq.resize(N, N, { kernel: 'lanczos3' }).removeAlpha().raw().toBuffer();

  let alpha: Uint8Array | null = null;
  if (mask) {
    try {
      const m = sharp(mask).rotate().resize(W, H, { fit: 'fill' }).toColourspace('b-w').removeAlpha();
      const mSq = await square(
        sharp(await m.raw().toBuffer(), { raw: { width: W, height: H, channels: 1 } }),
        1,
      );
      alpha = new Uint8Array(await mSq.resize(N, N).extractChannel(0).raw().toBuffer());
    } catch {
      alpha = null; // unreadable mask → oval fallback
    }
  }

  // The mask must actually cover the face, otherwise it's unreliable → oval fallback.
  const fh = faceHeight;
  const c = N / 2;
  if (alpha) {
    let sum = 0;
    let n = 0;
    for (let y = Math.round(c - fh * 0.25); y < c + fh * 0.25; y++) {
      for (let x = Math.round(c - fh * 0.2); x < c + fh * 0.2; x++) {
        sum += alpha[y * N + x] ?? 0;
        n++;
      }
    }
    if (!n || sum / n < 140) alpha = null;
  }
  const cutout: PreparedPerson['cutout'] = alpha ? 'mask' : 'oval';

  // 2. Region kept: head (and shoulders when masked).
  const rx0 = Math.max(0, Math.round(c - 1.45 * fh));
  const rx1 = Math.min(N, Math.round(c + 1.45 * fh));
  const ry0 = Math.max(0, Math.round(c - 1.25 * fh));
  const ry1 = Math.min(N, Math.round(c + (alpha ? 1.6 : 0.95) * fh));
  const RW = rx1 - rx0;
  const RH = ry1 - ry0;
  const out = Buffer.alloc(RW * RH * 4);
  const faceOut = Buffer.alloc(RW * RH * 4);
  // Face-only oval (a little wider/taller to keep hair and jaw), softly feathered.
  const frx = 0.6 * fh;
  const fry = 0.8 * fh;
  const ffeather = 0.22;

  const fadeStart = c + 1.05 * fh;
  const fadeEnd = c + 1.6 * fh;
  // Oval: slightly above the box centre so hair is kept; soft edge.
  const ox = c;
  const oy = c - 0.08 * fh;
  const orx = 0.56 * fh;
  const ory = 0.76 * fh;
  const feather = 0.14;

  let skinR = 0, skinG = 0, skinB = 0, skinN = 0;
  let clR = 0, clG = 0, clB = 0, clW = 0;

  for (let y = ry0; y < ry1; y++) {
    for (let x = rx0; x < rx1; x++) {
      const si = (y * N + x) * 3;
      const di = ((y - ry0) * RW + (x - rx0)) * 4;
      const r = px[si];
      const g = px[si + 1];
      const b = px[si + 2];
      let a: number;
      if (alpha) {
        a = alpha[y * N + x];
        if (y > fadeStart) a *= Math.max(0, 1 - (y - fadeStart) / (fadeEnd - fadeStart));
      } else {
        const d = Math.sqrt(((x - ox) / orx) ** 2 + ((y - oy) / ory) ** 2);
        a = d <= 1 - feather ? 255 : d >= 1 ? 0 : (255 * (1 - d)) / feather;
      }
      out[di] = r;
      out[di + 1] = g;
      out[di + 2] = b;
      out[di + 3] = Math.round(a);
      const fd = Math.sqrt(((x - ox) / frx) ** 2 + ((y - oy) / fry) ** 2);
      let fa = fd <= 1 - ffeather ? 255 : fd >= 1 ? 0 : (255 * (1 - fd)) / ffeather;
      if (alpha) fa = Math.min(fa, alpha[y * N + x]);
      faceOut[di] = r;
      faceOut[di + 1] = g;
      faceOut[di + 2] = b;
      faceOut[di + 3] = Math.round(fa);

      // Skin: the middle of the face (cheeks/nose), below the eyes.
      if (Math.abs(x - c) < 0.18 * fh && y > c && y < c + 0.22 * fh) {
        skinR += r; skinG += g; skinB += b; skinN++;
      }
      // Clothing: just below the chin, inside the person mask.
      if (alpha && Math.abs(x - c) < 0.9 * fh && y > c + 1.1 * fh && y < c + 1.45 * fh) {
        const w = alpha[y * N + x] / 255;
        clR += r * w; clG += g * w; clB += b * w; clW += w;
      }
    }
  }

  const png = await sharp(out, { raw: { width: RW, height: RH, channels: 4 } }).png().toBuffer();
  const facePng = await sharp(faceOut, { raw: { width: RW, height: RH, channels: 4 } }).png().toBuffer();
  return {
    png,
    facePng,
    width: RW,
    height: RH,
    anchorX: Math.round(c - rx0),
    anchorY: Math.round(c - ry0),
    skin: skinN ? hex(skinR / skinN, skinG / skinN, skinB / skinN) : '#c99a7a',
    clothing: clW > RW * 2 ? hex(clR / clW, clG / clW, clB / clW) : null,
    cutout,
  };
}

/** Darker/lighter variant of a #rrggbb colour (amount −1 … 1). */
export function shade(color: string, amount: number) {
  const n = parseInt(color.slice(1), 16);
  const f = (v: number) => (amount < 0 ? v * (1 + amount) : v + (255 - v) * amount);
  return hex(f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255));
}
