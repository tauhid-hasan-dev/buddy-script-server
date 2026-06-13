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

// Comment likes stay a simple binary like (reactions are a post-only
// feature), so they keep their own shapes rather than the post ILikeState.
export interface ICommentLikeState {
  liked: boolean;
  likeCount: number;
}

export interface ICommentLikerEntry {
  likedAt: Date;
  user: IPostAuthor;
}

export interface ICommentLikersPage {
  likes: ICommentLikerEntry[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
