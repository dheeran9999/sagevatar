import sharp from 'sharp';

/**
 * Synthetic head-and-shoulders "test portraits" — NOT real people. Each one has a distinct skin
 * tone, hair, shirt colour and a large ID letter on the forehead, so tests (and humans looking at
 * a generated poster) can verify that every participant's own face lands in their own slot.
 *
 * Returns the photo, a matching person mask, and the face box (normalised) where the face is drawn.
 */
const SKIN = ['#f1c7a5', '#c68863', '#8d5524', '#e0ac69', '#ffdbac', '#a0673f', '#d9a37f', '#7a4a2a', '#f5d0b5', '#b5835a', '#e8b98f'];
const HAIR = ['#2b1b0f', '#5a3825', '#0d0d0d', '#a56b3a', '#d9b26f', '#3b2a20', '#111111', '#7b4b2a', '#c0c0c0', '#4a2f1c', '#1d1d1d'];
const SHIRT = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#be185d', '#4d7c0f', '#1e293b', '#b45309', '#475569'];

export async function testPortrait(index: number, width = 720, height = 900) {
  const label = String.fromCharCode(65 + (index % 26));
  const cx = width / 2;
  const cy = height * 0.4;
  const fw = width * 0.34;
  const fh = fw * 1.25;
  const skin = SKIN[index % SKIN.length];
  const hair = HAIR[index % HAIR.length];
  const shirt = SHIRT[index % SHIRT.length];
  const person = `
    <path d="M${cx - width * 0.46},${height} L${cx - width * 0.44},${cy + fh * 1.05} Q${cx},${cy + fh * 0.75} ${cx + width * 0.44},${cy + fh * 1.05} L${cx + width * 0.46},${height} Z" fill="${shirt}"/>
    <rect x="${cx - fw * 0.2}" y="${cy + fh * 0.3}" width="${fw * 0.4}" height="${fh * 0.5}" fill="${skin}"/>
    <ellipse cx="${cx}" cy="${cy - fh * 0.12}" rx="${fw * 0.62}" ry="${fh * 0.6}" fill="${hair}"/>
    <ellipse cx="${cx}" cy="${cy}" rx="${fw / 2}" ry="${fh / 2}" fill="${skin}"/>
    <ellipse cx="${cx - fw * 0.18}" cy="${cy - fh * 0.05}" rx="${fw * 0.07}" ry="${fh * 0.045}" fill="#1f2937"/>
    <ellipse cx="${cx + fw * 0.18}" cy="${cy - fh * 0.05}" rx="${fw * 0.07}" ry="${fh * 0.045}" fill="#1f2937"/>
    <path d="M${cx - fw * 0.17},${cy + fh * 0.22} Q${cx},${cy + fh * 0.33} ${cx + fw * 0.17},${cy + fh * 0.22}" stroke="#7f1d1d" stroke-width="${fw * 0.035}" fill="none" stroke-linecap="round"/>
    <text x="${cx}" y="${cy - fh * 0.2}" font-family="Arial, sans-serif" font-size="${fh * 0.2}" font-weight="700" fill="#111827" text-anchor="middle">${label}</text>`;
  const svg = (body: string, bg: string) =>
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${bg}"/>${body}</svg>`,
    );
  const photo = await sharp(svg(person, '#cbd5e1')).jpeg({ quality: 92 }).toBuffer();
  const mask = await sharp(svg(person.replace(/fill="[^"]+"/g, 'fill="#ffffff"').replace(/stroke="[^"]+"/g, 'stroke="#ffffff"'), '#000000'))
    .greyscale()
    .png()
    .toBuffer();
  const face = { x: (cx - fw / 2) / width, y: (cy - fh / 2) / height, w: fw / width, h: fh / height };
  return { photo, mask, face, label };
}
