import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import multer from 'multer';
import config from '../config';
import HttpError from '../utils/httpError';

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not Found' });
}

// Central error handler: validation errors become 400s with field details,
// known HttpErrors pass their message through, and anything else is logged
// server-side and returned as a generic 500 so internals (stack traces,
// query details) never leak to clients.
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof multer.MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'Image must be 5MB or smaller'
        : 'Invalid file upload';
    res.status(400).json({ error: message });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed',
      details: err.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }

  console.error(err);
  res.status(500).json({
    error:
      config.isProduction || !(err instanceof Error)
        ? 'Internal Server Error'
        : err.message,
  });
}
