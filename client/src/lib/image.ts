/** Photo intake: validation, decoding and camera-frame capture. */

export const MAX_PHOTO_MB = 10; // matches the server's MAX_UPLOAD_MB
export const MAX_PHOTO_BYTES = MAX_PHOTO_MB * 1024 * 1024;
export const MIN_PHOTO_PX = 200;
export const MAX_PHOTO_PX = 8000;
/** Working canvas cap — the original file is kept untouched for saving. */
export const MAX_WORK_PX = 4096;

export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const ACCEPT_ATTR = ACCEPTED_TYPES.join(',');

export type PhotoSource = 'CAMERA' | 'UPLOAD';

export interface Photo {
  /** Original bytes exactly as uploaded or captured. */
  original: Blob;
  /** Decoded working canvas (≤ MAX_WORK_PX on the long edge). */
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  source: PhotoSource;
  /** True when a front-camera capture was mirrored to match the preview. */
  mirrored: boolean;
  name: string;
}

/** Identifies JPEG / PNG / WebP from the first bytes, independent of name or claimed type. */
export function sniffImageType(head: Uint8Array): (typeof ACCEPTED_TYPES)[number] | null {
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (
    head[0] === 0x89 &&
    head[1] === 0x50 &&
    head[2] === 0x4e &&
    head[3] === 0x47 &&
    head[4] === 0x0d &&
    head[5] === 0x0a
  )
    return 'image/png';
  const ascii = (a: number, b: number) => String.fromCharCode(...head.slice(a, b));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export class PhotoError extends Error {}

/** Checks size and real file type before anything is decoded. */
export async function validatePhotoFile(file: File): Promise<(typeof ACCEPTED_TYPES)[number]> {
  if (file.size === 0) throw new PhotoError('That file is empty.');
  if (file.size > MAX_PHOTO_BYTES) {
    throw new PhotoError(
      `That photo is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_PHOTO_MB} MB.`,
    );
  }
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const type = sniffImageType(head);
  if (!type) {
    throw new PhotoError('Please choose a JPG, PNG or WebP image.');
  }
  return type;
}

function fitWithin(w: number, h: number, max: number) {
  const k = Math.min(1, max / Math.max(w, h));
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

export function drawToCanvas(source: CanvasImageSource, w: number, h: number, mirror = false) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new PhotoError('Your browser couldn’t prepare the photo.');
  if (mirror) {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, 0, 0, w, h);
  return c;
}

/** Validates and decodes an uploaded image (EXIF orientation applied by the browser). */
export async function loadPhotoFile(file: File): Promise<Photo> {
  await validatePhotoFile(file);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new PhotoError(
      'This image couldn’t be opened. It may be damaged or in an unsupported format.',
    );
  }
  try {
    const { width, height } = bitmap;
    if (Math.min(width, height) < MIN_PHOTO_PX) {
      throw new PhotoError(
        `That photo is too small (${width}×${height}). Use at least ${MIN_PHOTO_PX}px.`,
      );
    }
    if (Math.max(width, height) > MAX_PHOTO_PX) {
      throw new PhotoError(
        `That photo is too large (${width}×${height}). The limit is ${MAX_PHOTO_PX}px.`,
      );
    }
    const fit = fitWithin(width, height, MAX_WORK_PX);
    return {
      original: file,
      canvas: drawToCanvas(bitmap, fit.w, fit.h),
      width: fit.w,
      height: fit.h,
      source: 'UPLOAD',
      mirrored: false,
      name: file.name,
    };
  } finally {
    bitmap.close();
  }
}

export function canvasToBlob(
  c: HTMLCanvasElement,
  type = 'image/jpeg',
  quality = 0.92,
): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob(
      (b) => (b ? resolve(b) : reject(new PhotoError('Couldn’t encode the image.'))),
      type,
      quality,
    ),
  );
}

/**
 * Grabs the current video frame at the camera's native resolution.
 * Front-camera captures are mirrored so the photo matches what the person saw.
 */
export async function captureFrame(video: HTMLVideoElement, mirror: boolean): Promise<Photo> {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) throw new PhotoError('The camera isn’t ready yet — try again in a moment.');
  const full = drawToCanvas(video, vw, vh, mirror);
  const original = await canvasToBlob(full, 'image/jpeg', 0.95);
  const fit = fitWithin(vw, vh, MAX_WORK_PX);
  const canvas = fit.w === vw ? full : drawToCanvas(full, fit.w, fit.h);
  return {
    original,
    canvas,
    width: fit.w,
    height: fit.h,
    source: 'CAMERA',
    mirrored: mirror,
    name: 'camera.jpg',
  };
}
