/**
 * AR face filters. Every built-in filter is original vector artwork drawn for SageVatar
 * (no third-party assets) in *face units* (see FaceLocal in facemesh.ts): the canvas is
 * already translated to the face, rotated by the head roll and scaled so 1 unit ≈ the
 * distance between the eyes. Filters attach to real landmarks — glasses to the eyes,
 * noses to the nose tip, moustaches above the upper lip, masks to the face oval, ears
 * and hats to the top of the head — so they follow the face in photos and live video.
 */
import type { FaceGeom, FaceLocal, P } from './facemesh';

export type FilterCategory =
  | 'animal'
  | 'accessories'
  | 'anime'
  | 'superhero'
  | 'fun'
  | 'corporate'
  | 'characters'
  | 'custom';

export const FILTER_CATEGORIES: { id: FilterCategory; label: string }[] = [
  { id: 'animal', label: 'Animal' },
  { id: 'accessories', label: 'Accessories' },
  { id: 'anime', label: 'Anime' },
  { id: 'superhero', label: 'Superhero' },
  { id: 'fun', label: 'Fun' },
  { id: 'corporate', label: 'Corporate' },
  { id: 'characters', label: 'Characters' },
  { id: 'custom', label: 'My filters' },
];

export const CATEGORY_LABEL = Object.fromEntries(
  FILTER_CATEGORIES.map((c) => [c.id, c.label]),
) as Record<FilterCategory, string>;

export type Ctx = CanvasRenderingContext2D;

export interface FaceFilter {
  id: string;
  name: string;
  category: FilterCategory;
  tags: string[];
  /** Shown under "Explore effects". */
  featured?: boolean;
  /** Thumbnail URL for image-based filters (built-ins render their own). */
  thumbUrl?: string;
  /** Draws in face units. `t` is seconds (0 for still photos — output is deterministic). */
  draw(ctx: Ctx, f: FaceLocal, t: number): void;
}

/** Manual alignment on top of the automatic landmark fit (applies to every targeted face). */
export interface FilterAdjust {
  /** Offset in face units. */
  dx: number;
  dy: number;
  scale: number;
  /** Degrees. */
  rotation: number;
  opacity: number;
}
export const NO_ADJUST: FilterAdjust = { dx: 0, dy: 0, scale: 1, rotation: 0, opacity: 1 };

export function clampAdjust(a: FilterAdjust): FilterAdjust {
  return {
    dx: Math.max(-4, Math.min(4, a.dx)),
    dy: Math.max(-4, Math.min(4, a.dy)),
    scale: Math.max(0.4, Math.min(2.5, a.scale)),
    rotation: ((((a.rotation + 180) % 360) + 360) % 360) - 180,
    opacity: Math.max(0.1, Math.min(1, a.opacity)),
  };
}

/** Pivot for manual scale/rotation: roughly the centre of the face. */
const PIVOT: P = { x: 0, y: 0.55 };

/**
 * Draws `filter` on one detected face. `k` scales photo pixels to the canvas (the preview
 * canvas is smaller than the photo; export uses k = 1).
 */
export function drawFilterOnFace(
  ctx: Ctx,
  filter: FaceFilter,
  face: FaceGeom,
  adjust: FilterAdjust = NO_ADJUST,
  t = 0,
  k = 1,
) {
  ctx.save();
  ctx.scale(k, k);
  ctx.translate(face.origin.x, face.origin.y);
  ctx.rotate(face.roll);
  ctx.scale(face.u, face.u);
  ctx.translate(adjust.dx + PIVOT.x, adjust.dy + PIVOT.y);
  ctx.rotate((adjust.rotation * Math.PI) / 180);
  ctx.scale(adjust.scale, adjust.scale);
  ctx.translate(-PIVOT.x, -PIVOT.y);
  ctx.globalAlpha *= adjust.opacity;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  try {
    filter.draw(ctx, face.local, t);
  } finally {
    ctx.restore();
  }
}

/** Rough on-photo outline of a filtered face (for the drag handle), as photo fractions. */
export function faceHandle(face: FaceGeom, adjust: FilterAdjust, W: number, H: number) {
  const c = Math.cos(face.roll);
  const s = Math.sin(face.roll);
  const lx = adjust.dx + PIVOT.x;
  const ly = adjust.dy + PIVOT.y - 0.3;
  const x = face.origin.x + (lx * c - ly * s) * face.u;
  const y = face.origin.y + (lx * s + ly * c) * face.u;
  const size = face.u * 4.2 * adjust.scale;
  return {
    x: x / W,
    y: y / H,
    w: (size * 0.85) / W,
    h: size / H,
    rotation: (face.roll * 180) / Math.PI + adjust.rotation,
  };
}

// ====================================================================== drawing kit

const TAU = Math.PI * 2;
const OUT = 'rgba(20,16,14,0.9)';

const lerpP = (a: P, b: P, t: number): P => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const midP = (a: P, b: P) => lerpP(a, b, 0.5);
const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);

function el(ctx: Ctx, x: number, y: number, rx: number, ry: number, rot = 0) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(rx, 1e-4), Math.max(ry, 1e-4), rot, 0, TAU);
}
function lg(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}
function rg(ctx: Ctx, x: number, y: number, r: number, stops: [number, string][], fx = x, fy = y) {
  const g = ctx.createRadialGradient(fx, fy, 0, x, y, Math.max(r, 1e-4));
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}
function fillStroke(ctx: Ctx, fill: string | CanvasGradient, stroke = OUT, w = 0.035) {
  ctx.fillStyle = fill;
  ctx.fill();
  if (w > 0) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = w;
    ctx.stroke();
  }
}
/** Smooth closed/open curve through points (quadratic through midpoints). */
function curve(ctx: Ctx, pts: P[], closed = true) {
  if (pts.length < 2) return;
  ctx.beginPath();
  if (closed) {
    const start = midP(pts[pts.length - 1], pts[0]);
    ctx.moveTo(start.x, start.y);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const n = midP(p, pts[(i + 1) % pts.length]);
      ctx.quadraticCurveTo(p.x, p.y, n.x, n.y);
    }
    ctx.closePath();
  } else {
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const n = midP(pts[i], pts[i + 1]);
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, n.x, n.y);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last.x, last.y);
  }
}
function star(ctx: Ctx, x: number, y: number, r: number, points = 5, inner = 0.45, rot = 0) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = rot - Math.PI / 2 + (i * Math.PI) / points;
    const rr = i % 2 ? r * inner : r;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
  }
  ctx.closePath();
}
function heart(ctx: Ctx, x: number, y: number, s: number) {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.35);
  ctx.bezierCurveTo(x - s * 0.1, y + s * 0.2, x - s * 0.62, y + s * 0.02, x - s * 0.5, y - s * 0.32);
  ctx.bezierCurveTo(x - s * 0.38, y - s * 0.62, x - s * 0.04, y - s * 0.55, x, y - s * 0.28);
  ctx.bezierCurveTo(x + s * 0.04, y - s * 0.55, x + s * 0.38, y - s * 0.62, x + s * 0.5, y - s * 0.32);
  ctx.bezierCurveTo(x + s * 0.62, y + s * 0.02, x + s * 0.1, y + s * 0.2, x, y + s * 0.35);
  ctx.closePath();
}
/** Deterministic pseudo-random for decorations (same output every render). */
function rand(seed: number) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Head ellipse in face units (forehead/hair region + jaw sides). */
function head(f: FaceLocal) {
  const cx = (f.jawL.x + f.jawR.x) / 2;
  const cy = (f.jawL.y + f.jawR.y) / 2;
  const rx = (f.width / 2) * 1.04;
  const ry = Math.max(0.5, cy - f.headTop.y);
  /** Point on the head outline; a = -π/2 is the top, -π the image-left side, 0 the right. */
  const at = (a: number): P => ({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
  /** Outward angle (radians, 0 = up) of the head outline at `a` — for ears and horns. */
  const tilt = (a: number) => Math.atan2(rx * Math.cos(a), -ry * Math.sin(a));
  /** Point on the outline pushed outward by `d` units (hair sits outside the face oval). */
  const out = (a: number, d: number): P => {
    const p = at(a);
    const dx = p.x - cx;
    const dy = p.y - cy;
    const l = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / l) * d, y: p.y + (dy / l) * d };
  };
  return { cx, cy, rx, ry, at, tilt, out };
}
/** Size factor relative to an average face (width 2.1 units). */
const S = (f: FaceLocal) => f.width / 2.1;

function withTransform(ctx: Ctx, at: P, angle: number, s: number, fn: () => void) {
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(angle);
  ctx.scale(s, s);
  fn();
  ctx.restore();
}
function clipToFace(ctx: Ctx, f: FaceLocal, fn: () => void) {
  ctx.save();
  curve(ctx, f.outline);
  ctx.clip();
  fn();
  ctx.restore();
}

/** Ear with the base at the origin, pointing up (−y). */
function earShape(ctx: Ctx, len: number, wid: number, pointy: number) {
  ctx.beginPath();
  ctx.moveTo(-wid / 2, 0);
  ctx.bezierCurveTo(-wid * (0.75 - pointy * 0.4), -len * 0.55, -wid * 0.3 * (1 - pointy), -len, 0, -len);
  ctx.bezierCurveTo(wid * 0.3 * (1 - pointy), -len, wid * (0.75 - pointy * 0.4), -len * 0.55, wid / 2, 0);
  ctx.closePath();
}
function ears(
  ctx: Ctx,
  f: FaceLocal,
  opts: {
    spread: number;
    len: number;
    wid: number;
    pointy: number;
    outer: (ctx: Ctx, len: number, wid: number) => string | CanvasGradient;
    inner?: string;
    flop?: number;
    extra?: (ctx: Ctx, len: number, wid: number, side: -1 | 1) => void;
  },
) {
  const h = head(f);
  const s = S(f);
  for (const side of [-1, 1] as const) {
    const a = -Math.PI / 2 + side * opts.spread;
    const base = h.at(a);
    const ang = h.tilt(a) * 0.75 + side * (opts.flop ?? 0);
    withTransform(ctx, base, ang, s, () => {
      earShape(ctx, opts.len, opts.wid, opts.pointy);
      fillStroke(ctx, opts.outer(ctx, opts.len, opts.wid));
      if (opts.inner) {
        ctx.save();
        ctx.translate(0, -opts.len * 0.06);
        earShape(ctx, opts.len * 0.78, opts.wid * 0.55, opts.pointy);
        ctx.fillStyle = opts.inner;
        ctx.fill();
        ctx.restore();
      }
      opts.extra?.(ctx, opts.len, opts.wid, side);
    });
  }
}

