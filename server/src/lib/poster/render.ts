/**
 * Renders a "Happy Work Anniversary – Group Cake Cutting" poster.
 *
 * Layers (bottom → top):
 *   1. scene      — AI-generated room (when available) or the design's built-in scene
 *   2. people     — back row first; each person = drawn body + their REAL face/shoulders cut-out
 *   3. table/cake — tablecloth, three-tier cake
 *   4. cutters    — knife and the two cake cutters' arms and hands on the handle
 *   5. overlay    — heading, company branding, names, confetti
 */
import sharp, { type OverlayOptions } from 'sharp';
import { escapeHtml } from '../events.js';
import { shade, type PreparedPerson } from './faces.js';
import {
  CAKE,
  CANVAS,
  KNIFE_HANDLE,
  SLOTS,
  TABLE_TOP,
  type Design,
  type Slot,
} from './templates.js';

const { width: CW, height: CH } = CANVAS;
const esc = escapeHtml;

/** Small deterministic PRNG so a variation always renders the same way. */
export function rng(seed: number) {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const svg = (body: string, w: number = CW, h: number = CH) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`,
  );

/** Rough text width for fitting (bold serif/sans ≈ 0.6 em per character). */
const fitFont = (text: string, maxWidth: number, base: number, em = 0.6) =>
  Math.max(18, Math.min(base, Math.floor(maxWidth / Math.max(1, text.length * em))));

// ---------------------------------------------------------------- Scene

function balloons(d: Design, r: () => number, side: 'left' | 'right') {
  const out: string[] = [];
  const baseX = side === 'left' ? 150 : CW - 150;
  for (let i = 0; i < 7; i++) {
    const x = baseX + (r() - 0.5) * 220;
    const y = 360 + r() * 300;
    const rr = 46 + r() * 22;
    const color = d.palette.balloons[i % d.palette.balloons.length];
    out.push(
      `<path d="M${x},${y + rr * 1.15} q ${(r() - 0.5) * 40},120 ${(r() - 0.5) * 30},260" stroke="${shade(color, -0.3)}" stroke-width="2" fill="none" opacity="0.7"/>`,
      `<ellipse cx="${x}" cy="${y}" rx="${rr}" ry="${rr * 1.15}" fill="${color}" stroke="${shade(color, -0.25)}" stroke-width="2"/>`,
      `<ellipse cx="${x - rr * 0.35}" cy="${y - rr * 0.45}" rx="${rr * 0.18}" ry="${rr * 0.3}" fill="#ffffff" opacity="0.45" transform="rotate(-25 ${x - rr * 0.35} ${y - rr * 0.45})"/>`,
    );
  }
  return out.join('');
}

function decor(d: Design, r: () => number) {
  const out: string[] = [];
  if (d.decor === 'brand') {
    // Glass office partition on the left, ceiling lights, plants and a soft floor line.
    out.push(
      `<rect x="0" y="330" width="560" height="780" fill="#dbe7f0" opacity="0.7"/>`,
      `<path d="M0,330 H560 M140,330 V1110 M280,330 V1110 M420,330 V1110" stroke="#b9c8d4" stroke-width="5"/>`,
      `<rect x="0" y="560" width="560" height="10" fill="#c7d3dd"/>`,
    );
    for (const x of [120, 330, 540]) out.push(`<ellipse cx="${x}" cy="350" rx="60" ry="8" fill="#ffffff" opacity="0.95"/>`);
    for (const x of [640, 1360]) {
      out.push(`<rect x="${x - 40}" y="1000" width="80" height="80" rx="10" fill="#ffffff" stroke="#c7d3dd" stroke-width="3"/>`);
      for (let i = 0; i < 7; i++) {
        const a = -Math.PI / 2 + (i - 3) * 0.38;
        const len = 70 + r() * 40;
        out.push(
          `<path d="M${x},1005 q${Math.cos(a) * len * 0.4 + 8},${Math.sin(a) * len * 0.5} ${Math.cos(a) * len},${Math.sin(a) * len}" stroke="#2f9e5b" stroke-width="12" stroke-linecap="round" fill="none"/>`,
        );
      }
    }
  }
  return out.join('');
}

function confetti(d: Design, r: () => number, count: number, area: { y0: number; y1: number }) {
  const colors = [d.palette.accent, d.palette.accent2, ...d.palette.balloons];
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const x = r() * CW;
    const y = area.y0 + r() * (area.y1 - area.y0);
    const c = colors[Math.floor(r() * colors.length)];
    const rot = Math.round(r() * 180);
    out.push(
      r() < 0.5
        ? `<rect x="${x}" y="${y}" width="${8 + r() * 10}" height="${4 + r() * 6}" fill="${c}" opacity="0.85" transform="rotate(${rot} ${x} ${y})"/>`
        : `<circle cx="${x}" cy="${y}" r="${3 + r() * 5}" fill="${c}" opacity="0.8"/>`,
    );
  }
  return out.join('');
}

/** The design's own scene, used when AI is unavailable or not chosen. */
export function sceneSvg(d: Design, companyName: string, variation: number) {
  const p = d.palette;
  const r = rng(variation * 7919 + d.sortOrder);
  return svg(`
    <defs>
      <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.wall[0]}"/><stop offset="1" stop-color="${p.wall[1]}"/></linearGradient>
      <radialGradient id="spot" cx="0.5" cy="0.45" r="0.6"><stop offset="0" stop-color="#ffffff" stop-opacity="0.18"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
      <radialGradient id="glow"><stop offset="0" stop-color="#ffe7a8" stop-opacity="0.8"/><stop offset="1" stop-color="#ffe7a8" stop-opacity="0"/></radialGradient>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfe3f5"/><stop offset="1" stop-color="#eef8fc"/></linearGradient>
    </defs>
    <rect width="${CW}" height="${CH}" fill="url(#wall)"/>
    <rect width="${CW}" height="${CH}" fill="url(#spot)"/>
    <rect y="1150" width="${CW}" height="${CH - 1150}" fill="${p.floor}"/>
    <!-- Brand sign on the background wall, behind the group -->
    <rect x="610" y="330" width="780" height="190" rx="20" fill="#ffffff" opacity="0.55"/>
    <text x="1000" y="472" font-family="'Segoe UI', Arial, Helvetica, sans-serif" font-size="${fitFont(companyName, 720, 170, 0.6)}" font-weight="800" fill="${p.heading}" opacity="0.85" text-anchor="middle">${esc(companyName)}</text>
    <rect x="760" y="494" width="480" height="10" rx="5" fill="${p.accent}" opacity="0.85"/>
    ${decor(d, r)}
    ${balloons(d, r, 'left')}
    ${balloons(d, r, 'right')}
    ${confetti(d, r, 90, { y0: 280, y1: 900 })}
  `);
}

// ---------------------------------------------------------------- People

/** A drawn torso (jacket, shirt, neck) under the person's real head/shoulders. */
function bodySvg(slot: Slot, color: string, skin: string, x: number, y: number) {
  const H = slot.faceHeight;
  const half = 1.12 * H;
  const bottom = TABLE_TOP + 60;
  const w = Math.ceil(half * 2 + 8);
  const top = Math.floor(y + 0.25 * H);
  const h = bottom - top;
  const L = (dx: number) => (half + 4 + dx).toFixed(1);
  const T = (dy: number) => (y + dy - top).toFixed(1);
  const dark = shade(color, -0.25);
  const body = `
    <rect x="${L(-0.19 * H)}" y="${T(0.25 * H)}" width="${(0.38 * H).toFixed(1)}" height="${(0.6 * H).toFixed(1)}" rx="${(0.1 * H).toFixed(1)}" fill="${skin}"/>
    <path d="M${L(-half)},${h} L${L(-half)},${T(1.4 * H)} Q${L(-1.08 * H)},${T(0.97 * H)} ${L(-0.55 * H)},${T(0.84 * H)} L${L(-0.2 * H)},${T(0.64 * H)} L${L(0.2 * H)},${T(0.64 * H)} L${L(0.55 * H)},${T(0.84 * H)} Q${L(1.08 * H)},${T(0.97 * H)} ${L(half)},${T(1.4 * H)} L${L(half)},${h} Z" fill="${color}" stroke="${dark}" stroke-width="3"/>
    <path d="M${L(-0.22 * H)},${T(0.64 * H)} L${L(0)},${T(1.45 * H)} L${L(0.22 * H)},${T(0.64 * H)} Z" fill="#f4f6f8"/>
    <path d="M${L(-0.07 * H)},${T(0.8 * H)} L${L(0.07 * H)},${T(0.8 * H)} L${L(0.1 * H)},${T(1.4 * H)} L${L(0)},${T(1.52 * H)} L${L(-0.1 * H)},${T(1.4 * H)} Z" fill="${shade(color, -0.45)}"/>
    <path d="M${L(-0.6 * H)},${T(0.86 * H)} L${L(-0.14 * H)},${T(1.5 * H)} M${L(0.6 * H)},${T(0.86 * H)} L${L(0.14 * H)},${T(1.5 * H)}" stroke="${dark}" stroke-width="4" fill="none"/>`;
  return { input: svg(body, w, h), left: Math.round(x - half - 4), top };
}

export interface PlacedPerson {
  name: string;
  slot: Slot;
  person: PreparedPerson | null;
}

/** Slot position nudged a little per variation so "Generate Again" isn't identical. */
function placeOf(slot: Slot, variation: number) {
  if (!variation) return { x: slot.x, y: slot.y };
  const r = rng(variation * 104729 + slot.x);
  const jx = slot.role === 'cutter' ? 6 : 18;
  return { x: Math.round(slot.x + (r() - 0.5) * 2 * jx), y: Math.round(slot.y + (r() - 0.5) * 16) };
}

/** Grey silhouette used ONLY for template previews (never in a generated poster). */
async function silhouette(slot: Slot) {
  const H = slot.faceHeight;
  const w = Math.round(1.6 * H);
  const h = Math.round(2.0 * H);
  const png = await sharp(
    svg(
      `<ellipse cx="${w / 2}" cy="${0.62 * H}" rx="${0.42 * H}" ry="${0.55 * H}" fill="#9aa5b1" stroke="#ffffff" stroke-width="4" stroke-dasharray="10 8"/>`,
      w,
      h,
    ),
  )
    .png()
    .toBuffer();
  return { png, anchorX: Math.round(w / 2), anchorY: Math.round(0.62 * H) };
}

// ---------------------------------------------------------------- Table, cake, knife, arms

function tableAndCakeSvg(d: Design, variation: number) {
  const p = d.palette;
  const c = p.cake;
  const r = rng(variation * 31 + 5);
  const tiers = [
    { w: CAKE.width, h: 125 },
    { w: CAKE.width * 0.72, h: 100 },
  ];
  let y: number = CAKE.baseY;
  const cake: string[] = [
    `<ellipse cx="${CAKE.x}" cy="${CAKE.baseY + 6}" rx="${CAKE.width * 0.62}" ry="26" fill="${c.plate}" stroke="${shade(c.plate, -0.25)}" stroke-width="3"/>`,
  ];
  for (const t of tiers) {
    const x0 = CAKE.x - t.w / 2;
    const top = y - t.h;
    cake.push(
      `<rect x="${x0}" y="${top}" width="${t.w}" height="${t.h}" rx="10" fill="${c.sponge}" stroke="${shade(c.sponge, -0.2)}" stroke-width="3"/>`,
      `<rect x="${x0}" y="${top}" width="${t.w}" height="${t.h * 0.86}" rx="10" fill="${c.frosting}"/>`,
    );
    // Drips
    const drips: string[] = [];
    for (let i = 0; i < Math.round(t.w / 34); i++) {
      const dx = x0 + 12 + i * 34;
      drips.push(
        `<path d="M${dx},${top + 4} v${18 + r() * 26} a9,9 0 0 0 18,0 v-${18}" fill="${c.trim}" opacity="0.9"/>`,
      );
    }
    cake.push(`<rect x="${x0}" y="${top}" width="${t.w}" height="12" rx="6" fill="${c.trim}"/>`, ...drips);
    for (let i = 0; i < Math.round(t.w / 30); i++) {
      cake.push(`<circle cx="${x0 + 15 + i * 30}" cy="${y - 10}" r="7" fill="${c.trim}"/>`);
    }
    y = top;
  }
  // Candles on the top tier, leaving the middle free for the knife.
  for (const i of [-3, -2, 2, 3]) {
    const cx = CAKE.x + i * 36;
    cake.push(
      `<rect x="${cx - 6}" y="${y - 56}" width="12" height="56" rx="4" fill="${i % 2 ? p.accent : p.accent2}" stroke="${shade(p.accent, -0.3)}" stroke-width="2"/>`,
      `<ellipse cx="${cx}" cy="${y - 70}" rx="9" ry="16" fill="#ffb703"/><ellipse cx="${cx}" cy="${y - 66}" rx="4" ry="8" fill="#fff3b0"/>`,
    );
  }
  if (d.extras.cakeTopper) {
    // Cloud-shaped topper card on the top tier, to the right of the knife.
    const tx = CAKE.x + 110;
    const ty = y - 92;
    cake.push(
      `<path d="M${tx},${y} V${ty + 40}" stroke="#c9ced6" stroke-width="5"/>`,
      `<path d="M${tx - 105},${ty + 30} q-12,-34 22,-40 q10,-30 46,-20 q22,-26 60,-6 q40,-14 54,22 q34,4 26,44 q8,30 -26,34 h-160 q-34,-4 -22,-34 Z" fill="#ffffff" stroke="${p.accent}" stroke-width="3.5" transform="translate(${tx} ${ty + 20}) scale(1.22 1.08) translate(${-tx} ${-(ty + 20)})"/>`,
      `<text x="${tx}" y="${ty + 8}" font-family="${p.headingFont}" font-size="28" font-weight="700" fill="${p.heading}" text-anchor="middle">Happy</text>`,
      `<text x="${tx}" y="${ty + 40}" font-family="${p.headingFont}" font-size="19" font-weight="700" fill="${p.heading}" text-anchor="middle">Work Anniversary</text>`,
    );
  }
  const gifts = d.extras.gifts
    ? [
        { x: 230, w: 250, h: 150, c: p.accent2 },
        { x: 470, w: 170, h: 110, c: p.accent },
      ]
        .map((g) => {
          const top = TABLE_TOP + 70 - g.h;
          return (
            `<rect x="${g.x}" y="${top}" width="${g.w}" height="${g.h}" rx="6" fill="${g.c}" stroke="${shade(g.c, -0.3)}" stroke-width="3"/>` +
            `<rect x="${g.x - 8}" y="${top - 6}" width="${g.w + 16}" height="34" rx="6" fill="${shade(g.c, 0.08)}" stroke="${shade(g.c, -0.3)}" stroke-width="3"/>` +
            `<rect x="${g.x + g.w / 2 - 12}" y="${top - 6}" width="24" height="${g.h + 6}" fill="#e8edf2"/>` +
            `<path d="M${g.x + g.w / 2},${top - 6} q-60,-50 -70,-8 q10,26 70,8 q60,-50 70,-8 q-10,26 -70,8" fill="none" stroke="#e8edf2" stroke-width="10"/>`
          );
        })
        .join('')
    : '';
  return svg(`
    <defs><linearGradient id="cloth" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.cloth[0]}"/><stop offset="1" stop-color="${p.cloth[1]}"/></linearGradient></defs>
    <path d="M110,${TABLE_TOP} L${CW - 110},${TABLE_TOP} L${CW - 60},${TABLE_TOP + 70} L60,${TABLE_TOP + 70} Z" fill="${shade(p.cloth[0], -0.06)}"/>
    <rect x="60" y="${TABLE_TOP + 70}" width="${CW - 120}" height="${CH - TABLE_TOP - 70}" fill="url(#cloth)"/>
    <path d="M60,${TABLE_TOP + 70} ${Array.from({ length: 24 }, (_, i) => `Q ${60 + (i + 0.5) * ((CW - 120) / 24)},${TABLE_TOP + 110} ${60 + (i + 1) * ((CW - 120) / 24)},${TABLE_TOP + 70}`).join(' ')}" fill="none" stroke="${p.accent}" stroke-width="6" opacity="0.9"/>
    ${gifts}
    ${cake.join('')}
  `);
}

type Cutter = { x: number; y: number; slot: Slot; color: string; skin: string };

/** Geometry of a cake cutter's inner arm: shoulder → elbow (behind the cake) → hand on the knife. */
function armOf(c: Cutter, i: number) {
  const k = KNIFE_HANDLE;
  const H = c.slot.faceHeight;
  const dir = c.x < k.x ? 1 : -1;
  const sx = c.x + dir * 0.98 * H;
  const sy = c.y + 1.1 * H;
  const ex = c.x + dir * 0.8 * H;
  const ey = c.y + 1.98 * H;
  const hx = k.x - dir * 3;
  const hy = k.y + (i === 0 ? 2 : 30);
  const fx = hx - ex;
  const fy = hy - ey;
  const fl = Math.hypot(fx, fy) || 1;
  const along = (d: number) => [hx - (fx / fl) * d * H, hy - (fy / fl) * d * H] as const;
  return { H, sx, sy, ex, ey, hx, hy, wrist: along(0.17), cuff: along(0.27), width: 0.3 * H };
}

/** Sleeves of the cake cutters' inner arms — drawn BEHIND the cake, so only the forearms show above it. */
function armsSvg(cutters: Cutter[]) {
  return svg(
    cutters
      .map((c, i) => {
        const a = armOf(c, i);
        const d = `M${a.sx.toFixed(1)},${a.sy.toFixed(1)} L${a.ex.toFixed(1)},${a.ey.toFixed(1)} L${a.cuff[0].toFixed(1)},${a.cuff[1].toFixed(1)}`;
        return (
          `<path d="${d}" stroke="${shade(c.color, -0.3)}" stroke-width="${a.width + 6}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>` +
          `<path d="${d}" stroke="${c.color}" stroke-width="${a.width}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`
        );
      })
      .join(''),
  );
}

