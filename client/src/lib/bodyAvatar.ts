/**
 * Full-body avatar alignment: where the person is (face landmarks + segmentation silhouette),
 * where the avatar's own head and feet are (alpha analysis of the artwork), and the transform
 * that puts one on the other. Also: removing the person from the photo for "Replace" mode,
 * and the face patch for "Keep my face".
 */
import type { AvatarType } from './api';
import type { Transform } from './compose';
import type { FaceGeom, P } from './facemesh';
import { POSE, type PoseResult } from './pose';

// ------------------------------------------------------------------ avatar anchors

export interface AvatarAnchors {
  /** Opaque bounds (fractions of the image). */
  top: number;
  bottom: number;
  left: number;
  right: number;
  /** Head box: centre and height (fractions of the image). */
  head: { cx: number; cy: number; h: number };
  /** True when the corners are opaque — the artwork has a solid background. */
  opaqueBackground: boolean;
  /** Body width just below the neck (fraction of image width), when found. */
  shoulderW?: number;
}

const anchorCache = new WeakMap<object, AvatarAnchors>();

/**
 * Finds the head and the opaque extent of an avatar image. The head is the top blob down to
 * the narrowest point (the neck) of the run of pixels under the head's centre, so raised arms
 * beside the head don't count.
 */
export function avatarAnchors(
  img: CanvasImageSource & { width: number; height: number },
  type: AvatarType,
): AvatarAnchors {
  const hit = anchorCache.get(img);
  if (hit) return hit;
  const k = Math.min(1, 320 / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * k));
  const h = Math.max(1, Math.round(img.height * k));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const fallback: AvatarAnchors = {
    top: 0,
    bottom: 1,
    left: 0,
    right: 1,
    head: type === 'FACE' ? { cx: 0.5, cy: 0.5, h: 0.9 } : { cx: 0.5, cy: 0.1, h: 0.18 },
    opaqueBackground: false,
  };
  if (!ctx) return fallback;
  ctx.drawImage(img, 0, 0, w, h);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return fallback; // cross-origin image — can't read pixels
  }
  const a = (x: number, y: number) => data[(y * w + x) * 4 + 3];
  const corners = [a(0, 0), a(w - 1, 0), a(0, h - 1), a(w - 1, h - 1)];
  const opaqueBackground = corners.every((v) => v > 245);
  if (opaqueBackground) {
    const r = { ...fallback, opaqueBackground };
    anchorCache.set(img, r);
    return r;
  }
  const T = 40;
  let top = -1;
  let bottom = -1;
  let left = w;
  let right = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (a(x, y) > T) {
        if (top < 0) top = y;
        bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  if (top < 0) return fallback;
  const figH = bottom - top + 1;
  // The head is the widest blob near the top — not simply the highest pixel, which may be a
  // raised hand, a hat feather or a held prop.
  const searchTo = Math.round(top + figH * (type === 'FACE' ? 0.7 : type === 'HALF_BODY' ? 0.35 : 0.2));
  let cx = Math.round((left + right) / 2);
  let widest = 0;
  let widestY = top;
  for (let y = top; y <= searchTo; y++) {
    let x = 0;
    while (x < w) {
      while (x < w && a(x, y) <= T) x++;
      const s = x;
      while (x < w && a(x, y) > T) x++;
      const len = x - s;
      if (len > widest) {
        widest = len;
        widestY = y;
        cx = Math.round((s + x - 1) / 2);
      }
    }
  }
  const runWidth = (y: number) => {
    if (a(cx, y) <= T) return 0;
    let l = cx;
    let r = cx;
    while (l > 0 && a(l - 1, y) > T) l--;
    while (r < w - 1 && a(r + 1, y) > T) r++;
    return r - l + 1;
  };
  // Top of the head: walk up from the widest row while the head column stays opaque.
  let headTop = widestY;
  while (headTop > top && a(cx, headTop - 1) > T) headTop--;
  // Neck: the narrowest run under the head column, below the widest head row.
  const to =
    type === 'FACE' ? bottom : Math.round(top + figH * (type === 'HALF_BODY' ? 0.55 : 0.35));
  let neck = -1;
  let best = Infinity;
  for (let y = widestY + 1; y <= Math.min(bottom, to); y++) {
    const rw = runWidth(y);
    if (rw > 0 && rw < best) {
      best = rw;
      neck = y;
    }
    // Stop once the body clearly widens again below a narrow neck.
    if (neck > 0 && rw > best * 2.2) break;
  }
  // A neck must be clearly narrower than the head; otherwise use a typical proportion.
  if (neck < 0 || best > widest * 0.85) {
    neck =
      type === 'FACE'
        ? bottom
        : Math.round(headTop + figH * (type === 'HALF_BODY' ? 0.32 : 0.15));
  }
  const headH = Math.max(1, neck - headTop);
  const shoulderRun = (y: number) => {
    const rw = y < h ? runWidth(Math.min(h - 1, y)) : 0;
    return rw > 0 ? rw / w : undefined;
  };
  const r: AvatarAnchors = {
    top: top / h,
    bottom: (bottom + 1) / h,
    left: left / w,
    right: (right + 1) / w,
    head: { cx: cx / w, cy: (headTop + headH / 2) / h, h: headH / h },
    shoulderW: type === 'FACE' ? undefined : shoulderRun(neck + Math.round(headH * 0.4)),
    opaqueBackground,
  };
  anchorCache.set(img, r);
  return r;
}

