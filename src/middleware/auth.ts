import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import config from '../config';
import prisma from '../lib/prisma';
import { COOKIE_NAME } from '../utils/token';

// Protects a route: verifies the JWT from the httpOnly cookie and attaches
// the current user to req.user. Also accepts a Bearer token so the API
// remains usable from Postman/mobile clients.
export default async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const bearer = req.headers.authorization;
  const token =
    req.cookies?.[COOKIE_NAME] ??
    (bearer?.startsWith('Bearer ') ? bearer.slice(7) : null);

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  let userId: string;
  try {
    const payload = jwt.verify(token, config.jwt.secret);
    if (typeof payload === 'string' || typeof payload.sub !== 'string') {
      throw new Error('Malformed payload');
    }
    userId = payload.sub;
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  // Confirm the user still exists (handles deleted accounts with live tokens).
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      createdAt: true,
    },
  });

  if (!user) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  req.user = user;
  next();
}
