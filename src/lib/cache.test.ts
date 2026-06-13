import { afterEach, describe, expect, it, vi } from 'vitest';
import { cache, feedFirstPageKey } from './cache';

// With no REDIS_URL configured (the test environment), the exported `cache`
// singleton is the in-process fallback. These cover its contract — get/set/del
// and TTL expiry — without touching Redis or the database.
describe('cache (in-memory fallback)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores and retrieves a value within its TTL', async () => {
    await cache.set('cache_test_k1', 'v1', 30);
    expect(await cache.get('cache_test_k1')).toBe('v1');
  });

  it('returns null for a missing key', async () => {
    expect(await cache.get('cache_test_missing')).toBeNull();
  });

  it('expires a value once its TTL elapses', async () => {
    vi.useFakeTimers();
    await cache.set('cache_test_k2', 'v2', 10);
    expect(await cache.get('cache_test_k2')).toBe('v2');
    vi.advanceTimersByTime(10_001);
    expect(await cache.get('cache_test_k2')).toBeNull();
  });

  it('deletes a key', async () => {
    await cache.set('cache_test_k3', 'v3', 30);
    await cache.del('cache_test_k3');
    expect(await cache.get('cache_test_k3')).toBeNull();
  });

  it('namespaces the feed key per viewer (no cross-viewer leak)', () => {
    expect(feedFirstPageKey('user-abc')).toBe('feed:first:user-abc');
    expect(feedFirstPageKey('a')).not.toBe(feedFirstPageKey('b'));
  });
});
