/**
 * "Happy Work Anniversary – Group Cake Cutting" designs.
 *
 * Layouts (canvas, slots, palette) live in code so every slot lines up with the drawn table and
 * cake. Creator-editable settings (name, heading, participant limit, published) live in the
 * PosterTemplate table and are merged in by `listTemplates`.
 */
import type { PrismaClient, PosterTemplate } from '@prisma/client';
import { z } from 'zod';

export const CANVAS = { width: 2000, height: 1500 } as const;

/** Where the table top starts; everything below is covered by the tablecloth. */
export const TABLE_TOP = 1120;
export const CAKE = { x: 1000, baseY: 1140, width: 470, height: 225 } as const;
/** The knife handle both cake cutters hold. */
export const KNIFE_HANDLE = { x: 1000, y: 880 } as const;

export type SlotRole = 'cutter' | 'stand';
export type Row = 'front' | 'back';
export type Side = 'left' | 'right' | 'center';

export interface Slot {
  id: string;
  label: string;
  role: SlotRole;
  row: Row;
  side: Side;
  /** Centre of the face, in canvas pixels. */
  x: number;
  y: number;
  /** Face height in canvas pixels. */
  faceHeight: number;
  /** Photo templates: the face box in the base photo (normalised) and its roll angle. */
  box?: { x: number; y: number; w: number; h: number };
  angle?: number;
}

/**
 * Slots in the order automatic arrangement fills them: the two cake cutters first,
 * then beside the cake, then the back row, then the outer ends.
 */
export const SLOTS: Slot[] = [
  { id: 'cut-left', label: 'Cutting the cake (left)', role: 'cutter', row: 'front', side: 'left', x: 755, y: 690, faceHeight: 190 },
  { id: 'cut-right', label: 'Cutting the cake (right)', role: 'cutter', row: 'front', side: 'right', x: 1245, y: 690, faceHeight: 190 },
  { id: 'front-left-1', label: 'Left of the cake', role: 'stand', row: 'front', side: 'left', x: 490, y: 715, faceHeight: 180 },
  { id: 'front-right-1', label: 'Right of the cake', role: 'stand', row: 'front', side: 'right', x: 1510, y: 715, faceHeight: 180 },
  { id: 'back-center', label: 'Behind the group (centre)', role: 'stand', row: 'back', side: 'center', x: 1000, y: 520, faceHeight: 160 },
  { id: 'back-left-1', label: 'Back row, left', role: 'stand', row: 'back', side: 'left', x: 600, y: 515, faceHeight: 156 },
  { id: 'back-right-1', label: 'Back row, right', role: 'stand', row: 'back', side: 'right', x: 1400, y: 515, faceHeight: 156 },
  { id: 'front-left-2', label: 'Far left', role: 'stand', row: 'front', side: 'left', x: 205, y: 735, faceHeight: 172 },
  { id: 'front-right-2', label: 'Far right', role: 'stand', row: 'front', side: 'right', x: 1795, y: 735, faceHeight: 172 },
  { id: 'back-left-2', label: 'Back row, far left', role: 'stand', row: 'back', side: 'left', x: 330, y: 535, faceHeight: 150 },
  { id: 'back-right-2', label: 'Back row, far right', role: 'stand', row: 'back', side: 'right', x: 1670, y: 535, faceHeight: 150 },
];

export const SLOT_IDS = SLOTS.map((s) => s.id) as [string, ...string[]];
export const slotById = (id: string) => SLOTS.find((s) => s.id === id);
export const MIN_PARTICIPANTS = 2;

export interface Palette {
  /** Wall gradient, top → bottom. */
  wall: [string, string];
  floor: string;
  accent: string;
  accent2: string;
  heading: string;
  headingShadow: string;
  text: string;
  cloth: [string, string];
  /** Name ribbon across the tablecloth (always dark, names are white). */
  ribbon: string;
  cake: { sponge: string; frosting: string; trim: string; plate: string };
  suits: string[];
  balloons: string[];
  headingFont: string;
}

