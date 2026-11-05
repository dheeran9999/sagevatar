/**
 * Generates the default login / sign-up backdrop: an ORIGINAL sunlit "city canyon" street view
 * between skyscrapers (no characters, no third-party imagery).
 *
 *   npm run backdrop -w client   →   client/public/backgrounds/city-canyon.svg
 *
 * To use a licensed image instead, set VITE_AUTH_BACKGROUND (see client/.env.example).
 */
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/backgrounds');
const W = 1920;
const H = 1080;
const VX = 960; // vanishing point
const VY = 470;
const r = (n) => Math.round(n * 10) / 10;

/** Perspective side wall from the screen edge to the street's far end. */
function wall(side, tone) {
  const near = side === 'left' ? 0 : W;
  const far = side === 'left' ? 760 : W - 760;
  const top = [-60, VY - 150];
  const bottom = [H + 60, VY + 210];
  const lerp = (a, b, t) => a + (b - a) * t;
  const floors = 26;
  const cols = 14;
  let lines = '';
  for (let i = 1; i < floors; i++) {
    const t = i / floors;
    lines += `<line x1="${near}" y1="${r(lerp(top[0], bottom[0], t))}" x2="${far}" y2="${r(lerp(top[1], bottom[1], t))}"/>`;
  }
  for (let k = 1; k < cols; k++) {
    const t = 1 - Math.pow(0.8, k); // columns bunch up with distance
    const x = lerp(near, far, t);
    lines += `<line x1="${r(x)}" y1="${r(lerp(top[0], top[1], t))}" x2="${r(x)}" y2="${r(lerp(bottom[0], bottom[1], t))}"/>`;
  }
  // A few lit windows for life.
  let lit = '';
  for (let i = 0; i < 18; i++) {
    const t = ((i * 37) % 100) / 100;
    const f = ((i * 53) % 90) / 100 + 0.05;
    const x = lerp(near, far, 1 - Math.pow(0.8, 1 + (i % 9)));
    const yTop = lerp(top[0], top[1], t);
    const yBot = lerp(bottom[0], bottom[1], t);
    const y = lerp(yTop, yBot, f);
    lit += `<rect x="${r(x + (side === 'left' ? 4 : -22))}" y="${r(y)}" width="16" height="10" fill="#fde68a" opacity="0.55"/>`;
  }
  return `
    <polygon points="${near},${top[0]} ${far},${top[1]} ${far},${bottom[1]} ${near},${bottom[0]}" fill="url(#${tone})"/>
    <g stroke="#0f172a" stroke-opacity="0.35" stroke-width="2">${lines}</g>
    ${lit}`;
}

function distantTowers() {
  const towers = [
    [690, 120, 70, '#94a3b8'],
    [770, 60, 60, '#a5b4c8'],
    [840, 150, 80, '#8fa3bb'],
    [930, 20, 70, '#b6c4d6'],
    [1010, 110, 60, '#9aaec4'],
    [1080, 70, 80, '#a5b4c8'],
    [1170, 160, 60, '#94a3b8'],
  ];
  return towers
    .map(([x, y, w, c]) => {
      let win = '';
      for (let i = 0; i < 4; i++) {
        win += `<rect x="${x + 8 + i * ((w - 16) / 4)}" y="${y + 10}" width="${(w - 16) / 4 - 4}" height="${VY + 220 - y}" fill="#fff" opacity="0.12"/>`;
      }
      return `<rect x="${x}" y="${y}" width="${w}" height="${VY + 240 - y}" fill="${c}"/>${win}`;
    })
    .join('');
}

