import prisma from '../../lib/prisma';
import { postSelect, toPostDto } from '../posts/posts.service';
import type { IFeedPage, IFeedQuery } from './feed.interface';

// Cursor-based pagination (WHERE id < cursor ORDER BY id DESC LIMIT n)
// stays O(page size) no matter how deep the reader scrolls — unlike
// OFFSET, which scans and discards every skipped row and degrades
// linearly on a table with millions of posts.
//
// Visibility: everyone sees public posts; private posts appear only in
// their author's own feed. The (visibility, id) and (author_id, id)
// indexes let Postgres satisfy the OR with a BitmapOr instead of a scan.
async function getFeed(viewerId: string, query: IFeedQuery): Promise<IFeedPage> {
  const { limit, cursor } = query;

  const posts = await prisma.post.findMany({
    where: {
      ...(cursor ? { id: { lt: BigInt(cursor) } } : {}),
      OR: [{ visibility: 'PUBLIC' }, { authorId: viewerId }],
    },
    orderBy: { id: 'desc' },
    take: limit + 1, // fetch one extra to know if another page exists
    select: postSelect(viewerId),
  });

  const hasMore = posts.length > limit;
  const page = hasMore ? posts.slice(0, limit) : posts;
  const last = page[page.length - 1];

  return {
    posts: page.map(toPostDto),
    nextCursor: hasMore && last ? last.id.toString() : null,
  };
}

export const FeedService = { getFeed };
