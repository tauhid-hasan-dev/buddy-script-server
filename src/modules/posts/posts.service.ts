import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { StorageService } from '../../lib/storage';
import HttpError from '../../utils/httpError';
import type {
  ICreatePostInput,
  ILikersPage,
  ILikeState,
  IPostDto,
} from './posts.interface';

// Shared select + mapper so the feed, single-post, and create responses all
// have the identical shape. The viewer's own like is fetched as a filtered
// relation (at most one row) — likedByMe without an extra query.
export function postSelect(viewerId: string) {
  return {
    id: true,
    content: true,
    imageUrl: true,
    visibility: true,
    createdAt: true,
    author: { select: { id: true, firstName: true, lastName: true } },
    _count: { select: { likes: true, comments: true } },
    likes: { where: { userId: viewerId }, select: { userId: true } },
  } satisfies Prisma.PostSelect;
}

type PostRow = Prisma.PostGetPayload<{ select: ReturnType<typeof postSelect> }>;

export function toPostDto(post: PostRow): IPostDto {
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
  };
}

// Visibility gate used by every post interaction (read, like, comment).
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
    return toPostDto(post);
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

  return toPostDto(post);
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

// Like/unlike are idempotent: liking twice or unliking a non-liked post is a
// no-op, not an error — double-taps and retries shouldn't surface failures.
async function like(postId: bigint, userId: string): Promise<ILikeState> {
  await assertPostVisible(postId, userId);

  await prisma.postLike.createMany({
    data: [{ postId, userId }],
    skipDuplicates: true,
  });

  const likeCount = await prisma.postLike.count({ where: { postId } });
  return { liked: true, likeCount };
}

async function unlike(postId: bigint, userId: string): Promise<ILikeState> {
  await assertPostVisible(postId, userId);

  await prisma.postLike.deleteMany({ where: { postId, userId } });

  const likeCount = await prisma.postLike.count({ where: { postId } });
  return { liked: false, likeCount };
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
        user: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
    prisma.postLike.count({ where: { postId } }),
  ]);

  return {
    likes: rows.map((row) => ({ likedAt: row.createdAt, user: row.user })),
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export const PostsService = { create, getById, remove, like, unlike, likers };
