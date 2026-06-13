import { Prisma, type ReactionType } from '@prisma/client';
import prisma from '../../lib/prisma';
import { StorageService } from '../../lib/storage';
import HttpError from '../../utils/httpError';
import type {
  ICreatePostInput,
  ILikersPage,
  ILikeState,
  IPostDto,
  IReactionCount,
  IUpdatePostInput,
} from './posts.interface';

// Shared select + mapper so the feed, single-post, and create responses all
// have the identical shape. The viewer's own reaction is fetched as a filtered
// relation (at most one row) — myReaction/likedByMe without an extra query.
export function postSelect(viewerId: string) {
  return {
    id: true,
    content: true,
    imageUrl: true,
    visibility: true,
    createdAt: true,
    author: { select: { id: true, firstName: true, lastName: true } },
    _count: { select: { likes: true, comments: true } },
    likes: { where: { userId: viewerId }, select: { type: true } },
  } satisfies Prisma.PostSelect;
}

type PostRow = Prisma.PostGetPayload<{ select: ReturnType<typeof postSelect> }>;

// Per-type reaction tallies for a set of posts, in one indexed GROUP BY query
// (post_likes_post_id_type_idx) — O(distinct reactions on the page), so the
// feed stays cheap no matter how many posts exist. Each list is ordered
// most-popular-first for the stacked-faces summary the client renders.
export async function reactionBreakdown(
  postIds: bigint[]
): Promise<Map<string, IReactionCount[]>> {
  const map = new Map<string, IReactionCount[]>();
  if (postIds.length === 0) return map;

  const groups = await prisma.postLike.groupBy({
    by: ['postId', 'type'],
    where: { postId: { in: postIds } },
    _count: { _all: true },
  });

  for (const group of groups) {
    const key = group.postId.toString();
    const list = map.get(key) ?? [];
    list.push({ type: group.type, count: group._count._all });
    map.set(key, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => b.count - a.count);
  }
  return map;
}

export function toPostDto(post: PostRow, reactions: IReactionCount[] = []): IPostDto {
  const mine = post.likes[0];
  return {
    id: post.id.toString(),
    content: post.content,
    imageUrl: post.imageUrl,
    visibility: post.visibility,
    createdAt: post.createdAt,
    author: post.author,
    likeCount: post._count.likes,
    commentCount: post._count.comments,
    likedByMe: post.likes.length > 0,
    myReaction: mine ? mine.type : null,
    reactions,
  };
}

// Single-post DTO: load the row's reaction breakdown and map it.
async function dtoForRow(post: PostRow): Promise<IPostDto> {
  const map = await reactionBreakdown([post.id]);
  return toPostDto(post, map.get(post.id.toString()) ?? []);
}

// Visibility gate used by every post interaction (read, react, comment).
// Private posts 404 for everyone but the author — a 403 would confirm the
// post exists, which is itself a leak.
export async function assertPostVisible(
  postId: bigint,
  viewerId: string
): Promise<{ id: bigint; authorId: string }> {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { id: true, authorId: true, visibility: true },
  });

  if (!post || (post.visibility === 'PRIVATE' && post.authorId !== viewerId)) {
    throw new HttpError(404, 'Post not found');
  }

  return { id: post.id, authorId: post.authorId };
}

async function create(
  authorId: string,
  input: ICreatePostInput,
  image?: { buffer: Buffer; mimetype: string }
): Promise<IPostDto> {
  // Upload happens after validation passed, so the only orphan window is a
  // failed insert — handled below by removing the just-uploaded object.
  const imageUrl = image ? await StorageService.uploadImage(image) : null;

  try {
    const post = await prisma.post.create({
      data: { authorId, content: input.content, visibility: input.visibility, imageUrl },
      select: postSelect(authorId),
    });
    // A brand-new post has no reactions yet — skip the breakdown query.
    return toPostDto(post, []);
  } catch (err) {
    if (imageUrl) void StorageService.removeImage(imageUrl);
    throw err;
  }
}

async function getById(postId: bigint, viewerId: string): Promise<IPostDto> {
  await assertPostVisible(postId, viewerId);

  const post = await prisma.post.findUniqueOrThrow({
    where: { id: postId },
    select: postSelect(viewerId),
  });

  return dtoForRow(post);
}

// Edit own post's content and/or visibility. Ownership is checked the same
// way as delete: 404 when the row doesn't exist, 403 when it isn't yours —
// editing is an explicit owner action, so a 403 here doesn't leak anything a
// delete wouldn't. Image edits are out of scope (kept as-is).
async function update(
  postId: bigint,
  userId: string,
  input: IUpdatePostInput
): Promise<IPostDto> {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { authorId: true },
  });

  if (!post) {
    throw new HttpError(404, 'Post not found');
  }
  if (post.authorId !== userId) {
    throw new HttpError(403, 'You can only edit your own posts');
  }

  const updated = await prisma.post.update({
    where: { id: postId },
    data: {
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
    },
    select: postSelect(userId),
  });

  return dtoForRow(updated);
}

async function remove(postId: bigint, userId: string): Promise<void> {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { authorId: true },
  });

  if (!post) {
    throw new HttpError(404, 'Post not found');
  }
  if (post.authorId !== userId) {
    throw new HttpError(403, 'You can only delete your own posts');
  }

  await prisma.post.delete({ where: { id: postId } });
}