// ------------------------------------------------------------------ the person's body

export interface BodyFrame {
  /** Head centre and height (pixels; height includes hair). */
  head: P;
  headH: number;
  headTop: number;
  /** Bottom of the person (pixels) or null when the photo cuts them off. */
  feetY: number | null;
  /** Lean of the body in degrees (positive = clockwise). */
  tilt: number;
  /** Silhouette width at shoulder height (pixels), when known. */
  shoulderW: number | null;
  source: 'pose+face' | 'pose' | 'face+silhouette' | 'face' | 'silhouette';
}

/** Head geometry from Face Mesh landmarks (pixels): centre, height incl. hair, skull top. */
function faceHead(face: FaceGeom) {
  const f = face.local;
  const c = Math.cos(face.roll);
  const s = Math.sin(face.roll);
  const toPx = (p: P): P => ({
    x: face.origin.x + (p.x * c - p.y * s) * face.u,
    y: face.origin.y + (p.x * s + p.y * c) * face.u,
  });
  const chin = toPx(f.chin);
  const forehead = toPx(f.forehead);
  const top = toPx(f.headTop);
  return {
    head: { x: (forehead.x + chin.x) / 2, y: (top.y + chin.y) / 2 },
    headTop: top.y,
    headH: chin.y - top.y,
  };
}

/**
 * Body frame from MediaPipe Pose: shoulders, hips and feet give the scale, lean and whether the
 * whole body is in the photo; the head comes from Face Mesh when available (more precise), else
 * from the pose's ears/nose and shoulder width.
 */
export function poseFrame(pose: PoseResult, face: FaceGeom | null, W: number, H: number): BodyFrame | null {
  const p = pose.points;
  const ok = (i: number, v = 0.5) => !!p[i] && p[i].v >= v && p[i].x >= 0 && p[i].x <= W;
  if (!ok(POSE.shoulderL, 0.3) || !ok(POSE.shoulderR, 0.3)) return null;
  const sL = p[POSE.shoulderL];
  const sR = p[POSE.shoulderR];
  const sMid = { x: (sL.x + sR.x) / 2, y: (sL.y + sR.y) / 2 };
  const shoulderW = Math.hypot(sL.x - sR.x, sL.y - sR.y);

  let head: P;
  let headH: number;
  let headTop: number;
  if (face) {
    ({ head, headH, headTop } = faceHead(face));
  } else {
    const nose = p[POSE.nose];
    const ears = ok(POSE.earL) && ok(POSE.earR);
    const anchor = ears
      ? { x: (p[POSE.earL].x + p[POSE.earR].x) / 2, y: (p[POSE.earL].y + p[POSE.earR].y) / 2 }
      : { x: nose.x, y: nose.y };
    headH = Math.max(shoulderW * 0.66, Math.hypot(nose.x - sMid.x, nose.y - sMid.y) * 0.95);
    head = { x: anchor.x, y: anchor.y - headH * 0.08 };
    headTop = head.y - headH * 0.55;
  }

  // Feet: lowest visible ankle / heel / toe, unless the photo cuts the legs off.
  const feet = [POSE.ankleL, POSE.ankleR, POSE.heelL, POSE.heelR, POSE.footL, POSE.footR]
    .filter((i) => ok(i, 0.5) && p[i].y < H * 0.985)
    .map((i) => p[i].y);
  const feetY = feet.length >= 2 ? Math.max(...feet) + headH * 0.04 : null;

  let tilt = face ? ((face.roll * 180) / Math.PI) * 0.4 : 0;
  if (ok(POSE.hipL, 0.4) && ok(POSE.hipR, 0.4)) {
    const hMid = {
      x: (p[POSE.hipL].x + p[POSE.hipR].x) / 2,
      y: (p[POSE.hipL].y + p[POSE.hipR].y) / 2,
    };
    tilt = (Math.atan2(sMid.x - hMid.x, hMid.y - sMid.y) * 180) / Math.PI;
    tilt = Math.max(-25, Math.min(25, tilt));
  }
  return { head, headH, headTop, feetY, tilt, shoulderW, source: face ? 'pose+face' : 'pose' };
}

