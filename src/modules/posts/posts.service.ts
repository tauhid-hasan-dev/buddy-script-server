import { Prisma, type ReactionType, type Visibility } from '@prisma/client';
import prisma from '../../lib/prisma';
import config from '../../config';
import { cache, feedFirstPageKey } from '../../lib/cache';
import { StorageService } from '../../lib/storage';
import HttpError from '../../utils/httpError';

// Schema qualifier for raw SQL. The Supabase transaction pooler resets the
// session search_path between transactions, so unqualified table names in
// $queryRaw intermittently fail with 42P01 ("relation does not exist"). Prisma
// schema-qualifies its own ORM SQL; we do the same here. Empty for the default
// `public` schema. config.dbSchema is validated to a plain identifier.
const T = Prisma.raw(config.dbSchema === 'public' ? '' : `"${config.dbSchema}".`);
import type {
  ICreatePostInput,
  ILikersPage,
  ILikeState,
  IPostAuthor,
  IPostDto,
  IPostState,
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
    author: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
    // Denormalized counters (maintained by DB triggers) instead of a _count
    // aggregate subquery — O(1) column reads, identical DTO shape.
    likeCount: true,
    commentCount: true,
    likes: { where: { userId: viewerId }, select: { type: true } },
  } satisfies Prisma.PostSelect;
}

type PostRow = Prisma.PostGetPayload<{ select: ReturnType<typeof postSelect> }>;

export function toPostDto(post: PostRow, reactions: IReactionCount[] = []): IPostDto {
  const mine = post.likes[0];
  return {
    id: post.id.toString(),
    content: post.content,
    imageUrl: post.imageUrl,
    visibility: post.visibility,
    createdAt: post.createdAt,
    author: post.author,
    likeCount: post.likeCount,
    commentCount: post.commentCount,
    likedByMe: post.likes.length > 0,
    myReaction: mine ? mine.type : null,
    reactions,
  };
}

// --- Single-query read projection (feed + single post) ---------------------
// Fetching the page rows and then a separate per-type tally needs two round-
// trips; against the remote DB that's two × ~700ms. This raw projection folds
// everything — author, like/comment counts, the viewer's own reaction, and the
// per-type breakdown as JSON — into ONE statement so reads cost a single trip.
// Every correlated subquery is indexed (post_likes/comments by post_id), so the
// page stays O(page size).
export interface IPostRawRow {
  id: bigint;
  content: string;
  image_url: string | null;
  visibility: Visibility;
  created_at: Date;
  author: IPostAuthor;
  like_count: number;
  comment_count: number;
  my_reaction: ReactionType | null;
  reactions: IReactionCount[];
}

// SELECT ... FROM posts JOIN users — the caller appends WHERE / ORDER / LIMIT.
export function postProjection(viewerId: string): Prisma.Sql {
  return Prisma.sql`
    SELECT
      p.id,
      p.content,
      p.image_url,
      p.visibility,
      p.created_at,
      json_build_object('id', u.id, 'firstName', u.first_name, 'lastName', u.last_name, 'avatarUrl', u.avatar_url) AS author,
      p.like_count,
      p.comment_count,
      (SELECT pl.type FROM ${T}post_likes pl WHERE pl.post_id = p.id AND pl.user_id = ${viewerId}::uuid) AS my_reaction,
      COALESCE((
        SELECT json_agg(json_build_object('type', t.type, 'count', t.count) ORDER BY t.count DESC, t.type)
        FROM (
          SELECT type, count(*)::int AS count
          FROM ${T}post_likes pl WHERE pl.post_id = p.id GROUP BY type
        ) t
      ), '[]'::json) AS reactions
    FROM ${T}posts p
    JOIN ${T}users u ON u.id = p.author_id
  `;
}

export function rawRowToDto(row: IPostRawRow): IPostDto {
  return {
    id: row.id.toString(),
    content: row.content,
    imageUrl: row.image_url,
    visibility: row.visibility,
    createdAt: row.created_at,
    author: row.author,
    likeCount: row.like_count,
    commentCount: row.comment_count,
    likedByMe: row.my_reaction !== null,
    myReaction: row.my_reaction,
    reactions: row.reactions,
  };
}

interface IPostStateRow {
  id: bigint;
  like_count: number;
  comment_count: number;
  my_reaction: ReactionType | null;
  reactions: IReactionCount[];
}

