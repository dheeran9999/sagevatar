/**
 * Body pose + full-body person mask for Full-Body Avatar mode, using MediaPipe Pose
 * (Apache-2.0, 33 landmarks, WebGL-accelerated) served from /vendor/mediapipe-pose (copied from
 * node_modules by scripts/copy-vendor.mjs — no CDN; the photo never leaves the browser).
 * Unlike selfie segmentation, Pose handles people standing at a distance.
 */
import { initMediapipe } from './mediapipeInit';
import type { P } from './facemesh';

interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}
interface PoseResults {
  poseLandmarks?: Landmark[];
  segmentationMask?: CanvasImageSource;
}
interface PoseInstance {
  setOptions(o: Record<string, unknown>): void;
  onResults(cb: (r: PoseResults) => void): void;
  initialize(): Promise<void>;
  send(input: { image: CanvasImageSource }): Promise<void>;
  reset(): void;
}
declare global {
  interface Window {
    Pose?: new (cfg: { locateFile: (f: string) => string }) => PoseInstance;
  }
}

const BASE = '/vendor/mediapipe-pose/';
let ready: Promise<PoseInstance> | null = null;
let resolveResult: ((r: PoseResults) => void) | null = null;

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    if (window.Pose) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('The body tracking engine couldn’t be loaded.'));
    document.head.appendChild(s);
  });
}

function engine(): Promise<PoseInstance> {
  ready ??= (async () => {
    await loadScript(`${BASE}pose.js`);
    if (!window.Pose) throw new Error('Body tracking isn’t available in this browser.');
    const pose = new window.Pose({ locateFile: (f) => BASE + f });
    pose.setOptions({
      modelComplexity: 1,
      smoothLandmarks: false,
      enableSegmentation: true,
      smoothSegmentation: false,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    pose.onResults((r) => {
      const done = resolveResult;
      resolveResult = null;
      done?.(r);
    });
    await initMediapipe(() => pose.initialize());
    return pose;
  })().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

export function warmUpPose() {
  engine().catch(() => undefined);
}

/** MediaPipe Pose landmark indices used for fitting. */
export const POSE = {
  nose: 0,
  eyeL: 2,
  eyeR: 5,
  earL: 7,
  earR: 8,
  mouthL: 9,
  mouthR: 10,
  shoulderL: 11,
  shoulderR: 12,
  hipL: 23,
  hipR: 24,
  ankleL: 27,
  ankleR: 28,
  heelL: 29,
  heelR: 30,
  footL: 31,
  footR: 32,
} as const;

export interface PoseResult {
  /** 33 landmarks in photo pixels, with visibility 0..1. */
  points: (P & { v: number })[];
  /** Person cut-out (photo colours where the person is, transparent elsewhere). */
  cutout: HTMLCanvasElement | null;
}

let queue: Promise<unknown> = Promise.resolve();

/** One engine call on `image`; landmarks normalised to that image. */
function runOnce(image: HTMLCanvasElement): Promise<PoseResults> {
  const job = queue.then(async () => {
    const pose = await engine();
    pose.reset();
    return new Promise<PoseResults>((resolve, reject) => {
      resolveResult = resolve;
      pose.send({ image }).catch(reject);
    });
  });
  queue = job.catch(() => undefined);
  return job;
}

/** How confidently the core body (shoulders + hips) was seen. */
function confidence(l: Landmark[]) {
  const core = [11, 12, 23, 24].map((i) => l[i]?.visibility ?? 0);
  return core.reduce((a, b) => a + b, 0) / core.length;
}

/**
 * Pose + person mask for a still photo (the most prominent person). The whole photo is tried
 * first; when the person is small in a wide shot, overlapping windows at two scales are tried
 * and the most confident one is mapped back. Null when nobody is found.
 */
export async function detectPose(photo: HTMLCanvasElement): Promise<PoseResult | null> {
  const W = photo.width;
  const H = photo.height;
  type Hit = { r: PoseResults; sx: number; sy: number; sw: number; sh: number; conf: number };
  let best: Hit | null = null;

  const tryRegion = async (sx: number, sy: number, sw: number, sh: number) => {
    let img = photo;
    if (sx || sy || sw !== W || sh !== H) {
      const k = Math.min(2, 640 / Math.max(sw, sh));
      img = document.createElement('canvas');
      img.width = Math.max(1, Math.round(sw * k));
      img.height = Math.max(1, Math.round(sh * k));
      img.getContext('2d')!.drawImage(photo, sx, sy, sw, sh, 0, 0, img.width, img.height);
    }
    const r = await runOnce(img);
    if (!r.poseLandmarks?.length) return;
    const conf = confidence(r.poseLandmarks);
    if (!best || conf > best.conf) best = { r, sx, sy, sw, sh, conf };
  };

  await tryRegion(0, 0, W, H);
  if (!best || (best as Hit).conf < 0.6) {
    const side = Math.min(W, H);
    for (const scale of [1, 0.6]) {
      const s = side * scale;
      const step = s / 2;
      for (let y = 0; y + s <= H + 1; y += step) {
        for (let x = 0; x + s <= W + 1; x += step) {
          if (scale === 1 && s === W && s === H) continue; // same as the whole photo
          await tryRegion(x, y, s, s);
        }
      }
      if (best && (best as Hit).conf >= 0.75) break;
    }
  }
  if (!best) return null;
  const { r, sx, sy, sw, sh } = best as Hit;

  const points = r.poseLandmarks!.map((l) => ({
    x: sx + l.x * sw,
    y: sy + l.y * sh,
    v: l.visibility ?? 1,
  }));
  let cutout: HTMLCanvasElement | null = null;
  if (r.segmentationMask) {
    cutout = document.createElement('canvas');
    cutout.width = W;
    cutout.height = H;
    const ctx = cutout.getContext('2d');
    if (ctx) {
      const feather = Math.max(1, Math.round(Math.max(W, H) / 900));
      ctx.filter = `blur(${feather}px)`;
      ctx.drawImage(r.segmentationMask, sx, sy, sw, sh);
      ctx.filter = 'none';
      ctx.globalCompositeOperation = 'source-in';
      ctx.drawImage(photo, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  return { points, cutout };
}
