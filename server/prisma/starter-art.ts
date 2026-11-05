/**
 * Original starter collection for SageAvatar Studio — every character and scene here is
 * drawn programmatically for this project (no third-party artwork, no franchise characters).
 * Superhero entries are genre-inspired originals with their own names, colours and emblems.
 *
 * One character drawing (400×900 canvas) is cropped into FACE / HALF_BODY / FULL_BODY via
 * the viewBox. Characters gently bob and blink (SVG SMIL animation).
 */
import type { AvatarType, Placement } from '../src/lib/domain.js';

export type CategorySlug = 'anime' | 'superhero' | 'business' | 'corporate';
type Style = 'PROFESSIONAL' | 'CASUAL' | 'THEMED';

type Expression = 'smile' | 'grin' | 'wink' | 'surprised' | 'determined' | 'calm';
type HairStyle =
  | 'spiky'
  | 'bob'
  | 'twintails'
  | 'long'
  | 'sidepart'
  | 'short'
  | 'bun'
  | 'curly'
  | 'buzz'
  | 'cowl'
  | 'helmet';
type Hand = 'open' | 'fist' | 'thumb' | 'peace' | 'tablet';
interface Arm {
  /** Shoulder angle, degrees outward from hanging straight down. */
  s: number;
  /** Elbow bend, degrees (positive bends the forearm inward/up). */
  e: number;
  hand: Hand;
  wave?: boolean;
  front?: boolean;
}
type Pose = 'idle' | 'wave' | 'hips' | 'crossed' | 'thumbsup' | 'peace' | 'tablet' | 'hero';
type Outfit =
  | { kind: 'school'; main: string; collar: string; ribbon: string; skirt: string }
  | { kind: 'hoodie'; main: string; trim: string; pants: string }
  | { kind: 'sweater'; main: string; trim: string; pants: string }
  | { kind: 'suit'; main: string; shirt: string; tie: string; pants: string }
  | {
      kind: 'blazer';
      main: string;
      shirt: string;
      accent: string;
      pants: string;
      lanyard?: boolean;
    }
  | { kind: 'polo'; main: string; trim: string; pants: string; headset?: boolean }
  | {
      kind: 'hero';
      main: string;
      second: string;
      emblem: Emblem;
      emblemColor: string;
      cape?: string;
      boots: string;
    }
  | { kind: 'armor'; main: string; second: string; glow: string };
type Emblem = 'star' | 'moon' | 'bolt' | 'triangle';

export interface Character {
  slug: string;
  name: string;
  category: CategorySlug;
  style: Style;
  description: string;
  tags: string[];
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  eyes: 'anime' | 'simple' | 'lenses' | 'visor';
  eyeColor?: string;
  expression: Expression;
  pose: Pose;
  outfit: Outfit;
  shoes?: string;
}

// ---------------------------------------------------------------- the cast

