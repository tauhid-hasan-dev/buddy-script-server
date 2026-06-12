import jwt, { type SignOptions } from 'jsonwebtoken';
import type { Response } from 'express';
import config from '../config';

export const COOKIE_NAME = 'token';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn as SignOptions['expiresIn'],
  });
}

// In production the frontend (vercel.app) and API (onrender.com) are
// different sites, so the cookie must be SameSite=None + Secure or browsers
// drop it on every cross-site request. CSRF exposure is contained by CORS
// being locked to the single CLIENT_URL origin: state-changing requests are
// JSON (preflighted), and a plain HTML form can't produce a body
// express.json() will parse. Dev stays Lax (same-site localhost, plain HTTP).
const sameSite = config.isProduction ? ('none' as const) : ('lax' as const);

export function setAuthCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true, // not readable by JS — blocks token theft via XSS
    secure: config.isProduction, // SameSite=None is only valid with Secure
    sameSite,
    maxAge: SEVEN_DAYS_MS,
    path: '/',
  });
}

export function clearAuthCookie(res: Response): void {
  // Attributes must match setAuthCookie or browsers won't clear the cookie.
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite,
    path: '/',
  });
}