// Current reaction/comment state for a bounded set of posts the viewer already
// has on screen — the cheap complement to the full feed projection. Skips the
// immutable columns (content, author, image) and the JOIN, so the live-update
// poll can refresh likes and comment counts without re-sending unchanged data.
// Same visibility gate as the feed (a private post the viewer can't see simply
// returns no row), same indexed correlated subqueries → O(number of ids).
export async function getPostsState(
  viewerId: string,
  ids: bigint[]
): Promise<IPostState[]> {
  if (ids.length === 0) return [];

  const rows = await prisma.$queryRaw<IPostStateRow[]>(Prisma.sql`
    SELECT
      p.id,
      p.like_count,
      p.comment_count,
      (SELECT pl.type FROM ${T}post_likes pl WHERE pl.post_id = p.id AND pl.user_id = ${viewerId}::uuid) AS my_reaction,
      COALESCE((
        SELECT json_agg(json_build_object('type', t.type, 'count', t.count) ORDER BY t.count DESC, t.type)
        FROM (
          SELECT type, count(*)::int AS count
          FROM ${T}post_likes pl WHERE pl.post_id = p.id GROUP BY type
        ) t
      ), '[]'::json) AS reactions
    FROM ${T}posts p
    WHERE p.id IN (${Prisma.join(ids)})
      AND (p.visibility = 'PUBLIC' OR p.author_id = ${viewerId}::uuid)
  `);

  return rows.map((r) => ({
    id: r.id.toString(),
    likeCount: r.like_count,
    commentCount: r.comment_count,
    likedByMe: r.my_reaction !== null,
    myReaction: r.my_reaction,
    reactions: r.reactions,
  }));
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
    // The author's cached feed is now stale (missing this post); drop it so
    // their next load is fresh. Best-effort — a cache miss is harmless.
    void cache.del(feedFirstPageKey(authorId));
    return toPostDto(post, []);
  } catch (err) {
    if (imageUrl) void StorageService.removeImage(imageUrl);
    throw err;
  }
}

// One round-trip: the visibility gate is the WHERE clause, so a private post
// seen by anyone but its author simply returns no row → 404 (a 403 would
// confirm it exists). The projection already carries counts, the viewer's
// reaction, and the breakdown — no follow-up query.
async function getById(postId: bigint, viewerId: string): Promise<IPostDto> {
  const rows = await prisma.$queryRaw<IPostRawRow[]>(Prisma.sql`
    ${postProjection(viewerId)}
    WHERE p.id = ${postId}
      AND (p.visibility = 'PUBLIC' OR p.author_id = ${viewerId}::uuid)
  `);

  const row = rows[0];
  if (!row) {
    throw new HttpError(404, 'Post not found');
  }
  return rawRowToDto(row);
}

