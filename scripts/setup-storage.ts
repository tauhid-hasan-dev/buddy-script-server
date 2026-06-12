// One-time setup: creates the public post-images bucket on Supabase.
// Run with: npm run storage:setup
import { createClient } from '@supabase/supabase-js';
import config from '../src/config';

async function main(): Promise<void> {
  if (!config.supabase) {
    throw new Error(
      'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set in .env'
    );
  }

  const client = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    auth: { persistSession: false },
  });

  const bucket = config.supabase.bucket;
  const { data: existing } = await client.storage.getBucket(bucket);

  if (existing) {
    if (!existing.public) {
      // Post images render in plain <img> tags, so the bucket must be
      // public-read; uploads still require the service role key.
      const { error } = await client.storage.updateBucket(bucket, { public: true });
      if (error) throw new Error(`Failed to make bucket public: ${error.message}`);
      console.log(`Bucket "${bucket}" existed but was private — now public`);
      return;
    }
    console.log(`Bucket "${bucket}" already exists (public: ${existing.public})`);
    return;
  }

  const { error } = await client.storage.createBucket(bucket, {
    public: true, // images must render in plain <img> tags
    fileSizeLimit: '5MB',
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  });

  if (error) {
    throw new Error(`Failed to create bucket: ${error.message}`);
  }
  console.log(`Created public bucket "${bucket}" (5MB limit, images only)`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
