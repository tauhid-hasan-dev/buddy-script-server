import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests run against the remote Supabase database (ap-southeast-2), so
    // each request carries real network latency on top of bcrypt hashing.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // One file at a time — five parallel workers each opening a Prisma pool
    // against the shared pgbouncer pooler causes intermittent P1001/P1017
    // connection drops over a long-distance link.
    fileParallelism: false,
  },
});