// One row from the react/unreact statements below: the visibility verdict plus
// the post-write reaction breakdown, computed server-side in a single trip.
interface IReactionResultRow {
  post_exists: boolean;
  visible: boolean;
  reactions: IReactionCount[];
}

// Turn the single-statement result into the API's ILikeState, enforcing the
// same visibility rule assertPostVisible does: a private post seen by anyone
// but its author 404s (a 403 would confirm it exists). Because the gate lives
// inside the SQL, an invisible post simply performs no write — we just reject
// here before returning its (unsent) breakdown.
function toLikeState(
  row: IReactionResultRow | undefined,
  myReaction: ReactionType | null
): ILikeState {
  // The statement always returns one row (scalar EXISTS columns); a missing
  // row would mean the query itself failed to run.
  if (!row) {
    throw new HttpError(500, 'Reaction update failed');
  }
  if (!row.visible) {
    throw new HttpError(404, 'Post not found');
  }
  const reactions = row.reactions;
  const likeCount = reactions.reduce((sum, entry) => sum + entry.count, 0);
  return { liked: myReaction !== null, likeCount, myReaction, reactions };
}

// React / un-react are idempotent: reacting replaces any existing reaction
// (one per user via the composite PK), un-reacting a post you haven't reacted
// to is a no-op — double-taps and retries never surface failures. A bare
// /like with no body defaults to LIKE, preserving the original endpoint.
//
// Both run as ONE round-trip. The remote DB is ~140ms away and the connection
// pooler adds per-query overhead, so the old visibility-check → write →
// breakdown sequence cost three serial trips (~2.1s observed). Folding all
// three into a single statement cuts that to one (~0.7s). The data-modifying
// CTE can't see its own write (Postgres evaluates every CTE against the same
// snapshot), so the breakdown is built from *everyone except the actor* and
// the actor's known new reaction is added back (+1) — correct without reading
// the row we just wrote. The (post_id, type) index serves the GROUP BY.
async function react(
  postId: bigint,
  userId: string,
  type: ReactionType
): Promise<ILikeState> {
  const rows = await prisma.$queryRaw<IReactionResultRow[]>`
    WITH gate AS (
      SELECT id FROM posts
      WHERE id = ${postId} AND (visibility = 'PUBLIC' OR author_id = ${userId}::uuid)
    ),
    ins AS (
      INSERT INTO post_likes (post_id, user_id, type)
      SELECT id, ${userId}::uuid, ${type}::"ReactionType" FROM gate
      ON CONFLICT (post_id, user_id) DO UPDATE SET type = EXCLUDED.type
      RETURNING 1
    ),
    others AS (
      SELECT type, count(*)::int AS count
      FROM post_likes
      WHERE post_id = ${postId} AND user_id <> ${userId}::uuid AND EXISTS (SELECT 1 FROM gate)
      GROUP BY type
    ),
    merged AS (
      SELECT type, count FROM others
      UNION ALL
      SELECT ${type}::"ReactionType", 1 WHERE EXISTS (SELECT 1 FROM gate)
    ),
    final AS (
      SELECT type, sum(count)::int AS count FROM merged GROUP BY type
    )
    SELECT
      EXISTS (SELECT 1 FROM posts WHERE id = ${postId}) AS post_exists,
      EXISTS (SELECT 1 FROM gate) AS visible,
      COALESCE(
        (SELECT json_agg(json_build_object('type', type, 'count', count) ORDER BY count DESC, type) FROM final),
        '[]'::json
      ) AS reactions
  `;

  return toLikeState(rows[0], type);
}

async function unreact(postId: bigint, userId: string): Promise<ILikeState> {
  // Same single-trip shape as react(): gate, delete the actor's row, and
  // return the remaining breakdown (already excludes the actor) in one query.
  const rows = await prisma.$queryRaw<IReactionResultRow[]>`
    WITH gate AS (
      SELECT id FROM posts
      WHERE id = ${postId} AND (visibility = 'PUBLIC' OR author_id = ${userId}::uuid)
    ),
    del AS (
      DELETE FROM post_likes
      WHERE post_id IN (SELECT id FROM gate) AND user_id = ${userId}::uuid
      RETURNING 1
    ),
    others AS (
      SELECT type, count(*)::int AS count
      FROM post_likes
      WHERE post_id = ${postId} AND user_id <> ${userId}::uuid AND EXISTS (SELECT 1 FROM gate)
      GROUP BY type
    )
    SELECT
      EXISTS (SELECT 1 FROM posts WHERE id = ${postId}) AS post_exists,
      EXISTS (SELECT 1 FROM gate) AS visible,
      COALESCE(
        (SELECT json_agg(json_build_object('type', type, 'count', count) ORDER BY count DESC, type) FROM others),
        '[]'::json
      ) AS reactions
  `;

  return toLikeState(rows[0], null);
}

async function likers(
  postId: bigint,
  viewerId: string,
  query: { page: number; limit: number }
): Promise<ILikersPage> {
  await assertPostVisible(postId, viewerId);

  const { page, limit } = query;
  const [rows, total] = await prisma.$transaction([
    prisma.postLike.findMany({
      where: { postId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        createdAt: true,
        type: true,
        user: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
    prisma.postLike.count({ where: { postId } }),
  ]);

  return {
    likes: rows.map((row) => ({ likedAt: row.createdAt, type: row.type, user: row.user })),
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export const PostsService = { create, getById, update, remove, react, unreact, likers };
