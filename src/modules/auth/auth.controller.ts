import type { Request, Response } from 'express';
import { signToken, setAuthCookie, clearAuthCookie } from '../../utils/token';
import { AuthService, toPublicUser } from './auth.service';

async function register(req: Request, res: Response): Promise<void> {
  const user = await AuthService.register(req.body);
  setAuthCookie(res, signToken(user.id));
  res.status(201).json({ user: toPublicUser(user) });
}

async function login(req: Request, res: Response): Promise<void> {
  const user = await AuthService.login(req.body);
  setAuthCookie(res, signToken(user.id));
  res.json({ user: toPublicUser(user) });
}

async function logout(_req: Request, res: Response): Promise<void> {
  clearAuthCookie(res);
  res.json({ message: 'Logged out' });
}

async function me(req: Request, res: Response): Promise<void> {
  res.json({ user: req.user });
}

export const AuthController = { register, login, logout, me };