export const CHARACTERS: Character[] = [
  // Anime
  {
    slug: 'hana',
    name: 'Hana',
    category: 'anime',
    style: 'CASUAL',
    description: 'Cheerful student with pink twin-tails, flashing a peace sign and a wink.',
    tags: ['school uniform', 'twin tails', 'peace sign', 'wink', 'cheerful'],
    skin: '#ffe0cc',
    hair: '#ff7eb6',
    hairStyle: 'twintails',
    eyes: 'anime',
    eyeColor: '#7c3aed',
    expression: 'wink',
    pose: 'peace',
    outfit: {
      kind: 'school',
      main: '#f8fafc',
      collar: '#1e3a8a',
      ribbon: '#e11d48',
      skirt: '#1e3a8a',
    },
  },
  {
    slug: 'ren',
    name: 'Ren',
    category: 'anime',
    style: 'CASUAL',
    description: 'Determined rival in a cosy hoodie, giving a confident thumbs-up.',
    tags: ['hoodie', 'spiky hair', 'thumbs up', 'determined', 'streetwear'],
    skin: '#f7d5b5',
    hair: '#4f46e5',
    hairStyle: 'spiky',
    eyes: 'anime',
    eyeColor: '#0f766e',
    expression: 'determined',
    pose: 'thumbsup',
    outfit: { kind: 'hoodie', main: '#f97316', trim: '#fde68a', pants: '#334155' },
  },
  {
    slug: 'yuki',
    name: 'Yuki',
    category: 'anime',
    style: 'CASUAL',
    description: 'Calm, friendly artist with long silver-blue hair, waving hello.',
    tags: ['long hair', 'sweater', 'wave', 'calm', 'friendly'],
    skin: '#fde7d9',
    hair: '#93c5fd',
    hairStyle: 'long',
    eyes: 'anime',
    eyeColor: '#2563eb',
    expression: 'calm',
    pose: 'wave',
    outfit: { kind: 'sweater', main: '#a78bfa', trim: '#ede9fe', pants: '#1f2937' },
  },
  // Superhero (original, genre-inspired)
  {
    slug: 'captain-nova',
    name: 'Captain Nova',
    category: 'superhero',
    style: 'THEMED',
    description: 'Original star-powered hero in navy and gold with a flowing crimson cape.',
    tags: ['cape', 'star emblem', 'hero pose', 'mask', 'brave'],
    skin: '#e0ac69',
    hair: '#3f2a1d',
    hairStyle: 'short',
    eyes: 'simple',
    expression: 'grin',
    pose: 'hero',
    outfit: {
      kind: 'hero',
      main: '#1e3a8a',
      second: '#facc15',
      emblem: 'star',
      emblemColor: '#facc15',
      cape: '#dc2626',
      boots: '#facc15',
    },
  },
  {
    slug: 'night-lynx',
    name: 'Night Lynx',
    category: 'superhero',
    style: 'THEMED',
    description:
      'Original stealth guardian in plum and teal with a lynx-eared cowl and crescent emblem.',
    tags: ['stealth', 'cowl', 'crescent emblem', 'arms crossed', 'night'],
    skin: '#c68642',
    hair: '#4c1d95',
    hairStyle: 'cowl',
    eyes: 'lenses',
    eyeColor: '#5eead4',
    expression: 'determined',
    pose: 'crossed',
    outfit: {
      kind: 'hero',
      main: '#3b0764',
      second: '#14b8a6',
      emblem: 'moon',
      emblemColor: '#5eead4',
      boots: '#1e1b4b',
    },
  },
  {
    slug: 'arc-sentinel',
    name: 'Arc Sentinel',
    category: 'superhero',
    style: 'THEMED',
    description:
      'Original armoured inventor in silver and teal plating with a glowing triangular core.',
    tags: ['armor', 'tech', 'glowing core', 'visor', 'hands on hips'],
    skin: '#d4a373',
    hair: '#94a3b8',
    hairStyle: 'helmet',
    eyes: 'visor',
    eyeColor: '#22d3ee',
    expression: 'calm',
    pose: 'hips',
    outfit: { kind: 'armor', main: '#cbd5e1', second: '#0f766e', glow: '#22d3ee' },
  },
  // Business
  {
    slug: 'priya',
    name: 'Priya',
    category: 'business',
    style: 'PROFESSIONAL',
    description: 'Confident team lead in a burgundy blazer, hands on hips and ready to present.',
    tags: ['blazer', 'bun', 'confident', 'leader', 'smile'],
    skin: '#a0674b',
    hair: '#1c1917',
    hairStyle: 'bun',
    eyes: 'simple',
    expression: 'smile',
    pose: 'hips',
    outfit: {
      kind: 'blazer',
      main: '#9f1239',
      shirt: '#fff1f2',
      accent: '#fbbf24',
      pants: '#27272a',
    },
  },
  {
    slug: 'marcus',
    name: 'Marcus',
    category: 'business',
    style: 'PROFESSIONAL',
    description: 'Seasoned consultant in a navy suit and teal tie, arms folded with a big grin.',
    tags: ['suit', 'tie', 'arms crossed', 'grin', 'executive'],
    skin: '#6b4226',
    hair: '#111827',
    hairStyle: 'buzz',
    eyes: 'simple',
    expression: 'grin',
    pose: 'crossed',
    outfit: { kind: 'suit', main: '#1e293b', shirt: '#f8fafc', tie: '#14b8a6', pants: '#1e293b' },
  },
  {
    slug: 'sam',
    name: 'Sam',
    category: 'business',
    style: 'CASUAL',
    description: 'Casual-Friday developer in a mustard sweater, curly hair and a thumbs-up.',
    tags: ['casual friday', 'sweater', 'curly hair', 'thumbs up', 'friendly'],
    skin: '#f1c27d',
    hair: '#7c2d12',
    hairStyle: 'curly',
    eyes: 'simple',
    expression: 'surprised',
    pose: 'thumbsup',
    outfit: { kind: 'sweater', main: '#ca8a04', trim: '#fef3c7', pants: '#1d4ed8' },
  },
  // Corporate
  {
    slug: 'alex',
    name: 'Alex',
    category: 'corporate',
    style: 'PROFESSIONAL',
    description:
      'Friendly colleague in a charcoal blazer with a SageIT-style lanyard badge, waving hello.',
    tags: ['blazer', 'lanyard', 'id badge', 'wave', 'welcome'],
    skin: '#8d5a3b',
    hair: '#1b1b1f',
    hairStyle: 'sidepart',
    eyes: 'simple',
    expression: 'smile',
    pose: 'wave',
    outfit: {
      kind: 'blazer',
      main: '#3f4a5a',
      shirt: '#dbeafe',
      accent: '#4f7cff',
      pants: '#2f3845',
      lanyard: true,
    },
  },
  {
    slug: 'jordan',
    name: 'Jordan',
    category: 'corporate',
    style: 'PROFESSIONAL',
    description: 'Helpdesk hero with a headset and polo shirt, giving the all-clear thumbs-up.',
    tags: ['headset', 'support', 'polo', 'thumbs up', 'helpful'],
    skin: '#ffdbac',
    hair: '#a16207',
    hairStyle: 'short',
    eyes: 'simple',
    expression: 'grin',
    pose: 'thumbsup',
    outfit: { kind: 'polo', main: '#0ea5e9', trim: '#e0f2fe', pants: '#334155', headset: true },
  },
  {
    slug: 'dana',
    name: 'Dana',
    category: 'corporate',
    style: 'PROFESSIONAL',
    description: 'Calm project manager with a sleek bob, presenting from a tablet.',
    tags: ['tablet', 'presenter', 'bob haircut', 'calm', 'project manager'],
    skin: '#e8b98a',
    hair: '#78350f',
    hairStyle: 'bob',
    eyes: 'simple',
    expression: 'calm',
    pose: 'tablet',
    outfit: {
      kind: 'blazer',
      main: '#0f766e',
      shirt: '#f0fdfa',
      accent: '#5eead4',
      pants: '#134e4a',
    },
  },
];

export interface Scene {
  slug: string;
  name: string;
  category: CategorySlug;
  style: Style;
  description: string;
  tags: string[];
}

export const SCENES: Scene[] = [
  {
    slug: 'sakura-sunset',
    name: 'Sakura Sunset',
    category: 'anime',
    style: 'CASUAL',
    description: 'Pastel sunset with drifting cherry blossoms.',
    tags: ['sunset', 'cherry blossom', 'pastel'],
  },
  {
    slug: 'neon-night',
    name: 'Neon Night',
    category: 'anime',
    style: 'THEMED',
    description: 'Glowing city street at night with neon signs and stars.',
    tags: ['neon', 'city', 'night'],
  },
  {
    slug: 'hero-skyline',
    name: 'Hero Skyline',
    category: 'superhero',
    style: 'THEMED',
    description: 'Night skyline with a sweeping searchlight.',
    tags: ['skyline', 'searchlight', 'night'],
  },
  {
    slug: 'comic-burst',
    name: 'Comic Burst',
    category: 'superhero',
    style: 'THEMED',
    description: 'Bold comic-book action burst with halftone dots.',
    tags: ['comic', 'action', 'pop art'],
  },
  {
    slug: 'modern-office',
    name: 'Modern Office',
    category: 'business',
    style: 'PROFESSIONAL',
    description: 'Bright teal office with glass panels and soft bokeh.',
    tags: ['office', 'glass', 'teal'],
  },
  {
    slug: 'boardroom',
    name: 'Boardroom',
    category: 'business',
    style: 'PROFESSIONAL',
    description: 'Warm boardroom with a long table and city windows.',
    tags: ['boardroom', 'meeting', 'warm'],
  },
  {
    slug: 'glass-towers',
    name: 'Glass Towers',
    category: 'corporate',
    style: 'PROFESSIONAL',
    description: 'Daytime skyline of glass towers.',
    tags: ['skyline', 'daytime', 'towers'],
  },
  {
    slug: 'brand-stage',
    name: 'Brand Stage',
    category: 'corporate',
    style: 'PROFESSIONAL',
    description: 'Event stage in violet-to-cyan light with spotlights.',
    tags: ['stage', 'event', 'spotlight'],
  },
];

