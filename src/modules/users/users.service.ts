import prisma from '../../lib/prisma';
import HttpError from '../../utils/httpError';
import { StorageService } from '../../lib/storage';
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
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        avatarUrl: true,
        createdAt: true,
      },
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
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      avatarUrl: true,
      createdAt: true,
    },
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

// Upload happens after multer validated the file, so the only orphan window is
// a failed DB update — handled by removing the just-uploaded object. On a
// successful swap the previous avatar is deleted best-effort so storage doesn't
// accumulate dead objects. Writes target the JWT's user id, never a body/URL id.
async function setAvatar(
  userId: string,
  image: { buffer: Buffer; mimetype: string }
): Promise<IAuthUser> {
  const previous = await prisma.user.findUnique({
    where: { id: userId },
    select: { avatarUrl: true },
  });

  const avatarUrl = await StorageService.uploadImage(image);

  try {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { avatarUrl },
    });

    if (previous?.avatarUrl) void StorageService.removeImage(previous.avatarUrl);
    return toPublicUser(user);
  } catch (err) {
    void StorageService.removeImage(avatarUrl);
    throw err;
  }
}

// Clear the avatar (client falls back to the default icon) and best-effort
// delete the stored object.
async function removeAvatar(userId: string): Promise<IAuthUser> {
  const previous = await prisma.user.findUnique({
    where: { id: userId },
    select: { avatarUrl: true },
  });

  const user = await prisma.user.update({
    where: { id: userId },
    data: { avatarUrl: null },
  });

  if (previous?.avatarUrl) void StorageService.removeImage(previous.avatarUrl);
  return toPublicUser(user);
}

export const UsersService = {
  list,
  getById,
  updateProfile,
  setAvatar,
  removeAvatar,
};
