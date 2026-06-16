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
// `ids` is the comma-separated list of on-screen post ids whose like/comment
// state should be refreshed; bounded so the query stays cheap.
export const feedUpdatesQuerySchema = z.object({
  after: z.string().regex(/^\d+$/, 'Invalid post id'),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  ids: z
    .string()
    .optional()
    .default('')
    .transform((s) => (s ? s.split(',') : []))
    .refine((arr) => arr.length <= 100, 'At most 100 ids')
    .refine((arr) => arr.every((x) => /^\d+$/.test(x)), 'Invalid id in ids'),
});
