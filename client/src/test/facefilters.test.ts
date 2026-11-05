import { describe, expect, it } from 'vitest';
import { canonicalFace, dedupe, IDX, smoothFaces, toFaceGeom } from '../lib/facemesh';
import {
  BUILT_IN_FILTERS,
  clampAdjust,
  drawFilterOnFace,
  FILTER_CATEGORIES,
  NO_ADJUST,
} from '../lib/faceFilters';
import { fitAvatarToBody, poseFrame, type AvatarAnchors } from '../lib/bodyAvatar';

/** Synthetic 468-point face: eyes 100px apart, centred at (cx, cy), rotated by `roll`. */
function syntheticLandmarks(cx: number, cy: number, roll: number, W = 1000, H = 1000) {
  const lm = Array.from({ length: 468 }, () => ({ x: cx / W, y: cy / H, z: 0 }));
  const set = (i: number, dx: number, dy: number) => {
    const c = Math.cos(roll);
    const s = Math.sin(roll);
    lm[i] = { x: (cx + dx * c - dy * s) / W, y: (cy + dx * s + dy * c) / H, z: 0 };
  };
  // Subject's right eye is image-left in an unmirrored photo.
  set(IDX.eyeROuter, -70, 0);
  set(IDX.eyeRInner, -30, 0);
  set(IDX.eyeLInner, 30, 0);
  set(IDX.eyeLOuter, 70, 0);
  set(IDX.forehead, 0, -100);
  set(IDX.chin, 0, 190);
  set(IDX.noseTip, 0, 75);
  set(IDX.jawR, -105, 30);
  set(IDX.jawL, 105, 30);
  IDX.oval.forEach((i, k) => {
    if (i === IDX.forehead || i === IDX.chin || i === IDX.jawR || i === IDX.jawL) return;
    const a = -Math.PI / 2 + (k / IDX.oval.length) * Math.PI * 2;
    set(i, Math.cos(a) * 105, 45 + Math.sin(a) * 145);
  });
  return lm;
}

