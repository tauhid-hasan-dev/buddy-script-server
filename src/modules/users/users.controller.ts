import type { Request, Response } from 'express';
import HttpError from '../../utils/httpError';
import { UsersService } from './users.service';
import { listUsersSchema, userIdSchema } from './users.validation';

async function listUsers(req: Request, res: Response): Promise<void> {
  // A ZodError here becomes a 400 in the global error handler.
  const query = listUsersSchema.parse(req.query);
  const page = await UsersService.list(query);
  res.json(page);
}

async function getUser(req: Request, res: Response): Promise<void> {
  const parsed = userIdSchema.safeParse(req.params.id);
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid user id');
  }

  const user = await UsersService.getById(parsed.data);
  res.json({ user });
}

async function updateMe(req: Request, res: Response): Promise<void> {
  // req.user is guaranteed by requireAuth on this route.
  const user = await UsersService.updateProfile(req.user!.id, req.body);
  res.json({ user });
}

async function uploadAvatar(req: Request, res: Response): Promise<void> {
  if (!req.file) {
    throw new HttpError(400, 'An image file is required');
  }
  const user = await UsersService.setAvatar(req.user!.id, {
    buffer: req.file.buffer,
    mimetype: req.file.mimetype,
  });
  res.json({ user });
}

async function deleteAvatar(req: Request, res: Response): Promise<void> {
  const user = await UsersService.removeAvatar(req.user!.id);
  res.json({ user });
}

export const UsersController = {
  listUsers,
  getUser,
  updateMe,
  uploadAvatar,
  deleteAvatar,
};
