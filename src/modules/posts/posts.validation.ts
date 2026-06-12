import { z } from 'zod';

export const createPostSchema = z.object({
  content: z
    .string({ error: 'Content is required' })
    .trim()
    .min(1, 'Content is required')
    .max(5000, 'Content must be at most 5000 characters'),
  // Tolerant of casing from form-data clients; defaults to public.
  visibility: z
    .string()
    .trim()
    .toUpperCase()
    .pipe(z.enum(['PUBLIC', 'PRIVATE'], { error: 'Visibility must be PUBLIC or PRIVATE' }))
    .default('PUBLIC'),
});

export const likersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
