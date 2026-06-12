import type { IPostDto } from '../posts/posts.interface';

export interface IFeedQuery {
  limit: number;
  cursor?: string;
}

export interface IFeedPage {
  posts: IPostDto[];
  nextCursor: string | null;
}