// ---------------------------------------------------------------- drawing helpers

const MOUTH = '#7a3b2e';
const blink = (ry: number) =>
  `<animate attributeName="ry" values="${ry};${ry};1;${ry}" keyTimes="0;0.92;0.96;1" dur="4.5s" repeatCount="indefinite"/>`;

function hairBack(c: Character): string {
  const h = c.hair;
  switch (c.hairStyle) {
    case 'long':
      return `<rect x="104" y="70" width="192" height="320" rx="80" fill="${h}"/>`;
    case 'twintails':
      return `<rect x="108" y="64" width="184" height="150" rx="80" fill="${h}"/>
        <g><animateTransform attributeName="transform" type="rotate" values="-3 200 140;3 200 140;-3 200 140" dur="2.6s" repeatCount="indefinite"/>
        <ellipse cx="88" cy="250" rx="30" ry="92" fill="${h}"/><ellipse cx="312" cy="250" rx="30" ry="92" fill="${h}"/></g>
        <circle cx="100" cy="166" r="11" fill="#fde047"/><circle cx="300" cy="166" r="11" fill="#fde047"/>`;
    case 'bob':
      return `<rect x="106" y="64" width="188" height="168" rx="74" fill="${h}"/>`;
    case 'bun':
      return `<circle cx="200" cy="50" r="32" fill="${h}"/>`;
    default:
      return '';
  }
}

function hairFront(c: Character): string {
  const h = c.hair;
  switch (c.hairStyle) {
    case 'spiky':
      return `<path d="M108 150 L112 80 L140 98 L150 50 L178 84 L200 38 L222 84 L250 50 L260 98 L288 80 L292 150 Q280 100 200 96 Q120 100 108 150 Z" fill="${h}">
        <animateTransform attributeName="transform" type="rotate" values="-1 200 120;1 200 120;-1 200 120" dur="3s" repeatCount="indefinite"/></path>`;
    case 'bob':
    case 'twintails':
    case 'long':
      return `<path d="M114 146 Q116 62 200 58 Q284 62 286 146 Q264 104 232 112 Q200 94 168 112 Q136 104 114 146 Z" fill="${h}"/>`;
    case 'sidepart':
      return `<path d="M114 134 Q114 58 200 54 Q286 58 286 134 Q284 104 250 92 Q236 106 160 98 Q124 104 114 134 Z" fill="${h}"/>`;
    case 'short':
      return `<path d="M116 128 Q120 60 200 56 Q284 60 284 120 Q250 86 190 96 Q150 100 116 128 Z" fill="${h}"/>`;
    case 'bun':
      return `<path d="M118 134 Q120 64 200 62 Q280 64 282 134 Q262 98 200 96 Q138 98 118 134 Z" fill="${h}"/>`;
    case 'buzz':
      return `<path d="M120 126 Q122 66 200 62 Q278 66 280 126 Q258 92 200 90 Q142 92 120 126 Z" fill="${h}" opacity="0.92"/>`;
    case 'curly':
      return [72, 98]
        .map((y, row) =>
          Array.from({ length: row ? 7 : 5 }, (_, i) => {
            const x = row ? 122 + i * 26 : 148 + i * 26;
            return `<circle cx="${x}" cy="${y}" r="${row ? 24 : 22}" fill="${h}"/>`;
          }).join(''),
        )
        .join('');
    default:
      return '';
  }
}

