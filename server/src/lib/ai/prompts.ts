import type { AvatarType } from '../domain.js';
import { HttpError } from '../http.js';
import { originalAlternative, protectedTermIn } from '../copyright.js';
import type { ImageSize } from './openai.js';

export const GENERATION_STYLES = {
  ANIME: {
    label: 'Anime-inspired',
    text: 'original anime-inspired illustration, clean cel shading',
  },
  SUPERHERO: {
    label: 'Original Superhero-inspired',
    text: 'original superhero character with a unique costume, emblem and colour scheme, comic-book illustration',
  },
  BUSINESS: {
    label: 'Business Character',
    text: 'friendly business professional character in smart office attire, polished illustration',
  },
  MASCOT: {
    label: 'Corporate Mascot',
    text: 'cheerful corporate mascot character, simple bold shapes, brand-friendly',
  },
  CARTOON_2D: {
    label: '2D Cartoon',
    text: 'flat 2D cartoon character, bold outlines, vibrant colours',
  },
  CHARACTER_3D: {
    label: '3D Character',
    text: 'stylised 3D rendered character, soft studio lighting, high detail',
  },
  DIGITAL_HUMAN: {
    label: 'Realistic Digital Human',
    text: 'photorealistic digital human of a fictional person (not a real or famous individual)',
  },
} as const;
export type GenerationStyle = keyof typeof GENERATION_STYLES;
export const STYLE_KEYS = Object.keys(GENERATION_STYLES) as GenerationStyle[];

const FRAMING: Record<AvatarType, string> = {
  FACE: 'head-and-shoulders portrait, face centred, looking at the viewer',
  HALF_BODY: 'half-body framing from the waist up, arms visible, facing the viewer',
  FULL_BODY: 'full-body standing pose, head to feet fully in frame, facing the viewer',
  BACKGROUND: 'wide scenic background with no people or characters, suitable as a photo backdrop',
};

export const SIZE: Record<AvatarType, ImageSize> = {
  FACE: '1024x1024',
  HALF_BODY: '1024x1536',
  FULL_BODY: '1024x1536',
  BACKGROUND: '1536x1024',
};

/** Character types need a transparent background so they composite onto photos. */
export const isTransparentType = (t: AvatarType) => t !== 'BACKGROUND';

/**
 * Refuses prompts naming protected franchise characters and suggests an original direction.
 * (Exact Batman / Spider-Man etc. artwork needs usage rights, which an AI prompt can't grant.)
 */
export function guardPrompt(prompt: string) {
  const term = protectedTermIn(prompt);
  if (term) {
    throw new HttpError(
      400,
      `“${term}” is a copyrighted character, so SageVatar can't generate it. Try ${originalAlternative(term)} instead.`,
      [{ path: 'prompt', message: `suggestion: ${originalAlternative(term)}` }],
    );
  }
}

export function buildPrompt(description: string, style: GenerationStyle, type: AvatarType) {
  const parts = [
    `${GENERATION_STYLES[style].text}.`,
    `Subject: ${description.trim()}.`,
    `${FRAMING[type]}.`,
    isTransparentType(type)
      ? 'Single character only, isolated on a fully transparent background, no scenery, no text, no watermark.'
      : 'No text, no logos, no watermark.',
    'Must be an original design that does not depict or resemble any existing copyrighted or trademarked character, logo or real person.',
  ];
  return parts.join(' ');
}
