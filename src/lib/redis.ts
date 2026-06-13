import Redis from 'ioredis';
import config from '../config';

// Single shared ioredis connection (or null when REDIS_URL is unset), used by
// both the feed cache and the rate limiter so each API replica opens one
// connection rather than one per concern. enableOfflineQueue:false +
// maxRetriesPerRequest:1 mean that when Redis is unreachable, commands fail
// fast (callers degrade to a miss / in-memory) instead of buffering or hanging.
export const redisClient: Redis | null = config.redis
  ? new Redis(config.redis.url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    })
  : null;

if (redisClient) {
  let degraded = false;
  redisClient.on('error', (err: Error) => {
    if (!degraded) {
      degraded = true;
      console.error('[redis] unavailable, degrading:', err.message);
    }
  });
  redisClient.on('ready', () => {
    degraded = false;
  });
}