function whiskers(ctx: Ctx, f: FaceLocal, color = 'rgba(30,24,22,0.85)', len = 1.1) {
  const s = S(f);
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.03 * s;
  for (const side of [-1, 1] as const) {
    const n = side < 0 ? f.nostrilL : f.nostrilR;
    const base = { x: n.x + side * 0.22 * s, y: lerpP(f.noseTip, f.lipTop, 0.4).y };
    for (const dy of [-0.12, 0.02, 0.16]) {
      ctx.beginPath();
      ctx.moveTo(base.x, base.y + dy * s);
      ctx.quadraticCurveTo(
        base.x + side * len * 0.5 * s,
        base.y + dy * s * 1.6 - 0.06 * s,
        base.x + side * len * s,
        base.y + dy * s * 2.6,
      );
      ctx.stroke();
    }
  }
}

function animalNose(ctx: Ctx, f: FaceLocal, color: string, size = 1, shape: 'oval' | 'heart' | 'tri' = 'oval') {
  const s = S(f) * size;
  const c = lerpP(f.noseTip, f.noseBottom, 0.3);
  if (shape === 'heart') {
    heart(ctx, c.x, c.y, 0.42 * s);
    fillStroke(ctx, rg(ctx, c.x, c.y, 0.3 * s, [[0, '#ffc0d4'], [1, color]], c.x - 0.06 * s, c.y - 0.1 * s), OUT, 0.025 * s);
  } else if (shape === 'tri') {
    ctx.beginPath();
    ctx.moveTo(c.x - 0.2 * s, c.y - 0.1 * s);
    ctx.quadraticCurveTo(c.x, c.y - 0.16 * s, c.x + 0.2 * s, c.y - 0.1 * s);
    ctx.quadraticCurveTo(c.x + 0.05 * s, c.y + 0.14 * s, c.x, c.y + 0.16 * s);
    ctx.quadraticCurveTo(c.x - 0.05 * s, c.y + 0.14 * s, c.x - 0.2 * s, c.y - 0.1 * s);
    fillStroke(ctx, color, OUT, 0.025 * s);
  } else {
    el(ctx, c.x, c.y, 0.26 * s, 0.18 * s);
    fillStroke(ctx, rg(ctx, c.x, c.y, 0.28 * s, [[0, '#6b5a55'], [0.5, color], [1, color]], c.x - 0.08 * s, c.y - 0.08 * s), OUT, 0.02 * s);
  }
  // Glossy highlight.
  el(ctx, c.x - 0.07 * s, c.y - 0.06 * s, 0.07 * s, 0.04 * s, -0.4);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fill();
}

// ---- glasses kit (shared by accessories and corporate) ----
type LensShape = 'round' | 'aviator' | 'rect' | 'browline' | 'heart' | 'star';
function lensPath(ctx: Ctx, c: P, w: number, h: number, shape: LensShape, side: -1 | 1) {
  switch (shape) {
    case 'round':
      el(ctx, c.x, c.y, w / 2, h / 2);
      return;
    case 'aviator':
      ctx.beginPath();
      ctx.moveTo(c.x - side * w * 0.5, c.y - h * 0.42);
      ctx.quadraticCurveTo(c.x, c.y - h * 0.56, c.x + side * w * 0.5, c.y - h * 0.4);
      ctx.bezierCurveTo(c.x + side * w * 0.58, c.y + h * 0.3, c.x + side * w * 0.1, c.y + h * 0.62, c.x - side * w * 0.12, c.y + h * 0.5);
      ctx.bezierCurveTo(c.x - side * w * 0.46, c.y + h * 0.38, c.x - side * w * 0.56, c.y, c.x - side * w * 0.5, c.y - h * 0.42);
      ctx.closePath();
      return;
    case 'rect':
    case 'browline': {
      const r = h * 0.28;
      ctx.beginPath();
      ctx.roundRect(c.x - w / 2, c.y - h / 2, w, h, [r, r, r * 1.3, r * 1.3]);
      return;
    }
    case 'heart':
      heart(ctx, c.x, c.y + h * 0.05, w * 1.05);
      return;
    case 'star':
      star(ctx, c.x, c.y, w * 0.62, 5, 0.5);
      return;
  }
}
function glasses(
  ctx: Ctx,
  f: FaceLocal,
  o: { shape: LensShape; frame: string; lens: string | ((c: P, w: number, h: number) => string | CanvasGradient); rim?: number; size?: number; arms?: boolean },
) {
  const s = S(f) * (o.size ?? 1);
  const span = dist(f.eyeL, f.eyeR);
  const w = Math.max(span * 0.78, (f.eyeLW + f.eyeRW) * 0.95) * (o.size ?? 1);
  const h = w * (o.shape === 'round' ? 0.92 : o.shape === 'aviator' ? 0.8 : 0.62);
  const rim = (o.rim ?? 0.06) * s;
  const lenses: [P, -1 | 1][] = [
    [{ x: f.eyeL.x, y: f.eyeL.y + 0.02 }, -1],
    [{ x: f.eyeR.x, y: f.eyeR.y + 0.02 }, 1],
  ];
  // Arms to the sides of the head.
  if (o.arms !== false) {
    ctx.strokeStyle = o.frame;
    ctx.lineWidth = rim * 0.9;
    for (const [c, side] of lenses) {
      const edge = { x: c.x + (side * w) / 2, y: c.y - h * 0.15 };
      const jaw = side < 0 ? f.jawL : f.jawR;
      ctx.beginPath();
      ctx.moveTo(edge.x, edge.y);
      ctx.lineTo(jaw.x - side * 0.02, Math.min(jaw.y, edge.y + 0.06));
      ctx.stroke();
    }
  }
  for (const [c, side] of lenses) {
    lensPath(ctx, c, w, h, o.shape, side);
    ctx.fillStyle = typeof o.lens === 'string' ? o.lens : o.lens(c, w, h);
    ctx.fill();
    ctx.strokeStyle = o.frame;
    ctx.lineWidth = rim;
    ctx.stroke();
    if (o.shape === 'browline') {
      ctx.beginPath();
      ctx.moveTo(c.x - w / 2, c.y - h * 0.32);
      ctx.quadraticCurveTo(c.x, c.y - h * 0.62, c.x + w / 2, c.y - h * 0.32);
      ctx.lineWidth = rim * 2.6;
      ctx.stroke();
    }
    // Lens glint.
    ctx.beginPath();
    ctx.moveTo(c.x - w * 0.22, c.y - h * 0.18);
    ctx.lineTo(c.x - w * 0.06, c.y - h * 0.3);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = rim * 0.6;
    ctx.stroke();
  }
  // Bridge.
  const a = { x: f.eyeL.x + w / 2, y: f.eyeL.y - h * 0.08 };
  const b = { x: f.eyeR.x - w / 2, y: f.eyeR.y - h * 0.08 };
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.quadraticCurveTo((a.x + b.x) / 2, Math.min(a.y, b.y) - h * 0.18, b.x, b.y);
  ctx.strokeStyle = o.frame;
  ctx.lineWidth = rim;
  ctx.stroke();
}

function moustache(ctx: Ctx, f: FaceLocal, color: string, style: 'handlebar' | 'chevron' | 'pencil' = 'handlebar') {
  const s = S(f);
  const c = lerpP(f.noseBottom, f.lipTop, 0.6);
  const w = Math.max(dist(f.mouthL, f.mouthR) * 0.75, 0.55 * s);
  ctx.beginPath();
  if (style === 'handlebar') {
    ctx.moveTo(c.x, c.y - 0.06 * s);
    ctx.bezierCurveTo(c.x - w * 0.4, c.y - 0.2 * s, c.x - w * 0.9, c.y - 0.05 * s, c.x - w * 1.05, c.y + 0.02 * s);
    ctx.bezierCurveTo(c.x - w * 1.35, c.y + 0.06 * s, c.x - w * 1.4, c.y - 0.3 * s, c.x - w * 1.15, c.y - 0.32 * s);
    ctx.bezierCurveTo(c.x - w * 1.32, c.y - 0.16 * s, c.x - w * 1.2, c.y - 0.06 * s, c.x - w * 1.02, c.y - 0.12 * s);
    ctx.bezierCurveTo(c.x - w * 0.7, c.y + 0.2 * s, c.x - w * 0.2, c.y + 0.12 * s, c.x, c.y + 0.04 * s);
    ctx.bezierCurveTo(c.x + w * 0.2, c.y + 0.12 * s, c.x + w * 0.7, c.y + 0.2 * s, c.x + w * 1.02, c.y - 0.12 * s);
    ctx.bezierCurveTo(c.x + w * 1.2, c.y - 0.06 * s, c.x + w * 1.32, c.y - 0.16 * s, c.x + w * 1.15, c.y - 0.32 * s);
    ctx.bezierCurveTo(c.x + w * 1.4, c.y - 0.3 * s, c.x + w * 1.35, c.y + 0.06 * s, c.x + w * 1.05, c.y + 0.02 * s);
    ctx.bezierCurveTo(c.x + w * 0.9, c.y - 0.05 * s, c.x + w * 0.4, c.y - 0.2 * s, c.x, c.y - 0.06 * s);
  } else if (style === 'chevron') {
    ctx.moveTo(c.x, c.y - 0.14 * s);
    ctx.bezierCurveTo(c.x - w * 0.5, c.y - 0.2 * s, c.x - w * 0.95, c.y - 0.05 * s, c.x - w * 1.0, c.y + 0.18 * s);
    ctx.quadraticCurveTo(c.x - w * 0.5, c.y + 0.12 * s, c.x, c.y + 0.1 * s);
    ctx.quadraticCurveTo(c.x + w * 0.5, c.y + 0.12 * s, c.x + w * 1.0, c.y + 0.18 * s);
    ctx.bezierCurveTo(c.x + w * 0.95, c.y - 0.05 * s, c.x + w * 0.5, c.y - 0.2 * s, c.x, c.y - 0.14 * s);
  } else {
    ctx.moveTo(c.x - w * 0.85, c.y + 0.04 * s);
    ctx.quadraticCurveTo(c.x, c.y - 0.12 * s, c.x + w * 0.85, c.y + 0.04 * s);
    ctx.quadraticCurveTo(c.x, c.y - 0.02 * s, c.x - w * 0.85, c.y + 0.04 * s);
  }
  ctx.closePath();
  fillStroke(ctx, lg(ctx, c.x, c.y - 0.2 * s, c.x, c.y + 0.2 * s, [[0, shade(color, 0.25)], [1, color]]), 'rgba(0,0,0,0.5)', 0.02 * s);
  // Hair strands.
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 0.012 * s;
  for (let i = -6; i <= 6; i++) {
    if (!i) continue;
    const x = c.x + (i / 6) * w * 0.85;
    ctx.beginPath();
    ctx.moveTo(x, c.y - 0.04 * s);
    ctx.lineTo(x + Math.sign(i) * 0.05 * s, c.y + 0.06 * s);
    ctx.stroke();
  }
}

