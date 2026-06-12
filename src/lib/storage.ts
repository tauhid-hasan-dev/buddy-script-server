import crypto from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import config from '../config';
import HttpError from '../utils/httpError';

// Server-side client with the service role key: uploads bypass RLS, and the
// key never leaves the backend. The bucket itself is public-read so image
// URLs work in plain <img> tags.
const client: SupabaseClient | null = config.supabase
  ? createClient(config.supabase.url, config.supabase.serviceRoleKey, {
      auth: { persistSession: false },
    })
  : null;

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

async function uploadImage(file: {
  buffer: Buffer;
  mimetype: string;
}): Promise<string> {
  if (!client || !config.supabase) {
    throw new HttpError(503, 'Image uploads are not configured');
  }

  // Random object name — the client's filename is never trusted.
  const objectName = `${crypto.randomUUID()}${EXTENSIONS[file.mimetype] ?? ''}`;

  const { error } = await client.storage
    .from(config.supabase.bucket)
    .upload(objectName, file.buffer, {
      contentType: file.mimetype,
      cacheControl: '604800', // immutable names → cache hard for 7 days
      upsert: false,
    });

  if (error) {
    console.error('Supabase storage upload failed:', error.message);
    throw new HttpError(502, 'Image upload failed');
  }

  return client.storage.from(config.supabase.bucket).getPublicUrl(objectName)
    .data.publicUrl;
}

// Best-effort orphan cleanup when a request fails after its upload succeeded.
async function removeImage(imageUrl: string): Promise<void> {
  if (!client || !config.supabase) return;

  const objectName = imageUrl.split('/').pop();
  if (!objectName) return;

  await client.storage
    .from(config.supabase.bucket)
    .remove([objectName])
    .catch(() => {});
}

export const StorageService = { uploadImage, removeImage };
