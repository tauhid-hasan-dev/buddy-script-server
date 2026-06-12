// Profile of another user — excludes email (PII stays private to its owner).
export interface IPublicProfile {
  id: string;
  firstName: string;
  lastName: string;
  createdAt: Date;
}

export interface IUpdateProfileInput {
  firstName?: string;
  lastName?: string;
}

export interface IListUsersQuery {
  page: number;
  limit: number;
}

export interface IUsersPage {
  users: IPublicProfile[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