function face(c: Character): string {
  // Masked / armoured heads draw their own faces.
  if (c.hairStyle === 'helmet') {
    const glow = c.eyeColor ?? '#22d3ee';
    return `
      <rect x="118" y="56" width="164" height="172" rx="70" fill="${c.outfit.kind === 'armor' ? c.outfit.main : '#cbd5e1'}"/>
      <path d="M138 120 L262 120 L250 200 Q200 226 150 200 Z" fill="#0f172a"/>
      <rect x="146" y="138" width="108" height="14" rx="7" fill="${glow}">
        <animate attributeName="opacity" values="1;0.55;1" dur="2.2s" repeatCount="indefinite"/></rect>
      <path d="M200 60 L200 116" stroke="#94a3b8" stroke-width="6"/>
      <path d="M170 178 L230 178" stroke="${glow}" stroke-width="3" opacity="0.6"/>`;
  }
  if (c.hairStyle === 'cowl') {
    const lens = c.eyeColor ?? '#5eead4';
    return `
      <path d="M132 96 L146 30 L176 72 Z M268 96 L254 30 L224 72 Z" fill="${c.hair}"/>
      <path d="M146 30 L140 18 L152 28 Z M254 30 L260 18 L248 28 Z" fill="#0b0b12"/>
      <circle cx="200" cy="140" r="86" fill="${c.hair}"/>
      <ellipse cx="200" cy="196" rx="54" ry="40" fill="${c.skin}"/>
      <path d="M152 146 Q170 128 188 148 Q170 156 152 146 Z M248 146 Q230 128 212 148 Q230 156 248 146 Z" fill="${lens}">
        <animate attributeName="opacity" values="1;1;0.2;1" keyTimes="0;0.92;0.96;1" dur="4.5s" repeatCount="indefinite"/></path>
      <path d="M184 204 Q200 ${c.expression === 'determined' ? 208 : 214} 216 204" stroke="${MOUTH}" stroke-width="4" fill="none" stroke-linecap="round"/>`;
  }

  const anime = c.eyes === 'anime';
  const lx = 170;
  const rx = 230;
  const ey = anime ? 150 : 148;
  const ec = c.eyeColor ?? '#2b2118';
  const openEye = (x: number) =>
    anime
      ? `<ellipse cx="${x}" cy="${ey}" rx="17" ry="24" fill="${ec}">${blink(24)}</ellipse>
         <circle cx="${x + 6}" cy="${ey - 10}" r="6" fill="#fff"/><circle cx="${x - 5}" cy="${ey + 8}" r="3" fill="#fff" opacity="0.8"/>`
      : `<ellipse cx="${x}" cy="${ey}" rx="${c.expression === 'surprised' ? 11 : 9}" ry="${c.expression === 'surprised' ? 11 : 9}" fill="${ec}">${blink(c.expression === 'surprised' ? 11 : 9)}</ellipse>
         <circle cx="${x + 3}" cy="${ey - 3}" r="2.5" fill="#fff"/>`;
  const closedEye = (x: number, up = false) =>
    `<path d="M${x - 12} ${ey + (up ? 2 : 0)} Q${x} ${ey + (up ? -10 : 10)} ${x + 12} ${ey + (up ? 2 : 0)}" stroke="${anime ? ec : '#2b2118'}" stroke-width="4" fill="none" stroke-linecap="round"/>`;

  const eyes =
    c.expression === 'wink'
      ? closedEye(lx, true) + openEye(rx)
      : c.expression === 'calm'
        ? closedEye(lx) + closedEye(rx)
        : openEye(lx) + openEye(rx);

  const brows =
    c.expression === 'determined'
      ? `<path d="M152 ${ey - 30} L186 ${ey - 20} M248 ${ey - 30} L214 ${ey - 20}" stroke="${c.hair}" stroke-width="6" stroke-linecap="round"/>`
      : c.expression === 'surprised'
        ? `<path d="M156 ${ey - 28} Q170 ${ey - 38} 184 ${ey - 28} M216 ${ey - 28} Q230 ${ey - 38} 244 ${ey - 28}" stroke="${c.hair}" stroke-width="5" fill="none" stroke-linecap="round"/>`
        : anime
          ? ''
          : `<path d="M158 ${ey - 22} Q170 ${ey - 28} 182 ${ey - 22} M218 ${ey - 22} Q230 ${ey - 28} 242 ${ey - 22}" stroke="${c.hair}" stroke-width="4" fill="none" stroke-linecap="round"/>`;

  const mouths: Record<Expression, string> = {
    smile: `<path d="M182 192 Q200 208 218 192" stroke="${MOUTH}" stroke-width="4" fill="none" stroke-linecap="round"/>`,
    calm: `<path d="M188 196 Q200 204 212 196" stroke="${MOUTH}" stroke-width="4" fill="none" stroke-linecap="round"/>`,
    wink: `<path d="M184 192 Q200 210 216 192 Z" fill="${MOUTH}"/><path d="M192 200 Q200 206 208 200" fill="#fb7185"/>`,
    grin: `<path d="M176 188 Q200 222 224 188 Z" fill="${MOUTH}"/><path d="M180 189 L220 189 L216 197 L184 197 Z" fill="#fff"/>`,
    surprised: `<ellipse cx="200" cy="200" rx="9" ry="12" fill="${MOUTH}"/>`,
    determined: `<path d="M184 198 Q200 202 216 196" stroke="${MOUTH}" stroke-width="4" fill="none" stroke-linecap="round"/>`,
  };
  const blush =
    anime || c.expression === 'wink' || c.expression === 'calm'
      ? `<ellipse cx="148" cy="180" rx="12" ry="6" fill="#fb7185" opacity="0.35"/><ellipse cx="252" cy="180" rx="12" ry="6" fill="#fb7185" opacity="0.35"/>`
      : '';
  const mask =
    c.category === 'superhero' && c.outfit.kind === 'hero'
      ? `<path d="M120 132 Q200 112 280 132 L276 166 Q240 176 200 160 Q160 176 124 166 Z" fill="${c.outfit.main}"/>`
      : '';
  return `<circle cx="200" cy="140" r="${anime ? 90 : 84}" fill="${c.skin}"/>${hairFront(c)}${blush}${mask}${brows}${eyes}${mouths[c.expression]}`;
}

function poseArms(pose: Pose): { L: Arm; R: Arm } {
  switch (pose) {
    case 'wave':
      return { L: { s: 8, e: 0, hand: 'open' }, R: { s: 125, e: -42, hand: 'open', wave: true } };
    case 'hips':
    case 'hero':
      return { L: { s: 36, e: 72, hand: 'fist' }, R: { s: 36, e: 72, hand: 'fist' } };
    case 'crossed':
      return {
        L: { s: 12, e: 118, hand: 'fist', front: true },
        R: { s: 12, e: 102, hand: 'fist', front: true },
      };
    case 'thumbsup':
      return { L: { s: 8, e: 0, hand: 'open' }, R: { s: 18, e: 120, hand: 'thumb', front: true } };
    case 'peace':
      return { L: { s: 8, e: 0, hand: 'open' }, R: { s: 158, e: 8, hand: 'peace' } };
    case 'tablet':
      return { L: { s: 6, e: 92, hand: 'tablet', front: true }, R: { s: 10, e: 30, hand: 'open' } };
    default:
      return { L: { s: 8, e: 4, hand: 'open' }, R: { s: 8, e: 4, hand: 'open' } };
  }
}

function sleeves(o: Outfit): { upper: string; lower: string; glove?: string } {
  switch (o.kind) {
    case 'polo':
      return { upper: o.main, lower: '' };
    case 'hero':
      return { upper: o.main, lower: o.main, glove: o.second };
    case 'armor':
      return { upper: o.main, lower: o.second, glove: o.main };
    default:
      return { upper: o.main, lower: o.main };
  }
}