// Edit own post's content and/or visibility, in ONE round-trip. Ownership is
// checked the same way as delete: 404 when the row doesn't exist, 403 when it
// isn't yours — editing is an explicit owner action, so a 403 here doesn't leak
// anything a delete wouldn't. Image edits are out of scope (kept as-is).
//
// The CTE runs the guarded UPDATE (WHERE id AND author = viewer) and the outer
// projection returns the post DTO. Row presence answers existence (no row →
// 404); the `owned` flag answers ownership (→ 403). An edit only touches
// content/visibility, so every other projected field (author, counts,
// reactions) is read from the unchanged row, while content/visibility come from
// the UPDATE's RETURNING — correct even though the CTE's write isn't visible to
// the outer SELECT's snapshot. A non-owner's UPDATE matches nothing, so the
// COALESCE falls back to the existing values (which we discard on the 403).
async function update(
  postId: bigint,
  userId: string,
  input: IUpdatePostInput
): Promise<IPostDto> {
  const rows = await prisma.$queryRaw<(IPostRawRow & { owned: boolean })[]>(Prisma.sql`
    WITH upd AS (
      UPDATE ${T}posts SET
        content = COALESCE(${input.content ?? null}, content),
        visibility = COALESCE(${input.visibility ?? null}::${T}"Visibility", visibility),
        updated_at = now()
      WHERE id = ${postId} AND author_id = ${userId}::uuid
      RETURNING content, visibility
    )
    SELECT
      (p.author_id = ${userId}::uuid) AS owned,
      p.id,
      COALESCE((SELECT content FROM upd), p.content) AS content,
      p.image_url,
      COALESCE((SELECT visibility FROM upd), p.visibility) AS visibility,
      p.created_at,
      json_build_object('id', u.id, 'firstName', u.first_name, 'lastName', u.last_name, 'avatarUrl', u.avatar_url) AS author,
      p.like_count,
      p.comment_count,
      (SELECT pl.type FROM ${T}post_likes pl WHERE pl.post_id = p.id AND pl.user_id = ${userId}::uuid) AS my_reaction,
      COALESCE((
        SELECT json_agg(json_build_object('type', t.type, 'count', t.count) ORDER BY t.count DESC, t.type)
        FROM (
          SELECT type, count(*)::int AS count
          FROM ${T}post_likes pl WHERE pl.post_id = p.id GROUP BY type
        ) t
      ), '[]'::json) AS reactions
    FROM ${T}posts p
    JOIN ${T}users u ON u.id = p.author_id
    WHERE p.id = ${postId}
  `);

  const row = rows[0];
  if (!row) {
    throw new HttpError(404, 'Post not found');
  }
  if (!row.owned) {
    throw new HttpError(403, 'You can only edit your own posts');
  }
  // Edited content/visibility is now stale in the author's cached feed.
  void cache.del(feedFirstPageKey(userId));
  return rawRowToDto(row);
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
  void cache.del(feedFirstPageKey(userId));
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
      SELECT id FROM ${T}posts
      WHERE id = ${postId} AND (visibility = 'PUBLIC' OR author_id = ${userId}::uuid)
    ),
    ins AS (
      INSERT INTO ${T}post_likes (post_id, user_id, type)
      SELECT id, ${userId}::uuid, ${type}::${T}"ReactionType" FROM gate
      ON CONFLICT (post_id, user_id) DO UPDATE SET type = EXCLUDED.type
      RETURNING 1
    ),
    others AS (
      SELECT type, count(*)::int AS count
      FROM ${T}post_likes
      WHERE post_id = ${postId} AND user_id <> ${userId}::uuid AND EXISTS (SELECT 1 FROM gate)
      GROUP BY type
    ),
    merged AS (
      SELECT type, count FROM others
      UNION ALL
      SELECT ${type}::${T}"ReactionType", 1 WHERE EXISTS (SELECT 1 FROM gate)
    ),
    final AS (
      SELECT type, sum(count)::int AS count FROM merged GROUP BY type
    )
    SELECT
      EXISTS (SELECT 1 FROM ${T}posts WHERE id = ${postId}) AS post_exists,
      EXISTS (SELECT 1 FROM gate) AS visible,
      COALESCE(
        (SELECT json_agg(json_build_object('type', type, 'count', count) ORDER BY count DESC, type) FROM final),
        '[]'::json
      ) AS reactions
  `;

  // toLikeState throws 404 for an invisible post (no write happened); if it
  // returns, the actor's reaction changed, so refresh their cached feed.
  const state = toLikeState(rows[0], type);
  void cache.del(feedFirstPageKey(userId));
  return state;
}

async function unreact(postId: bigint, userId: string): Promise<ILikeState> {
  // Same single-trip shape as react(): gate, delete the actor's row, and
  // return the remaining breakdown (already excludes the actor) in one query.
  const rows = await prisma.$queryRaw<IReactionResultRow[]>`
    WITH gate AS (
      SELECT id FROM ${T}posts
      WHERE id = ${postId} AND (visibility = 'PUBLIC' OR author_id = ${userId}::uuid)
    ),
    del AS (
      DELETE FROM ${T}post_likes
      WHERE post_id IN (SELECT id FROM gate) AND user_id = ${userId}::uuid
      RETURNING 1
    ),
    others AS (
      SELECT type, count(*)::int AS count
      FROM ${T}post_likes
      WHERE post_id = ${postId} AND user_id <> ${userId}::uuid AND EXISTS (SELECT 1 FROM gate)
      GROUP BY type
    )
    SELECT
      EXISTS (SELECT 1 FROM ${T}posts WHERE id = ${postId}) AS post_exists,
      EXISTS (SELECT 1 FROM gate) AS visible,
      COALESCE(
        (SELECT json_agg(json_build_object('type', type, 'count', count) ORDER BY count DESC, type) FROM others),
        '[]'::json
      ) AS reactions
  `;

  const state = toLikeState(rows[0], null);
  void cache.del(feedFirstPageKey(userId));
  return state;
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
        user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
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