function street() {
  let dashes = '';
  for (let i = 0; i < 12; i++) {
    const t0 = Math.pow(i / 12, 1.8);
    const t1 = Math.pow((i + 0.45) / 12, 1.8);
    const y0 = VY + 210 + (H - VY - 210) * t0;
    const y1 = VY + 210 + (H - VY - 210) * t1;
    const w0 = 2 + 10 * t0;
    const w1 = 2 + 10 * t1;
    dashes += `<polygon points="${r(VX - w0)},${r(y0)} ${r(VX + w0)},${r(y0)} ${r(VX + w1)},${r(y1)} ${r(VX - w1)},${r(y1)}" fill="#fef3c7" opacity="0.8"/>`;
  }
  const cars = [
    [VX - 40, VY + 230, 16, '#ef4444'],
    [VX + 22, VY + 248, 20, '#facc15'],
    [VX - 90, VY + 290, 30, '#e2e8f0'],
    [VX + 60, VY + 330, 40, '#3b82f6'],
    [VX - 160, VY + 420, 60, '#f59e0b'],
  ]
    .map(
      (
        [x, y, w, c],
        i,
      ) => `<g><animateTransform attributeName="transform" type="translate" values="0 0;0 ${i % 2 ? -6 : 6};0 0" dur="${6 + i}s" repeatCount="indefinite"/>
      <rect x="${x}" y="${y}" width="${w}" height="${w * 0.55}" rx="${w * 0.15}" fill="${c}"/>
      <rect x="${x + w * 0.15}" y="${y - w * 0.22}" width="${w * 0.7}" height="${w * 0.3}" rx="${w * 0.1}" fill="${c}" opacity="0.85"/></g>`,
    )
    .join('');
  return `
    <polygon points="0,${H + 60} 760,${VY + 210} ${W - 760},${VY + 210} ${W},${H + 60}" fill="url(#road)"/>
    <polygon points="0,${H + 60} 760,${VY + 210} 800,${VY + 210} 160,${H + 60}" fill="#94a3b8" opacity="0.35"/>
    <polygon points="${W},${H + 60} ${W - 760},${VY + 210} ${W - 800},${VY + 210} ${W - 160},${H + 60}" fill="#94a3b8" opacity="0.35"/>
    ${dashes}${cars}`;
}

function clouds() {
  return [
    [700, 120, 90, 28, 70],
    [1100, 70, 120, 34, 90],
    [900, 200, 70, 20, 60],
  ]
    .map(
      (
        [x, y, rx, ry, dur],
        i,
      ) => `<g opacity="0.85"><animateTransform attributeName="transform" type="translate" values="-80 0;80 0;-80 0" dur="${dur}s" begin="-${i * 13}s" repeatCount="indefinite"/>
      <ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="#fff"/><ellipse cx="${x + rx * 0.5}" cy="${y - ry * 0.5}" rx="${rx * 0.6}" ry="${ry}" fill="#fff"/></g>`,
    )
    .join('');
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#38bdf8"/><stop offset="0.6" stop-color="#bae6fd"/><stop offset="1" stop-color="#f0f9ff"/>
    </linearGradient>
    <radialGradient id="sun" cx="0.62" cy="0.18" r="0.35">
      <stop offset="0" stop-color="#fff" stop-opacity="0.95"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="wallL" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#1e293b"/><stop offset="1" stop-color="#64748b"/>
    </linearGradient>
    <linearGradient id="wallR" x1="1" y1="0" x2="0" y2="0">
      <stop offset="0" stop-color="#334155"/><stop offset="1" stop-color="#94a3b8"/>
    </linearGradient>
    <linearGradient id="road" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="#1f2937"/><stop offset="1" stop-color="#64748b"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  <rect width="${W}" height="${H}" fill="url(#sun)">
    <animate attributeName="opacity" values="1;0.8;1" dur="8s" repeatCount="indefinite"/>
  </rect>
  ${clouds()}
  ${distantTowers()}
  ${street()}
  ${wall('left', 'wallL')}
  ${wall('right', 'wallR')}
</svg>`;

mkdirSync(OUT, { recursive: true });
const file = path.join(OUT, 'city-canyon.svg');
writeFileSync(file, svg);
console.log(`city-canyon.svg: ${(statSync(file).size / 1024).toFixed(0)} KB`);
