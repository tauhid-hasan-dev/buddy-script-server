import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { cache, feedFirstPageKey } from '../../lib/cache';
import {
  getPostsState,
  postProjection,
  rawRowToDto,
  type IPostRawRow,
} from '../posts/posts.service';
import type {
  IFeedPage,
  IFeedQuery,
  IFeedUpdates,
  IFeedUpdatesQuery,
} from './feed.interface';

// The default first feed page (no cursor, default limit) is the single hottest
// read in the system and what the web client requests on load. Cache it
// per-viewer for a short window: bounded staleness for a social feed, and the
// per-viewer key keeps each reader's likedByMe / myReaction private. Deeper
// pages and non-default limits always hit the DB. Matches feedQuerySchema's
// default of 20.
const FEED_DEFAULT_LIMIT = 20;
const FEED_FIRST_PAGE_TTL_SECONDS = 15;

// Cursor-based pagination (WHERE id < cursor ORDER BY id DESC LIMIT n)
// stays O(page size) no matter how deep the reader scrolls — unlike
// OFFSET, which scans and discards every skipped row and degrades
// linearly on a table with millions of posts.
//
// Visibility: everyone sees public posts; private posts appear only in
// their author's own feed. The (visibility, id) and (author_id, id)
// indexes let Postgres satisfy the OR with a BitmapOr instead of a scan.
//
// The whole page — rows, author, counts, the viewer's reaction, and the
// per-type tallies — comes back in ONE statement via the shared projection
// (see postProjection). The remote DB makes round-trips the dominant cost, so
// folding the old findMany + GROUP BY pair into a single query halves the
// latency; the per-post tallies are indexed correlated subqueries, so the page
// stays O(page size) with no N+1.
async function getFeed(viewerId: string, query: IFeedQuery): Promise<IFeedPage> {
  const { limit, cursor } = query;

  const cacheable = !cursor && limit === FEED_DEFAULT_LIMIT;
  const cacheKey = feedFirstPageKey(viewerId);
  if (cacheable) {
    const cached = await cache.get(cacheKey);
    // The page contains only JSON-safe values (ids are already strings), so a
    // round-trip through the cache is byte-identical to a fresh res.json().
    if (cached) return JSON.parse(cached) as IFeedPage;
  }

  const rows = await prisma.$queryRaw<IPostRawRow[]>(Prisma.sql`
    ${postProjection(viewerId)}
    WHERE (p.visibility = 'PUBLIC' OR p.author_id = ${viewerId}::uuid)
    ${cursor ? Prisma.sql`AND p.id < ${BigInt(cursor)}` : Prisma.empty}
    ORDER BY p.id DESC
    LIMIT ${limit + 1}
  `);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  const result: IFeedPage = {
    posts: page.map(rawRowToDto),
    nextCursor: hasMore && last ? last.id.toString() : null,
  };

  if (cacheable) {
    await cache.set(cacheKey, JSON.stringify(result), FEED_FIRST_PAGE_TTL_SECONDS);
  }
  return result;
}

// Powers the client's live-update poll: "give me posts newer than the one I
// already have on top." Deliberately NOT cached — the first-page cache above
// trades up to FEED_FIRST_PAGE_TTL_SECONDS of staleness for read throughput,
// which is fine for the bulk page but would make new posts from *other* users
// take that long to appear. This query is the cheap complement: a bounded,
// forward-only scan of the same (visibility, id DESC) index, returning at most
// `limit` of the newest rows above `after`. Same visibility rule as getFeed, so
// a viewer never sees others' private posts here either.
//
// Returns newest-first. If more than `limit` posts arrived since `after`, only
// the newest `limit` come back (hasMore=true); the client advances its anchor
// and the next poll picks up the rest — no gap, just paced delivery.
async function getUpdates(
  viewerId: string,
  query: IFeedUpdatesQuery
): Promise<IFeedUpdates> {
  const { after, limit, ids } = query;

  // Two independent reads — new posts above `after`, and refreshed state for
  // posts already on screen — issued in parallel so the poll is a single
  // round-trip's worth of latency, not two serial ones.
  const [rows, updated] = await Promise.all([
    prisma.$queryRaw<IPostRawRow[]>(Prisma.sql`
      ${postProjection(viewerId)}
      WHERE (p.visibility = 'PUBLIC' OR p.author_id = ${viewerId}::uuid)
        AND p.id > ${BigInt(after)}
      ORDER BY p.id DESC
      LIMIT ${limit + 1}
    `),
    getPostsState(viewerId, ids.map(BigInt)),
  ]);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return { posts: page.map(rawRowToDto), updated, hasMore };
}

export const FeedService = { getFeed, getUpdates };