export interface Design {
  key: string;
  name: string;
  description: string;
  defaultMax: number;
  sortOrder: number;
  /** Decorations drawn on the built-in scene. */
  decor: 'brand';
  /**
   * centered = heading across the top; split = large company logo/wordmark on the left and a
   * script heading banner with a thank-you line on the right.
   */
  header: 'centered' | 'split';
  /** Extra props on the table. */
  extras: { cakeTopper: boolean; logoOnCake: boolean; gifts: boolean };
  palette: Palette;
  /** Wording for the optional AI-generated scene (no people, no text). */
  aiScene: string;
}


const SCRIPT = "'Segoe Script', 'Brush Script MT', 'Lucida Handwriting', cursive";

export const DESIGNS: Design[] = [
  {
    key: 'sageit-green-blue',
    name: 'SageIT Office Celebration',
    description:
      'Bright SageIT office in brand green and blue: logo wall, script banner, branded cake and gifts.',
    defaultMax: 11,
    sortOrder: 0,
    decor: 'brand',
    header: 'split',
    extras: { cakeTopper: true, logoOnCake: true, gifts: true },
    palette: {
      wall: ['#fbfcfd', '#e8edf2'],
      floor: '#d9e0e6',
      accent: '#1f9d55',
      accent2: '#1f4fbf',
      heading: '#1d3c8f',
      headingShadow: '#ffffff',
      text: '#1d3c8f',
      cloth: ['#ffffff', '#eef1f4'],
      ribbon: '#1d3c8f',
      cake: { sponge: '#fafafa', frosting: '#ffffff', trim: '#1f9d55', plate: '#d9dde3' },
      suits: ['#5b6b3a', '#1f2937', '#9fb4d8', '#111827', '#1e7a4c', '#1e3a8a', '#5b2246'],
      balloons: ['#1f9d55', '#1f4fbf', '#ffffff', '#22c55e', '#2563eb'],
      headingFont: SCRIPT,
    },
    aiScene:
      'a bright modern Indian IT company office with white walls, glass partitions, indoor plants and green, blue and white balloons',
  },
];

export const designByKey = (key: string) => DESIGNS.find((d) => d.key === key);
export const DESIGN_KEYS = DESIGNS.map((d) => d.key) as [string, ...string[]];

/** Makes sure every built-in design has its settings row (idempotent, cheap). */
export async function ensurePosterTemplates(prisma: PrismaClient) {
  const existing = new Set((await prisma.posterTemplate.findMany({ select: { key: true } })).map((t) => t.key));
  for (const d of DESIGNS) {
    if (existing.has(d.key)) continue;
    await prisma.posterTemplate
      .create({
        data: {
          key: d.key,
          name: d.name,
          description: d.description,
          maxParticipants: d.defaultMax,
          sortOrder: d.sortOrder,
        },
      })
      .catch(() => undefined); // created concurrently
  }
}

// ---------------------------------------------------------------- Photo templates

/** A face in a Creator-uploaded photo that gets replaced by a participant's face. */
export const PhotoSlotSchema = z.object({
  id: z.string().regex(/^face-\d{1,2}$/),
  label: z.string().trim().min(1).max(60),
  role: z.enum(['cutter', 'stand']),
  x: z.number().min(-0.2).max(1.2),
  y: z.number().min(-0.2).max(1.2),
  w: z.number().min(0.005).max(1),
  h: z.number().min(0.005).max(1),
  angle: z.number().min(-60).max(60).optional(),
});
export type PhotoSlot = z.infer<typeof PhotoSlotSchema>;
export const PhotoSlotsSchema = z
  .array(PhotoSlotSchema)
  .min(1, 'Mark at least one face')
  .max(20)
  .refine((a) => new Set(a.map((s) => s.id)).size === a.length, 'Face ids must be unique');

/** Photo templates are rendered on a canvas 2000 px wide with the photo's aspect ratio. */
export const PHOTO_CANVAS_WIDTH = 2000;

