/**
 * Removes a flat / gently graded studio background from a still image and writes a
 * transparent, trimmed PNG.
 *
 *   npm run cutout -w client -- <input> <output.png>
 *
 * Works on stills only (PNG, JPEG, WebP, single-frame GIF). Pixels connected to the image
 * border whose colour is close to that row's background colour become transparent, with a
 * soft edge. Enclosed pockets of background (e.g. between a cape and legs) are removed only when
 * they are large and match the background closely, so small grey details inside the figure stay.
 */
import sharp from 'sharp';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: cutout.mjs <input> <output.png>');
  process.exit(1);
}

const meta = await sharp(input, { animated: true }).metadata();
if ((meta.pages ?? 1) > 1) {
  console.error(`${input} is animated (${meta.pages} frames); use it as-is instead.`);
  process.exit(1);
}
console.log(`input: ${meta.format} ${meta.width}×${meta.height}, alpha: ${meta.hasAlpha}`);

const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H } = info;
const px = (x, y) => (y * W + x) * 4;

// Per-row background estimate: average of a few pixels at each side edge.
const bg = [];
for (let y = 0; y < H; y++) {
  let r = 0,
    g = 0,
    b = 0,
    n = 0;
  for (const x of [0, 1, 2, W - 3, W - 2, W - 1]) {
    const i = px(x, y);
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    n++;
  }
  bg.push([r / n, g / n, b / n]);
}
const dist = (x, y) => {
  const i = px(x, y);
  const [r, g, b] = bg[y];
  return Math.hypot(data[i] - r, data[i + 1] - g, data[i + 2] - b);
};

const HARD = 26; // ≤ this: background
const SOFT = 52; // between HARD and SOFT: partially transparent edge
const seen = new Uint8Array(W * H);
const stack = [];
for (let x = 0; x < W; x++) stack.push(x, 0, x, H - 1);
for (let y = 0; y < H; y++) stack.push(0, y, W - 1, y);
while (stack.length) {
  const y = stack.pop();
  const x = stack.pop();
  if (x < 0 || y < 0 || x >= W || y >= H || seen[y * W + x]) continue;
  seen[y * W + x] = 1;
  const d = dist(x, y);
  if (d >= SOFT) continue;
  const i = px(x, y);
  data[i + 3] = d <= HARD ? 0 : Math.round(((d - HARD) / (SOFT - HARD)) * 255);
  if (d <= HARD) stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
}

// Second pass: large enclosed regions that match the background closely.
const POCKET = 18;
const MIN_POCKET = Math.round(W * H * 0.0008);
for (let start = 0; start < W * H; start++) {
  if (seen[start]) continue;
  const region = [];
  const q = [start];
  seen[start] = 1;
  while (q.length) {
    const k = q.pop();
    const x = k % W;
    const y = (k - x) / W;
    if (dist(x, y) > POCKET) continue;
    region.push(k);
    for (const [nx, ny] of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ]) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[ny * W + nx]) continue;
      seen[ny * W + nx] = 1;
      q.push(ny * W + nx);
    }
  }
  if (region.length >= MIN_POCKET) for (const k of region) data[k * 4 + 3] = 0;
}

await sharp(data, { raw: { width: W, height: H, channels: 4 } })
  .trim({ threshold: 1 })
  .png({ compressionLevel: 9 })
  .toFile(output);
const out = await sharp(output).metadata();
console.log(`wrote ${output}: ${out.width}×${out.height} transparent PNG`);
