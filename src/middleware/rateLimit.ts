import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import config from '../config';
import { redisClient } from '../lib/redis';

// Rate limiters. With REDIS_URL set, counters live in Redis so the limit is
// enforced across all API replicas (the in-memory default would let each
// replica grant the full quota). Without it, the default in-memory store is
// used — correct for a single instance and the behavior the test suite relies
// on. Skipped entirely under NODE_ENV=test so the suite is never throttled.
function makeStore(prefix: string) {
  const client = redisClient;
  if (!client) return undefined; // express-rate-limit's in-memory default
  return new RedisStore({
    prefix,
    // rate-limit-redis just needs a way to issue Redis commands.
    sendCommand: (command: string, ...args: string[]) =>
      client.call(command, ...args) as Promise<RedisReply>,
  });
}

function createLimiter(opts: {
  windowMs: number;
  limit: number;
  prefix: string;
  message: string;
  perUser?: boolean;
}): RateLimitRequestHandler {
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: opts.message },
    skip: () => config.nodeEnv === 'test',
    store: makeStore(opts.prefix),
    // Authenticated write endpoints key by the JWT user id, so users behind a
    // shared NAT/proxy aren't throttled as one. The limiter always runs after
    // requireAuth, so req.user is set — no IP fallback (which would also trip
    // express-rate-limit's IPv6 keyGenerator guard). Credential endpoints stay
    // on the default IP key (there's no authenticated user yet).
    ...(opts.perUser
      ? { keyGenerator: (req) => req.user?.id ?? 'anonymous' }
      : {}),
  });
}

// Credential endpoints: tight, to slow brute-force and signup spam.
export const authLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  prefix: 'rl:auth:',
  message: 'Too many attempts, please try again later',
});

// Content writes (posts/comments/reactions): generous enough never to bother a
// real user, but a backstop against scripted spam at scale.
export const writeLimiter = createLimiter({
  windowMs: 60 * 1000,
  limit: 60,
  prefix: 'rl:write:',
  message: 'You are doing that too fast, please slow down',
  perUser: true,
});
