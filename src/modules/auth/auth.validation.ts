import { z } from 'zod';

const name = (label: string) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .max(50, `${label} must be at most 50 characters`);

export const registerSchema = z.object({
  firstName: name('First name'),
  lastName: name('Last name'),
  email: z
    .string({ error: 'Email is required' })
    .trim()
    .toLowerCase()
    .max(255, 'Email must be at most 255 characters')
    .pipe(z.email('Invalid email address')),
  password: z
    .string({ error: 'Password is required' })
    .min(8, 'Password must be at least 8 characters')
    .max(72, 'Password must be at most 72 characters'), // bcrypt input limit
});

export const loginSchema = z.object({
  email: z.string({ error: 'Email is required' }).trim().toLowerCase(),
  password: z.string({ error: 'Password is required' }),
});
