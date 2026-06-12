import { z } from 'zod';

export const feedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z
    .string()
    .regex(/^\d+$/, 'Invalid cursor')
    .optional(),
});
