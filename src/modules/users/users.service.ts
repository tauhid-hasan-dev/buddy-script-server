import prisma from '../../lib/prisma';
import HttpError from '../../utils/httpError';
import type { IAuthUser } from '../auth/auth.interface';
import { toPublicUser } from '../auth/auth.service';
import type {
  IListUsersQuery,
  IPublicProfile,
  IUpdateProfileInput,
  IUsersPage,
} from './users.interface';

// Offset pagination here (unlike the feed's cursor) because a user directory
// is browsed shallowly and needs a total count; the page size cap keeps the
// worst-case OFFSET scan bounded.
async function list(query: IListUsersQuery): Promise<IUsersPage> {
  const { page, limit } = query;

  const [users, total] = await prisma.$transaction([
    prisma.user.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
      select: { id: true, firstName: true, lastName: true, createdAt: true },
    }),
    prisma.user.count(),
  ]);

  return {
    users,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

async function getById(id: string): Promise<IPublicProfile> {
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, firstName: true, lastName: true, createdAt: true },
  });

  if (!user) {
    throw new HttpError(404, 'User not found');
  }

  return user;
}

// Authorization is structural: the user id comes from the verified JWT
// (req.user), never from the request body or URL, so users can only ever
// update their own profile.
async function updateProfile(
  userId: string,
  input: IUpdateProfileInput
): Promise<IAuthUser> {
  const user = await prisma.user.update({
    where: { id: userId },
    data: input,
  });

  return toPublicUser(user);
}

export const UsersService = { list, getById, updateProfile };