/** Lightens (+) or darkens (−) a #rrggbb colour. */
function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) =>
    Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k))
      .toString(16)
      .padStart(2, '0');
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

/** Points of the face oval from one side to the other through the chin, at or below `y`. */
function lowerOutline(f: FaceLocal, y: number) {
  const o = f.outline;
  const chinI = o.reduce((b, p, i) => (p.y > o[b].y ? i : b), 0);
  const pts: P[] = [];
  // Walk from the chin both ways while below y.
  const right: P[] = [];
  for (let i = chinI; ; i = (i - 1 + o.length) % o.length) {
    if (o[i].y < y || right.length > o.length / 2) break;
    right.push(o[i]);
  }
  const left: P[] = [];
  for (let i = (chinI + 1) % o.length; ; i = (i + 1) % o.length) {
    if (o[i].y < y || left.length > o.length / 2) break;
    left.push(o[i]);
  }
  pts.push(...right.reverse(), ...left);
  // Always image-left → chin → image-right (mirrored frames reverse the oval order).
  if (pts.length > 1 && pts[0].x > pts[pts.length - 1].x) pts.reverse();
  return pts;
}

/** Eye-mask (domino) shape covering both eyes, with eye holes cut out (even-odd). */
function dominoPath(ctx: Ctx, f: FaceLocal, grow = 1) {
  const s = S(f);
  const L = f.eyeL;
  const R = f.eyeR;
  const top = Math.min(...f.browL.map((p) => p.y), ...f.browR.map((p) => p.y)) + 0.05;
  const bottom = Math.max(L.y, R.y) + 0.38 * s * grow;
  const w = (R.x - L.x) / 2 + 0.62 * s * grow;
  const cx = (L.x + R.x) / 2;
  ctx.beginPath();
  ctx.moveTo(cx, top + 0.08 * s);
  ctx.bezierCurveTo(cx - w * 0.4, top - 0.06 * s, cx - w * 0.95, top - 0.02 * s, cx - w * 1.1, top - 0.14 * s);
  ctx.bezierCurveTo(cx - w * 1.08, bottom - 0.1 * s, cx - w * 0.75, bottom + 0.04 * s, cx - w * 0.38, bottom - 0.04 * s);
  ctx.quadraticCurveTo(cx - 0.12 * s, bottom - 0.12 * s, cx, f.noseBridge.y + 0.3 * s);
  ctx.quadraticCurveTo(cx + 0.12 * s, bottom - 0.12 * s, cx + w * 0.38, bottom - 0.04 * s);
  ctx.bezierCurveTo(cx + w * 0.75, bottom + 0.04 * s, cx + w * 1.08, bottom - 0.1 * s, cx + w * 1.1, top - 0.14 * s);
  ctx.bezierCurveTo(cx + w * 0.95, top - 0.02 * s, cx + w * 0.4, top - 0.06 * s, cx, top + 0.08 * s);
  ctx.closePath();
  for (const [e, ew] of [
    [L, f.eyeLW],
    [R, f.eyeRW],
  ] as const) {
    ctx.moveTo(e.x + ew * 0.75, e.y);
    ctx.ellipse(e.x, e.y, ew * 0.75, Math.max(0.14, ew * 0.42), 0, 0, TAU);
  }
}

// ====================================================================== the library

const ANIMAL: FaceFilter[] = [
  {
    id: 'bunny',
    name: 'Bunny',
    category: 'animal',
    tags: ['rabbit', 'ears', 'nose', 'cute'],
    featured: true,
    draw(ctx, f) {
      ears(ctx, f, {
        spread: 0.42,
        len: 2.3,
        wid: 0.62,
        pointy: 0,
        outer: (c, len) => lg(c, 0, 0, 0, -len, [[0, '#d9d4d0'], [0.4, '#ffffff'], [1, '#f4efec']]),
        inner: '#f7b5c8',
        flop: 0.08,
      });
      whiskers(ctx, f, 'rgba(60,50,48,0.8)', 0.95);
      animalNose(ctx, f, '#f48fb1', 0.85, 'heart');
      // Buck teeth under the upper lip.
      const s = S(f);
      const lt = f.lipTop;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.roundRect(lt.x + (side < 0 ? -0.15 : 0.005) * s, lt.y + 0.06 * s, 0.145 * s, 0.2 * s, [0, 0, 0.04 * s, 0.04 * s]);
        fillStroke(ctx, '#ffffff', 'rgba(60,50,48,0.7)', 0.018 * s);
      }
    },
  },
  {
    id: 'kitty',
    name: 'Kitty',
    category: 'animal',
    tags: ['cat', 'ears', 'whiskers'],
    featured: true,
    draw(ctx, f) {
      ears(ctx, f, {
        spread: 0.62,
        len: 0.95,
        wid: 0.95,
        pointy: 1,
        outer: (c, len) => lg(c, 0, 0, 0, -len, [[0, '#3f3a3a'], [1, '#6a6262']]),
        inner: '#f6a5bf',
      });
      whiskers(ctx, f, 'rgba(25,22,22,0.85)', 1.15);
      animalNose(ctx, f, '#f06292', 0.75, 'tri');
      for (const side of [-1, 1] as const) {
        const c = side < 0 ? f.cheekL : f.cheekR;
        el(ctx, c.x, c.y + 0.05, 0.26 * S(f), 0.15 * S(f));
        ctx.fillStyle = 'rgba(255,120,150,0.28)';
        ctx.fill();
      }
    },
  },
  {
    id: 'puppy',
    name: 'Puppy',
    category: 'animal',
    tags: ['dog', 'ears', 'nose', 'tongue'],
    featured: true,
    draw(ctx, f) {
      const s = S(f);
      const h = head(f);
      for (const side of [-1, 1] as const) {
        const base = h.out(-Math.PI / 2 + side * 1.2, 0.35 * s);
        withTransform(ctx, base, side * 0.25, s, () => {
          ctx.beginPath();
          ctx.moveTo(-0.3 * side, -0.1);
          ctx.bezierCurveTo(side * 0.6, -0.35, side * 0.95, 0.4, side * 0.75, 1.35);
          ctx.bezierCurveTo(side * 0.65, 1.7, side * 0.25, 1.6, side * 0.2, 1.2);
          ctx.bezierCurveTo(side * 0.15, 0.7, -side * 0.1, 0.3, -0.3 * side, -0.1);
          ctx.closePath();
          fillStroke(ctx, lg(ctx, 0, 0, 0, 1.6, [[0, '#9a6b45'], [1, '#6e4529']]));
        });
      }
      // Tongue when the mouth opens.
      if (f.mouthOpen > 0.12) {
        const c = f.mouthCenter;
        const w = dist(f.mouthL, f.mouthR) * 0.42;
        ctx.beginPath();
        ctx.moveTo(c.x - w, c.y);
        ctx.bezierCurveTo(c.x - w, c.y + 0.9 * s, c.x + w, c.y + 0.9 * s, c.x + w, c.y);
        ctx.closePath();
        fillStroke(ctx, lg(ctx, c.x, c.y, c.x, c.y + 0.8 * s, [[0, '#e5737c'], [1, '#f497a0']]), '#a8404a', 0.03 * s);
        ctx.beginPath();
        ctx.moveTo(c.x, c.y + 0.05 * s);
        ctx.lineTo(c.x, c.y + 0.4 * s);
        ctx.strokeStyle = '#b94c57';
        ctx.lineWidth = 0.025 * s;
        ctx.stroke();
      }
      animalNose(ctx, f, '#1d1716', 1.15, 'oval');
    },
  },
  {
    id: 'bear',
    name: 'Teddy Bear',
    category: 'animal',
    tags: ['bear', 'ears', 'nose'],
    draw(ctx, f) {
      const s = S(f);
      const h = head(f);
      for (const side of [-1, 1] as const) {
        const p = h.out(-Math.PI / 2 + side * 0.62, 0.38 * s);
        el(ctx, p.x, p.y - 0.05 * s, 0.42 * s, 0.4 * s);
        fillStroke(ctx, rg(ctx, p.x, p.y, 0.45 * s, [[0, '#a87348'], [1, '#7a4f2e']]));
        el(ctx, p.x, p.y, 0.24 * s, 0.22 * s);
        ctx.fillStyle = '#e2b48a';
        ctx.fill();
      }
      const m = lerpP(f.noseTip, f.lipTop, 0.35);
      el(ctx, m.x, m.y, 0.42 * s, 0.3 * s);
      ctx.fillStyle = 'rgba(226,180,138,0.75)';
      ctx.fill();
      animalNose(ctx, f, '#3b2417', 0.95, 'oval');
    },
  },
  {
    id: 'tiger',
    name: 'Tiger',
    category: 'animal',
    tags: ['tiger', 'stripes', 'face paint', 'ears'],
    featured: true,
    draw(ctx, f) {
      const s = S(f);
      ears(ctx, f, {
        spread: 0.66,
        len: 0.7,
        wid: 0.85,
        pointy: 0.3,
        outer: () => '#f08a24',
        inner: '#fff4e2',
        extra: (c, len) => {
          c.beginPath();
          c.moveTo(-0.2, -len * 0.95);
          c.lineTo(0, -len * 0.7);
          c.lineTo(0.2, -len * 0.95);
          c.fillStyle = '#1b1310';
          c.fill();
        },
      });
      clipToFace(ctx, f, () => {
        ctx.globalCompositeOperation = 'multiply';
        curve(ctx, f.outline);
        ctx.fillStyle = 'rgba(245,150,60,0.35)';
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        // Muzzle stays light.
        const m = lerpP(f.noseTip, f.lipTop, 0.5);
        for (const side of [-1, 1]) {
          el(ctx, m.x + side * 0.24 * s, m.y + 0.05 * s, 0.3 * s, 0.24 * s);
          ctx.fillStyle = 'rgba(255,248,236,0.55)';
          ctx.fill();
        }
        // Stripes from the sides and forehead.
        ctx.fillStyle = 'rgba(25,16,12,0.85)';
        for (const side of [-1, 1] as const) {
          const edge = side < 0 ? f.jawL.x : f.jawR.x;
          for (let i = 0; i < 4; i++) {
            const y = f.eyeL.y - 0.4 + i * 0.42;
            ctx.beginPath();
            ctx.moveTo(edge - side * 0.1, y - 0.12 * s);
            ctx.quadraticCurveTo(edge - side * 0.55 * s, y + 0.04 * s, edge - side * (0.7 - i * 0.06) * s, y + 0.1 * s);
            ctx.quadraticCurveTo(edge - side * 0.45 * s, y + 0.12 * s, edge - side * 0.1, y + 0.12 * s);
            ctx.fill();
          }
        }
        const fh = f.forehead;
        for (const dx of [-0.32, 0, 0.32]) {
          ctx.beginPath();
          ctx.moveTo(fh.x + dx * s - 0.1 * s, fh.y - 0.1 * s);
          ctx.lineTo(fh.x + dx * 0.6 * s, fh.y + (dx ? 0.42 : 0.55) * s);
          ctx.lineTo(fh.x + dx * s + 0.1 * s, fh.y - 0.1 * s);
          ctx.fill();
        }
      });
      animalNose(ctx, f, '#3a2220', 0.85, 'tri');
      whiskers(ctx, f, 'rgba(250,250,250,0.85)', 1.0);
    },
  },
  {
    id: 'fox',
    name: 'Fox',
    category: 'animal',
    tags: ['fox', 'ears', 'cheeks'],
    draw(ctx, f) {
      const s = S(f);
      ears(ctx, f, {
        spread: 0.6,
        len: 1.15,
        wid: 0.9,
        pointy: 1,
        outer: (c, len) => lg(c, 0, 0, 0, -len, [[0, '#e46a1f'], [0.85, '#c8541a'], [1, '#2a1a14']]),
        inner: '#fff1e0',
      });
      for (const side of [-1, 1] as const) {
        const jaw = side < 0 ? f.jawL : f.jawR;
        const c = side < 0 ? f.cheekL : f.cheekR;
        ctx.beginPath();
        ctx.moveTo(jaw.x + side * 0.05, jaw.y + 0.2 * s);
        for (let i = 0; i < 4; i++) {
          ctx.lineTo(jaw.x + side * (0.25 - i * 0.02) * s, jaw.y + (0.35 + i * 0.22) * s);
          ctx.lineTo(jaw.x - side * (0.02 + i * 0.05) * s, jaw.y + (0.42 + i * 0.22) * s);
        }
        ctx.quadraticCurveTo(c.x, c.y + 0.5 * s, c.x - side * 0.1 * s, c.y + 0.1 * s);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,248,240,0.92)';
        ctx.fill();
      }
      animalNose(ctx, f, '#1b1414', 0.8, 'oval');
      whiskers(ctx, f, 'rgba(30,24,22,0.75)', 0.9);
    },
  },
  {
    id: 'panda',
    name: 'Panda',
    category: 'animal',
    tags: ['panda', 'bear', 'eye patches'],
    draw(ctx, f) {
      const s = S(f);
      const h = head(f);
      for (const side of [-1, 1] as const) {
        const p = h.out(-Math.PI / 2 + side * 0.62, 0.36 * s);
        el(ctx, p.x, p.y - 0.04 * s, 0.4 * s, 0.38 * s);
        fillStroke(ctx, '#151515', '#000', 0.02);
        const e = side < 0 ? f.eyeL : f.eyeR;
        el(ctx, e.x + side * 0.05 * s, e.y + 0.06 * s, 0.36 * s, 0.27 * s, side * 0.5);
        ctx.fillStyle = 'rgba(15,15,15,0.62)';
        ctx.fill();
      }
      animalNose(ctx, f, '#111111', 0.9, 'oval');
    },
  },
  {
    id: 'deer',
    name: 'Woodland Deer',
    category: 'animal',
    tags: ['deer', 'antlers', 'freckles'],
    draw(ctx, f) {
      const s = S(f);
      const h = head(f);
      ctx.strokeStyle = '#7a5332';
      ctx.lineCap = 'round';
      for (const side of [-1, 1] as const) {
        const base = h.at(-Math.PI / 2 + side * 0.45);
        withTransform(ctx, base, h.tilt(-Math.PI / 2 + side * 0.45) * 0.5, s, () => {
          ctx.lineWidth = 0.16;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.quadraticCurveTo(side * 0.35, -0.6, side * 0.2, -1.3);
          ctx.moveTo(side * 0.24, -0.55);
          ctx.quadraticCurveTo(side * 0.7, -0.7, side * 0.8, -1.05);
          ctx.moveTo(side * 0.27, -0.95);
          ctx.quadraticCurveTo(side * 0.0, -1.1, -side * 0.12, -1.35);
          ctx.stroke();
        });
      }
      for (let i = 0; i < 9; i++) {
        const side = i % 2 ? 1 : -1;
        const c = side < 0 ? f.cheekL : f.cheekR;
        el(ctx, c.x + (rand(i) - 0.5) * 0.4 * s, c.y - 0.25 * s + rand(i + 9) * 0.3 * s, 0.035 * s, 0.035 * s);
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.fill();
      }
      animalNose(ctx, f, '#3d2a20', 0.75, 'oval');
    },
  },
];

