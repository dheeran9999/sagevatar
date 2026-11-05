/**
 * Facial landmark tracking for AR face filters and face/body alignment, using MediaPipe
 * Face Mesh (Apache-2.0, 468 landmarks, WebGL-accelerated) served from /vendor/mediapipe-mesh
 * (copied from node_modules by scripts/copy-vendor.mjs — no CDN). Runs entirely in the
 * browser: photos and camera frames never leave the device.
 *
 * The same engine serves still photos (`detectFaceMeshes`) and the live camera
 * (`trackFaces`, called once per animation frame).
 */
import { initMediapipe } from './mediapipeInit';
import { detectFaces } from './faces';

export interface P {
  x: number;
  y: number;
}
interface Landmark {
  x: number;
  y: number;
  z: number;
}
interface MeshResults {
  multiFaceLandmarks?: Landmark[][];
}
interface FaceMeshInstance {
  setOptions(o: {
    maxNumFaces?: number;
    refineLandmarks?: boolean;
    minDetectionConfidence?: number;
    minTrackingConfidence?: number;
    selfieMode?: boolean;
  }): void;
  onResults(cb: (r: MeshResults) => void): void;
  initialize(): Promise<void>;
  send(input: { image: CanvasImageSource }): Promise<void>;
  reset(): void;
}
declare global {
  interface Window {
    FaceMesh?: new (cfg: { locateFile: (f: string) => string }) => FaceMeshInstance;
  }
}

const BASE = '/vendor/mediapipe-mesh/';
let ready: Promise<FaceMeshInstance> | null = null;

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    if (window.FaceMesh) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('The face tracking engine couldn’t be loaded.'));
    document.head.appendChild(s);
  });
}

let resolveResult: ((r: MeshResults) => void) | null = null;