/**
 * The person's head, height, lean and shoulders from the face landmarks and the segmentation
 * cut-out (alpha = person). Either input may be missing; the result degrades gracefully.
 */
export function bodyFrame(
  face: FaceGeom | null,
  cutout: HTMLCanvasElement | null,
  W: number,
  H: number,
): BodyFrame | null {
  let mask: { data: Uint8ClampedArray; w: number; h: number; k: number } | null = null;
  if (cutout) {
    const k = Math.min(1, 256 / Math.max(W, H));
    const w = Math.max(1, Math.round(W * k));
    const h = Math.max(1, Math.round(H * k));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      ctx.drawImage(cutout, 0, 0, w, h);
      mask = { data: ctx.getImageData(0, 0, w, h).data, w, h, k };
    }
  }
  // Keep only the person's own region: the connected component under the face, or — with no
  // face — the largest one (segmentation also marks crowds and other people).
  let keep: Uint8Array | null = null;
  if (mask) {
    const { w, h, data } = mask;
    const raw = (x: number, y: number) => data[(y * w + x) * 4 + 3] > 110;
    const label = new Int32Array(w * h).fill(-1);
    const sizes: number[] = [];
    const stack: number[] = [];
    for (let i = 0; i < w * h; i++) {
      if (label[i] >= 0 || !raw(i % w, (i / w) | 0)) continue;
      const id = sizes.length;
      let n = 0;
      label[i] = id;
      stack.push(i);
      while (stack.length) {
        const j = stack.pop()!;
        n++;
        const x = j % w;
        const y = (j / w) | 0;
        for (const [nx, ny] of [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
        ]) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (label[q] < 0 && raw(nx, ny)) {
            label[q] = id;
            stack.push(q);
          }
        }
      }
      sizes.push(n);
    }
    let pick = -1;
    if (face) {
      // Nearest labelled pixel below the face centre (the face itself may be thin in the mask).
      const fx = Math.round(face.origin.x * mask.k);
      const fy = Math.round(face.origin.y * mask.k);
      for (let r = 0; r < 12 && pick < 0; r++) {
        for (const [dx, dy] of [
          [0, r],
          [0, -r],
          [r, 0],
          [-r, 0],
        ]) {
          const x = fx + dx;
          const y = fy + dy;
          if (x >= 0 && y >= 0 && x < w && y < h && label[y * w + x] >= 0) {
            pick = label[y * w + x];
            break;
          }
        }
      }
    }
    if (pick < 0 && sizes.length) pick = sizes.indexOf(Math.max(...sizes));
    if (pick >= 0 && sizes[pick] > 12) {
      keep = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) if (label[i] === pick) keep[i] = 1;
    }
  }
  const on = (x: number, y: number) => !!mask && !!keep && keep[y * mask.w + x] === 1;

  let mTop = -1;
  let mBottom = -1;
  if (mask && keep) {
    for (let y = 0; y < mask.h; y++) {
      let any = false;
      for (let x = 0; x < mask.w; x++) {
        if (on(x, y)) {
          any = true;
          break;
        }
      }
      if (any) {
        if (mTop < 0) mTop = y;
        mBottom = y;
      }
    }
  }
  const runAt = (yPx: number, xPx: number) => {
    if (!mask) return null;
    const y = Math.min(mask.h - 1, Math.max(0, Math.round(yPx * mask.k)));
    const x0 = Math.min(mask.w - 1, Math.max(0, Math.round(xPx * mask.k)));
    if (!on(x0, y)) return null;
    let l = x0;
    let r = x0;
    while (l > 0 && on(l - 1, y)) l--;
    while (r < mask.w - 1 && on(r + 1, y)) r++;
    return { l: l / mask.k, r: (r + 1) / mask.k };
  };

  if (face) {
    const f = face.local;
    const toPx = (p: P): P => {
      const c = Math.cos(face.roll);
      const s = Math.sin(face.roll);
      return {
        x: face.origin.x + (p.x * c - p.y * s) * face.u,
        y: face.origin.y + (p.x * s + p.y * c) * face.u,
      };
    };
    const chin = toPx(f.chin);
    const forehead = toPx(f.forehead);
    const faceH = Math.hypot(chin.x - forehead.x, chin.y - forehead.y);
    let headTop = toPx(f.headTop).y;
    // The silhouette knows where the hair ends.
    if (mask && mTop >= 0) {
      const sTop = mTop / mask.k;
      if (sTop < headTop && sTop > headTop - faceH * 0.7) headTop = sTop;
    }
    const headH = chin.y - headTop;
    const head = { x: (forehead.x + chin.x) / 2, y: (headTop + chin.y) / 2 };
    const shoulderY = chin.y + faceH * 0.55;
    const run = runAt(shoulderY, chin.x);
    const feetY = mask && mBottom >= 0 && mBottom < mask.h - 2 ? (mBottom + 1) / mask.k : null;
    // Lean: from the head to the middle of the silhouette lower down.
    let tilt = (face.roll * 180) / Math.PI * 0.4;
    if (mask) {
      const lowY = Math.min(H - 1, chin.y + faceH * 2.2);
      const low = runAt(lowY, head.x) ?? runAt(lowY, chin.x);
      if (low) {
        const dx = (low.l + low.r) / 2 - head.x;
        const dy = lowY - head.y;
        tilt = Math.max(-18, Math.min(18, (-Math.atan2(dx, dy) * 180) / Math.PI));
      }
    }
    return {
      head,
      headH,
      headTop,
      feetY,
      tilt,
      shoulderW: run ? run.r - run.l : null,
      source: mask ? 'face+silhouette' : 'face',
    };
  }

  if (!mask || !keep || mTop < 0) return null;
  // Silhouette only: the head is the top of the largest blob.
  const y0 = mTop / mask.k;
  const span = (mBottom - mTop + 1) / mask.k;
  let sx = 0;
  let n = 0;
  for (let y = mTop; y < mTop + Math.max(2, (mBottom - mTop) * 0.05); y++) {
    for (let x = 0; x < mask.w; x++) {
      if (on(x, y)) {
        sx += x;
        n++;
      }
    }
  }
  const hx = n ? sx / n / mask.k : W / 2;
  const headH = Math.min(span * 0.14, H * 0.3); // ~7 heads tall
  return {
    head: { x: hx, y: y0 + headH / 2 },
    headH,
    headTop: y0,
    feetY: mBottom < mask.h - 2 ? (mBottom + 1) / mask.k : null,
    tilt: 0,
    shoulderW: runAt(y0 + headH * 1.4, hx)?.r ?? null,
    source: 'silhouette',
  };
}

