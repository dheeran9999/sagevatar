/**
 * Photo templates: a Creator-uploaded celebration photograph (e.g. the SageIT office cake
 * cutting) in which the marked faces are replaced by the selected employees' REAL faces.
 *
 * For every face slot: the participant's face cut-out (from their original photo) is scaled to
 * the target face, tilted to the target head angle, brightness-matched to the lighting at that
 * spot in the photo (skin tone is kept from the employee's own photo), and blended in with a feathered edge. Everything else in the photo — logo,
 * banner, cake, balloons — stays exactly as uploaded.
 */
import sharp, { type OverlayOptions } from 'sharp';
import { escapeHtml } from '../events.js';
import type { PreparedPerson } from './faces.js';
import type { Slot } from './templates.js';

export interface PhotoPerson {
  name: string;
  slot: Slot;
  person: PreparedPerson;
}

const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

function lumaStats(values: number[]) {
  if (values.length < 20) return null;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const std = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length) || 1;
  return { mean, std };
}
type Stats = NonNullable<ReturnType<typeof lumaStats>>;

/**
 * Matches the LIGHTING of the target spot (brightness and contrast only). Colour/skin tone is
 * kept from the employee's own photo — tone is part of identity, so it is never transferred.
 */
async function lightMatch(face: PreparedPerson, target: Stats | null, strength = 0.65) {
  if (!target) return face.facePng;
  const { data, info } = await sharp(face.facePng).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const src: number[] = [];
  for (let i = 0; i < data.length; i += 4 * 3) if (data[i + 3] > 200) src.push(luma(data[i], data[i + 1], data[i + 2]));
  const s = lumaStats(src);
  if (!s) return face.facePng;
  const ratio = Math.min(1.5, Math.max(0.7, target.std / s.std));
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const y = luma(data[i], data[i + 1], data[i + 2]);
    const wanted = (y - s.mean) * ratio + target.mean;
    const y2 = y * (1 - strength) + wanted * strength;
    const k = y > 1 ? y2 / y : 1;
    for (let c = 0; c < 3; c++) data[i + c] = Math.max(0, Math.min(255, Math.round(data[i + c] * k)));
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

/** Pads an image so `anchor` is its exact centre (so rotation keeps the face in place). */
async function centreOn(png: Buffer, w: number, h: number, ax: number, ay: number) {
  const half = Math.ceil(Math.max(ax, w - ax, ay, h - ay));
  return sharp(png)
    .extend({
      left: half - ax,
      right: half - (w - ax),
      top: half - ay,
      bottom: half - (h - ay),
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

async function clip(l: OverlayOptions, W: number, H: number): Promise<OverlayOptions | null> {
  const left = l.left ?? 0;
  const top = l.top ?? 0;
  const m = await sharp(l.input as Buffer).metadata();
  const w = m.width ?? 0;
  const h = m.height ?? 0;
  const x0 = Math.max(0, -left);
  const y0 = Math.max(0, -top);
  const x1 = Math.min(w, W - left);
  const y1 = Math.min(h, H - top);
  if (x1 <= x0 || y1 <= y0) return null;
  if (x0 === 0 && y0 === 0 && x1 === w && y1 === h) return l;
  return {
    input: await sharp(l.input as Buffer).extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 }).png().toBuffer(),
    left: left + x0,
    top: top + y0,
  };
}

function namesRibbon(W: number, H: number, names: string[], accent: string, heading: string) {
  const line = names.join('   •   ');
  const size = Math.max(18, Math.min(Math.round(W * 0.022), Math.floor((W * 0.86) / Math.max(1, line.length * 0.52))));
  const band = Math.round(size * 2.9);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <rect x="0" y="${H - band}" width="${W}" height="${band}" fill="${heading}" opacity="0.88"/>
      <rect x="0" y="${H - band}" width="${W}" height="6" fill="${accent}"/>
      <text x="${W / 2}" y="${H - band + size * 1.05}" font-family="'Segoe UI', Arial, sans-serif" font-size="${Math.round(size * 0.55)}" letter-spacing="6" font-weight="600" fill="${accent}" text-anchor="middle">CELEBRATING</text>
      <text x="${W / 2}" y="${H - band + size * 2.25}" font-family="'Segoe UI', Arial, sans-serif" font-size="${size}" font-weight="600" fill="#ffffff" text-anchor="middle">${escapeHtml(line)}</text>
    </svg>`,
  );
}

export async function renderPhotoTemplate(input: {
  photo: Buffer;
  canvas: { width: number; height: number };
  people: PhotoPerson[];
  showNames: boolean;
  colours: { accent: string; heading: string };
}): Promise<{ png: Buffer; scene: Buffer }> {
  const { width: W, height: H } = input.canvas;
  const scene = await sharp(input.photo).rotate().resize(W, H, { fit: 'fill' }).removeAlpha().png().toBuffer();
  const { data: base } = await sharp(scene).raw().toBuffer({ resolveWithObject: true });

  const layers: OverlayOptions[] = [];
  for (const p of input.people) {
    const s = p.slot;
    // Lighting at the target face (centre of the face box, inside an ellipse).
    const samples: number[] = [];
    const rx = s.faceHeight * 0.28;
    const ry = s.faceHeight * 0.36;
    for (let y = Math.round(s.y - ry); y < s.y + ry; y += 2) {
      for (let x = Math.round(s.x - rx); x < s.x + rx; x += 2) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        if (((x - s.x) / rx) ** 2 + ((y - s.y) / ry) ** 2 > 1) continue;
        const i = (y * W + x) * 3;
        samples.push(luma(base[i], base[i + 1], base[i + 2]));
      }
    }
    const matched = await lightMatch(p.person, lumaStats(samples));
    let face = await centreOn(matched, p.person.width, p.person.height, p.person.anchorX, p.person.anchorY);
    if (s.angle && Math.abs(s.angle) > 0.5) {
      face = await sharp(face).rotate(s.angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    }
    const m = await sharp(face).metadata();
    layers.push({ input: face, left: Math.round(s.x - (m.width ?? 0) / 2), top: Math.round(s.y - (m.height ?? 0) / 2) });
  }
  if (input.showNames && input.people.length) {
    const names = [...input.people].sort((a, b) => a.slot.x - b.slot.x).map((p) => p.name);
    layers.push({ input: namesRibbon(W, H, names, input.colours.accent, input.colours.heading), left: 0, top: 0 });
  }
  const clipped = (await Promise.all(layers.map((l) => clip(l, W, H)))).filter((l): l is OverlayOptions => !!l);
  const png = await sharp(scene).composite(clipped).png({ compressionLevel: 7 }).toBuffer();
  return { png, scene };
}

/** Preview: the photo with each replaceable face outlined and numbered (cake cutters in gold). */
export async function renderPhotoPreview(photo: Buffer, canvas: { width: number; height: number }, slots: Slot[]) {
  const { width: W, height: H } = canvas;
  const marks = slots
    .map(
      (s, i) => `
      <ellipse cx="${s.x}" cy="${s.y}" rx="${s.faceHeight * 0.45}" ry="${s.faceHeight * 0.58}" fill="#ffffff" fill-opacity="0.18" stroke="${s.role === 'cutter' ? '#f2b632' : '#ffffff'}" stroke-width="${Math.max(4, W / 300)}" stroke-dasharray="14 10"/>
      <circle cx="${s.x}" cy="${s.y - s.faceHeight * 0.58 - 26}" r="24" fill="${s.role === 'cutter' ? '#f2b632' : '#1d3c8f'}"/>
      <text x="${s.x}" y="${s.y - s.faceHeight * 0.58 - 17}" font-family="Arial, sans-serif" font-size="26" font-weight="700" fill="#ffffff" text-anchor="middle">${i + 1}</text>`,
    )
    .join('');
  const png = await sharp(await sharp(photo).rotate().resize(W, H, { fit: 'fill' }).png().toBuffer())
    .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${marks}</svg>`) }])
    .png()
    .toBuffer();
  return sharp(png).resize(900).jpeg({ quality: 84 }).toBuffer();
}