function engine(): Promise<FaceMeshInstance> {
  ready ??= (async () => {
    await loadScript(`${BASE}face_mesh.js`);
    if (!window.FaceMesh) throw new Error('Face tracking isn’t available in this browser.');
    const fm = new window.FaceMesh({ locateFile: (f) => BASE + f });
    fm.setOptions({
      maxNumFaces: 6,
      refineLandmarks: false,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    fm.onResults((r) => {
      const done = resolveResult;
      resolveResult = null;
      done?.(r);
    });
    await initMediapipe(() => fm.initialize());
    return fm;
  })().catch((e) => {
    ready = null; // allow a retry later
    throw e;
  });
  return ready;
}

/** One request at a time — the engine reports through a single callback. */
let queue: Promise<unknown> = Promise.resolve();

function run(image: CanvasImageSource, fresh: boolean): Promise<Landmark[][]> {
  const job = queue.then(async () => {
    const fm = await engine();
    if (fresh) fm.reset(); // a still photo must not reuse tracking from earlier frames
    const r = await new Promise<MeshResults>((resolve, reject) => {
      resolveResult = resolve;
      fm.send({ image }).catch(reject);
    });
    return r.multiFaceLandmarks ?? [];
  });
  queue = job.catch(() => undefined);
  return job;
}

export function warmUpFaceMesh() {
  engine().catch(() => undefined);
}

// ------------------------------------------------------------------ landmark indices

/** Face Mesh indices. "R" = the subject's right (image-left in an unmirrored photo). */
export const IDX = {
  eyeROuter: 33,
  eyeRInner: 133,
  eyeRTop: 159,
  eyeRBottom: 145,
  eyeLOuter: 263,
  eyeLInner: 362,
  eyeLTop: 386,
  eyeLBottom: 374,
  browR: [70, 63, 105, 66, 107],
  browL: [300, 293, 334, 296, 336],
  noseTip: 1,
  noseBridge: 168,
  noseBottom: 2,
  nostrilR: 98,
  nostrilL: 327,
  lipTop: 0,
  lipBottom: 17,
  lipInnerTop: 13,
  lipInnerBottom: 14,
  mouthR: 61,
  mouthL: 291,
  chin: 152,
  forehead: 10,
  jawR: 234,
  jawL: 454,
  cheekR: 50,
  cheekL: 280,
  /** Face oval, clockwise from the top of the forehead. */
  oval: [
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152,
    148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
  ],
};

// ------------------------------------------------------------------ geometry

/**
 * A face in "face units": origin at the midpoint between the eyes, x along the eye line
 * (image-left → image-right), y pointing down the face, 1 unit ≈ the distance between the
 * eyes. Head roll is removed, so filters can be drawn upright and simply follow these points.
 * "L"/"R" here mean image-left / image-right.
 */
export interface FaceLocal {
  eyeL: P;
  eyeR: P;
  /** Eye width and openness (height) per eye. */
  eyeLW: number;
  eyeRW: number;
  eyeLH: number;
  eyeRH: number;
  browL: P[];
  browR: P[];
  noseTip: P;
  noseBridge: P;
  noseBottom: P;
  nostrilL: P;
  nostrilR: P;
  lipTop: P;
  lipBottom: P;
  mouthL: P;
  mouthR: P;
  mouthCenter: P;
  /** Inner-lip gap divided by mouth width (0 closed … ~0.6 wide open). */
  mouthOpen: number;
  chin: P;
  forehead: P;
  /** Estimated top of the skull (above the hairline). */
  headTop: P;
  jawL: P;
  jawR: P;
  cheekL: P;
  cheekR: P;
  outline: P[];
  /** Face width (jaw to jaw) in face units. */
  width: number;
  /** Head turn: -1 (turned toward image-left) … 1 (toward image-right). */
  yaw: number;
  /** Head nod: negative looking up, positive looking down (rough). */
  pitch: number;
}

export interface FaceGeom {
  /** Pixel position of the face-unit origin (between the eyes). */
  origin: P;
  /** Pixels per face unit. */
  u: number;
  /** Head roll in radians (clockwise positive, image coordinates). */
  roll: number;
  /** Pixel bounding box of the face oval. */
  box: { x: number; y: number; w: number; h: number };
  /** Face oval in pixels (for masks, face preservation and the scan overlay). */
  ovalPx: P[];
  local: FaceLocal;
}

const mid = (a: P, b: P): P => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);

/** Converts one face's normalised landmarks to pixel-space geometry + face units. */
export function toFaceGeom(lm: Landmark[], width: number, height: number, mirror = false): FaceGeom {
  const px = (i: number): P => ({
    x: (mirror ? 1 - lm[i].x : lm[i].x) * width,
    y: lm[i].y * height,
  });
  const z = (i: number) => lm[i].z * width;
  // In a mirrored frame the subject's right appears on the image-right.
  const pick = <T,>(subjectRight: T, subjectLeft: T): [T, T] =>
    mirror ? [subjectLeft, subjectRight] : [subjectRight, subjectLeft];

  const eyeRc = mid(px(IDX.eyeROuter), px(IDX.eyeRInner));
  const eyeLc = mid(px(IDX.eyeLOuter), px(IDX.eyeLInner));
  const [eyeA, eyeB] = pick(eyeRc, eyeLc); // image-left, image-right
  const origin = mid(eyeA, eyeB);
  const roll = Math.atan2(eyeB.y - eyeA.y, eyeB.x - eyeA.x);
  const faceH = dist(px(IDX.forehead), px(IDX.chin));
  // Inter-eye distance shrinks when the head turns; face height doesn't — use the larger.
  const u = Math.max(dist(eyeA, eyeB), faceH * 0.34, 1e-3);

  const cos = Math.cos(-roll);
  const sin = Math.sin(-roll);
  const toLocal = (p: P): P => {
    const dx = p.x - origin.x;
    const dy = p.y - origin.y;
    return { x: (dx * cos - dy * sin) / u, y: (dx * sin + dy * cos) / u };
  };
  const L = (i: number) => toLocal(px(i));

  const [eyeOutA, eyeOutB] = pick<readonly number[]>(
    [IDX.eyeROuter, IDX.eyeRInner, IDX.eyeRTop, IDX.eyeRBottom] as const,
    [IDX.eyeLOuter, IDX.eyeLInner, IDX.eyeLTop, IDX.eyeLBottom] as const,
  );
  const eyeW = (e: readonly number[]) => dist(L(e[0]), L(e[1]));
  const eyeH = (e: readonly number[]) => dist(L(e[2]), L(e[3]));
  const [browA, browB] = pick(IDX.browR, IDX.browL);
  const [nosA, nosB] = pick(IDX.nostrilR, IDX.nostrilL);
  const [mA, mB] = pick(IDX.mouthR, IDX.mouthL);
  const [jA, jB] = pick(IDX.jawR, IDX.jawL);
  const [cA, cB] = pick(IDX.cheekR, IDX.cheekL);

  const forehead = L(IDX.forehead);
  const chin = L(IDX.chin);
  const headTop = {
    x: forehead.x + (forehead.x - chin.x) * 0.28,
    y: forehead.y + (forehead.y - chin.y) * 0.28,
  };
  const mouthL = L(mA);
  const mouthR = L(mB);
  const jawL = L(jA);
  const jawR = L(jB);
  const noseTip = L(IDX.noseTip);

  // Yaw from the depth of the jaw sides (z grows away from the camera).
  const [zA, zB] = pick(z(IDX.jawR), z(IDX.jawL));
  const yaw = Math.max(-1, Math.min(1, (zA - zB) / (dist(px(jA), px(jB)) || 1)));
  const eyeLine = 0;
  const pitch = (noseTip.y - eyeLine) / Math.max(0.1, chin.y - eyeLine) - 0.42;

  const ovalPx = IDX.oval.map(px);
  const xs = ovalPx.map((p) => p.x);
  const ys = ovalPx.map((p) => p.y);
  const box = {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };

  const lipTop = L(IDX.lipTop);
  const lipBottom = L(IDX.lipBottom);
  const mw = dist(mouthL, mouthR) || 1;

  return {
    origin,
    u,
    roll,
    box,
    ovalPx,
    local: {
      eyeL: toLocal(eyeA),
      eyeR: toLocal(eyeB),
      eyeLW: eyeW(eyeOutA),
      eyeRW: eyeW(eyeOutB),
      eyeLH: eyeH(eyeOutA),
      eyeRH: eyeH(eyeOutB),
      browL: browA.map(L),
      browR: browB.map(L),
      noseTip,
      noseBridge: L(IDX.noseBridge),
      noseBottom: L(IDX.noseBottom),
      nostrilL: L(nosA),
      nostrilR: L(nosB),
      lipTop,
      lipBottom,
      mouthL,
      mouthR,
      mouthCenter: mid(L(IDX.lipInnerTop), L(IDX.lipInnerBottom)),
      mouthOpen: dist(L(IDX.lipInnerTop), L(IDX.lipInnerBottom)) / mw,
      chin,
      forehead,
      headTop,
      jawL,
      jawR,
      cheekL: L(cA),
      cheekR: L(cB),
      outline: IDX.oval.map(L),
      width: dist(jawL, jawR),
      yaw,
      pitch,
    },
  };
}

/** A neutral front-facing face in face units (thumbnails, tests, previews). */
export function canonicalFace(): FaceLocal {
  const outline: P[] = [];
  for (let i = 0; i < 36; i++) {
    const a = -Math.PI / 2 + (i / 36) * Math.PI * 2;
    outline.push({ x: Math.cos(a) * 1.05, y: 0.42 + Math.sin(a) * (a > 0 && a < Math.PI ? 1.5 : 1.45) });
  }
  return {
    eyeL: { x: -0.5, y: 0 },
    eyeR: { x: 0.5, y: 0 },
    eyeLW: 0.36,
    eyeRW: 0.36,
    eyeLH: 0.12,
    eyeRH: 0.12,
    browL: [-0.78, -0.62, -0.46, -0.3, -0.18].map((x, i) => ({ x, y: -0.36 - Math.sin((i / 4) * Math.PI) * 0.06 })),
    browR: [0.78, 0.62, 0.46, 0.3, 0.18].map((x, i) => ({ x, y: -0.36 - Math.sin((i / 4) * Math.PI) * 0.06 })),
    noseTip: { x: 0, y: 0.78 },
    noseBridge: { x: 0, y: 0.02 },
    noseBottom: { x: 0, y: 0.9 },
    nostrilL: { x: -0.2, y: 0.84 },
    nostrilR: { x: 0.2, y: 0.84 },
    lipTop: { x: 0, y: 1.1 },
    lipBottom: { x: 0, y: 1.42 },
    mouthL: { x: -0.42, y: 1.24 },
    mouthR: { x: 0.42, y: 1.24 },
    mouthCenter: { x: 0, y: 1.24 },
    mouthOpen: 0,
    chin: { x: 0, y: 1.92 },
    forehead: { x: 0, y: -1.02 },
    headTop: { x: 0, y: -1.85 },
    jawL: { x: -1.05, y: 0.3 },
    jawR: { x: 1.05, y: 0.3 },
    cheekL: { x: -0.72, y: 0.62 },
    cheekR: { x: 0.72, y: 0.62 },
    outline,
    width: 2.1,
    yaw: 0,
    pitch: 0,
  };
}

// ------------------------------------------------------------------ public API

/** Every face in a still image, largest first. */
export async function detectFaceMeshes(image: HTMLCanvasElement): Promise<FaceGeom[]> {
  const W = image.width;
  const H = image.height;
  // Stage 1: Face Mesh on the whole photo (its built-in detector is tuned for close-ups).
  const whole = await run(image, true);
  const found = whole.map((lm) => toFaceGeom(lm, W, H));

  // Stage 2: the full-range face detector finds smaller / group faces; each one it finds that
  // stage 1 missed is cropped, enlarged and meshed on its own, then mapped back.
  let boxes: { x: number; y: number; w: number; h: number }[] = [];
  try {
    boxes = await detectFaces(image);
  } catch {
    /* the second detector is optional — keep stage-1 results */
  }
  for (const b of boxes) {
    const cx = (b.x + b.w / 2) * W;
    const cy = (b.y + b.h / 2) * H;
    const covered = found.some(
      (f) => cx > f.box.x && cx < f.box.x + f.box.w && cy > f.box.y && cy < f.box.y + f.box.h,
    );
    if (covered) continue;
    const size = Math.max(b.w * W, b.h * H) * 2.4;
    const sx = cx - size / 2;
    const sy = cy - size / 2;
    const crop = document.createElement('canvas');
    crop.width = crop.height = 512;
    const ctx = crop.getContext('2d');
    if (!ctx) continue;
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, 512, 512);
    ctx.drawImage(image, sx, sy, size, size, 0, 0, 512, 512);
    const meshes = await run(crop, true).catch(() => [] as Landmark[][]);
    const lm = meshes[0];
    if (!lm) continue;
    // Crop-normalised → photo-normalised (z is scaled like x).
    const mapped = lm.map((p) => ({
      x: (sx + p.x * size) / W,
      y: (sy + p.y * size) / H,
      z: (p.z * size) / W,
    }));
    found.push(toFaceGeom(mapped, W, H));
  }
  return dedupe(found.sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h));
}