/**
 * The avatar transform that puts the avatar's head on the person's head. Full-body avatars
 * whose feet are visible in the photo are scaled to the person's full height (head to feet)
 * so proportions match; otherwise the head size sets the scale.
 */
export function fitAvatarToBody(
  frame: BodyFrame,
  anchors: AvatarAnchors,
  avatar: { width: number; height: number; type: AvatarType },
  W: number,
  H: number,
): Transform {
  const aspect = avatar.width / avatar.height;
  let D = (frame.headH * 1.05) / anchors.head.h; // drawn avatar height (px), head-matched
  // Cartoon heads are large for their bodies: when both shoulder widths are known, meet in
  // the middle so the avatar also covers the person's shoulders.
  if (frame.shoulderW && anchors.shoulderW && avatar.type !== 'FACE') {
    const byShoulders = (frame.shoulderW * 1.15) / (anchors.shoulderW * aspect);
    if (byShoulders > D) D = Math.sqrt(D * Math.min(byShoulders, D * 2.2));
  }
  let anchorY = anchors.head.cy;
  let targetY = frame.head.y;
  if (avatar.type === 'FULL_BODY' && frame.feetY) {
    const avatarHeadTop = anchors.head.cy - anchors.head.h / 2;
    const bodyD = (frame.feetY - frame.headTop) / Math.max(0.05, anchors.bottom - avatarHeadTop);
    if (bodyD > D * 0.55 && bodyD < D * 1.8) {
      D = bodyD;
      anchorY = avatarHeadTop;
      targetY = frame.headTop;
    }
  }
  const rot = (frame.tilt * Math.PI) / 180;
  // Vector from the avatar's centre to its anchor point, rotated with the body.
  const vx = (anchors.head.cx - 0.5) * D * aspect;
  const vy = (anchorY - 0.5) * D;
  const cx = frame.head.x - (vx * Math.cos(rot) - vy * Math.sin(rot));
  const cy = targetY - (vx * Math.sin(rot) + vy * Math.cos(rot));
  return {
    x: cx / W,
    y: cy / H,
    scale: D / H,
    rotation: frame.tilt,
    flipX: false,
    opacity: 1,
  };
}

