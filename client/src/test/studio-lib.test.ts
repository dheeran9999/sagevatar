import { describe, it, expect, afterEach, vi } from 'vitest';
import { cameraErrorFrom, cameraSupportIssue } from '../lib/camera';
import { MAX_PHOTO_BYTES, PhotoError, sniffImageType, validatePhotoFile } from '../lib/image';
import {
  clampTransform,
  defaultPlacementFor,
  needsCutout,
  presetFor,
  PLACEMENTS,
} from '../lib/compose';
import type { Avatar } from '../lib/api';

const bytes = (...b: number[]) => new Uint8Array([...b, ...Array(16).fill(0)].slice(0, 16));
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const WEBP = new Uint8Array(
  [...'RIFF']
    .map((c) => c.charCodeAt(0))
    .concat(
      [0, 0, 0, 0],
      [...'WEBP'].map((c) => c.charCodeAt(0)),
      [0, 0, 0, 0],
    ),
);
const GIF = bytes(...[...'GIF89a'].map((c) => c.charCodeAt(0)));

describe('image type sniffing', () => {
  it('recognises JPEG, PNG and WebP by content', () => {
    expect(sniffImageType(JPEG)).toBe('image/jpeg');
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(WEBP)).toBe('image/webp');
  });
  it('rejects other formats', () => {
    expect(sniffImageType(GIF)).toBeNull();
    expect(sniffImageType(bytes(0x25, 0x50, 0x44, 0x46))).toBeNull(); // %PDF
  });
});

describe('photo file validation', () => {
  const file = (head: Uint8Array, name: string, type: string, size?: number) => {
    const f = new File([head as Uint8Array<ArrayBuffer>], name, { type });
    if (size) Object.defineProperty(f, 'size', { value: size });
    return f;
  };

  it('accepts a real JPEG even with a misleading name', async () => {
    await expect(validatePhotoFile(file(JPEG, 'photo.txt', 'text/plain'))).resolves.toBe(
      'image/jpeg',
    );
  });
  it('rejects a renamed non-image', async () => {
    await expect(validatePhotoFile(file(GIF, 'fake.png', 'image/png'))).rejects.toThrow(
      /JPG, PNG or WebP/,
    );
  });
  it('rejects files over the size limit', async () => {
    await expect(
      validatePhotoFile(file(JPEG, 'big.jpg', 'image/jpeg', MAX_PHOTO_BYTES + 1)),
    ).rejects.toThrow(/limit is 10 MB/);
  });
  it('rejects empty files', async () => {
    await expect(validatePhotoFile(new File([], 'empty.jpg'))).rejects.toBeInstanceOf(PhotoError);
  });
});

describe('camera errors', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['NotAllowedError', 'denied'],
    ['NotFoundError', 'not-found'],
    ['NotReadableError', 'in-use'],
    ['OverconstrainedError', 'constraints'],
    ['WeirdError', 'unknown'],
  ])('%s → %s', (name, issue) => {
    expect(cameraErrorFrom({ name }).issue).toBe(issue);
  });

  it('reports an insecure context before trying the camera', () => {
    vi.stubGlobal('isSecureContext', false);
    expect(cameraSupportIssue()?.issue).toBe('insecure');
  });

  it('reports missing camera APIs', () => {
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: undefined });
    expect(cameraSupportIssue()?.issue).toBe('unsupported');
  });
});

describe('composition placements', () => {
  it('offers exactly the five placements', () => {
    expect([...PLACEMENTS]).toEqual(['left', 'right', 'beside', 'behind', 'foreground']);
  });

  it('puts Left and Right on opposite sides', () => {
    expect(presetFor('left', 'FULL_BODY').x).toBeLessThan(0.5);
    expect(presetFor('right', 'FULL_BODY').x).toBeGreaterThan(0.5);
  });

  it('sizes avatars by type and keeps bodies standing on the same floor', () => {
    const full = presetFor('beside', 'FULL_BODY');
    const half = presetFor('beside', 'HALF_BODY');
    const face = presetFor('beside', 'FACE');
    expect(face.scale).toBeLessThan(half.scale);
    expect(half.scale).toBeLessThan(full.scale);
    expect(half.y + half.scale / 2).toBeCloseTo(full.y + full.scale / 2, 5);
  });

  it('keeps transforms in sensible bounds', () => {
    const t = clampTransform({ x: 5, y: -5, scale: 99, rotation: 270, flipX: false, opacity: 0 });
    expect(t).toMatchObject({ x: 1.1, y: -0.1, scale: 1.6, rotation: -90, opacity: 0.1 });
  });

  it('only cuts the person out when the avatar goes behind or replaces the background', () => {
    const av = (type: Avatar['type']) => ({ type }) as Avatar;
    expect(needsCutout(av('FULL_BODY'), 'behind')).toBe(true);
    expect(needsCutout(av('BACKGROUND'), 'beside')).toBe(true);
    expect(needsCutout(av('FULL_BODY'), 'left')).toBe(false);
    expect(needsCutout(null, 'behind')).toBe(false);
  });

  it('maps library defaults to studio placements', () => {
    const av = (layer: string, type: Avatar['type'] = 'FULL_BODY') =>
      ({ type, defaultPlacement: { layer, x: 0, y: 0, scale: 1 } }) as Avatar;
    expect(defaultPlacementFor(av('behind'))).toBe('behind');
    expect(defaultPlacementFor(av('beside'))).toBe('beside');
    expect(defaultPlacementFor(av('front', 'FACE'))).toBe('right');
  });
});
