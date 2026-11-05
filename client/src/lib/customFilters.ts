/**
 * "Add New Filter": filters people make from their own transparent PNG/WebP artwork.
 * Stored in this browser only (localStorage, downscaled), so nothing is uploaded until the
 * finished photo is saved. Each filter remembers which face landmark it attaches to.
 */
import { imageFilter, type FaceFilter, type FilterAnchor } from './faceFilters';

export interface CustomFilterRecord {
  id: string;
  name: string;
  anchor: FilterAnchor;
  size: number;
  dataUrl: string;
  createdAt: string;
}

const KEY = 'sagevatar.customFilters';
const MAX_PX = 512;

export function readCustomFilters(): CustomFilterRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as CustomFilterRecord[]) : [];
    return Array.isArray(list) ? list.filter((r) => r && r.id && r.dataUrl) : [];
  } catch {
    return [];
  }
}

function write(list: CustomFilterRecord[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
}

export function deleteCustomFilter(id: string) {
  try {
    write(readCustomFilters().filter((r) => r.id !== id));
  } catch {
    /* storage unavailable */
  }
}

/** Validates, downsizes and stores an uploaded image as a filter. */
export async function addCustomFilter(
  file: File,
  o: { name: string; anchor: FilterAnchor; size: number },
): Promise<CustomFilterRecord> {
  if (!/^image\/(png|webp)$/.test(file.type)) {
    throw new Error('Use a PNG or WebP image with a transparent background.');
  }
  if (file.size > 5 * 1024 * 1024) throw new Error('The image must be 5 MB or smaller.');
  const bmp = await createImageBitmap(file).catch(() => {
    throw new Error('This image couldn’t be opened.');
  });
  const k = Math.min(1, MAX_PX / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * k));
  c.height = Math.max(1, Math.round(bmp.height * k));
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const rec: CustomFilterRecord = {
    id: `custom-${Date.now().toString(36)}`,
    name: o.name.trim().slice(0, 40) || 'My filter',
    anchor: o.anchor,
    size: o.size,
    dataUrl: c.toDataURL('image/png'),
    createdAt: new Date().toISOString(),
  };
  try {
    write([rec, ...readCustomFilters()].slice(0, 24));
  } catch {
    throw new Error('This browser has no room left to keep the filter. Remove an older one.');
  }
  return rec;
}

const loaded = new Map<string, Promise<FaceFilter>>();

/** Turns a stored record into a drawable filter (image decoded once). */
export function customFilter(rec: CustomFilterRecord): Promise<FaceFilter> {
  let p = loaded.get(rec.id);
  if (!p) {
    p = new Promise<FaceFilter>((resolve, reject) => {
      const img = new Image();
      img.onload = () =>
        resolve(
          imageFilter({
            id: rec.id,
            name: rec.name,
            category: 'custom',
            image: img,
            anchor: rec.anchor,
            size: rec.size,
            thumbUrl: rec.dataUrl,
            tags: ['custom', 'my filter'],
          }),
        );
      img.onerror = () => reject(new Error('This filter image couldn’t be loaded.'));
      img.src = rec.dataUrl;
    });
    loaded.set(rec.id, p);
  }
  return p;
}
