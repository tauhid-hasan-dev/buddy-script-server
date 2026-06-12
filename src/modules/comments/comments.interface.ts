import type { IPostAuthor } from '../posts/posts.interface';

export interface ICreateCommentInput {
  content: string;
  parentId?: bigint;
}

export interface ICommentDto {
  id: string; // BigInt serialized as string
  postId: string;
  parentId: string | null;
  content: string;
  createdAt: Date;
  author: IPostAuthor;
  likeCount: number;
  replyCount: number;
  likedByMe: boolean;
}

export interface ICommentsPage {
  comments: ICommentDto[];
  nextCursor: string | null;
}

export interface IRepliesPage {
  replies: ICommentDto[];
  nextCursor: string | null;
}
