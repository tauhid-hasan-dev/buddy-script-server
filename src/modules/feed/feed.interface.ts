export interface IFeedQuery {
  limit: number;
  cursor?: string;
}

export interface IFeedPost {
  id: string; // BigInt serialized as string for JSON safety
  content: string;
  createdAt: Date;
  author: {
    id: string;
    firstName: string;
    lastName: string;
  };
}

export interface IFeedPage {
  posts: IFeedPost[];
  nextCursor: string | null;
}