const ACCESSORIES: FaceFilter[] = [
  {
    id: 'round-glasses',
    name: 'Round Specs',
    category: 'accessories',
    tags: ['glasses', 'round', 'gold'],
    draw: (ctx, f) =>
      glasses(ctx, f, { shape: 'round', frame: '#b8892f', lens: 'rgba(200,230,255,0.14)', rim: 0.05 }),
  },
  {
    id: 'aviators',
    name: 'Aviators',
    category: 'accessories',
    tags: ['sunglasses', 'shades', 'cool'],
    featured: true,
    draw: (ctx, f) =>
      glasses(ctx, f, {
        shape: 'aviator',
        frame: '#c9a24a',
        rim: 0.04,
        size: 1.12,
        lens: (c, _w, h) =>
          lg(ctx, c.x, c.y - h / 2, c.x, c.y + h / 2, [[0, 'rgba(25,30,45,0.95)'], [0.6, 'rgba(60,70,95,0.92)'], [1, 'rgba(120,90,160,0.85)']]),
      }),
  },
  {
    id: 'handlebar',
    name: 'Handlebar Moustache',
    category: 'accessories',
    tags: ['moustache', 'mustache', 'vintage'],
    featured: true,
    draw: (ctx, f) => moustache(ctx, f, '#3b2618', 'handlebar'),
  },
  {
    id: 'full-beard',
    name: 'Lumberjack Beard',
    category: 'accessories',
    tags: ['beard', 'moustache'],
    draw(ctx, f) {
      const s = S(f);
      const top = lerpP(f.noseTip, f.lipTop, 0.5).y;
      const lower = lowerOutline(f, f.noseTip.y - 0.05);
      if (lower.length < 3) return;
      ctx.beginPath();
      ctx.moveTo(lower[0].x, lower[0].y);
      for (const p of lower) ctx.lineTo(p.x, p.y + 0.18 * s * Math.max(0, (p.y - top) / 1.2));
      // Up around the mouth (hole cut out with even-odd).
      ctx.lineTo(f.mouthR.x + 0.2 * s, top);
      ctx.lineTo(f.mouthL.x - 0.2 * s, top);
      ctx.closePath();
      const m = { x: (f.mouthL.x + f.mouthR.x) / 2, y: (f.lipTop.y + f.lipBottom.y) / 2 };
      const mw = dist(f.mouthL, f.mouthR) / 2 + 0.1 * s;
      const mh = (f.lipBottom.y - f.lipTop.y) / 2 + 0.07 * s;
      ctx.moveTo(m.x + mw, m.y);
      ctx.ellipse(m.x, m.y, mw, mh, 0, 0, TAU);
      ctx.fillStyle = lg(ctx, 0, top, 0, f.chin.y + 0.4, [[0, '#5a3820'], [1, '#3a2312']]);
      ctx.fill('evenodd');
      ctx.strokeStyle = 'rgba(255,220,180,0.12)';
      ctx.lineWidth = 0.015 * s;
      for (let i = 0; i < 40; i++) {
        const x = f.jawL.x + rand(i) * (f.jawR.x - f.jawL.x);
        const y = top + 0.3 + rand(i + 40) * (f.chin.y - top);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (rand(i + 80) - 0.5) * 0.1, y + 0.12 * s);
        ctx.stroke();
      }
      moustache(ctx, f, '#4a2e1a', 'chevron');
    },
  },
  {
    id: 'top-hat',
    name: 'Top Hat',
    category: 'accessories',
    tags: ['hat', 'formal', 'gentleman'],
    draw(ctx, f) {
      const s = S(f);
      const h = head(f);
      const top = h.at(-Math.PI / 2);
      const w = f.width * 0.62;
      withTransform(ctx, { x: top.x, y: top.y + 0.35 * s }, 0, 1, () => {
        el(ctx, 0, 0, w * 1.45, 0.22 * s);
        fillStroke(ctx, '#121212', '#000', 0.02);
        ctx.beginPath();
        ctx.moveTo(-w, 0);
        ctx.lineTo(-w * 0.92, -1.7 * s);
        ctx.quadraticCurveTo(0, -1.82 * s, w * 0.92, -1.7 * s);
        ctx.lineTo(w, 0);
        ctx.quadraticCurveTo(0, 0.18 * s, -w, 0);
        fillStroke(ctx, lg(ctx, -w, 0, w, 0, [[0, '#0d0d0d'], [0.45, '#3a3a3a'], [1, '#0d0d0d']]), '#000', 0.02);
        ctx.beginPath();
        ctx.moveTo(-w * 0.99, -0.12 * s);
        ctx.lineTo(-w * 0.96, -0.45 * s);
        ctx.quadraticCurveTo(0, -0.55 * s, w * 0.96, -0.45 * s);
        ctx.lineTo(w * 0.99, -0.12 * s);
        ctx.quadraticCurveTo(0, -0.04 * s, -w * 0.99, -0.12 * s);
        ctx.fillStyle = '#b3202f';
        ctx.fill();
      });
    },
  },
  {
    id: 'headband',
    name: 'Sport Headband',
    category: 'accessories',
    tags: ['headband', 'sport', 'band'],
    draw(ctx, f) {
      const s = S(f);
      const h = head(f);
      const y0 = lerpP(f.forehead, f.headTop, 0.15).y;
      const band = 0.42 * s;
      const pts: P[] = [];
      for (let i = 0; i <= 20; i++) {
        const a = -Math.PI + 0.35 + (i / 20) * (Math.PI - 0.7);
        const p = h.at(a);
        pts.push({ x: p.x, y: y0 + (p.y - h.at(-Math.PI / 2).y) * 0.18 });
      }
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (const p of pts) ctx.lineTo(p.x, p.y);
      for (const p of [...pts].reverse()) ctx.lineTo(p.x, p.y + band);
      ctx.closePath();
      fillStroke(ctx, lg(ctx, 0, y0, 0, y0 + band, [[0, '#ef4444'], [0.48, '#ef4444'], [0.5, '#ffffff'], [0.62, '#ffffff'], [0.64, '#ef4444'], [1, '#c81e1e']]), 'rgba(80,0,0,0.6)', 0.025);
      // Knot tails on the side.
      const end = pts[pts.length - 1];
      ctx.beginPath();
      ctx.moveTo(end.x, end.y + band * 0.2);
      ctx.quadraticCurveTo(end.x + 0.4 * s, end.y + band, end.x + 0.25 * s, end.y + band * 2.2);
      ctx.lineTo(end.x + 0.05 * s, end.y + band * 1.9);
      ctx.quadraticCurveTo(end.x + 0.15 * s, end.y + band, end.x, end.y + band * 0.8);
      fillStroke(ctx, '#dc2626', 'rgba(80,0,0,0.6)', 0.02);
    },
  },
  {
    id: 'face-mask',
    name: 'Face Mask',
    category: 'accessories',
    tags: ['mask', 'medical', 'face covering'],
    draw(ctx, f) {
      const s = S(f);
      const top = lerpP(f.noseBridge, f.noseTip, 0.45).y;
      const lower = lowerOutline(f, top + 0.15);
      if (lower.length < 3) return;
      const first = lower[0];
      const last = lower[lower.length - 1];
      ctx.beginPath();
      ctx.moveTo(first.x * 0.98, top + 0.18 * s);
      for (const p of lower) ctx.lineTo(p.x * 0.98, Math.min(p.y + 0.06 * s, f.chin.y + 0.1 * s));
      ctx.lineTo(last.x * 0.98, top + 0.18 * s);
      ctx.quadraticCurveTo(f.noseTip.x * 0.5 + last.x * 0.5, top - 0.06 * s, f.noseBridge.x, top - 0.12 * s);
      ctx.quadraticCurveTo(f.noseTip.x * 0.5 + first.x * 0.5, top - 0.06 * s, first.x * 0.98, top + 0.18 * s);
      ctx.closePath();
      fillStroke(ctx, lg(ctx, 0, top, 0, f.chin.y, [[0, '#cfe9fb'], [1, '#9fcff0']]), 'rgba(40,90,130,0.6)', 0.025);
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = 'rgba(60,120,170,0.35)';
      ctx.lineWidth = 0.025 * s;
      for (const k of [0.3, 0.5, 0.7]) {
        const y = lerpP({ x: 0, y: top }, f.chin, k).y;
        ctx.beginPath();
        ctx.moveTo(first.x, y);
        ctx.quadraticCurveTo(0, y + 0.1 * s, last.x, y);
        ctx.stroke();
      }
      ctx.restore();
      // Ear loops.
      ctx.strokeStyle = '#e5f3fc';
      ctx.lineWidth = 0.05 * s;
      for (const [p, jaw] of [
        [first, f.jawL],
        [last, f.jawR],
      ] as const) {
        ctx.beginPath();
        ctx.moveTo(p.x, top + 0.2 * s);
        ctx.lineTo(jaw.x, jaw.y);
        ctx.stroke();
      }
    },
  },
];

