import type { Visibility } from '@prisma/client';

export interface ICreatePostInput {
  content: string;
  visibility: Visibility;
}

// Edits are partial — the client may change content, visibility, or both.
// At least one field is required (enforced in validation).
export interface IUpdatePostInput {
  content?: string;
  visibility?: Visibility;
}

export interface IPostAuthor {
  id: string;
  firstName: string;
  lastName: string;
}

// The shape every post-returning endpoint responds with. likedByMe makes the
// like/unlike state renderable without a second request.
export interface IPostDto {
  id: string; // BigInt serialized as string for JSON safety
  content: string;
  imageUrl: string | null;
  visibility: Visibility;
  createdAt: Date;
  author: IPostAuthor;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
}

export interface ILikeState {
  liked: boolean;
  likeCount: number;
}

export interface ILikerEntry {
  likedAt: Date;
  user: IPostAuthor;
}

export interface ILikersPage {
  likes: ILikerEntry[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