/** One arm drawn as a left arm (origin at shoulder, hanging down); the right one is mirrored. */
function arm(a: Arm, c: Character, mirrored: boolean): string {
  const sl = sleeves(c.outfit);
  const handFill = sl.glove ?? c.skin;
  const lower = sl.lower || c.skin;
  let hand = `<circle cx="0" cy="118" r="19" fill="${handFill}"/>`;
  if (a.hand === 'fist')
    hand = `<rect x="-19" y="102" width="38" height="34" rx="15" fill="${handFill}"/>`;
  if (a.hand === 'thumb') {
    hand = `<rect x="-19" y="102" width="38" height="34" rx="15" fill="${handFill}"/>
      <rect x="${mirrored ? -2 : -10}" y="80" width="12" height="30" rx="6" fill="${handFill}"/>`;
  }
  if (a.hand === 'peace') {
    hand = `<circle cx="0" cy="112" r="17" fill="${handFill}"/>
      <rect x="-12" y="116" width="10" height="34" rx="5" fill="${handFill}" transform="rotate(-12 -7 116)"/>
      <rect x="2" y="116" width="10" height="34" rx="5" fill="${handFill}" transform="rotate(12 7 116)"/>`;
  }
  if (a.hand === 'tablet') {
    hand = `<g transform="rotate(${-a.e - a.s} 0 120)">
      <rect x="-70" y="96" width="120" height="84" rx="10" fill="#0f172a" stroke="#94a3b8" stroke-width="4"/>
      <rect x="-60" y="106" width="100" height="64" rx="5" fill="#22d3ee" opacity="0.85"/>
      <rect x="-50" y="118" width="46" height="8" rx="4" fill="#fff" opacity="0.9"/>
      <rect x="-50" y="134" width="70" height="6" rx="3" fill="#fff" opacity="0.6"/>
      <rect x="-50" y="148" width="58" height="6" rx="3" fill="#fff" opacity="0.6"/>
      </g><circle cx="0" cy="118" r="18" fill="${handFill}"/>`;
  }
  const waveAnim = a.wave
    ? `<animateTransform attributeName="transform" type="rotate" additive="sum" values="0 0 0;-18 0 0;0 0 0" dur="1.6s" repeatCount="indefinite"/>`
    : '';
  const inner = `
    <g transform="rotate(${a.s})">
      <rect x="-17" y="-6" width="34" height="128" rx="17" fill="${sl.upper}"/>
      <g transform="translate(0 112) rotate(${-a.e})">${waveAnim}
        <rect x="-15" y="0" width="30" height="112" rx="15" fill="${lower}"/>
        ${hand}
      </g>
    </g>`;
  return mirrored
    ? `<g transform="translate(272 266) scale(-1 1)">${inner}</g>`
    : `<g transform="translate(128 266)">${inner}</g>`;
}

function emblem(e: Emblem, color: string): string {
  switch (e) {
    case 'star':
      return `<polygon points="200,286 212,318 246,318 218,338 228,372 200,352 172,372 182,338 154,318 188,318" fill="${color}">
        <animate attributeName="opacity" values="1;0.6;1" dur="2s" repeatCount="indefinite"/></polygon>`;
    case 'moon':
      return `<path d="M212 292 A40 40 0 1 0 212 372 A30 30 0 1 1 212 292 Z" fill="${color}"/>`;
    case 'bolt':
      return `<path d="M212 288 L178 336 L200 336 L188 376 L226 324 L204 324 Z" fill="${color}"/>`;
    case 'triangle':
      return `<path d="M200 296 L234 352 L166 352 Z" fill="${color}"/>`;
  }
}