const ANIME: FaceFilter[] = [
  {
    id: 'anime-eyes',
    name: 'Sparkle Eyes',
    category: 'anime',
    tags: ['anime', 'eyes', 'kawaii', 'big eyes'],
    featured: true,
    draw(ctx, f, t) {
      const s = S(f);
      for (const [e, w] of [
        [f.eyeL, f.eyeLW],
        [f.eyeR, f.eyeRW],
      ] as const) {
        const rx = Math.max(w * 0.72, 0.26 * s);
        const ry = rx * 1.3;
        const c = { x: e.x, y: e.y - ry * 0.18 };
        el(ctx, c.x, c.y, rx * 1.05, ry * 1.02);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        el(ctx, c.x, c.y + ry * 0.08, rx * 0.86, ry * 0.9);
        ctx.fillStyle = rg(ctx, c.x, c.y + ry * 0.3, ry, [[0, '#7dd3fc'], [0.55, '#4f46e5'], [1, '#1e1b4b']]);
        ctx.fill();
        el(ctx, c.x, c.y + ry * 0.12, rx * 0.4, ry * 0.45);
        ctx.fillStyle = '#0b0820';
        ctx.fill();
        el(ctx, c.x - rx * 0.3, c.y - ry * 0.3, rx * 0.26, ry * 0.2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        el(ctx, c.x + rx * 0.3, c.y + ry * 0.38, rx * 0.12, ry * 0.09);
        ctx.fill();
        // Lash line.
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, rx * 1.08, ry * 1.04, 0, Math.PI * 1.05, Math.PI * 1.95);
        ctx.strokeStyle = '#140c1c';
        ctx.lineWidth = 0.07 * s;
        ctx.stroke();
        const tw = 0.5 + 0.5 * Math.sin(t * 4 + c.x * 3);
        star(ctx, c.x + rx * 1.3, c.y - ry * 0.9, 0.09 * s * (0.7 + tw * 0.3), 4, 0.35);
        ctx.fillStyle = '#fff7c2';
        ctx.fill();
      }
    },
  },
  {
    id: 'anime-blush',
    name: 'Kawaii Blush',
    category: 'anime',
    tags: ['blush', 'cheeks', 'cute', 'cartoon'],
    draw(ctx, f, t) {
      const s = S(f);
      for (const side of [-1, 1] as const) {
        const c = side < 0 ? f.cheekL : f.cheekR;
        el(ctx, c.x, c.y + 0.05 * s, 0.32 * s, 0.17 * s);
        ctx.fillStyle = rg(ctx, c.x, c.y, 0.32 * s, [[0, 'rgba(255,105,150,0.6)'], [1, 'rgba(255,105,150,0)']]);
        ctx.fill();
        ctx.strokeStyle = 'rgba(230,60,110,0.75)';
        ctx.lineWidth = 0.025 * s;
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath();
          ctx.moveTo(c.x + i * 0.11 * s - 0.04 * s, c.y + 0.1 * s);
          ctx.lineTo(c.x + i * 0.11 * s + 0.04 * s, c.y - 0.02 * s);
          ctx.stroke();
        }
      }
      const h = head(f);
      for (let i = 0; i < 5; i++) {
        const p = h.at(-Math.PI + 0.3 + i * 0.6);
        const tw = 0.6 + 0.4 * Math.sin(t * 3 + i);
        star(ctx, p.x, p.y - 0.1 * s, 0.12 * s * tw, 4, 0.35, 0.3);
        ctx.fillStyle = i % 2 ? '#fde68a' : '#f9a8d4';
        ctx.fill();
      }
    },
  },
  {
    id: 'kitsune-mask',
    name: 'Kitsune Mask',
    category: 'anime',
    tags: ['mask', 'fox', 'festival', 'anime mask'],
    featured: true,
    draw(ctx, f) {
      const s = S(f);
      const bottom = lerpP(f.noseTip, f.lipTop, 0.45).y;
      const top = f.forehead.y - 0.2 * s;
      const w = f.width / 2 * 0.98;
      // Ears.
      ears(ctx, f, { spread: 0.55, len: 0.75, wid: 0.7, pointy: 1, outer: () => '#fbfbf8', inner: '#e11d48' });
      ctx.beginPath();
      ctx.moveTo(0, top);
      ctx.bezierCurveTo(w * 0.8, top, w * 1.05, top + 0.6 * s, w, f.eyeR.y + 0.2);
      ctx.bezierCurveTo(w * 0.9, bottom - 0.1, w * 0.4, bottom, 0, bottom + 0.15 * s);
      ctx.bezierCurveTo(-w * 0.4, bottom, -w * 0.9, bottom - 0.1, -w, f.eyeL.y + 0.2);
      ctx.bezierCurveTo(-w * 1.05, top + 0.6 * s, -w * 0.8, top, 0, top);
      ctx.closePath();
      for (const [e, ew] of [
        [f.eyeL, f.eyeLW],
        [f.eyeR, f.eyeRW],
      ] as const) {
        const side = e.x < 0 ? -1 : 1;
        ctx.moveTo(e.x - side * ew * 0.7, e.y + 0.05);
        ctx.quadraticCurveTo(e.x, e.y - 0.22 * s, e.x + side * ew * 0.8, e.y - 0.1 * s);
        ctx.quadraticCurveTo(e.x, e.y + 0.12 * s, e.x - side * ew * 0.7, e.y + 0.05);
      }
      ctx.fillStyle = lg(ctx, 0, top, 0, bottom, [[0, '#ffffff'], [1, '#ece8e1']]);
      ctx.fill('evenodd');
      ctx.strokeStyle = 'rgba(60,40,40,0.6)';
      ctx.lineWidth = 0.025;
      ctx.stroke();
      // Red markings.
      ctx.strokeStyle = '#dc2626';
      ctx.lineWidth = 0.07 * s;
      for (const side of [-1, 1]) {
        const e = side < 0 ? f.eyeL : f.eyeR;
        ctx.beginPath();
        ctx.moveTo(e.x + side * 0.25 * s, e.y - 0.12 * s);
        ctx.quadraticCurveTo(e.x + side * 0.55 * s, e.y - 0.3 * s, e.x + side * 0.7 * s, e.y - 0.45 * s);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(e.x + side * 0.1 * s, e.y + 0.35 * s);
        ctx.quadraticCurveTo(e.x + side * 0.4 * s, e.y + 0.4 * s, e.x + side * 0.55 * s, e.y + 0.62 * s);
        ctx.stroke();
      }
      el(ctx, 0, f.forehead.y + 0.12 * s, 0.1 * s, 0.16 * s);
      ctx.fillStyle = '#dc2626';
      ctx.fill();
      el(ctx, f.noseTip.x, bottom + 0.05 * s, 0.1 * s, 0.07 * s);
      ctx.fillStyle = '#1f1f1f';
      ctx.fill();
    },
  },
  {
    id: 'cute-bow',
    name: 'Ribbon Bow',
    category: 'anime',
    tags: ['bow', 'ribbon', 'hair clip', 'cute'],
    draw(ctx, f) {
      const s = S(f);
      const h = head(f);
      const p = h.at(-Math.PI / 2 + 0.55);
      withTransform(ctx, p, 0.35, s, () => {
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.bezierCurveTo(side * 0.35, -0.55, side * 0.95, -0.45, side * 0.85, 0);
          ctx.bezierCurveTo(side * 0.95, 0.45, side * 0.35, 0.55, 0, 0);
          fillStroke(ctx, lg(ctx, 0, -0.5, 0, 0.5, [[0, '#fb7185'], [1, '#e11d48']]), '#881337', 0.04);
        }
        el(ctx, 0, 0, 0.17, 0.2);
        fillStroke(ctx, '#be123c', '#881337', 0.04);
      });
      const q = h.at(-Math.PI / 2 - 0.65);
      star(ctx, q.x, q.y + 0.1 * s, 0.2 * s, 5, 0.5);
      fillStroke(ctx, '#fde047', '#a16207', 0.03 * s);
    },
  },
  {
    id: 'anime-feels',
    name: 'Cartoon Feels',
    category: 'anime',
    tags: ['sweat drop', 'anger mark', 'cartoon', 'expression'],
    draw(ctx, f) {
      const s = S(f);
      const h = head(f);
      const d = h.at(-Math.PI / 2 + 0.75);
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.bezierCurveTo(d.x + 0.22 * s, d.y + 0.35 * s, d.x + 0.2 * s, d.y + 0.6 * s, d.x, d.y + 0.6 * s);
      ctx.bezierCurveTo(d.x - 0.2 * s, d.y + 0.6 * s, d.x - 0.22 * s, d.y + 0.35 * s, d.x, d.y);
      fillStroke(ctx, lg(ctx, d.x, d.y, d.x, d.y + 0.6 * s, [[0, '#e0f2fe'], [1, '#7dd3fc']]), '#0369a1', 0.03 * s);
      const a = h.at(-Math.PI / 2 - 0.6);
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 0.07 * s;
      for (const r of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
        withTransform(ctx, a, r, s, () => {
          ctx.beginPath();
          ctx.moveTo(0.08, 0.25);
          ctx.quadraticCurveTo(0.1, 0.1, 0.25, 0.08);
          ctx.stroke();
        });
      }
      for (const side of [-1, 1]) {
        const c = side < 0 ? f.cheekL : f.cheekR;
        ctx.strokeStyle = 'rgba(244,63,94,0.7)';
        ctx.lineWidth = 0.03 * s;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.moveTo(c.x + (i - 1) * 0.1 * s, c.y + 0.08 * s);
          ctx.lineTo(c.x + (i - 1) * 0.1 * s + 0.06 * s, c.y - 0.04 * s);
          ctx.stroke();
        }
      }
    },
  },
];

