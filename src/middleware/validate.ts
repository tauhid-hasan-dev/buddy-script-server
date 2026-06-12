import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodType } from 'zod';

// Validates req.body against a Zod schema; replaces it with the parsed
// (trimmed, normalized) result so controllers only ever see clean data.
// ZodErrors are mapped to 400 responses by the global error handler.
export default function validate(schema: ZodType): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.body = schema.parse(req.body);
    next();
  };
}
