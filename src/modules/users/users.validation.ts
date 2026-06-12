import { z } from 'zod';

const name = (label: string) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .max(50, `${label} must be at most 50 characters`);

// strictObject rejects unknown keys, so attempts to update email,
// password, or any other column fail loudly instead of being ignored.
export const updateProfileSchema = z
  .strictObject({
    firstName: name('First name').optional(),
    lastName: name('Last name').optional(),
  })
  .refine((data) => data.firstName !== undefined || data.lastName !== undefined, {
    message: 'At least one field must be provided',
  });

export const userIdSchema = z.uuid('Invalid user id');

export const listUsersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
