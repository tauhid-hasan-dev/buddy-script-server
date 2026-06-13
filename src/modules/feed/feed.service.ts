import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { postProjection, rawRowToDto, type IPostRawRow } from '../posts/posts.service';
import type { IFeedPage, IFeedQuery } from './feed.interface';

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

  return {
    posts: page.map(rawRowToDto),
    nextCursor: hasMore && last ? last.id.toString() : null,
  };
}

export const FeedService = { getFeed };
