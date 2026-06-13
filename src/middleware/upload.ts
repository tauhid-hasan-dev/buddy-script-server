import multer from 'multer';
import HttpError from '../utils/httpError';

// Whitelist by MIME type — never trust the client's filename.
const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Shared in-memory multer instance: the controller hands the parsed buffer to
// Supabase Storage. Nothing touches local disk, so the API stays stateless
// across replicas. Non-multipart requests (plain JSON) pass through untouched.
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new HttpError(400, 'Only JPEG, PNG, WebP or GIF images are allowed'));
    }
  },
});

// Optional "image" field on post create.
export const uploadPostImage = imageUpload.single('image');

// Single "avatar" field for profile-image uploads.
export const uploadAvatar = imageUpload.single('avatar');