/** The knife pushed into the top tier, and both cutters' hands on its handle (in front of the cake). */
function knifeAndHandsSvg(cutters: Cutter[]) {
  const k = KNIFE_HANDLE;
  const parts: string[] = [
    `<path d="M${k.x - 10},${k.y + 40} L${k.x + 10},${k.y + 40} L${k.x + 8},${k.y + 120} Q${k.x},${k.y + 132} ${k.x - 8},${k.y + 120} Z" fill="#d9dee4" stroke="#8a939c" stroke-width="2"/>`,
    `<rect x="${k.x - 12}" y="${k.y - 30}" width="24" height="74" rx="9" fill="#3b2f2a" stroke="#1f1813" stroke-width="2"/>`,
  ];
  cutters.forEach((c, i) => {
    const a = armOf(c, i);
    const H = a.H;
    parts.push(
      `<path d="M${a.cuff[0].toFixed(1)},${a.cuff[1].toFixed(1)} L${a.wrist[0].toFixed(1)},${a.wrist[1].toFixed(1)}" stroke="#f4f6f8" stroke-width="${a.width * 0.92}" stroke-linecap="butt"/>`,
      `<ellipse cx="${a.hx}" cy="${a.hy}" rx="${0.15 * H}" ry="${0.12 * H}" fill="${c.skin}" stroke="${shade(c.skin, -0.3)}" stroke-width="2"/>`,
      `<path d="M${a.hx - 0.09 * H},${a.hy - 0.03 * H} h${0.18 * H} M${a.hx - 0.09 * H},${a.hy + 0.03 * H} h${0.18 * H}" stroke="${shade(c.skin, -0.3)}" stroke-width="2" opacity="0.7"/>`,
    );
  });
  return svg(parts.join(''));
}

