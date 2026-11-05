import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import sharp, { type Metadata } from 'sharp';
import { HttpError } from './http.js';

export type ImageFormat = 'png' | 'jpeg' | 'webp' | 'gif';

const MIME: Record<ImageFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

export interface InspectedImage {
  format: ImageFormat;
  mimeType: string;
  ext: string;
  width: number;
  height: number;
  isAnimated: boolean;
  sizeBytes: number;
  sha256: string;
}

/** In-memory multipart parser. Files are validated by content, not by name or claimed type. */
export function uploader(maxUploadMb: number) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxUploadMb * 1024 * 1024, files: 2, fields: 20 },
  });
}

/**
 * Decodes the bytes to confirm they really are an allowed raster image.
 * SVG is deliberately not accepted for uploads (it can carry script).
 */
export async function inspectImage(
  buf: Buffer | undefined,
  allowed: ImageFormat[],
): Promise<InspectedImage> {
  if (!buf || buf.length === 0) throw new HttpError(400, 'An image file is required');
  let meta: Metadata;
  try {
    meta = await sharp(buf, { animated: true }).metadata();
  } catch {
    throw new HttpError(400, 'File is not a valid image');
  }
  const format = meta.format as ImageFormat;
  if (!allowed.includes(format)) {
    throw new HttpError(400, `Unsupported image type. Allowed: ${allowed.join(', ')}`);
  }
  const width = meta.width ?? 0;
  const height = meta.pageHeight ?? meta.height ?? 0;
  if (width < 16 || height < 16 || width > 8000 || height > 8000) {
    throw new HttpError(400, 'Image dimensions must be between 16 and 8000 pixels');
  }
  return {
    format,
    mimeType: MIME[format],
    ext: format === 'jpeg' ? 'jpg' : format,
    width,
    height,
    isAnimated: (meta.pages ?? 1) > 1,
    sizeBytes: buf.length,
    sha256: createHash('sha256').update(buf).digest('hex'),
  };
}

export async function saveFile(dir: string, fileName: string, buf: Buffer): Promise<string> {
  await mkdir(dir, { recursive: true });
  const full = path.join(dir, fileName);
  await writeFile(full, buf);
  return full;
}

/** Static PNG thumbnail (first frame for animated images). */
export function makeThumbnail(buf: Buffer, size = 256): Promise<Buffer> {
  return sharp(buf, { pages: 1 })
    .resize(size, size, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();
}

export const newFileId = () => randomUUID();

/** True if the image has an alpha channel that is actually used (some pixels see-through). */
export async function hasTransparency(buf: Buffer): Promise<boolean> {
  const img = sharp(buf, { pages: 1 });
  const meta = await img.metadata();
  if (!meta.hasAlpha) return false;
  const { channels } = await img.stats();
  return (channels[channels.length - 1]?.min ?? 255) < 250;
}
