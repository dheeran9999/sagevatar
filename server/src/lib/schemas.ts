import { z } from 'zod';
import { PLACEMENT_LAYERS } from './domain.js';

/** Default placement of an avatar on the photo: { layer, x, y, scale } (fractions). */
export const PlacementSchema = z
  .object({
    layer: z.enum(PLACEMENT_LAYERS),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    scale: z.number().min(0.05).max(2),
  })
  .strict();
