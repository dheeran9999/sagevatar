/**
 * Face detection for group posters, using MediaPipe Face Detection (Apache-2.0) served from
 * /vendor/mediapipe-face (copied from node_modules — no CDN). Runs in the browser; the photo is
 * analysed on the device and only the original file + face box + person mask are uploaded.
 */
import type { FaceBox } from './api';
import { cutOutPerson } from './segmentation';
import { initMediapipe } from './mediapipeInit';

interface Detection {
  boundingBox: { xCenter: number; yCenter: number; width: number; height: number };
  landmarks?: { x: number; y: number }[];
  score?: number[];
}
interface FaceDetectionInstance {
  setOptions(o: { model: 'short' | 'full'; minDetectionConfidence: number }): void;
  onResults(cb: (r: { detections: Detection[] }) => void): void;
  initialize(): Promise<void>;
  send(input: { image: CanvasImageSource }): Promise<void>;
}
declare global {
  interface Window {
    FaceDetection?: new (cfg: { locateFile: (f: string) => string }) => FaceDetectionInstance;
  }
}

const BASE = '/vendor/mediapipe-face/';
let ready: Promise<FaceDetectionInstance> | null = null;

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    if (window.FaceDetection) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('The face detection engine couldn’t be loaded.'));
    document.head.appendChild(s);
  });
}

function engine() {
  ready ??= (async () => {
    await loadScript(`${BASE}face_detection.js`);
    if (!window.FaceDetection) throw new Error('Face detection isn’t available in this browser.');
    const fd = new window.FaceDetection({ locateFile: (f) => BASE + f });
    // "full" range copes with group/half-body photos as well as close-ups.
    fd.setOptions({ model: 'full', minDetectionConfidence: 0.5 });
    await initMediapipe(() => fd.initialize());
    return fd;
  })().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

let queue: Promise<unknown> = Promise.resolve();

export interface FaceResult {
  /** The largest face, normalised to the image; null when none was found. */
  face: FaceBox | null;
  /** How many faces were found (more than one → the largest is used, the user should check). */
  count: number;
}

/** MediaPipe detection → our face box (slightly enlarged) with roll angle from the eyes. */
function toBox(d: Detection, image: HTMLCanvasElement): FaceBox {
  const bb = d.boundingBox;
  let angle: number | undefined;
  const [rightEye, leftEye] = d.landmarks ?? [];
  if (rightEye && leftEye) {
    // Landmarks are normalised separately per axis — convert to pixels for the angle.
    const dx = (leftEye.x - rightEye.x) * image.width;
    const dy = (leftEye.y - rightEye.y) * image.height;
    angle = Math.round(((Math.atan2(dy, dx) * 180) / Math.PI) * 10) / 10;
    if (Math.abs(angle) > 60) angle = undefined;
  }
  // MediaPipe's box is tight (brows → chin); grow it slightly to cover forehead and jaw.
  const w = bb.width * 1.1;
  const h = bb.height * 1.2;
  return { x: bb.xCenter - w / 2, y: bb.yCenter - h / 2 - bb.height * 0.06, w, h, ...(angle !== undefined ? { angle } : {}) };
}

/** Every face in the image, left to right. */
export function detectFaces(image: HTMLCanvasElement): Promise<FaceBox[]> {
  const job = queue.then(async () => {
    const fd = await engine();
    const detections = await new Promise<Detection[]>((resolve, reject) => {
      fd.onResults((r) => resolve(r.detections ?? []));
      fd.send({ image }).catch(reject);
    });
    return detections.map((d) => toBox(d, image)).sort((a, b) => a.x - b.x);
  });
  queue = job.catch(() => undefined);
  return job;
}

/** Detects faces; the largest one is assumed to be the person. */
export async function detectFace(image: HTMLCanvasElement): Promise<FaceResult> {
  const faces = await detectFaces(image);
  if (!faces.length) return { face: null, count: 0 };
  const best = [...faces].sort((a, b) => b.w * b.h - a.w * a.h)[0];
  return { face: best, count: faces.length };
}

/** Greyscale person mask (white = person) for the photo, from selfie segmentation. */
export async function personMask(image: HTMLCanvasElement): Promise<Blob> {
  const cut = await cutOutPerson(image);
  const ctx = cut.getContext('2d')!;
  const data = ctx.getImageData(0, 0, cut.width, cut.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3];
    px[i] = px[i + 1] = px[i + 2] = a;
    px[i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  return new Promise((resolve, reject) =>
    cut.toBlob((b) => (b ? resolve(b) : reject(new Error('Couldn’t encode the mask.'))), 'image/png'),
  );
}

/** Draws the aligned face crop the poster will use — a live preview for manual adjustment. */
export function drawFacePreview(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource & { width: number; height: number },
  face: FaceBox,
  adjust: { dx: number; dy: number; zoom: number; rotate: number },
) {
  const W = img.width;
  const H = img.height;
  const size = ctx.canvas.width;
  const F0 = Math.max(face.w * W, face.h * H);
  const F = F0 / adjust.zoom;
  const cx = (face.x + face.w / 2) * W + adjust.dx * F0;
  const cy = (face.y + face.h / 2) * H + adjust.dy * F0;
  const angle = ((face.angle ?? 0) + adjust.rotate) * (Math.PI / 180);
  const view = 1.9 * F; // the crop shows the head with some margin
  ctx.save();
  ctx.clearRect(0, 0, size, size);
  ctx.translate(size / 2, size / 2);
  ctx.rotate(-angle);
  ctx.scale(size / view, size / view);
  ctx.drawImage(img, -cx, -cy);
  ctx.restore();
  // Face guide: where the poster expects the face to be.
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.setLineDash([6, 5]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(size / 2, size / 2 - size * 0.04, size * 0.3, size * 0.4, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