const SUPERHERO: FaceFilter[] = [
  {
    id: 'domino-mask',
    name: 'Vigilante Mask',
    category: 'superhero',
    tags: ['eye mask', 'domino', 'hero'],
    featured: true,
    draw(ctx, f) {
      const s = S(f);
      dominoPath(ctx, f);
      ctx.fillStyle = lg(ctx, 0, -0.5, 0, 0.5, [[0, '#ef4444'], [1, '#991b1b']]);
      ctx.fill('evenodd');
      ctx.strokeStyle = '#3f0d0d';
      ctx.lineWidth = 0.035 * s;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(f.eyeL.x - 0.5 * s, f.eyeL.y - 0.32 * s);
      ctx.quadraticCurveTo(0, f.eyeL.y - 0.45 * s, f.eyeR.x + 0.5 * s, f.eyeR.y - 0.32 * s);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 0.04 * s;
      ctx.stroke();
    },
  },
  {
    id: 'cyber-visor',
    name: 'Circuit Visor',
    category: 'superhero',
    tags: ['visor', 'cyber', 'tech', 'glow'],
    draw(ctx, f, t) {
      const s = S(f);
      const y = (f.eyeL.y + f.eyeR.y) / 2;
      const w = f.width / 2 * 1.02;
      ctx.beginPath();
      ctx.moveTo(-w, y - 0.18 * s);
      ctx.quadraticCurveTo(0, y - 0.42 * s, w, y - 0.18 * s);
      ctx.lineTo(w * 0.96, y + 0.22 * s);
      ctx.quadraticCurveTo(0, y + 0.42 * s, -w * 0.96, y + 0.22 * s);
      ctx.closePath();
      fillStroke(ctx, lg(ctx, -w, 0, w, 0, [[0, 'rgba(8,47,73,0.92)'], [0.5, 'rgba(14,116,144,0.88)'], [1, 'rgba(8,47,73,0.92)']]), '#94a3b8', 0.05 * s);
      const scan = ((t * 0.8) % 1) * 2 - 1;
      ctx.save();
      ctx.clip();
      ctx.fillStyle = rg(ctx, scan * w, y, 0.6 * s, [[0, 'rgba(103,232,249,0.85)'], [1, 'rgba(103,232,249,0)']]);
      ctx.fillRect(-w, y - 0.5 * s, w * 2, s);
      ctx.restore();
      ctx.strokeStyle = 'rgba(165,243,252,0.9)';
      ctx.lineWidth = 0.02 * s;
      ctx.beginPath();
      ctx.moveTo(-w * 0.8, y);
      ctx.lineTo(w * 0.8, y);
      ctx.stroke();
      for (const side of [-1, 1]) {
        el(ctx, side * w, y + 0.02 * s, 0.12 * s, 0.2 * s);
        fillStroke(ctx, '#475569', '#1e293b', 0.03 * s);
      }
    },
  },
  {
    id: 'nova-helmet',
    name: 'Nova Helmet',
    category: 'superhero',
    tags: ['helmet', 'wings', 'hero', 'armour'],
    featured: true,
    draw(ctx, f) {
      const s = S(f);
      const h = head(f);
      // Shell around the head with the face opening cut out.
      ctx.beginPath();
      const shell: P[] = [];
      for (let i = 0; i <= 24; i++) {
        const a = -Math.PI - 0.25 + (i / 24) * (Math.PI + 0.5);
        const p = h.at(a);
        shell.push({ x: h.cx + (p.x - h.cx) * 1.12, y: h.cy + (p.y - h.cy) * 1.1 - 0.05 * s });
      }
      const jawY = lerpP(f.lipTop, f.chin, 0.4).y;
      ctx.moveTo(shell[0].x, jawY);
      for (const p of shell) ctx.lineTo(p.x, p.y);
      ctx.lineTo(shell[shell.length - 1].x, jawY);
      ctx.closePath();
      // Opening: brows → cheeks → mouth.
      const browY = Math.min(...f.browL.map((p) => p.y), ...f.browR.map((p) => p.y)) - 0.12 * s;
      const ow = f.width / 2 * 0.8;
      ctx.moveTo(-ow, browY + 0.1 * s);
      ctx.quadraticCurveTo(0, browY - 0.12 * s, ow, browY + 0.1 * s);
      ctx.quadraticCurveTo(ow * 1.02, jawY - 0.2 * s, ow * 0.55, jawY + 0.25 * s);
      ctx.quadraticCurveTo(0, f.chin.y + 0.1 * s, -ow * 0.55, jawY + 0.25 * s);
      ctx.quadraticCurveTo(-ow * 1.02, jawY - 0.2 * s, -ow, browY + 0.1 * s);
      ctx.closePath();
      ctx.fillStyle = lg(ctx, -h.rx, 0, h.rx, 0, [[0, '#1e3a8a'], [0.35, '#3b82f6'], [0.5, '#93c5fd'], [0.65, '#3b82f6'], [1, '#1e3a8a']]);
      ctx.fill('evenodd');
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 0.05 * s;
      ctx.stroke();
      // Wings.
      for (const side of [-1, 1] as const) {
        const p = h.at(-Math.PI / 2 + side * 1.15);
        withTransform(ctx, { x: h.cx + (p.x - h.cx) * 1.12, y: p.y }, side * 0.3, s, () => {
          ctx.beginPath();
          ctx.moveTo(0, 0.2);
          for (let i = 0; i < 3; i++) {
            ctx.lineTo(side * (0.55 + i * 0.12), -0.3 - i * 0.32);
            ctx.lineTo(side * (0.2 + i * 0.1), -0.15 - i * 0.3);
          }
          ctx.lineTo(0, -0.9);
          ctx.closePath();
          fillStroke(ctx, lg(ctx, 0, 0.2, 0, -0.9, [[0, '#e5e7eb'], [1, '#facc15']]), '#713f12', 0.04);
        });
      }
      star(ctx, 0, browY - 0.42 * s, 0.24 * s, 5, 0.45);
      fillStroke(ctx, '#facc15', '#713f12', 0.03 * s);
    },
  },
  {
    id: 'star-guardian',
    name: 'Star Guardian',
    category: 'superhero',
    tags: ['emblem', 'headband', 'face paint', 'hero'],
    draw(ctx, f, t) {
      const s = S(f);
      const fh = lerpP(f.forehead, f.browL[4], 0.35);
      const glow = 0.75 + 0.25 * Math.sin(t * 3);
      ctx.save();
      ctx.shadowColor = 'rgba(56,189,248,0.9)';
      ctx.shadowBlur = 0.4 * s * glow;
      star(ctx, 0, fh.y - 0.05 * s, 0.32 * s, 5, 0.42);
      fillStroke(ctx, lg(ctx, 0, fh.y - 0.4 * s, 0, fh.y + 0.3 * s, [[0, '#e0f2fe'], [1, '#38bdf8']]), '#075985', 0.035 * s);
      ctx.restore();
      for (const side of [-1, 1]) {
        const c = side < 0 ? f.cheekL : f.cheekR;
        for (let i = 0; i < 2; i++) {
          ctx.beginPath();
          ctx.moveTo(c.x - side * 0.25 * s, c.y - 0.08 * s + i * 0.18 * s);
          ctx.lineTo(c.x + side * 0.2 * s, c.y - 0.16 * s + i * 0.18 * s);
          ctx.strokeStyle = i ? '#facc15' : '#38bdf8';
          ctx.lineWidth = 0.08 * s;
          ctx.stroke();
        }
      }
    },
  },
];

