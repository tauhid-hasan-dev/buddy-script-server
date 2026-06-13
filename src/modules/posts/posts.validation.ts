import { z } from 'zod';

const contentSchema = z
  .string({ error: 'Content is required' })
  .trim()
  .min(1, 'Content is required')
  .max(5000, 'Content must be at most 5000 characters');

const visibilitySchema = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(z.enum(['PUBLIC', 'PRIVATE'], { error: 'Visibility must be PUBLIC or PRIVATE' }));

export const createPostSchema = z.object({
  content: contentSchema,
  // Tolerant of casing from form-data clients; defaults to public.
  visibility: visibilitySchema.default('PUBLIC'),
});

// Partial update: both fields optional, but the body must change something.
// strictObject rejects unknown keys so a client can't smuggle e.g. authorId.
export const updatePostSchema = z
  .strictObject({
    content: contentSchema.optional(),
    visibility: visibilitySchema.optional(),
  })
  .refine((data) => data.content !== undefined || data.visibility !== undefined, {
    error: 'Provide content or visibility to update',
  });

export const likersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