function torso(c: Character): { back: string; body: string; legs: string } {
  const o = c.outfit;
  const shoes = c.shoes ?? '#1f2430';
  const pantsLegs = (color: string, shoe = shoes) => `
    <rect x="160" y="550" width="36" height="300" rx="14" fill="${color}"/>
    <rect x="204" y="550" width="36" height="300" rx="14" fill="${color}"/>
    <ellipse cx="174" cy="860" rx="30" ry="14" fill="${shoe}"/><ellipse cx="226" cy="860" rx="30" ry="14" fill="${shoe}"/>`;
  const base = (fill: string) =>
    `<rect x="125" y="238" width="150" height="330" rx="42" fill="${fill}"/>`;

  switch (o.kind) {
    case 'school':
      return {
        back: '',
        legs: `
          <rect x="164" y="560" width="30" height="290" rx="13" fill="${c.skin}"/>
          <rect x="206" y="560" width="30" height="290" rx="13" fill="${c.skin}"/>
          <rect x="162" y="760" width="34" height="80" rx="8" fill="#f8fafc"/><rect x="204" y="760" width="34" height="80" rx="8" fill="#f8fafc"/>
          <ellipse cx="178" cy="858" rx="28" ry="13" fill="#1f2430"/><ellipse cx="222" cy="858" rx="28" ry="13" fill="#1f2430"/>`,
        body: `${base(o.main)}
          <path d="M126 470 L274 470 L304 600 L96 600 Z" fill="${o.skirt}"/>
          <path d="M140 600 L150 470 M200 600 L200 470 M260 600 L250 470" stroke="#0b1650" stroke-width="3" opacity="0.5"/>
          <path d="M140 242 L200 320 L260 242 L276 270 L200 340 L124 270 Z" fill="${o.collar}"/>
          <path d="M150 262 L250 262" stroke="#fff" stroke-width="4" opacity="0.8"/>
          <path d="M200 330 L176 350 L180 312 Z M200 330 L224 350 L220 312 Z" fill="${o.ribbon}"/><circle cx="200" cy="330" r="8" fill="${o.ribbon}"/>`,
      };
    case 'hoodie':
      return {
        back: `<path d="M120 250 Q200 196 280 250 L270 300 Q200 270 130 300 Z" fill="${o.main}" opacity="0.9"/>`,
        legs: pantsLegs(o.pants, '#f8fafc'),
        body: `${base(o.main)}
          <path d="M150 242 Q200 300 250 242" stroke="${o.trim}" stroke-width="8" fill="none"/>
          <path d="M184 262 L180 330 M216 262 L220 330" stroke="${o.trim}" stroke-width="4" stroke-linecap="round"/>
          <rect x="150" y="420" width="100" height="70" rx="20" fill="#000" opacity="0.12"/>
          <rect x="125" y="540" width="150" height="26" rx="10" fill="${o.trim}" opacity="0.4"/>`,
      };
    case 'sweater':
      return {
        back: '',
        legs: pantsLegs(o.pants),
        body: `${base(o.main)}
          <path d="M162 240 Q200 276 238 240" stroke="${o.trim}" stroke-width="10" fill="none"/>
          <path d="M176 248 L190 270 L200 252 L210 270 L224 248" fill="#ffffff"/>
          <rect x="125" y="360" width="150" height="16" fill="${o.trim}" opacity="0.6"/>
          <rect x="125" y="390" width="150" height="8" fill="${o.trim}" opacity="0.4"/>
          <rect x="125" y="540" width="150" height="26" rx="10" fill="${o.trim}" opacity="0.35"/>`,
      };
    case 'suit':
      return {
        back: '',
        legs: pantsLegs(o.pants, '#0b0b0f'),
        body: `${base(o.main)}
          <path d="M170 242 L200 300 L230 242 Z" fill="${o.shirt}"/>
          <path d="M194 252 L206 252 L212 360 L200 376 L188 360 Z" fill="${o.tie}"/>
          <path d="M125 270 L170 242 L200 330 Z M275 270 L230 242 L200 330 Z" fill="#0f172a" opacity="0.55"/>
          <circle cx="200" cy="420" r="5" fill="#94a3b8"/><circle cx="200" cy="460" r="5" fill="#94a3b8"/>
          <rect x="232" y="300" width="22" height="6" rx="3" fill="${o.tie}" opacity="0.8"/>`,
      };
    case 'blazer':
      return {
        back: '',
        legs: pantsLegs(o.pants),
        body: `${base(o.main)}
          <path d="M168 242 L200 ${o.lanyard ? 380 : 320} L232 242 Z" fill="${o.shirt}"/>
          <path d="M125 270 L168 242 L196 400 L150 470 Z M275 270 L232 242 L204 400 L250 470 Z" fill="#000" opacity="0.22"/>
          ${
            o.lanyard
              ? `<path d="M176 246 L200 330 L224 246" stroke="${o.accent}" stroke-width="6" fill="none" stroke-linejoin="round"/>
                 <rect x="184" y="328" width="32" height="42" rx="5" fill="#ffffff"/><rect x="184" y="328" width="32" height="10" rx="3" fill="${o.accent}"/>
                 <circle cx="200" cy="350" r="6" fill="#cbd5e1"/><rect x="190" y="360" width="20" height="3" rx="1.5" fill="#94a3b8"/>`
              : `<circle cx="244" cy="300" r="7" fill="${o.accent}"/>`
          }`,
      };
    case 'polo':
      return {
        back: '',
        legs: pantsLegs(o.pants),
        body: `${base(o.main)}
          <path d="M168 238 L200 262 L232 238 L240 262 L200 280 L160 262 Z" fill="${o.trim}"/>
          <circle cx="200" cy="296" r="4" fill="${o.trim}"/><circle cx="200" cy="316" r="4" fill="${o.trim}"/>
          <rect x="226" y="300" width="28" height="22" rx="4" fill="${o.trim}" opacity="0.6"/>`,
      };
    case 'hero':
      return {
        back: o.cape
          ? `<path d="M132 250 Q90 450 80 640 L320 640 Q310 450 268 250 Z" fill="${o.cape}">
              <animate attributeName="d" dur="2.8s" repeatCount="indefinite" values="M132 250 Q90 450 80 640 L320 640 Q310 450 268 250 Z;M132 250 Q80 450 64 650 L336 630 Q318 450 268 250 Z;M132 250 Q90 450 80 640 L320 640 Q310 450 268 250 Z"/></path>`
          : '',
        legs: `
          <rect x="160" y="550" width="36" height="300" rx="14" fill="${o.main}"/><rect x="204" y="550" width="36" height="300" rx="14" fill="${o.main}"/>
          <rect x="156" y="740" width="44" height="112" rx="14" fill="${o.boots}"/><rect x="200" y="740" width="44" height="112" rx="14" fill="${o.boots}"/>
          <ellipse cx="178" cy="858" rx="30" ry="13" fill="${o.boots}"/><ellipse cx="222" cy="858" rx="30" ry="13" fill="${o.boots}"/>`,
        body: `${base(o.main)}
          <path d="M140 250 Q200 300 260 250 L262 280 Q200 330 138 280 Z" fill="${o.second}" opacity="0.35"/>
          <circle cx="200" cy="330" r="44" fill="${o.second}" opacity="0.25"/>
          ${emblem(o.emblem, o.emblemColor)}
          <rect x="125" y="470" width="150" height="22" fill="${o.second}"/><rect x="186" y="466" width="28" height="30" rx="6" fill="${o.emblemColor}"/>`,
      };
    case 'armor':
      return {
        back: '',
        legs: `
          <rect x="158" y="550" width="40" height="300" rx="14" fill="${o.main}"/><rect x="202" y="550" width="40" height="300" rx="14" fill="${o.main}"/>
          <rect x="158" y="640" width="40" height="16" fill="${o.second}"/><rect x="202" y="640" width="40" height="16" fill="${o.second}"/>
          <ellipse cx="178" cy="860" rx="32" ry="14" fill="${o.second}"/><ellipse cx="222" cy="860" rx="32" ry="14" fill="${o.second}"/>`,
        body: `${base(o.main)}
          <path d="M125 260 L170 240 L230 240 L275 260 L262 360 L200 390 L138 360 Z" fill="${o.second}"/>
          <path d="M100 250 Q128 226 160 246 L150 290 Q120 290 100 250 Z M300 250 Q272 226 240 246 L250 290 Q280 290 300 250 Z" fill="${o.main}" stroke="${o.second}" stroke-width="4"/>
          <path d="M200 290 L232 344 L168 344 Z" fill="${o.glow}"><animate attributeName="opacity" values="1;0.55;1" dur="1.8s" repeatCount="indefinite"/></path>
          <path d="M200 304 L220 336 L180 336 Z" fill="#ecfeff"/>
          <path d="M140 420 L260 420 M146 460 L254 460" stroke="${o.second}" stroke-width="6" stroke-linecap="round"/>`,
      };
  }
}

function accessories(c: Character): string {
  if (c.outfit.kind === 'polo' && c.outfit.headset) {
    return `<path d="M112 140 Q112 52 200 50 Q288 52 288 140" stroke="#1f2937" stroke-width="10" fill="none"/>
      <rect x="100" y="120" width="26" height="46" rx="10" fill="#1f2937"/><rect x="274" y="120" width="26" height="46" rx="10" fill="#1f2937"/>
      <path d="M112 160 Q120 210 172 210" stroke="#1f2937" stroke-width="5" fill="none"/><circle cx="176" cy="210" r="8" fill="#0ea5e9"/>`;
  }
  return '';
}

export function drawCharacter(c: Character): string {
  const { L, R } = poseArms(c.pose);
  const t = torso(c);
  const behindArms = [!L.front ? arm(L, c, false) : '', !R.front ? arm(R, c, true) : ''].join('');
  const frontArms = [L.front ? arm(L, c, false) : '', R.front ? arm(R, c, true) : ''].join('');
  const bodyFirst = c.pose === 'hips' || c.pose === 'hero';
  return `
  <g>
    <animateTransform attributeName="transform" type="translate" values="0 0;0 -6;0 0" dur="3.2s" repeatCount="indefinite"/>
    ${t.back}
    ${hairBack(c)}
    ${t.legs}
    ${bodyFirst ? t.body + behindArms : behindArms + t.body}
    <rect x="185" y="205" width="30" height="45" rx="10" fill="${c.skin}"/>
    ${face(c)}
    ${accessories(c)}
    ${frontArms}
  </g>`;
}