// ---------------------------------------------------------------- Overlay

function overlaySvg(opts: {
  d: Design;
  heading: string;
  companyName: string;
  tagline: string;
  hasLogo: boolean;
  names: string[];
  footer: string;
  aiScene: boolean;
  variation: number;
}) {
  const { d, heading, names } = opts;
  const p = d.palette;
  const r = rng(opts.variation * 13 + 3);
  const headSize = fitFont(heading, CW - 240, 132);
  const SANS = "'Segoe UI', Arial, Helvetica, sans-serif";
  // Names: one line, or two balanced lines for bigger groups.
  const lines =
    names.length > 6
      ? [names.slice(0, Math.ceil(names.length / 2)), names.slice(Math.ceil(names.length / 2))]
      : [names];
  const nameLines = lines.map((l) => l.join('   •   '));
  const nameSize = Math.min(...nameLines.map((l) => fitFont(l, CW - 420, 44, 0.5)));
  const ribbonTop = 1212;
  const ribbonH = lines.length > 1 ? 160 : 118;
  const ribbon = p.ribbon;
  const brandX = opts.hasLogo ? 60 + 250 : 60;
  const split = d.header === 'split';
  const thanks = `Thank you for being a valuable part of our ${opts.companyName} family!`;
  const header = split
    ? `
    <rect x="1040" y="28" width="920" height="300" rx="22" fill="#ffffff" opacity="0.94" stroke="#dfe6ee" stroke-width="3"/>
    <path d="M1890,60 l10,22 24,3 -18,16 5,24 -21,-12 -21,12 5,-24 -18,-16 24,-3 Z" fill="${p.accent}"/>
    <path d="M1100,60 l7,15 16,2 -12,11 3,16 -14,-8 -14,8 3,-16 -12,-11 16,-2 Z" fill="#f2b632"/>
    <text x="1480" y="128" font-family="${p.headingFont}" font-size="104" font-weight="700" fill="${p.heading}" text-anchor="middle">${esc(heading.split(' ')[0])}</text>
    <text x="1480" y="232" font-family="${p.headingFont}" font-size="${fitFont(heading.split(' ').slice(1).join(' '), 840, 96, 0.64)}" font-weight="700" fill="${p.accent}" text-anchor="middle">${esc(heading.split(' ').slice(1).join(' '))}</text>
    <path d="M1180,258 Q1480,236 1790,252" stroke="${p.heading}" stroke-width="6" fill="none" stroke-linecap="round"/>
    <text x="1480" y="302" font-family="${SANS}" font-size="${fitFont(thanks, 860, 30, 0.5)}" fill="${p.heading}" text-anchor="middle">${esc(thanks)}</text>
    ${opts.hasLogo ? '' : `<text x="80" y="210" font-family="${SANS}" font-size="${fitFont(opts.companyName, 880, 150, 0.62)}" font-weight="800" fill="${p.heading}">${esc(opts.companyName)}</text><rect x="84" y="236" width="300" height="12" rx="6" fill="${p.accent}"/>`}`
    : `
    <text x="${CW / 2 + 4}" y="${236 + 5}" font-family="${p.headingFont}" font-size="${headSize}" font-weight="700" fill="${p.headingShadow}" opacity="0.55" text-anchor="middle">${esc(heading)}</text>
    <text x="${CW / 2}" y="236" font-family="${p.headingFont}" font-size="${headSize}" font-weight="700" fill="${p.heading}" text-anchor="middle">${esc(heading)}</text>
    <text x="${brandX}" y="92" font-family="${SANS}" font-size="46" font-weight="800" fill="${opts.aiScene ? '#ffffff' : p.text}">${esc(opts.companyName)}</text>
    ${opts.tagline ? `<text x="${brandX}" y="128" font-family="${SANS}" font-size="24" fill="${p.text}" opacity="0.8">${esc(opts.tagline)}</text>` : ''}`;
  return svg(`
    <defs>
      <linearGradient id="topfade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="${opts.aiScene ? 0.55 : 0}"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>
    </defs>
    <rect width="${CW}" height="330" fill="url(#topfade)" opacity="${split ? 0 : 1}"/>
    ${split ? '' : confetti(d, r, 40, { y0: 20, y1: 290 })}
    ${header}
    <path d="M150,${ribbonTop} H${CW - 150} L${CW - 110},${ribbonTop + ribbonH / 2} L${CW - 150},${ribbonTop + ribbonH} H150 L110,${ribbonTop + ribbonH / 2} Z" fill="${ribbon}" stroke="${p.accent}" stroke-width="4"/>
    <text x="${CW / 2}" y="${ribbonTop + 40}" font-family="${SANS}" font-size="24" letter-spacing="8" font-weight="600" fill="${p.accent}" text-anchor="middle">CELEBRATING</text>
    ${nameLines
      .map(
        (l, i) =>
          `<text x="${CW / 2}" y="${ribbonTop + 92 + i * (nameSize + 14)}" font-family="${SANS}" font-size="${nameSize}" font-weight="600" fill="#ffffff" text-anchor="middle">${esc(l)}</text>`,
      )
      .join('')}
    <text x="${CW / 2}" y="${CH - 52}" font-family="${p.headingFont}" font-size="40" font-weight="700" fill="${p.cloth[0] === '#1c1a17' ? p.accent : shade(p.accent, -0.15)}" text-anchor="middle">${esc(opts.footer)}</text>
  `);
}

