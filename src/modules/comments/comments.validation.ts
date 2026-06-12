import { z } from 'zod';

export const createCommentSchema = z.object({
  content: z
    .string({ error: 'Content is required' })
    .trim()
    .min(1, 'Content is required')
    .max(2000, 'Content must be at most 2000 characters'),
  // Present → this is a reply to the given top-level comment.
  parentId: z
    .union([z.string().regex(/^\d+$/, 'Invalid parentId'), z.number().int().positive()])
    .transform((value) => BigInt(value))
    .optional(),
});

export const commentsCursorSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().regex(/^\d+$/, 'Invalid cursor').optional(),
});
