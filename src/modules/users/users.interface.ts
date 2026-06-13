// Profile visible to other authenticated users. Includes email by product
// decision; passwordHash never leaves the service layer.
export interface IPublicProfile {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  avatarUrl: string | null;
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
