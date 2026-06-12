import 'dotenv/config';

const required = ['DATABASE_URL', 'JWT_SECRET'] as const;
const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}

const jwtSecret = process.env.JWT_SECRET as string;

if (process.env.NODE_ENV === 'production' && jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters in production');
}

// Storage is optional config: without it the API runs fine, but image
// uploads return 503 instead of crashing the boot.
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const storageConfigured =
  !!supabaseUrl && !!supabaseKey && !supabaseKey.startsWith('[');

const config = {
  port: Number(process.env.PORT) || 5000,
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProduction: process.env.NODE_ENV === 'production',
  clientUrl: process.env.CLIENT_URL ?? 'http://localhost:5173',
  jwt: {
    secret: jwtSecret,
    expiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  },
  supabase: storageConfigured
    ? {
        url: supabaseUrl as string,
        serviceRoleKey: supabaseKey as string,
        bucket: process.env.SUPABASE_STORAGE_BUCKET ?? 'post-images',
      }
    : null,
} as const;

export default config;
