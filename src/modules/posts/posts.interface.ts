import type { ReactionType, Visibility } from '@prisma/client';

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

// Per-type tally shown as the stacked reaction faces above the action bar,
// already ordered most-popular-first by the service.
export interface IReactionCount {
  type: ReactionType;
  count: number;
}

// The shape every post-returning endpoint responds with.
// - likeCount: total reactions of any type (kept named for backward compat).
// - likedByMe: whether the viewer has any reaction (myReaction !== null).
// - myReaction: the viewer's specific reaction, or null — lets the client
//   render the active reaction without a second request.
// - reactions: per-type breakdown, most popular first, for the faces summary.
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
  myReaction: ReactionType | null;
  reactions: IReactionCount[];
}

// Returned by the react / unreact endpoints so the client can reconcile its
// optimistic update. liked/likeCount stay for backward compatibility.
export interface ILikeState {
  liked: boolean;
  likeCount: number;
  myReaction: ReactionType | null;
  reactions: IReactionCount[];
}

export interface ILikerEntry {
  likedAt: Date;
  type: ReactionType;
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
