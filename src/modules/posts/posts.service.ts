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

// Summarize a post's reactions after a write, deriving likeCount from the
// breakdown so we don't issue a separate COUNT query.
async function reactionState(
  postId: bigint,
  myReaction: ReactionType | null
): Promise<ILikeState> {
  const map = await reactionBreakdown([postId]);
  const reactions = map.get(postId.toString()) ?? [];
  const likeCount = reactions.reduce((sum, entry) => sum + entry.count, 0);
  return { liked: myReaction !== null, likeCount, myReaction, reactions };
}

// React / un-react are idempotent: reacting replaces any existing reaction
// (one per user via the composite PK), un-reacting a post you haven't reacted
// to is a no-op — double-taps and retries never surface failures. A bare
// /like with no body defaults to LIKE, preserving the original endpoint.
async function react(
  postId: bigint,
  userId: string,
  type: ReactionType
): Promise<ILikeState> {
  await assertPostVisible(postId, userId);

  await prisma.postLike.upsert({
    where: { postId_userId: { postId, userId } },
    create: { postId, userId, type },
    update: { type },
  });

  return reactionState(postId, type);
}

async function unreact(postId: bigint, userId: string): Promise<ILikeState> {
  await assertPostVisible(postId, userId);

  await prisma.postLike.deleteMany({ where: { postId, userId } });

  return reactionState(postId, null);
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
