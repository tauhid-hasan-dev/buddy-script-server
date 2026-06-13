import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import HttpError from '../../utils/httpError';
import { assertPostVisible } from '../posts/posts.service';
import type {
  ICommentDto,
  ICommentLikersPage,
  ICommentLikeState,
  ICommentsPage,
  ICreateCommentInput,
  IRepliesPage,
} from './comments.interface';

function commentSelect(viewerId: string) {
  return {
    id: true,
    postId: true,
    parentId: true,
    content: true,
    createdAt: true,
    author: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
    _count: { select: { likes: true, replies: true } },
    likes: { where: { userId: viewerId }, select: { userId: true } },
  } satisfies Prisma.CommentSelect;
}

type CommentRow = Prisma.CommentGetPayload<{
  select: ReturnType<typeof commentSelect>;
}>;

function toCommentDto(comment: CommentRow): ICommentDto {
  return {
    id: comment.id.toString(),
    postId: comment.postId.toString(),
    parentId: comment.parentId?.toString() ?? null,
    content: comment.content,
    createdAt: comment.createdAt,
    author: comment.author,
    likeCount: comment._count.likes,
    replyCount: comment._count.replies,
    likedByMe: comment.likes.length > 0,
  };
}

// Every comment interaction inherits the post's visibility rules: if the
// viewer can't see the post, its comments 404 too.
async function assertCommentVisible(
  commentId: bigint,
  viewerId: string
): Promise<{ id: bigint; postId: bigint; parentId: bigint | null }> {
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { id: true, postId: true, parentId: true },
  });

  if (!comment) {
    throw new HttpError(404, 'Comment not found');
  }

  await assertPostVisible(comment.postId, viewerId);
  return comment;
}

async function create(
  postId: bigint,
  authorId: string,
  input: ICreateCommentInput
): Promise<ICommentDto> {
  await assertPostVisible(postId, authorId);

  if (input.parentId !== undefined) {
    const parent = await prisma.comment.findUnique({
      where: { id: input.parentId },
      select: { postId: true, parentId: true },
    });

    if (!parent || parent.postId !== postId) {
      throw new HttpError(404, 'Parent comment not found');
    }
    // One level of nesting: replying to a reply attaches to nothing.
    if (parent.parentId !== null) {
      throw new HttpError(400, 'Replies to replies are not supported');
    }
  }

  const comment = await prisma.comment.create({
    data: {
      postId,
      authorId,
      content: input.content,
      parentId: input.parentId ?? null,
    },
    select: commentSelect(authorId),
  });

  return toCommentDto(comment);
}

// Top-level comments, newest first, cursor-paginated like the feed.
async function listForPost(
  postId: bigint,
  viewerId: string,
  query: { limit: number; cursor?: string }
): Promise<ICommentsPage> {
  await assertPostVisible(postId, viewerId);

  const { limit, cursor } = query;
  const rows = await prisma.comment.findMany({
    where: {
      postId,
      parentId: null,
      ...(cursor ? { id: { lt: BigInt(cursor) } } : {}),
    },
    orderBy: { id: 'desc' },
    take: limit + 1,
    select: commentSelect(viewerId),
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  return {
    comments: page.map(toCommentDto),
    nextCursor: hasMore && last ? last.id.toString() : null,
  };
}

// Replies read oldest-first (conversation order), cursor ascending.
async function listReplies(
  commentId: bigint,
  viewerId: string,
  query: { limit: number; cursor?: string }
): Promise<IRepliesPage> {
  await assertCommentVisible(commentId, viewerId);

  const { limit, cursor } = query;
  const rows = await prisma.comment.findMany({
    where: {
      parentId: commentId,
      ...(cursor ? { id: { gt: BigInt(cursor) } } : {}),
    },
    orderBy: { id: 'asc' },
    take: limit + 1,
    select: commentSelect(viewerId),
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  return {
    replies: page.map(toCommentDto),
    nextCursor: hasMore && last ? last.id.toString() : null,
  };
}

async function like(commentId: bigint, userId: string): Promise<ICommentLikeState> {
  await assertCommentVisible(commentId, userId);

  await prisma.commentLike.createMany({
    data: [{ commentId, userId }],
    skipDuplicates: true,
  });

  const likeCount = await prisma.commentLike.count({ where: { commentId } });
  return { liked: true, likeCount };
}

async function unlike(commentId: bigint, userId: string): Promise<ICommentLikeState> {
  await assertCommentVisible(commentId, userId);

  await prisma.commentLike.deleteMany({ where: { commentId, userId } });

  const likeCount = await prisma.commentLike.count({ where: { commentId } });
  return { liked: false, likeCount };
}

async function likers(
  commentId: bigint,
  viewerId: string,
  query: { page: number; limit: number }
): Promise<ICommentLikersPage> {
  await assertCommentVisible(commentId, viewerId);

  const { page, limit } = query;
  const [rows, total] = await prisma.$transaction([
    prisma.commentLike.findMany({
      where: { commentId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        createdAt: true,
        user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
      },
    }),
    prisma.commentLike.count({ where: { commentId } }),
  ]);

  return {
    likes: rows.map((row) => ({ likedAt: row.createdAt, user: row.user })),
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export const CommentsService = {
  create,
  listForPost,
  listReplies,
  like,
  unlike,
  likers,
};
