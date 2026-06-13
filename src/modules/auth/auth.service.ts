import bcrypt from 'bcrypt';
import { Prisma, type User } from '@prisma/client';
import prisma from '../../lib/prisma';
import HttpError from '../../utils/httpError';
import type { IAuthUser, ILoginInput, IRegisterInput } from './auth.interface';

const BCRYPT_ROUNDS = 12;

// Pre-computed hash used when the email doesn't exist, so login takes the
// same time either way (prevents user enumeration via response timing).
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer-password', BCRYPT_ROUNDS);

export function toPublicUser(user: User): IAuthUser {
  const { id, firstName, lastName, email, avatarUrl, createdAt } = user;
  return { id, firstName, lastName, email, avatarUrl, createdAt };
}

async function register(input: IRegisterInput): Promise<User> {
  const { firstName, lastName, email, password } = input;

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  try {
    return await prisma.user.create({
      data: { firstName, lastName, email, passwordHash },
    });
  } catch (err) {
    // Unique constraint on email — rely on the DB rather than a racy
    // check-then-insert.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      throw new HttpError(409, 'An account with this email already exists');
    }
    throw err;
  }
}

async function login(input: ILoginInput): Promise<User> {
  const { email, password } = input;

  const user = await prisma.user.findUnique({ where: { email } });
  const match = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);

  // One generic message for both wrong email and wrong password.
  if (!user || !match) {
    throw new HttpError(401, 'Invalid email or password');
  }

  return user;
}

export const AuthService = { register, login };
