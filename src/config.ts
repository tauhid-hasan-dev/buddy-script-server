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

// The Postgres schema the app lives in, read from DATABASE_URL's `schema`
// param (Prisma's convention; defaults to public). Raw $queryRaw statements
// schema-qualify their tables with this, because the Supabase transaction
// pooler resets the session search_path between transactions — so unqualified
// names would intermittently resolve to the wrong schema. Validated to a plain
// identifier so it's safe to interpolate into SQL.
function parseDbSchema(url: string | undefined): string {
  if (!url) return 'public';
  try {
    const schema = new URL(url).searchParams.get('schema') ?? 'public';
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(schema) ? schema : 'public';
  } catch {
    return 'public';
  }
}

// Storage is optional config: without it the API runs fine, but image
// uploads return 503 instead of crashing the boot.
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const storageConfigured =
  !!supabaseUrl && !!supabaseKey && !supabaseKey.startsWith('[');

// Redis is optional config: when REDIS_URL is set, the feed cache and rate
// limiter use it (shared across API replicas); otherwise both fall back to an
// in-process implementation so dev, tests, and single-instance deploys work
// with no extra service. Same opt-in shape as storage above.
const redisUrl = process.env.REDIS_URL;
const redisConfigured = !!redisUrl && !redisUrl.startsWith('[');

const config = {
  port: Number(process.env.PORT) || 5000,
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProduction: process.env.NODE_ENV === 'production',
  dbSchema: parseDbSchema(process.env.DATABASE_URL),
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
  redis: redisConfigured ? { url: redisUrl as string } : null,
} as const;

export default config;
