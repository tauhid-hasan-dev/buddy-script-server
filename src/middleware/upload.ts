import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import HttpError from '../utils/httpError';

export const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Whitelist by MIME type and force our own extension — never trust the
// client's filename (path traversal, double extensions, etc.).
const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (_req, file, cb) => {
    cb(null, `${crypto.randomUUID()}${ALLOWED_TYPES[file.mimetype]}`);
  },
});

// Parses an optional single "image" field from multipart/form-data.
// Non-multipart requests (plain JSON) pass through untouched.
export const uploadPostImage = multer({
  storage,
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES[file.mimetype]) {
      cb(null, true);
    } else {
      cb(new HttpError(400, 'Only JPEG, PNG, WebP or GIF images are allowed'));
    }
  },
}).single('image');

// Best-effort removal of an uploaded file when the request later fails —
// keeps validation errors from leaving orphans in uploads/.
export function removeUploadedFile(filePath: string | undefined): void {
  if (!filePath) return;
  fs.unlink(filePath, () => {});
}
