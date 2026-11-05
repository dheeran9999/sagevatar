/**
 * Generates the app background: an ORIGINAL cinematic city at night with a caped hero
 * silhouette on a rooftop at the far left (a generic figure — no franchise character, emblem
 * or logo). Deterministic, so rebuilding gives the same picture.
 *
 *   node scripts/generate-cyber-city.mjs   → public/backgrounds/cyber-city.svg (night)
 *                                          + public/backgrounds/cyber-city-day.svg (daylight)
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(here, '../public/backgrounds');
const W = 1920;
const H = 1080;

let seed = 20261105;
/** Night (dark theme) and daylight (light theme) palettes for the same city. */
const THEMES = [
  ['cyber-city.svg', { sky0: '#01030a', sky1: '#05102c', sky2: '#0a2556', sky3: '#0c3170', glow: '#1d7bff', glowOpacity: 0.55, moonGlow: '#bfe3ff', moon: '#d6ecff', moonOpacity: 0.85, cloud: '#1b3a78', star: '#cfe8ff', stars: 90, fog: '#0b2a5c', far: '#0a1d44', near: '#061331', win1: '#3aa0ff', win2: '#5cc8ff', winBoost: 1, tower: '#030817', towerTop: '#050c22', rim: '#38bdf8', rim2: '#7dd3fc', cape: '#020713', body: '#01040c', heroOpacity: 1 }],
  ['cyber-city-day.svg', { sky0: '#5aa9f5', sky1: '#8cc8fb', sky2: '#c4e3fd', sky3: '#e8f4ff', glow: '#ffffff', glowOpacity: 0.7, moonGlow: '#fff7d6', moon: '#fffbea', moonOpacity: 0.95, cloud: '#ffffff', star: '#ffffff', stars: 0, fog: '#eaf5ff', far: '#9cc2e8', near: '#6f9fd2', win1: '#e6f3ff', win2: '#f2f9ff', winBoost: 0.8, tower: '#4f7fb6', towerTop: '#5b8cc4', rim: '#ffffff', rim2: '#ffffff', cape: '#2c4f80', body: '#26466f', heroOpacity: 0.55 }],
];

