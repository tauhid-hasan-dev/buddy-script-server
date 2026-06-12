import HttpError from './httpError';

// Posts and comments use BigInt PKs; route params arrive as strings
// (Express 5 types them string | string[] for repeatable segments).
export function parseBigIntId(
  value: string | string[] | undefined,
  label: string
): bigint {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new HttpError(400, `Invalid ${label}`);
  }
  return BigInt(value);
}