const FUN: FaceFilter[] = [
  {
    id: 'clown-nose',
    name: 'Clown Nose',
    category: 'fun',
    tags: ['nose', 'funny', 'red nose'],
    featured: true,
    draw(ctx, f) {
      const s = S(f);
      const c = lerpP(f.noseTip, f.noseBottom, 0.2);
      el(ctx, c.x, c.y, 0.34 * s, 0.32 * s);
      fillStroke(ctx, rg(ctx, c.x, c.y, 0.34 * s, [[0, '#ff6b6b'], [0.7, '#dc2626'], [1, '#991b1b']], c.x - 0.1 * s, c.y - 0.12 * s), '#7f1d1d', 0.02 * s);
      el(ctx, c.x - 0.1 * s, c.y - 0.12 * s, 0.08 * s, 0.05 * s, -0.5);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fill();
    },
  },
  {
    id: 'googly-eyes',
    name: 'Googly Eyes',
    category: 'fun',
    tags: ['eyes', 'funny', 'googly'],
    draw(ctx, f, t) {
      const s = S(f);
      [f.eyeL, f.eyeR].forEach((e, i) => {
        const r = 0.36 * s;
        el(ctx, e.x, e.y - 0.02, r, r);
        fillStroke(ctx, rg(ctx, e.x, e.y, r, [[0, '#ffffff'], [0.85, '#f1f5f9'], [1, '#cbd5e1']]), '#0f172a', 0.035 * s);
        const a = t * 5 + i * 2.1;
        const off = t ? 0.14 * s : 0.1 * s;
        el(ctx, e.x + Math.cos(a) * off * (t ? 1 : 0.4), e.y + 0.08 * s + Math.abs(Math.sin(a)) * off * 0.5, 0.17 * s, 0.17 * s);
        ctx.fillStyle = '#0b0b0b';
        ctx.fill();
      });
    },
  },
  {
    id: 'party-hat',
    name: 'Party Time',
    category: 'fun',
    tags: ['hat', 'party', 'confetti', 'birthday', 'festival'],
    featured: true,
    draw(ctx, f, t) {
      const s = S(f);
      const h = head(f);
      const p = h.at(-Math.PI / 2 - 0.25);
      withTransform(ctx, { x: p.x, y: p.y + 0.25 * s }, -0.22, s, () => {
        ctx.beginPath();
        ctx.moveTo(-0.62, 0);
        ctx.lineTo(0, -1.75);
        ctx.lineTo(0.62, 0);
        ctx.quadraticCurveTo(0, 0.16, -0.62, 0);
        ctx.closePath();
        fillStroke(ctx, '#8b5cf6', '#3b0764', 0.04);
        ctx.save();
        ctx.clip();
        for (let i = 0; i < 6; i++) {
          ctx.beginPath();
          ctx.moveTo(-1, -i * 0.32);
          ctx.lineTo(1, -i * 0.32 - 0.5);
          ctx.lineTo(1, -i * 0.32 - 0.38);
          ctx.lineTo(-1, -i * 0.32 + 0.12);
          ctx.fillStyle = i % 2 ? '#fde047' : '#22d3ee';
          ctx.fill();
        }
        ctx.restore();
        el(ctx, 0, -1.78, 0.17, 0.17);
        fillStroke(ctx, '#f472b6', '#831843', 0.03);
      });
      const colors = ['#f43f5e', '#22d3ee', '#facc15', '#a78bfa', '#34d399'];
      for (let i = 0; i < 18; i++) {
        const a = -Math.PI + rand(i) * Math.PI;
        const r = 1.05 + rand(i + 20) * 0.5;
        const q = h.at(a);
        const x = h.cx + (q.x - h.cx) * r;
        const y = h.cy + (q.y - h.cy) * r + ((t * 0.6 + rand(i + 40)) % 1) * (t ? 0.6 : 0) * s;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rand(i + 60) * TAU + t * 2);
        ctx.fillStyle = colors[i % colors.length];
        ctx.fillRect(-0.05 * s, -0.025 * s, 0.1 * s, 0.05 * s);
        ctx.restore();
      }
    },
  },
  {
    id: 'heart-eyes',
    name: 'Heart Eyes',
    category: 'fun',
    tags: ['hearts', 'love', 'eyes', 'expression'],
    draw(ctx, f, t) {
      const s = S(f);
      const pulse = 1 + 0.08 * Math.sin(t * 7);
      for (const e of [f.eyeL, f.eyeR]) {
        heart(ctx, e.x, e.y, 0.78 * s * pulse);
        fillStroke(ctx, rg(ctx, e.x, e.y, 0.5 * s, [[0, '#fb7185'], [1, '#be123c']], e.x - 0.12 * s, e.y - 0.15 * s), '#881337', 0.03 * s);
        el(ctx, e.x - 0.15 * s, e.y - 0.12 * s, 0.07 * s, 0.045 * s, -0.6);
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.fill();
      }
    },
  },
  {
    id: 'flower-crown',
    name: 'Flower Crown',
    category: 'fun',
    tags: ['flowers', 'crown', 'spring', 'festival'],
    featured: true,
    draw(ctx, f) {
      const s = S(f);
      const h = head(f);
      const palette = ['#f472b6', '#fbbf24', '#a78bfa', '#fb7185', '#f9fafb'];
      const n = 9;
      for (let i = 0; i < n; i++) {
        const a = -Math.PI + 0.25 + (i / (n - 1)) * (Math.PI - 0.5);
        const p = h.at(a);
        const q = { x: p.x, y: p.y + 0.22 * s };
        for (let k = 0; k < 2; k++) {
          const la = a + (k ? 0.18 : -0.18);
          el(ctx, q.x + Math.cos(la) * 0.25 * s, q.y + Math.sin(la) * 0.1 * s, 0.16 * s, 0.07 * s, la);
          ctx.fillStyle = '#4d7c0f';
          ctx.fill();
        }
        const r = (0.17 + rand(i) * 0.06) * s;
        for (let k = 0; k < 5; k++) {
          const pa = (k / 5) * TAU + i;
          el(ctx, q.x + Math.cos(pa) * r * 0.6, q.y + Math.sin(pa) * r * 0.6, r * 0.55, r * 0.4, pa);
          ctx.fillStyle = palette[i % palette.length];
          ctx.fill();
        }
        el(ctx, q.x, q.y, r * 0.3, r * 0.3);
        ctx.fillStyle = '#fde047';
        ctx.fill();
      }
    },
  },
  {
    id: 'festive-glow',
    name: 'Festive Lights',
    category: 'fun',
    tags: ['festival', 'lights', 'diwali', 'christmas', 'glitter', 'celebration'],
    draw(ctx, f, t) {
      const s = S(f);
      const h = head(f);
      const pts: P[] = [];
      for (let i = 0; i <= 12; i++) {
        const a = -Math.PI - 0.1 + (i / 12) * (Math.PI + 0.2);
        const p = h.at(a);
        pts.push({ x: h.cx + (p.x - h.cx) * 1.08, y: h.cy + (p.y - h.cy) * 1.05 + 0.25 * s });
      }
      curve(ctx, pts, false);
      ctx.strokeStyle = '#14532d';
      ctx.lineWidth = 0.04 * s;
      ctx.stroke();
      const colors = ['#facc15', '#f43f5e', '#22d3ee', '#a3e635', '#f97316'];
      pts.forEach((p, i) => {
        const on = t ? 0.55 + 0.45 * Math.sin(t * 4 + i * 1.3) : 1;
        ctx.save();
        ctx.shadowColor = colors[i % colors.length];
        ctx.shadowBlur = 0.35 * s * on;
        el(ctx, p.x, p.y + 0.1 * s, 0.08 * s, 0.13 * s);
        ctx.fillStyle = colors[i % colors.length];
        ctx.globalAlpha *= 0.6 + 0.4 * on;
        ctx.fill();
        ctx.restore();
      });
      for (let i = 0; i < 24; i++) {
        const side = i % 2 ? 1 : -1;
        const c = side < 0 ? f.cheekL : f.cheekR;
        star(ctx, c.x + (rand(i) - 0.5) * 0.5 * s, c.y - 0.2 * s + rand(i + 3) * 0.3 * s, (0.03 + rand(i + 5) * 0.04) * s, 4, 0.4);
        ctx.fillStyle = colors[i % colors.length];
        ctx.fill();
      }
    },
  },
  {
    id: 'big-grin',
    name: 'Big Grin',
    category: 'fun',
    tags: ['smile', 'mouth', 'expression', 'cartoon'],
    draw(ctx, f) {
      const s = S(f);
      const c = { x: (f.mouthL.x + f.mouthR.x) / 2, y: (f.lipTop.y + f.lipBottom.y) / 2 };
      const w = Math.max(dist(f.mouthL, f.mouthR) * 0.75, 0.42 * s);
      ctx.beginPath();
      ctx.moveTo(c.x - w, c.y - 0.08 * s);
      ctx.quadraticCurveTo(c.x, c.y + 0.02 * s, c.x + w, c.y - 0.08 * s);
      ctx.bezierCurveTo(c.x + w * 0.9, c.y + 0.55 * s, c.x - w * 0.9, c.y + 0.55 * s, c.x - w, c.y - 0.08 * s);
      ctx.closePath();
      fillStroke(ctx, '#5b0f1a', '#2b0509', 0.04 * s);
      ctx.save();
      ctx.clip();
      ctx.fillStyle = '#fff';
      ctx.fillRect(c.x - w, c.y - 0.2 * s, w * 2, 0.24 * s);
      el(ctx, c.x, c.y + 0.42 * s, w * 0.5, 0.2 * s);
      ctx.fillStyle = '#f87171';
      ctx.fill();
      ctx.restore();
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(c.x + side * w * 1.08, c.y - 0.1 * s, 0.07 * s, side < 0 ? 0 : Math.PI, side < 0 ? Math.PI : TAU);
        ctx.strokeStyle = '#2b0509';
        ctx.lineWidth = 0.035 * s;
        ctx.stroke();
      }
    },
  },
];

