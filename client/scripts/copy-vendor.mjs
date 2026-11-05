/**
 * Copies the MediaPipe runtime files (models + WASM, Apache-2.0) from node_modules into
 * client/public/vendor so they are served from our own origin (no CDN):
 *  - selfie segmentation → public/vendor/mediapipe       (person cut-outs)
 *  - face detection      → public/vendor/mediapipe-face  (group anniversary face alignment)
 *  - face mesh           → public/vendor/mediapipe-mesh  (468 landmarks for AR face filters)
 *  - pose                → public/vendor/mediapipe-pose  (body landmarks + mask for full-body avatars)
 * Runs automatically before `dev` and `build`; the output folders are git-ignored.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

const PACKAGES = [
  ['@mediapipe/selfie_segmentation', 'mediapipe'],
  ['@mediapipe/face_detection', 'mediapipe-face'],
  ['@mediapipe/face_mesh', 'mediapipe-mesh'],
  ['@mediapipe/pose', 'mediapipe-pose'],
];

for (const [pkg, folder] of PACKAGES) {
  const src = path.dirname(require.resolve(`${pkg}/package.json`));
  const dest = path.resolve(here, '../public/vendor', folder);
  mkdirSync(dest, { recursive: true });
  let n = 0;
  for (const f of readdirSync(src)) {
    if (!/\.(js|wasm|tflite|binarypb|data)$/.test(f)) continue;
    if (/_heavy\.tflite$/.test(f)) continue; // 26 MB pose model we never select
    const to = path.join(dest, f);
    if (!existsSync(to)) {
      copyFileSync(path.join(src, f), to);
      n++;
    }
  }
  console.log(`${pkg}: ${n} file(s) copied to public/vendor/${folder}`);
}
