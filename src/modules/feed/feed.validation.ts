import { z } from 'zod';

export const feedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z
    .string()
    .regex(/^\d+$/, 'Invalid cursor')
    .optional(),
});

// Live-update poll: `after` is the id of the newest post the client already
// has (required — the client always has at least the seeded feed's top id).
export const feedUpdatesQuerySchema = z.object({
  after: z.string().regex(/^\d+$/, 'Invalid post id'),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