// ------------------------------------------------------------------ replace + keep face

/**
 * The photo with the person removed: the (slightly grown) silhouette is erased and filled
 * from the surrounding background with a push-pull pyramid (GPU-scaled canvases), so a
 * replacement avatar doesn't leave the original person peeking out around it.
 */
export function removePerson(photo: HTMLCanvasElement, cutout: HTMLCanvasElement): HTMLCanvasElement {
  const W = photo.width;
  const H = photo.height;
  const mk = (w: number, h: number) => {
    const c = document.createElement('canvas');
    c.width = Math.max(1, w);
    c.height = Math.max(1, h);
    return c;
  };
  // Grown mask.
  const grow = Math.max(3, Math.round(Math.max(W, H) / 120));
  const mask = mk(W, H);
  const m = mask.getContext('2d')!;
  m.filter = `blur(${grow}px)`;
  for (let i = 0; i < 3; i++) m.drawImage(cutout, 0, 0);
  m.filter = 'none';
  // Photo with a hole.
  const holed = mk(W, H);
  const hctx = holed.getContext('2d')!;
  hctx.drawImage(photo, 0, 0);
  hctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 3; i++) hctx.drawImage(mask, 0, 0);
  hctx.globalCompositeOperation = 'source-over';
  // Push: halve until tiny (premultiplied averaging ignores the hole).
  const levels: HTMLCanvasElement[] = [holed];
  while (levels[levels.length - 1].width > 4 && levels.length < 14) {
    const prev = levels[levels.length - 1];
    const next = mk(Math.ceil(prev.width / 2), Math.ceil(prev.height / 2));
    const nctx = next.getContext('2d')!;
    nctx.imageSmoothingQuality = 'high';
    nctx.drawImage(prev, 0, 0, next.width, next.height);
    // Re-normalise partly transparent pixels toward opaque (same colour).
    for (let i = 0; i < 6; i++) nctx.drawImage(next, 0, 0);
    levels.push(next);
  }
  // Pull: fill each level's hole from the coarser level beneath it.
  for (let i = levels.length - 2; i >= 0; i--) {
    const c = levels[i];
    const ctx = c.getContext('2d')!;
    ctx.globalCompositeOperation = 'destination-over';
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(levels[i + 1], 0, 0, c.width, c.height);
    ctx.globalCompositeOperation = 'source-over';
  }
  const out = mk(W, H);
  const o = out.getContext('2d')!;
  o.drawImage(photo, 0, 0);
  o.drawImage(levels[0], 0, 0);
  return out;
}

/** The person's own face (feathered face oval) cut from the photo, same size as the photo. */
export function facePatch(photo: HTMLCanvasElement, face: FaceGeom): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = photo.width;
  c.height = photo.height;
  const ctx = c.getContext('2d')!;
  const feather = Math.max(2, face.u * 0.08);
  ctx.filter = `blur(${feather}px)`;
  ctx.beginPath();
  // Slightly inset so the jaw edge/background isn't included.
  const cx = face.box.x + face.box.w / 2;
  const cy = face.box.y + face.box.h / 2;
  face.ovalPx.forEach((p, i) => {
    const x = cx + (p.x - cx) * 0.95;
    const y = cy + (p.y - cy) * 0.97;
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.filter = 'none';
  ctx.globalCompositeOperation = 'source-in';
  ctx.drawImage(photo, 0, 0);
  return c;
}