const CORPORATE: FaceFilter[] = [
  {
    id: 'exec-frames',
    name: 'Executive Frames',
    category: 'corporate',
    tags: ['glasses', 'professional', 'rectangular', 'office'],
    featured: true,
    draw: (ctx, f) =>
      glasses(ctx, f, { shape: 'rect', frame: '#111827', lens: 'rgba(210,230,255,0.12)', rim: 0.07 }),
  },
  {
    id: 'browline',
    name: 'Browline Classic',
    category: 'corporate',
    tags: ['glasses', 'browline', 'tortoiseshell', 'professional'],
    draw: (ctx, f) =>
      glasses(ctx, f, { shape: 'browline', frame: '#5b3a1e', lens: 'rgba(220,235,255,0.1)', rim: 0.035 }),
  },
  {
    id: 'headset',
    name: 'Support Headset',
    category: 'corporate',
    tags: ['headset', 'microphone', 'call center', 'business'],
    draw(ctx, f) {
      const s = S(f);
      const h = head(f);
      const pts: P[] = [];
      for (let i = 0; i <= 16; i++) {
        const a = -Math.PI - 0.05 + (i / 16) * (Math.PI + 0.1);
        const p = h.at(a);
        pts.push({ x: h.cx + (p.x - h.cx) * 1.06, y: h.cy + (p.y - h.cy) * 1.04 });
      }
      curve(ctx, pts, false);
      ctx.strokeStyle = '#1f2937';
      ctx.lineWidth = 0.14 * s;
      ctx.stroke();
      ctx.strokeStyle = '#4b5563';
      ctx.lineWidth = 0.05 * s;
      ctx.stroke();
      for (const side of [-1, 1] as const) {
        const jaw = side < 0 ? f.jawL : f.jawR;
        el(ctx, jaw.x + side * 0.04 * s, jaw.y - 0.1 * s, 0.2 * s, 0.32 * s);
        fillStroke(ctx, lg(ctx, 0, jaw.y - 0.4, 0, jaw.y + 0.2, [[0, '#374151'], [1, '#111827']]), '#000', 0.02);
      }
      const jaw = f.jawR;
      ctx.beginPath();
      ctx.moveTo(jaw.x, jaw.y + 0.1 * s);
      ctx.quadraticCurveTo(jaw.x - 0.1 * s, f.mouthR.y + 0.1 * s, f.mouthR.x + 0.18 * s, f.mouthR.y + 0.02 * s);
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 0.05 * s;
      ctx.stroke();
      el(ctx, f.mouthR.x + 0.14 * s, f.mouthR.y + 0.02 * s, 0.09 * s, 0.07 * s);
      fillStroke(ctx, '#1f2937', '#000', 0.015);
    },
  },
  {
    id: 'bow-tie',
    name: 'Gala Bow Tie',
    category: 'corporate',
    tags: ['bow tie', 'formal', 'business', 'gala'],
    draw(ctx, f) {
      const s = S(f);
      const c = { x: f.chin.x, y: f.chin.y + 0.5 * s };
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(c.x, c.y);
        ctx.lineTo(c.x + side * 0.55 * s, c.y - 0.28 * s);
        ctx.quadraticCurveTo(c.x + side * 0.65 * s, c.y, c.x + side * 0.55 * s, c.y + 0.28 * s);
        ctx.closePath();
        fillStroke(ctx, lg(ctx, c.x, c.y - 0.3 * s, c.x, c.y + 0.3 * s, [[0, '#1e3a8a'], [1, '#172554']]), '#0b1120', 0.03 * s);
      }
      el(ctx, c.x, c.y, 0.11 * s, 0.13 * s);
      fillStroke(ctx, '#1d4ed8', '#0b1120', 0.03 * s);
    },
  },
  {
    id: 'brand-spirit',
    name: 'SageIT Spirit',
    category: 'corporate',
    tags: ['branding', 'company', 'team', 'face paint', 'sageit'],
    featured: true,
    draw(ctx, f) {
      const s = S(f);
      const c = f.cheekR;
      for (let i = 0; i < 2; i++) {
        ctx.beginPath();
        ctx.moveTo(c.x - 0.22 * s, c.y - 0.1 * s + i * 0.16 * s);
        ctx.lineTo(c.x + 0.22 * s, c.y - 0.1 * s + i * 0.16 * s);
        ctx.strokeStyle = i ? '#22d3ee' : '#1f6fff';
        ctx.lineWidth = 0.09 * s;
        ctx.stroke();
      }
      const b = { x: f.cheekL.x, y: f.cheekL.y };
      ctx.beginPath();
      ctx.roundRect(b.x - 0.42 * s, b.y - 0.13 * s, 0.84 * s, 0.26 * s, 0.13 * s);
      fillStroke(ctx, lg(ctx, b.x - 0.4 * s, 0, b.x + 0.4 * s, 0, [[0, '#1f6fff'], [1, '#22d3ee']]), 'rgba(255,255,255,0.8)', 0.02 * s);
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 ${0.15 * s}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('SageIT', b.x, b.y + 0.005 * s);
    },
  },
];

export const BUILT_IN_FILTERS: FaceFilter[] = [
  ...ANIMAL,
  ...ACCESSORIES,
  ...ANIME,
  ...SUPERHERO,
  ...FUN,
  ...CORPORATE,
];

// ====================================================================== image filters

/** Where an uploaded or character filter image attaches on the face. */
export type FilterAnchor = 'head' | 'eyes' | 'nose' | 'mouth' | 'face' | 'chin';

export const ANCHOR_LABEL: Record<FilterAnchor, string> = {
  head: 'Top of head (hats, ears)',
  eyes: 'Eyes (glasses, eye masks)',
  nose: 'Nose',
  mouth: 'Above the mouth (moustaches)',
  face: 'Whole face (masks)',
  chin: 'Below the chin (ties, beards)',
};

/**
 * An image filter: the picture is centred on the anchor and sized to the face width.
 * `size` is the image width as a multiple of the face width.
 */
export function imageFilter(o: {
  id: string;
  name: string;
  category: FilterCategory;
  image: CanvasImageSource & { width: number; height: number };
  anchor: FilterAnchor;
  size?: number;
  thumbUrl?: string;
  tags?: string[];
}): FaceFilter {
  const aspect = o.image.height / o.image.width || 1;
  return {
    id: o.id,
    name: o.name,
    category: o.category,
    tags: o.tags ?? [],
    thumbUrl: o.thumbUrl,
    draw(ctx, f) {
      const w = f.width * (o.size ?? defaultSize(o.anchor));
      const h = w * aspect;
      const eyes = midP(f.eyeL, f.eyeR);
      let c: P;
      switch (o.anchor) {
        case 'head':
          c = { x: f.headTop.x, y: f.headTop.y - h * 0.3 };
          break;
        case 'eyes':
          c = { x: eyes.x, y: eyes.y + 0.02 };
          break;
        case 'nose':
          c = f.noseTip;
          break;
        case 'mouth':
          c = lerpP(f.noseBottom, f.lipTop, 0.6);
          break;
        case 'face':
          c = { x: (f.jawL.x + f.jawR.x) / 2, y: (f.forehead.y + f.chin.y) / 2 };
          break;
        case 'chin':
          c = { x: f.chin.x, y: f.chin.y + h * 0.4 };
          break;
      }
      ctx.drawImage(o.image, c.x - w / 2, c.y - h / 2, w, h);
    },
  };
}
function defaultSize(a: FilterAnchor) {
  return { head: 1.3, eyes: 1.05, nose: 0.45, mouth: 0.7, face: 1.15, chin: 0.9 }[a];
}

/**
 * A library character's head (FACE avatar) worn over the person's head: the avatar's head
 * box is mapped onto the person's head (forehead-to-chin plus hair room).
 */
export function characterFilter(o: {
  id: string;
  name: string;
  image: CanvasImageSource & { width: number; height: number };
  /** The avatar's head box as fractions of the image (from avatarAnchors). */
  head: { cx: number; cy: number; h: number };
  thumbUrl?: string;
}): FaceFilter {
  const aspect = o.image.width / o.image.height || 1;
  return {
    id: o.id,
    name: o.name,
    category: 'characters',
    tags: ['character', 'avatar', 'head'],
    thumbUrl: o.thumbUrl,
    draw(ctx, f) {
      // Person's head: from the estimated skull top to the chin.
      const top = f.headTop;
      const headH = (f.chin.y - top.y) * 1.08;
      const D = headH / o.head.h; // drawn image height
      const W = D * aspect;
      const cx = (top.x + f.chin.x) / 2;
      const cy = (top.y + f.chin.y) / 2 + headH * 0.02;
      ctx.drawImage(o.image, cx - o.head.cx * W, cy - o.head.cy * D, W, D);
    },
  };
}

// ====================================================================== thumbnails

const thumbCache = new Map<string, string>();

/** Renders a filter on a neutral cartoon face, for the carousel (cached data URL). */
export function filterThumb(filter: FaceFilter, face: FaceLocal, size = 112, cache = true): string {
  if (filter.thumbUrl) return filter.thumbUrl;
  const hit = cache ? thumbCache.get(filter.id) : undefined;
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  const u = size / 6.2;
  ctx.translate(size / 2, size * 0.47);
  ctx.scale(u, u);
  ctx.translate(0, -0.25);
  // Neutral face.
  curve(ctx, face.outline);
  ctx.fillStyle = rg(ctx, 0, 0.4, 2, [[0, '#f6d7c3'], [1, '#e2b498']]);
  ctx.fill();
  ctx.fillStyle = '#4a3428';
  for (const e of [face.eyeL, face.eyeR]) {
    el(ctx, e.x, e.y, 0.11, 0.13);
    ctx.fill();
  }
  ctx.strokeStyle = '#a0614a';
  ctx.lineWidth = 0.07;
  ctx.beginPath();
  ctx.moveTo(face.mouthL.x * 0.7, face.mouthCenter.y);
  ctx.quadraticCurveTo(0, face.mouthCenter.y + 0.25, face.mouthR.x * 0.7, face.mouthCenter.y);
  ctx.stroke();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  try {
    filter.draw(ctx, face, 0);
  } catch {
    /* thumbnails are best-effort */
  }
  const url = c.toDataURL('image/png');
  if (cache) thumbCache.set(filter.id, url);
  return url;
}
