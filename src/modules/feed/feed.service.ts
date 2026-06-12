import prisma from '../../lib/prisma';
import type { IFeedPage, IFeedQuery } from './feed.interface';

// Cursor-based pagination (WHERE id < cursor ORDER BY id DESC LIMIT n)
// stays O(page size) no matter how deep the reader scrolls — unlike
// OFFSET, which scans and discards every skipped row and degrades
// linearly on a table with millions of posts.
async function getFeed(query: IFeedQuery): Promise<IFeedPage> {
  const { limit, cursor } = query;

  const posts = await prisma.post.findMany({
    where: cursor ? { id: { lt: BigInt(cursor) } } : undefined,
    orderBy: { id: 'desc' },
    take: limit + 1, // fetch one extra to know if another page exists
    select: {
      id: true,
      content: true,
      createdAt: true,
      author: {
        select: { id: true, firstName: true, lastName: true },
      },
    },
  });

  const hasMore = posts.length > limit;
  const page = hasMore ? posts.slice(0, limit) : posts;
  const last = page[page.length - 1];

  return {
    posts: page.map((post) => ({ ...post, id: post.id.toString() })),
    nextCursor: hasMore && last ? last.id.toString() : null,
  };
}

export const FeedService = { getFeed };