// ---------------------------------------------------------------- scenes

function drawScene(slug: string): string {
  switch (slug) {
    case 'sakura-sunset': {
      const petals = Array.from({ length: 14 }, (_, i) => {
        const x = 60 + i * 88;
        const dur = 6 + (i % 5);
        return `<ellipse cx="${x}" cy="-20" rx="9" ry="6" fill="#ffc8dd" opacity="0.85">
          <animate attributeName="cy" from="-20" to="740" dur="${dur}s" begin="-${i * 0.7}s" repeatCount="indefinite"/>
          <animate attributeName="cx" values="${x};${x + 40};${x}" dur="${dur}s" begin="-${i * 0.7}s" repeatCount="indefinite"/></ellipse>`;
      }).join('');
      return `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7c5cff"/><stop offset="0.55" stop-color="#ff7eb6"/><stop offset="1" stop-color="#ffd6a5"/></linearGradient></defs>
        <rect width="1280" height="720" fill="url(#g)"/><circle cx="980" cy="260" r="120" fill="#fff4e0" opacity="0.85"/>
        <path d="M0 560 Q320 470 640 540 T1280 520 L1280 720 L0 720 Z" fill="#5b3fa8" opacity="0.7"/>
        <path d="M0 620 Q300 560 700 620 T1280 600 L1280 720 L0 720 Z" fill="#3b2a73"/>${petals}`;
    }
    case 'neon-night': {
      const stars = Array.from(
        { length: 40 },
        (_, i) =>
          `<circle cx="${(i * 97) % 1280}" cy="${(i * 53) % 300}" r="${1 + (i % 3)}" fill="#fff" opacity="0.7"><animate attributeName="opacity" values="0.2;0.9;0.2" dur="${2 + (i % 4)}s" repeatCount="indefinite"/></circle>`,
      ).join('');
      const blocks = [
        [0, 300, 220],
        [230, 240, 180],
        [420, 330, 200],
        [630, 200, 170],
        [810, 280, 210],
        [1030, 230, 250],
      ]
        .map(
          ([x, y, w]) =>
            `<rect x="${x}" y="${y}" width="${w}" height="${720 - y}" fill="#1e1b4b"/>`,
        )
        .join('');
      const signs = [
        [60, 380, '#f472b6'],
        [270, 300, '#22d3ee'],
        [470, 400, '#facc15'],
        [660, 260, '#a78bfa'],
        [860, 350, '#22d3ee'],
        [1080, 300, '#f472b6'],
      ]
        .map(
          ([x, y, c], i) =>
            `<rect x="${x}" y="${y}" width="110" height="34" rx="8" fill="none" stroke="${c}" stroke-width="5"><animate attributeName="opacity" values="1;0.4;1" dur="${1.5 + i * 0.3}s" repeatCount="indefinite"/></rect>`,
        )
        .join('');
      return `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b0726"/><stop offset="1" stop-color="#3b0764"/></linearGradient></defs>
        <rect width="1280" height="720" fill="url(#g)"/>${stars}${blocks}${signs}
        <rect x="0" y="640" width="1280" height="80" fill="#0b0726"/><rect x="0" y="640" width="1280" height="4" fill="#f472b6" opacity="0.6"/>`;
    }
    case 'hero-skyline': {
      const b = [
        [0, 380, 120],
        [130, 300, 90],
        [230, 420, 140],
        [380, 250, 100],
        [490, 340, 130],
        [630, 200, 110],
        [750, 360, 150],
        [910, 280, 100],
        [1020, 390, 120],
        [1150, 320, 130],
      ]
        .map(
          ([x, y, w]) =>
            `<rect x="${x}" y="${y}" width="${w}" height="${720 - y}" fill="#0d1b2a"/>`,
        )
        .join('');
      return `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b132b"/><stop offset="1" stop-color="#1c2541"/></linearGradient>
        <linearGradient id="beam" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ffd166" stop-opacity="0.55"/><stop offset="1" stop-color="#ffd166" stop-opacity="0"/></linearGradient></defs>
        <rect width="1280" height="720" fill="url(#g)"/>
        <g><animateTransform attributeName="transform" type="rotate" values="-18 640 720;18 640 720;-18 640 720" dur="8s" repeatCount="indefinite"/><polygon points="610,720 670,720 760,0 520,0" fill="url(#beam)"/></g>${b}`;
    }
    case 'comic-burst': {
      const rays = Array.from({ length: 24 }, (_, i) => {
        const a1 = (i / 24) * Math.PI * 2;
        const a2 = ((i + 0.5) / 24) * Math.PI * 2;
        const p = (a: number) =>
          `${(640 + Math.cos(a) * 1400).toFixed(0)},${(360 + Math.sin(a) * 1400).toFixed(0)}`;
        return `<polygon points="640,360 ${p(a1)} ${p(a2)}" fill="${i % 2 ? '#fde047' : '#fb923c'}"/>`;
      }).join('');
      const dots = Array.from({ length: 18 * 10 }, (_, i) => {
        const x = (i % 18) * 72 + 20;
        const y = Math.floor(i / 18) * 72 + 20;
        const r = 4 + (Math.hypot(x - 640, y - 360) / 800) * 10;
        return `<circle cx="${x}" cy="${y}" r="${r.toFixed(1)}" fill="#dc2626" opacity="0.25"/>`;
      }).join('');
      return `<rect width="1280" height="720" fill="#fde047"/>
        <g><animateTransform attributeName="transform" type="rotate" values="0 640 360;360 640 360" dur="60s" repeatCount="indefinite"/>${rays}</g>${dots}
        <circle cx="640" cy="360" r="170" fill="#fff7ed" opacity="0.6"><animate attributeName="r" values="160;185;160" dur="2.4s" repeatCount="indefinite"/></circle>`;
    }
    case 'modern-office': {
      const bokeh = Array.from({ length: 10 }, (_, i) => {
        const x = 80 + i * 120;
        const y = 120 + ((i * 97) % 380);
        return `<circle cx="${x}" cy="${y}" r="${18 + (i % 4) * 8}" fill="#5eead4" opacity="0.18"><animate attributeName="cy" values="${y};${y - 30};${y}" dur="${5 + (i % 3)}s" repeatCount="indefinite"/></circle>`;
      }).join('');
      const panes = Array.from(
        { length: 8 },
        (_, i) =>
          `<rect x="${40 + i * 155}" y="60" width="140" height="460" rx="6" fill="#fff" opacity="0.07"/>`,
      ).join('');
      return `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f2a3d"/><stop offset="1" stop-color="#14b8a6"/></linearGradient></defs>
        <rect width="1280" height="720" fill="url(#g)"/>${panes}<rect x="0" y="540" width="1280" height="180" fill="#0b1e2b" opacity="0.85"/>
        <rect x="0" y="536" width="1280" height="6" fill="#5eead4" opacity="0.5"/>${bokeh}`;
    }
    case 'boardroom': {
      const windows = Array.from(
        { length: 6 },
        (_, i) => `<rect x="${70 + i * 195}" y="70" width="175" height="300" rx="6" fill="#bfdbfe"/>
        <rect x="${70 + i * 195}" y="${220 + (i % 3) * 30}" width="175" height="${150 - (i % 3) * 30}" fill="#93c5fd"/>`,
      ).join('');
      const chairs = Array.from(
        { length: 6 },
        (_, i) =>
          `<rect x="${200 + i * 150}" y="470" width="70" height="90" rx="18" fill="#1f2937"/>`,
      ).join('');
      return `<rect width="1280" height="720" fill="#78350f"/><rect width="1280" height="420" fill="#fef3c7"/>${windows}
        <rect x="0" y="380" width="1280" height="12" fill="#92400e"/>${chairs}
        <path d="M140 540 L1140 540 L1240 660 L40 660 Z" fill="#a16207"/><path d="M140 540 L1140 540 L1150 552 L130 552 Z" fill="#fde68a" opacity="0.5"/>
        <circle cx="1100" cy="150" r="50" fill="#fff" opacity="0.5"><animate attributeName="opacity" values="0.5;0.2;0.5" dur="6s" repeatCount="indefinite"/></circle>`;
    }
    case 'glass-towers': {
      const towers = [
        [40, 220, 150, '#9ec5fe'],
        [210, 120, 130, '#7fb0fb'],
        [360, 260, 170, '#a9cbff'],
        [560, 80, 150, '#6ea4f7'],
        [730, 200, 140, '#9ec5fe'],
        [890, 140, 160, '#86b5fb'],
        [1070, 240, 170, '#a9cbff'],
      ]
        .map(([x, y, w, c]) => {
          const X = Number(x),
            Y = Number(y),
            Wd = Number(w);
          return (
            `<rect x="${X}" y="${Y}" width="${Wd}" height="${720 - Y}" fill="${c}"/>` +
            Array.from(
              { length: 6 },
              (_, i) =>
                `<rect x="${(X + 12 + i * ((Wd - 24) / 6)).toFixed(1)}" y="${Y + 14}" width="${((Wd - 24) / 6 - 6).toFixed(1)}" height="${706 - Y}" fill="#fff" opacity="0.18"/>`,
            ).join('')
          );
        })
        .join('');
      return `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dbeafe"/><stop offset="1" stop-color="#eff6ff"/></linearGradient></defs>
        <rect width="1280" height="720" fill="url(#g)"/><circle cx="1080" cy="120" r="70" fill="#fff" opacity="0.8"/>${towers}
        <rect x="0" y="640" width="1280" height="80" fill="#1e3a8a" opacity="0.85"/>`;
    }
    case 'brand-stage':
    default: {
      const lights = [260, 640, 1020]
        .map(
          (
            x,
            i,
          ) => `<g><animateTransform attributeName="transform" type="rotate" values="${-10 + i * 5} ${x} 0;${10 - i * 5} ${x} 0;${-10 + i * 5} ${x} 0" dur="${6 + i}s" repeatCount="indefinite"/>
        <polygon points="${x - 20},0 ${x + 20},0 ${x + 160},620 ${x - 160},620" fill="url(#beam)"/></g>`,
        )
        .join('');
      return `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1e1b4b"/><stop offset="0.5" stop-color="#4c1d95"/><stop offset="1" stop-color="#0e7490"/></linearGradient>
        <linearGradient id="beam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.45"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
        <rect width="1280" height="720" fill="url(#g)"/>${lights}
        <ellipse cx="640" cy="660" rx="620" ry="70" fill="#0b1020" opacity="0.7"/><ellipse cx="640" cy="640" rx="520" ry="40" fill="#22d3ee" opacity="0.18"/>
        <rect x="0" y="600" width="1280" height="4" fill="#a78bfa" opacity="0.6"/>`;
    }
  }
}