// ---------------------------------------------------------------- Compose

export interface RenderInput {
  design: Design;
  heading: string;
  companyName: string;
  tagline: string;
  /** Bottom line, e.g. "SageIT · Annual Day 2026". */
  footer: string;
  logo: Buffer | null;
  people: PlacedPerson[];
  variation: number;
  /**
   * Optional AI photo-realism pass. Receives the arranged layout (3:2, people/cake/table in
   * place, no text) and returns a photorealistic version of it. The ORIGINAL faces, the heading,
   * names and logo are always composited on top afterwards.
   */
  restyle?: (layout: Buffer) => Promise<Buffer>;
  /** Template previews draw dashed silhouettes instead of people. */
  preview?: boolean;
}

export interface RenderResult {
  png: Buffer;
  /** The arranged layout before text (kept as the poster's "source" image). */
  scene: Buffer;
  restyled: boolean;
  restyleError: string | null;
}

/** Pads the 4:3 canvas to 3:2 (edge pixels repeated) for image models that work in 3:2. */
const PAD_X = Math.round((CH * 1.5 - CW) / 2);

export async function renderPoster(input: RenderInput): Promise<RenderResult> {
  const { design: d, variation } = input;
  const scene = await sharp(sceneSvg(d, input.companyName, variation)).png().toBuffer();

  const layout: OverlayOptions[] = [];
  const faces: OverlayOptions[] = [];
  const top: OverlayOptions[] = [];

  // Big wall logo for the split header.
  if (d.header === 'split' && input.logo) {
    layout.push({
      input: await sharp(input.logo).resize(900, 250, { fit: 'inside' }).png().toBuffer(),
      left: 70,
      top: 50,
    });
  }

  // Back row first, and within a row the outer people first, so the centre overlaps them.
  const ordered = [...input.people].sort((a, b) => {
    if (a.slot.row !== b.slot.row) return a.slot.row === 'back' ? -1 : 1;
    return Math.abs(b.slot.x - 1000) - Math.abs(a.slot.x - 1000);
  });
  const cutters: Cutter[] = [];
  for (const [i, pp] of ordered.entries()) {
    const at = placeOf(pp.slot, variation);
    const color = pp.person?.clothing ?? d.palette.suits[i % d.palette.suits.length];
    const skin = pp.person?.skin ?? '#c9a48a';
    if (!input.preview || pp.person) {
      const body = bodySvg(pp.slot, color, skin, at.x, at.y);
      layout.push({ input: await sharp(body.input).png().toBuffer(), left: body.left, top: body.top });
    }
    const head = pp.person ?? (input.preview ? await silhouette(pp.slot) : null);
    if (head) {
      const pos = { left: Math.round(at.x - head.anchorX), top: Math.round(at.y - head.anchorY) };
      layout.push({ input: head.png, ...pos });
      if (pp.person) faces.push({ input: pp.person.facePng, ...pos });
    }
    if (pp.slot.role === 'cutter') cutters.push({ ...at, slot: pp.slot, color, skin });
  }
  if (cutters.length) layout.push({ input: await sharp(armsSvg(cutters)).png().toBuffer(), left: 0, top: 0 });
  layout.push({ input: await sharp(tableAndCakeSvg(d, variation)).png().toBuffer(), left: 0, top: 0 });
  if (d.extras.logoOnCake) {
    if (input.logo) {
      layout.push({
        input: await sharp(input.logo).resize(230, 74, { fit: 'inside' }).png().toBuffer(),
        left: CAKE.x - 115,
        top: CAKE.baseY - 98,
      });
    } else {
      const fs = fitFont(input.companyName, 300, 54, 0.62);
      layout.push({
        input: await sharp(
          svg(
            `<text x="${CAKE.x}" y="${CAKE.baseY - 40}" font-family="'Segoe UI', Arial, sans-serif" font-size="${fs}" font-weight="800" fill="${d.palette.heading}" text-anchor="middle">${esc(input.companyName)}</text>`,
          ),
        )
          .png()
          .toBuffer(),
        left: 0,
        top: 0,
      });
    }
  }
  if (cutters.length) layout.push({ input: await sharp(knifeAndHandsSvg(cutters)).png().toBuffer(), left: 0, top: 0 });

  const names = [...input.people].sort((a, b) => a.slot.x - b.slot.x).map((p) => p.name);

  const arranged = await sharp(scene).composite(await clipAll(layout)).png().toBuffer();

  // Optional AI photo-realism, then the original faces go back on top.
  let base = arranged;
  let restyled = false;
  let restyleError: string | null = null;
  if (input.restyle && !input.preview) {
    try {
      // Two passes: inside one pipeline sharp would resize before extending.
      const wide = await sharp(arranged).extend({ left: PAD_X, right: PAD_X, extendWith: 'copy' }).png().toBuffer();
      const padded = await sharp(wide).resize(1536, 1024, { fit: 'fill' }).png().toBuffer();
      const out = await input.restyle(padded);
      base = await sharp(
        await sharp(out).resize(CW + 2 * PAD_X, CH, { fit: 'fill' }).png().toBuffer(),
      )
        .extract({ left: PAD_X, top: 0, width: CW, height: CH })
        .png()
        .toBuffer();
      restyled = true;
      top.push(...faces);
    } catch (e) {
      restyleError = (e as Error).message.slice(0, 200);
      base = arranged;
    }
  }

  top.push({
    input: await sharp(
      overlaySvg({
        d,
        heading: input.heading,
        companyName: input.companyName,
        tagline: input.tagline,
        hasLogo: !!input.logo,
        names,
        footer: input.footer,
        aiScene: restyled,
        variation,
      }),
    )
      .png()
      .toBuffer(),
    left: 0,
    top: 0,
  });
  if (input.logo && d.header !== 'split') {
    top.push({ input: await sharp(input.logo).resize(230, 110, { fit: 'inside' }).png().toBuffer(), left: 50, top: 30 });
  }
  if (input.logo && d.header === 'split' && restyled) {
    // Keep the approved logo crisp (the AI pass may have redrawn it).
    top.push({ input: await sharp(input.logo).resize(900, 250, { fit: 'inside' }).png().toBuffer(), left: 70, top: 50 });
  }

  const png = await sharp(base).composite(await clipAll(top)).png({ compressionLevel: 7 }).toBuffer();
  return { png, scene: arranged, restyled, restyleError };
}

