import type Redis from 'ioredis';
import { redisClient } from './redis';

// A tiny string key/value cache with TTL, used for the hot feed page. Backed by
// Redis when REDIS_URL is configured (shared across API replicas), otherwise an
// in-process Map so dev, tests, and single-instance deploys need no extra
// service. Every operation is best-effort: a backend failure degrades to a
// cache miss / no-op and never breaks the request path.
export interface CacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
}

class InMemoryCache implements CacheStore {
  private store = new Map<string, { value: string; expiresAt: number }>();

  async get(key: string): Promise<string | null> {
    const hit = this.store.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= Date.now()) {
      this.store.delete(key); // lazy expiry
      return null;
    }
    return hit.value;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }
}

class RedisCache implements CacheStore {
  constructor(private client: Redis) {}

  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch {
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    try {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } catch {
      /* best-effort: a failed cache write just means the next read misses */
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch {
      /* best-effort */
    }
  }
}

export const cache: CacheStore = redisClient
  ? new RedisCache(redisClient)
  : new InMemoryCache();

// Per-viewer key for the cached first feed page. Keyed by viewer so the
// viewer-specific fields (likedByMe / myReaction) can never leak across users;
// invalidated on that viewer's own writes (see posts.service).
export const feedFirstPageKey = (viewerId: string): string => `feed:first:${viewerId}`;