/**
 * One live-camera frame. Landmarks are returned in the coordinates of the *displayed* frame
 * (mirrored for the front camera), sorted left to right so indices stay stable.
 */
export async function trackFaces(
  video: HTMLVideoElement,
  mirror: boolean,
): Promise<FaceGeom[]> {
  const faces = await run(video, false);
  const w = video.videoWidth;
  const h = video.videoHeight;
  return dedupe(faces.map((lm) => toFaceGeom(lm, w, h, mirror))).sort((a, b) => a.origin.x - b.origin.x);
}

/**
 * Exponential smoothing between live frames so filters don't jitter. Faces are matched by
 * nearest origin; big jumps (a new face, fast motion) snap instead of trailing behind.
 */
export function smoothFaces(prev: FaceGeom[], next: FaceGeom[], k = 0.55): FaceGeom[] {
  return next.map((f) => {
    const p = prev.reduce<FaceGeom | null>(
      (best, c) =>
        !best || dist(c.origin, f.origin) < dist(best.origin, f.origin) ? c : best,
      null,
    );
    if (!p || dist(p.origin, f.origin) > f.u * 0.8) return f;
    const a = k; // weight of the new frame
    const lerp = (x: number, y: number) => x * (1 - a) + y * a;
    const lp = (q: P, r: P): P => ({ x: lerp(q.x, r.x), y: lerp(q.y, r.y) });
    const local = { ...f.local };
    for (const key of Object.keys(local) as (keyof FaceLocal)[]) {
      const pv = p.local[key];
      const nv = f.local[key];
      if (typeof nv === 'number' && typeof pv === 'number') {
        (local as Record<string, unknown>)[key] = lerp(pv, nv);
      } else if (Array.isArray(nv) && Array.isArray(pv) && pv.length === nv.length) {
        (local as Record<string, unknown>)[key] = (nv as P[]).map((q, i) => lp((pv as P[])[i], q));
      } else if (nv && pv && typeof nv === 'object') {
        (local as Record<string, unknown>)[key] = lp(pv as P, nv as P);
      }
    }
    // Unwrap the roll difference so smoothing never spins the long way round.
    let dr = f.roll - p.roll;
    if (dr > Math.PI) dr -= Math.PI * 2;
    if (dr < -Math.PI) dr += Math.PI * 2;
    return {
      ...f,
      origin: lp(p.origin, f.origin),
      u: lerp(p.u, f.u),
      roll: p.roll + dr * a,
      local,
    };
  });
}

/**
 * Drops repeated detections of the same face (the tracker can briefly report a moving face
 * twice). Faces whose eye-midpoints are closer than ~0.7 eye-distances are the same person;
 * the first (largest / earliest) one is kept.
 */
export function dedupe(faces: FaceGeom[]): FaceGeom[] {
  const out: FaceGeom[] = [];
  for (const f of faces) {
    if (!out.some((g) => dist(g.origin, f.origin) < Math.max(g.u, f.u) * 0.7)) out.push(f);
  }
  return out;
}