async function clipAll(layers: OverlayOptions[]) {
  const out: OverlayOptions[] = [];
  for (const l of layers) out.push(await clip(l));
  return out;
}

async function clip(l: OverlayOptions): Promise<OverlayOptions> {
  const left = l.left ?? 0;
  const top = l.top ?? 0;
  const meta = await sharp(l.input as Buffer).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  const x0 = Math.max(0, -left);
  const y0 = Math.max(0, -top);
  const x1 = Math.min(w, CW - left);
  const y1 = Math.min(h, CH - top);
  if (x0 === 0 && y0 === 0 && x1 === w && y1 === h) return l;
  if (x1 <= x0 || y1 <= y0) {
    return { input: { create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }, left: 0, top: 0 };
  }
  const input = await sharp(l.input as Buffer)
    .extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 })
    .png()
    .toBuffer();
  return { input, left: left + x0, top: top + y0 };
}

/** A template preview: the real design with dashed placeholders where people go. */
export async function renderPreview(d: Design, heading: string, companyName: string, tagline: string, logo: Buffer | null) {
  const people = SLOTS.slice(0, 7).map((slot, i) => ({ name: `Person ${i + 1}`, slot, person: null }));
  const { png } = await renderPoster({
    design: d,
    heading,
    companyName,
    tagline,
    footer: companyName,
    logo,
    people,
    variation: 0,
    preview: true,
  });
  return sharp(png).resize(800).jpeg({ quality: 82 }).toBuffer();
}
