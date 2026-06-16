import type { IPostDto } from '../posts/posts.interface';

export interface IFeedQuery {
  limit: number;
  cursor?: string;
}

export interface IFeedPage {
  posts: IPostDto[];
  nextCursor: string | null;
}

export interface IFeedUpdatesQuery {
  after: string;
  limit: number;
}

export interface IFeedUpdates {
  posts: IPostDto[];
  // True when more than `limit` posts arrived since `after`; the client should
  // keep polling to drain the backlog.
  hasMore: boolean;
}