/** A 2D context stand-in that accepts every call (jsdom has no canvas). */
function recordingCtx() {
  const calls: string[] = [];
  const gradient = { addColorStop: () => undefined };
  const ctx = new Proxy(
    { globalAlpha: 1, canvas: { width: 100, height: 100 } } as Record<string, unknown>,
    {
      get(target, prop: string) {
        if (prop in target) return target[prop];
        if (prop.startsWith('create')) return () => gradient;
        return (..._args: unknown[]) => {
          calls.push(prop);
        };
      },
      set(target, prop: string, value) {
        target[prop] = value;
        return true;
      },
    },
  );
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

describe('face landmarks → face units', () => {
  it('puts the origin between the eyes and measures roll', () => {
    const roll = (15 * Math.PI) / 180;
    const g = toFaceGeom(syntheticLandmarks(500, 400, roll), 1000, 1000);
    expect(g.origin.x).toBeCloseTo(500, 0);
    expect(g.origin.y).toBeCloseTo(400, 0);
    expect(g.roll).toBeCloseTo(roll, 3);
    expect(g.u).toBeGreaterThan(90);
    // Roll is removed in face units: eyes level, chin straight below.
    expect(g.local.eyeL.y).toBeCloseTo(g.local.eyeR.y, 3);
    expect(g.local.eyeL.x).toBeLessThan(g.local.eyeR.x);
    expect(g.local.chin.x).toBeCloseTo(0, 2);
    expect(g.local.chin.y).toBeGreaterThan(1);
  });

  it('keeps image-left/right consistent for mirrored (front camera) frames', () => {
    const g = toFaceGeom(syntheticLandmarks(500, 400, 0), 1000, 1000, true);
    expect(g.local.eyeL.x).toBeLessThan(g.local.eyeR.x);
    expect(g.local.jawL.x).toBeLessThan(g.local.jawR.x);
  });

  it('drops duplicate detections of the same face but keeps separate people', () => {
    const a = toFaceGeom(syntheticLandmarks(300, 400, 0), 1000, 1000);
    const a2 = toFaceGeom(syntheticLandmarks(310, 405, 0), 1000, 1000);
    const b = toFaceGeom(syntheticLandmarks(700, 400, 0), 1000, 1000);
    expect(dedupe([a, a2, b])).toHaveLength(2);
  });

  it('smooths small moves but snaps on big jumps', () => {
    const a = toFaceGeom(syntheticLandmarks(500, 400, 0), 1000, 1000);
    const near = toFaceGeom(syntheticLandmarks(520, 400, 0), 1000, 1000);
    const far = toFaceGeom(syntheticLandmarks(900, 400, 0), 1000, 1000);
    expect(smoothFaces([a], [near])[0].origin.x).toBeGreaterThan(500);
    expect(smoothFaces([a], [near])[0].origin.x).toBeLessThan(520);
    expect(smoothFaces([a], [far])[0].origin.x).toBeCloseTo(900, 0);
  });
});

describe('built-in face filters', () => {
  it('has original filters in every required category', () => {
    for (const c of ['animal', 'accessories', 'anime', 'superhero', 'fun', 'corporate'] as const) {
      expect(BUILT_IN_FILTERS.filter((f) => f.category === c).length).toBeGreaterThanOrEqual(4);
    }
    expect(new Set(BUILT_IN_FILTERS.map((f) => f.id)).size).toBe(BUILT_IN_FILTERS.length);
    expect(FILTER_CATEGORIES.map((c) => c.id)).toContain('custom');
  });

  it.each(BUILT_IN_FILTERS.map((f) => [f.id, f] as const))('%s draws on a face', (_id, f) => {
    const face = toFaceGeom(syntheticLandmarks(500, 400, 0.2), 1000, 1000);
    const { ctx, calls } = recordingCtx();
    drawFilterOnFace(ctx, f, face, NO_ADJUST, 0, 0.5);
    expect(calls.some((c) => /fill|stroke|drawImage|fillText|fillRect/.test(c))).toBe(true);
    // Every save is restored, so filters can't leak transforms into the next draw.
    expect(calls.filter((c) => c === 'save').length).toBe(calls.filter((c) => c === 'restore').length);
    // Thumbnails draw on the canonical face too.
    const t = recordingCtx();
    f.draw(t.ctx, canonicalFace(), 0);
  });

  it('clamps manual adjustments to sane ranges', () => {
    const a = clampAdjust({ dx: 10, dy: -10, scale: 9, rotation: 270, opacity: 0 });
    expect(a).toEqual({ dx: 4, dy: -4, scale: 2.5, rotation: -90, opacity: 0.1 });
  });
});

describe('full-body fitting', () => {
  const anchors: AvatarAnchors = {
    top: 0.02,
    bottom: 0.98,
    left: 0.2,
    right: 0.8,
    head: { cx: 0.5, cy: 0.1, h: 0.16 },
    opaqueBackground: false,
  };

  it('puts the avatar head on the person head and scales to the full height', () => {
    const frame = {
      head: { x: 400, y: 200 },
      headH: 100,
      headTop: 150,
      feetY: 850,
      tilt: 0,
      shoulderW: null,
      source: 'pose' as const,
    };
    const t = fitAvatarToBody(frame, anchors, { width: 460, height: 900, type: 'FULL_BODY' }, 1000, 1000);
    const D = t.scale * 1000;
    // Avatar head top lands on the person's head top, feet on the feet.
    expect(t.y * 1000 + (anchors.head.cy - anchors.head.h / 2 - 0.5) * D).toBeCloseTo(150, 0);
    expect(t.y * 1000 + (anchors.bottom - 0.5) * D).toBeCloseTo(850, 0);
    expect(t.x * 1000).toBeCloseTo(400, 0);
  });

  it('builds a body frame from pose landmarks (feet, lean)', () => {
    const points = Array.from({ length: 33 }, () => ({ x: 0, y: 0, v: 0 }));
    const put = (i: number, x: number, y: number) => (points[i] = { x, y, v: 0.99 });
    put(0, 500, 200); // nose
    put(7, 470, 195);
    put(8, 530, 195);
    put(11, 440, 300);
    put(12, 560, 300);
    put(23, 460, 520);
    put(24, 540, 520);
    put(27, 470, 880);
    put(28, 530, 880);
    const f = poseFrame({ points, cutout: null }, null, 1000, 1000);
    expect(f).not.toBeNull();
    expect(f!.feetY).toBeGreaterThan(880);
    expect(Math.abs(f!.tilt)).toBeLessThan(1);
    expect(f!.head.x).toBeCloseTo(500, 0);
  });
});
