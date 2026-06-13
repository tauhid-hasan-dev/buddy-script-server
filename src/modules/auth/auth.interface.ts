export interface IRegisterInput {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}

export interface ILoginInput {
  email: string;
  password: string;
}

// Shape of a user that is safe to send to clients (no passwordHash).
export interface IAuthUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  avatarUrl: string | null;
  createdAt: Date;
}

declare global {
  namespace Express {
    interface Request {
      user?: IAuthUser;
    }
  }
}
