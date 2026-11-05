/**
 * Person cut-out for "Behind person" and Background avatars, using MediaPipe Selfie
 * Segmentation (Apache-2.0). Model + WASM are served from /vendor/mediapipe (copied from
 * node_modules by scripts/copy-vendor.mjs) — no CDN, and the photo never leaves the browser.
 * The runtime is only downloaded the first time a cut-out is needed.
 */
import { initMediapipe } from './mediapipeInit';

interface SegResults {
  segmentationMask: CanvasImageSource;
}
interface SelfieSegmentationInstance {
  setOptions(o: { modelSelection: 0 | 1 }): void;
  onResults(cb: (r: SegResults) => void): void;
  initialize(): Promise<void>;
  send(input: { image: CanvasImageSource }): Promise<void>;
  close(): Promise<void>;
}
declare global {
  interface Window {
    SelfieSegmentation?: new (cfg: {
      locateFile: (f: string) => string;
    }) => SelfieSegmentationInstance;
  }
}

const BASE = '/vendor/mediapipe/';
let ready: Promise<SelfieSegmentationInstance> | null = null;

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    if (window.SelfieSegmentation) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('The person cut-out engine couldn’t be loaded.'));
    document.head.appendChild(s);
  });
}

function engine(): Promise<SelfieSegmentationInstance> {
  ready ??= (async () => {
    await loadScript(`${BASE}selfie_segmentation.js`);
    if (!window.SelfieSegmentation) throw new Error('The person cut-out engine isn’t available.');
    const seg = new window.SelfieSegmentation({ locateFile: (f) => BASE + f });
    seg.setOptions({ modelSelection: 0 }); // general model — better for portrait/selfie photos
    await initMediapipe(() => seg.initialize());
    return seg;
  })().catch((e) => {
    ready = null; // allow a retry later
    throw e;
  });
  return ready;
}

/** Calls are serialised — the engine reports results through one callback. */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Returns a canvas the size of `photo` containing only the person (soft edges),
 * transparent everywhere else.
 */
export function cutOutPerson(photo: HTMLCanvasElement): Promise<HTMLCanvasElement> {
  const job = queue.then(async () => {
    const seg = await engine();
    const mask = await new Promise<CanvasImageSource>((resolve, reject) => {
      seg.onResults((r) => resolve(r.segmentationMask));
      seg.send({ image: photo }).catch(reject);
    });
    const out = document.createElement('canvas');
    out.width = photo.width;
    out.height = photo.height;
    const ctx = out.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available in this browser.');
    // Feather the low-resolution mask slightly so the edge blends naturally.
    const feather = Math.max(1, Math.round(Math.max(photo.width, photo.height) / 900));
    ctx.filter = `blur(${feather}px)`;
    ctx.drawImage(mask, 0, 0, out.width, out.height);
    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'source-in';
    ctx.drawImage(photo, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    return out;
  });
  queue = job.catch(() => undefined);
  return job;
}

/** Starts downloading the engine in the background (e.g. once a photo exists). */
export function warmUpSegmentation() {
  engine().catch(() => undefined);
}