for (const [file, P] of THEMES) {
seed = 20261105;
const r = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const f = (n) => Math.round(n * 10) / 10;

/** A row of buildings with lit windows. */
function skyline({
  y0,
  minH,
  maxH,
  minW,
  maxW,
  fill,
  win,
  winOpacity,
  density,
  from = 0,
  to = W,
  rim,
}) {
  const out = [];
  let x = from - 20;
  while (x < to) {
    const w = minW + r() * (maxW - minW);
    const h = minH + r() * (maxH - minH);
    const top = y0 - h;
    out.push(
      `<rect x="${f(x)}" y="${f(top)}" width="${f(w)}" height="${f(h + 40)}" fill="${fill}"/>`,
    );
    // Occasional stepped crown / antenna for a varied silhouette.
    if (r() < 0.35) {
      const cw = w * (0.4 + r() * 0.3);
      out.push(
        `<rect x="${f(x + (w - cw) / 2)}" y="${f(top - 18)}" width="${f(cw)}" height="20" fill="${fill}"/>`,
      );
    }
    if (r() < 0.18) {
      out.push(
        `<rect x="${f(x + w / 2 - 1)}" y="${f(top - 60)}" width="2" height="60" fill="${fill}"/>`,
      );
      out.push(
        `<circle cx="${f(x + w / 2)}" cy="${f(top - 61)}" r="2.2" fill="#ff5a6a" opacity="0.9"/>`,
      );
    }
    if (rim)
      out.push(
        `<rect x="${f(x + w - 1.5)}" y="${f(top)}" width="1.5" height="${f(h)}" fill="${rim}" opacity="0.35"/>`,
      );
    // Windows
    const cols = Math.max(1, Math.floor(w / 9));
    const rows = Math.floor(h / 13);
    for (let c = 0; c < cols; c++) {
      for (let k = 0; k < rows; k++) {
        if (r() > density) continue;
        const o = winOpacity * (0.35 + r() * 0.65);
        out.push(
          `<rect x="${f(x + 3 + c * 9)}" y="${f(top + 8 + k * 13)}" width="3.6" height="5.4" fill="${win}" opacity="${f(o * 100) / 100}"/>`,
        );
      }
    }
    x += w + 2 + r() * 6;
  }
  return out.join('');
}

/** Original caped hero, standing tall with the cape blowing to the right. Feet at (cx, base). */
function hero(cx, base, s) {
  const p = (x, y) => `${f(cx + x * s)},${f(base + y * s)}`;
  // Body: legs apart, narrow waist, broad shoulders, arms slightly away from the body.
  const body = [
    `M${p(-22, 0)}`,
    `L${p(-15, -70)}`,
    `L${p(-17, -96)}`,
    `L${p(-33, -100)}`,
    `L${p(-40, -150)}`,
    `Q${p(-40, -166)} ${p(-24, -170)}`,
    `L${p(-9, -174)}`,
    `L${p(-8, -182)}`,
    `Q${p(-14, -186)} ${p(-14, -198)}`,
    `Q${p(-13, -214)} ${p(0, -215)}`,
    `Q${p(13, -214)} ${p(14, -198)}`,
    `Q${p(14, -186)} ${p(8, -182)}`,
    `L${p(9, -174)}`,
    `L${p(24, -170)}`,
    `Q${p(40, -166)} ${p(40, -150)}`,
    `L${p(33, -100)}`,
    `L${p(17, -96)}`,
    `L${p(15, -70)}`,
    `L${p(22, 0)}`,
    `L${p(9, 0)}`,
    `L${p(2, -66)}`,
    `L${p(-2, -66)}`,
    `L${p(-9, 0)}`,
    'Z',
  ].join(' ');
  // Cape from both shoulders, billowing right with a ragged hem.
  const cape = [
    `M${p(-26, -168)}`,
    `Q${p(0, -176)} ${p(26, -168)}`,
    `C${p(80, -150)} ${p(130, -95)} ${p(170, -26)}`,
    `L${p(146, -30)}`,
    `L${p(150, -8)}`,
    `L${p(122, -18)}`,
    `L${p(118, 4)}`,
    `L${p(92, -12)}`,
    `L${p(80, 6)}`,
    `C${p(52, -40)} ${p(14, -110)} ${p(-26, -168)}`,
    'Z',
  ].join(' ');
  // Rim light: only on the outer edges facing the city glow.
  const capeEdge = `M${p(26, -168)} C${p(80, -150)} ${p(130, -95)} ${p(170, -26)}`;
  const bodyEdge = `M${p(14, -198)} Q${p(14, -186)} ${p(8, -182)} L${p(9, -174)} L${p(24, -170)} Q${p(40, -166)} ${p(40, -150)} L${p(33, -100)}`;
  return `
    <g opacity="${P.heroOpacity}">
      <path d="${cape}" fill="${P.cape}"/>
      <path d="${body}" fill="${P.body}"/>
      <path d="${capeEdge}" fill="none" stroke="${P.rim}" stroke-width="${f(1.6 * s)}" stroke-linecap="round" opacity="0.65"/>
      <path d="${bodyEdge}" fill="none" stroke="${P.rim2}" stroke-width="${f(1.5 * s)}" stroke-linecap="round" opacity="0.75"/>
    </g>`;
}

// ---- The tall rooftop building on the far left ------------------------------------------
const roofY = 560;
const tower = `
  <rect x="40" y="${roofY}" width="300" height="${H - roofY + 40}" fill="${P.tower}"/>
  <rect x="20" y="${roofY - 14}" width="340" height="16" fill="${P.towerTop}"/>
  <rect x="356" y="${roofY - 14}" width="2" height="${H - roofY + 14}" fill="${P.rim}" opacity="0.45"/>
  <rect x="20" y="${roofY - 15}" width="340" height="1.5" fill="${P.rim2}" opacity="0.5"/>
  <rect x="300" y="${roofY - 90}" width="3" height="76" fill="${P.towerTop}"/>
  <circle cx="301.5" cy="${roofY - 92}" r="3" fill="#ff5a6a"/>
  ${Array.from({ length: 34 }, (_, k) =>
    Array.from({ length: 14 }, (_, c) =>
      r() < 0.28
        ? `<rect x="${58 + c * 20}" y="${roofY + 26 + k * 16}" width="8" height="7" fill="${P.win2}" opacity="${f((0.15 + r() * 0.5) * 100) / 100}"/>`
        : '',
    ).join(''),
  ).join('')}`;

const clouds = Array.from({ length: 9 }, () => {
  const cx = r() * W;
  const cy = 120 + r() * 260;
  const rx = 160 + r() * 260;
  return `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(rx * 0.18)}" fill="${P.cloud}" opacity="${f((0.12 + r() * 0.16) * 100) / 100}"/>`;
}).join('');

const stars = Array.from(
  { length: P.stars },
  () =>
    `<circle cx="${f(r() * W)}" cy="${f(r() * 420)}" r="${f(0.5 + r() * 1.1)}" fill="${P.star}" opacity="${f((0.2 + r() * 0.6) * 100) / 100}"/>`,
).join('');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMinYMax slice">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${P.sky0}"/>
      <stop offset="0.45" stop-color="${P.sky1}"/>
      <stop offset="0.78" stop-color="${P.sky2}"/>
      <stop offset="1" stop-color="${P.sky3}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.22" cy="0.82" r="0.6">
      <stop offset="0" stop-color="${P.glow}" stop-opacity="${P.glowOpacity}"/>
      <stop offset="1" stop-color="${P.glow}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="moon" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${P.moonGlow}" stop-opacity="0.9"/>
      <stop offset="0.35" stop-color="#7cc4ff" stop-opacity="0.25"/>
      <stop offset="1" stop-color="#7cc4ff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="fog" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${P.fog}" stop-opacity="0"/>
      <stop offset="1" stop-color="${P.fog}" stop-opacity="0.85"/>
    </linearGradient>
    <filter id="soft"><feGaussianBlur stdDeviation="22"/></filter>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  ${stars}
  <circle cx="420" cy="210" r="210" fill="url(#moon)"/>
  <circle cx="420" cy="210" r="46" fill="${P.moon}" opacity="${P.moonOpacity}"/>
  <g filter="url(#soft)">${clouds}</g>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <g>${skyline({ y0: H, minH: 220, maxH: 520, minW: 40, maxW: 110, fill: P.far, win: P.win1, winOpacity: 0.35, density: 0.22 })}</g>
  <rect y="${H - 420}" width="${W}" height="420" fill="url(#fog)" opacity="0.6"/>
  <g>${skyline({ y0: H, minH: 140, maxH: 380, minW: 60, maxW: 150, fill: P.near, win: P.win2, winOpacity: 0.7, density: 0.3, from: 300, rim: P.rim })}</g>
  <rect y="${H - 200}" width="${W}" height="200" fill="url(#fog)"/>
  ${tower}
  ${hero(165, roofY - 14, 1.22)}
</svg>
`;

writeFileSync(path.join(OUT_DIR, file), svg);
console.log(`${file}: ${(svg.length / 1024).toFixed(0)} KB`);
}