// ---------------------------------------------------------------- crops & public API

interface Frame {
  viewBox: string;
  width: number;
  height: number;
  placement: Placement;
}

const FRAMES: Record<Exclude<AvatarType, 'BACKGROUND'>, Frame> = {
  FACE: {
    viewBox: '56 10 288 288',
    width: 512,
    height: 512,
    placement: { layer: 'front', x: 0.78, y: 0.3, scale: 0.35 },
  },
  HALF_BODY: {
    viewBox: '-10 0 420 470',
    width: 504,
    height: 564,
    placement: { layer: 'beside', x: 0.75, y: 0.55, scale: 0.7 },
  },
  FULL_BODY: {
    viewBox: '-30 0 460 900',
    width: 460,
    height: 900,
    placement: { layer: 'behind', x: 0.72, y: 0.5, scale: 0.95 },
  },
};

export interface GeneratedAvatar {
  svg: string;
  width: number;
  height: number;
  placement: Placement;
}

export function renderCharacter(
  c: Character,
  type: Exclude<AvatarType, 'BACKGROUND'>,
): GeneratedAvatar {
  const f = FRAMES[type];
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f.viewBox}" width="${f.width}" height="${f.height}">${drawCharacter(c)}</svg>`,
    width: f.width,
    height: f.height,
    placement: f.placement,
  };
}

export function renderScene(s: Scene): GeneratedAvatar {
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720">${drawScene(s.slug)}</svg>`,
    width: 1280,
    height: 720,
    placement: { layer: 'background', x: 0.5, y: 0.5, scale: 1 },
  };
}
