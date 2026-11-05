/**
 * Generates the login mascot — an ORIGINAL character ("Sagi", a friendly camera bot) —
 * as a looping animated GIF plus a static poster frame, entirely locally.
 *
 *   npm run mascot -w client
 *
 * Output (committed): client/public/mascot/sagi.gif, client/public/mascot/sagi-poster.png
 *
 * GIF only supports 1-bit transparency, which looks jagged on glass. So the GIF is fully
 * opaque with a baked "studio portal" background, and the page clips it with CSS
 * border-radius (anti-aliased) inside a glowing frame.
 */
import { mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/mascot');
const W = 400;
const H = 480;
const FRAMES = 36;
const DELAY_MS = 55; // ≈2s loop

const TAU = Math.PI * 2;
const r2 = (n) => Math.round(n * 100) / 100;

function sparkle(cx, cy, size, opacity, fill) {
  const s = size;
  return `<path transform="translate(${r2(cx)} ${r2(cy)})" opacity="${r2(opacity)}" fill="${fill}"
    d="M0 ${-s} C ${s * 0.18} ${-s * 0.18} ${s * 0.18} ${-s * 0.18} ${s} 0 C ${s * 0.18} ${s * 0.18} ${s * 0.18} ${s * 0.18} 0 ${s}
       C ${-s * 0.18} ${s * 0.18} ${-s * 0.18} ${s * 0.18} ${-s} 0 C ${-s * 0.18} ${-s * 0.18} ${-s * 0.18} ${-s * 0.18} 0 ${-s} Z"/>`;
}

function frame(i) {
  const t = i / FRAMES;
  const p = t * TAU;
  const bob = Math.sin(p) * 10;
  const wave = Math.sin(p * 2) * 20 - 22;
  const blink = i === 13 || i === 14;
  const glow = 0.45 + 0.3 * Math.sin(p * 2);
  const flash = [0, 0.95, 0.6, 0.25][Math.max(0, i - 28)] ?? 0;
  const shadowScale = 1 - ((bob + 10) / 20) * 0.18;
  const thruster = 0.55 + 0.35 * Math.abs(Math.sin(p * 3));

  const sparkles = [
    [68, 118, 12, 0.0, '#22d3ee'],
    [334, 96, 9, 0.33, '#ffffff'],
    [346, 236, 11, 0.66, '#a78bfa'],
    [56, 300, 8, 0.5, '#60a5fa'],
  ]
    .map(([x, y, s, off, c]) => {
      const k = (Math.sin((t + off) * TAU) + 1) / 2;
      return sparkle(x, y, s * (0.5 + 0.6 * k), 0.25 + 0.75 * k, c);
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="44%" r="70%">
      <stop offset="0" stop-color="#2d2475"/>
      <stop offset="0.55" stop-color="#151d4d"/>
      <stop offset="1" stop-color="#0a0f2a"/>
    </radialGradient>
    <linearGradient id="body" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#c7d2fe"/>
    </linearGradient>
    <linearGradient id="core" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#7c5cff"/>
      <stop offset="1" stop-color="#22d3ee"/>
    </linearGradient>
    <radialGradient id="lens" cx="40%" cy="35%" r="70%">
      <stop offset="0" stop-color="#93c5fd"/>
      <stop offset="0.5" stop-color="#3b5bdb"/>
      <stop offset="1" stop-color="#0b1230"/>
    </radialGradient>
    <radialGradient id="halo" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#7c5cff" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#7c5cff" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <circle cx="200" cy="250" r="170" fill="url(#halo)"/>
  <!-- orbit rings are drawn in CSS around the frame (cheaper than per-frame GIF pixels) -->
  ${sparkles}

  <ellipse cx="200" cy="440" rx="${r2(88 * shadowScale)}" ry="${r2(13 * shadowScale)}" fill="#04071a" opacity="0.65"/>

  <g transform="translate(0 ${r2(bob)})">
    <ellipse cx="200" cy="388" rx="30" ry="10" fill="#22d3ee" opacity="${r2(thruster)}"/>
    <ellipse cx="200" cy="396" rx="16" ry="14" fill="#67e8f9" opacity="${r2(thruster * 0.5)}"/>

    <!-- waving arm (behind body) -->
    <g transform="rotate(${r2(wave)} 142 282)">
      <rect x="128" y="200" width="28" height="90" rx="14" fill="url(#body)"/>
      <circle cx="142" cy="196" r="17" fill="#e0e7ff"/>
      <circle cx="142" cy="196" r="7" fill="#7c5cff" opacity="0.55"/>
    </g>

    <!-- body -->
    <rect x="186" y="240" width="28" height="18" rx="6" fill="#a5b4fc"/>
    <rect x="134" y="252" width="132" height="124" rx="50" fill="url(#body)"/>
    <circle cx="200" cy="306" r="23" fill="url(#core)"/>
    ${sparkle(200, 306, 12, 0.6 + glow * 0.5, '#ffffff')}

    <!-- head -->
    <line x1="200" y1="118" x2="200" y2="90" stroke="#c7d2fe" stroke-width="6" stroke-linecap="round"/>
    <circle cx="200" cy="84" r="${r2(14 + glow * 4)}" fill="#22d3ee" opacity="${r2(0.25 + glow * 0.25)}"/>
    <circle cx="200" cy="84" r="9" fill="#67e8f9"/>
    <circle cx="117" cy="184" r="15" fill="#7c5cff"/>
    <circle cx="283" cy="184" r="15" fill="#4f7cff"/>
    <rect x="118" y="116" width="164" height="132" rx="58" fill="url(#body)"/>
    <rect x="138" y="146" width="124" height="76" rx="36" fill="#0b1230"/>
    <rect x="150" y="152" width="58" height="10" rx="5" fill="#ffffff" opacity="0.08"/>
    <ellipse cx="176" cy="184" rx="11" ry="${blink ? 2 : 14}" fill="#22d3ee"/>
    <ellipse cx="224" cy="184" rx="11" ry="${blink ? 2 : 14}" fill="#22d3ee"/>
    ${blink ? '' : '<circle cx="180" cy="178" r="3.5" fill="#ffffff"/><circle cx="228" cy="178" r="3.5" fill="#ffffff"/>'}
    <path d="M186 204 Q200 214 214 204" stroke="#22d3ee" stroke-width="4" fill="none" stroke-linecap="round"/>
    <ellipse cx="152" cy="210" rx="9" ry="5" fill="#f472b6" opacity="0.45"/>
    <ellipse cx="248" cy="210" rx="9" ry="5" fill="#f472b6" opacity="0.45"/>

    <!-- camera arm + camera -->
    <rect x="252" y="268" width="26" height="72" rx="13" fill="url(#body)" transform="rotate(-28 262 278)"/>
    <g>
      <rect x="252" y="300" width="88" height="60" rx="13" fill="#1e293b" stroke="#334155" stroke-width="2"/>
      <rect x="264" y="291" width="26" height="13" rx="4" fill="#1e293b"/>
      <rect x="318" y="307" width="14" height="8" rx="2" fill="#e2e8f0"/>
      <circle cx="294" cy="331" r="21" fill="#0f172a" stroke="#22d3ee" stroke-width="4"/>
      <circle cx="294" cy="331" r="12" fill="url(#lens)"/>
      <circle cx="289" cy="326" r="3.5" fill="#ffffff" opacity="0.85"/>
      <circle cx="262" cy="349" r="4" fill="${i % 12 < 6 ? '#f43f5e' : '#7f1d1d'}"/>
    </g>
    ${
      flash
        ? `<circle cx="325" cy="311" r="${r2(18 + flash * 34)}" fill="#ffffff" opacity="${r2(flash * 0.35)}"/>
           <circle cx="325" cy="311" r="${r2(8 + flash * 12)}" fill="#ffffff" opacity="${r2(flash)}"/>
           ${sparkle(325, 311, 30 * flash + 10, flash, '#ffffff')}`
        : ''
    }
  </g>
</svg>`;
}

mkdirSync(OUT, { recursive: true });
const frames = await Promise.all(
  Array.from({ length: FRAMES }, (_, i) =>
    sharp(Buffer.from(frame(i)))
      .png()
      .toBuffer(),
  ),
);

await sharp(frames, { join: { animated: true } })
  .gif({
    delay: Array(FRAMES).fill(DELAY_MS),
    loop: 0,
    effort: 10,
    colours: 128,
    dither: 0.25,
    interFrameMaxError: 6,
    interPaletteMaxError: 4,
  })
  .toFile(path.join(OUT, 'sagi.gif'));

// Static frame for reduced-motion users and as a load-failure fallback.
await sharp(frames[4])
  .png({ compressionLevel: 9, palette: true, quality: 90 })
  .toFile(path.join(OUT, 'sagi-poster.png'));

for (const f of ['sagi.gif', 'sagi-poster.png']) {
  console.log(`${f}: ${(statSync(path.join(OUT, f)).size / 1024).toFixed(0)} KB`);
}