export function photoCanvas(row: Pick<PosterTemplate, 'photoWidth' | 'photoHeight'>) {
  const w = row.photoWidth ?? 1;
  const h = row.photoHeight ?? 1;
  return { width: PHOTO_CANVAS_WIDTH, height: Math.round((PHOTO_CANVAS_WIDTH * h) / w) };
}

/** Face boxes → slots on the canvas. Cake cutters come first, then left → right. */
export function photoSlots(row: Pick<PosterTemplate, 'photoWidth' | 'photoHeight' | 'faceSlots'>): Slot[] {
  const canvas = photoCanvas(row);
  const raw = PhotoSlotsSchema.safeParse(row.faceSlots);
  if (!raw.success) return [];
  return [...raw.data]
    .sort((a, b) => (a.role === b.role ? a.x - b.x : a.role === 'cutter' ? -1 : 1))
    .map((f) => {
      const cx = f.x + f.w / 2;
      return {
        id: f.id,
        label: f.label,
        role: f.role,
        row: 'front' as const,
        side: cx < 0.4 ? ('left' as const) : cx > 0.6 ? ('right' as const) : ('center' as const),
        x: Math.round(cx * canvas.width),
        y: Math.round((f.y + f.h / 2) * canvas.height),
        faceHeight: Math.round(Math.max(f.w * canvas.width, f.h * canvas.height)),
        box: { x: f.x, y: f.y, w: f.w, h: f.h },
        angle: f.angle,
      };
    });
}

export interface TemplateView {
  key: string;
  kind: 'illustrated' | 'photo';
  name: string;
  description: string;
  heading: string;
  maxParticipants: number;
  minParticipants: number;
  isPublished: boolean;
  showNames: boolean;
  previewUrl: string;
  /** Photo templates: the base photograph (for the positions map). */
  photoUrl: string | null;
  canvas: { width: number; height: number };
  slots: Slot[];
  palette: { primary: string; accent: string; heading: string };
}

const SAGEIT = { primary: '#1d3c8f', accent: '#1f9d55', heading: '#1d3c8f' };

export function templateView(row: PosterTemplate): TemplateView | null {
  const v = row.updatedAt.getTime().toString(36);
  const base = {
    key: row.key,
    name: row.name,
    description: row.description,
    heading: row.heading,
    isPublished: row.isPublished,
    showNames: row.showNames,
    previewUrl: `/api/posters/templates/${row.key}/preview?v=${v}`,
  };
  if (row.kind === 'photo') {
    const slots = photoSlots(row);
    if (!row.photoKey || !slots.length) return null;
    const cutters = slots.filter((s) => s.role === 'cutter').length;
    return {
      ...base,
      kind: 'photo',
      maxParticipants: Math.min(row.maxParticipants, slots.length),
      minParticipants: Math.max(1, cutters),
      photoUrl: `/api/posters/templates/${row.key}/photo?v=${v}`,
      canvas: photoCanvas(row),
      slots,
      palette: SAGEIT,
    };
  }
  const d = designByKey(row.key);
  if (!d) return null;
  return {
    ...base,
    kind: 'illustrated',
    maxParticipants: Math.min(row.maxParticipants, SLOTS.length),
    minParticipants: MIN_PARTICIPANTS,
    photoUrl: null,
    canvas: { ...CANVAS },
    slots: SLOTS,
    palette: { primary: d.palette.wall[1], accent: d.palette.accent, heading: d.palette.heading },
  };
}

export async function listTemplates(prisma: PrismaClient, includeUnpublished: boolean) {
  await ensurePosterTemplates(prisma);
  const rows = await prisma.posterTemplate.findMany({
    where: includeUnpublished ? {} : { isPublished: true },
    orderBy: [{ sortOrder: 'asc' }, { updatedAt: 'desc' }],
  });
  return rows.map(templateView).filter((t): t is TemplateView => !!t);
}
