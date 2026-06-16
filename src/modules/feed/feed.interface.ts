import type { IPostDto, IPostState } from '../posts/posts.interface';

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
  // Ids of posts the client already has on screen; their like/comment state is
  // refreshed so reactions and comment counts go live, not just new posts.
  ids: string[];
}

export interface IFeedUpdates {
  // Posts newer than `after`, full DTOs ready to prepend.
  posts: IPostDto[];
  // Refreshed reaction/comment state for the `ids` the client asked about.
  updated: IPostState[];
  // True when more than `limit` posts arrived since `after`; the client should
  // keep polling to drain the backlog.
  hasMore: boolean;
}
