# Buddy Script Server

Express 5 + TypeScript + PostgreSQL (Prisma) API with JWT authentication delivered via httpOnly cookies.

## Setup

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL and JWT_SECRET
npm run db:migrate     # creates the database schema
npm run dev            # tsx watch mode → http://localhost:5000
```

Production: `npm run build` then `npm start` (runs compiled JS from `dist/`).

## Tests

```bash
npm test          # Vitest + Supertest integration tests (needs the database)
npm run test:watch
```

24 integration tests cover registration, login, the `/me` endpoint, logout,
and authorization on the feed — including security cases: password never
echoed, bcrypt-hashed at rest, generic 401s (no user enumeration),
case-insensitive duplicate emails, malformed/deleted-user tokens, and
httpOnly cookie flags. Test rows use a `test_auth_` email prefix and are
removed after the run. The auth rate limiter is skipped when
`NODE_ENV=test`.

## API

| Method | Path                 | Auth | Description                                  |
| ------ | -------------------- | ---- | -------------------------------------------- |
| POST   | `/api/auth/register` | —    | `{ firstName, lastName, email, password }`   |
| POST   | `/api/auth/login`    | —    | `{ email, password }`                        |
| POST   | `/api/auth/logout`   | —    | Clears the auth cookie                       |
| GET    | `/api/auth/me`       | ✓    | Current user                                 |
| GET    | `/api/feed`          | ✓    | Paginated feed: `?cursor=<postId>&limit=20`  |
| GET    | `/api/users`         | ✓    | Paginated profiles: `?page=1&limit=20`       |
| GET    | `/api/users/:id`     | ✓    | Public profile (no email)                    |
| PATCH  | `/api/users/me`      | ✓    | Update own `firstName` / `lastName`          |
| GET    | `/health`            | —    | Liveness check                               |

Register and login set a `token` cookie (`HttpOnly`, `SameSite=Lax`, `Secure` in
production) and return the user. Protected routes also accept
`Authorization: Bearer <token>` for non-browser clients.

Errors are JSON: `{ "error": "..." }`, with a `details` array of
`{ field, message }` for validation failures (400). Duplicate email → 409,
bad credentials / missing auth → 401.

## Security decisions

- **JWT in an httpOnly cookie** — stateless (no session store to scale), and
  the cookie is invisible to JavaScript, so an XSS bug can't exfiltrate the
  token the way it could from localStorage. `SameSite=Lax` mitigates CSRF.
- **bcrypt, cost 12** — adaptive hashing; passwords capped at 72 bytes
  (bcrypt's input limit) and validated to 8+ characters.
- **No user enumeration** — login compares against a dummy hash when the
  email doesn't exist (constant-time behavior) and returns the same generic
  message for wrong email and wrong password.
- **Duplicate emails handled by the DB** — a unique constraint plus catching
  Prisma `P2002`, instead of a racy check-then-insert. Emails are normalized
  to lowercase at validation.
- **Rate limiting** on register/login (20 req / 15 min / IP), `helmet`
  security headers, request body size capped at 100 KB, CORS locked to a
  single configured origin with credentials.
- **No leaked internals** — central error handler returns generic 500s in
  production; secrets live in `.env` (git-ignored), validated at boot.

## Scale decisions (millions of posts/reads)

- **`posts.id` is a `BIGINT` identity** — compact, monotonically increasing
  primary key, so the B-tree index stays insert-ordered and cache-friendly.
  Users keep UUIDs (no ID enumeration of accounts).
- **Cursor pagination** (`WHERE id < cursor ORDER BY id DESC LIMIT n`) —
  O(page) regardless of scroll depth; `OFFSET` would scan and discard every
  skipped row.
- **Composite index `(author_id, id DESC)`** ready for per-author timelines.
- **Stateless auth** — any number of horizontal API replicas without shared
  session state.

## Structure

Feature-module layout: every module has the same five files —
`controller` (HTTP in/out), `interface` (types), `route` (wiring +
per-route middleware), `service` (business logic, talks to the DB),
`validation` (Zod schemas). Cross-cutting concerns live at the top level.

```
prisma/schema.prisma            # User + Post models
src/
  server.ts                     # bootstrap + graceful shutdown
  app.ts                        # middleware + module route wiring
  config.ts                     # env loading + fail-fast validation
  lib/prisma.ts                 # shared Prisma client (connection pool)
  middleware/
    auth.ts                     # requireAuth (cookie or Bearer)
    validate.ts                 # generic Zod body validation
    error.ts                    # ZodError→400, HttpError→status, else 500
  utils/
    httpError.ts
    token.ts                    # JWT sign + auth cookie helpers
  modules/
    auth/
      auth.controller.ts
      auth.interface.ts         # IRegisterInput, ILoginInput, IAuthUser
      auth.route.ts             # rate-limited register/login, logout, me
      auth.service.ts           # bcrypt + Prisma, enumeration-safe login
      auth.validation.ts
    feed/
      feed.controller.ts
      feed.interface.ts         # IFeedQuery, IFeedPost, IFeedPage
      feed.route.ts             # protected feed
      feed.service.ts           # cursor-paginated reads
      feed.validation.ts        # query params (limit, cursor)
    users/
      users.controller.ts
      users.interface.ts        # IPublicProfile, IUpdateProfileInput
      users.route.ts            # GET /:id, PATCH /me (both protected)
      users.service.ts          # profile reads + self-only updates
      users.validation.ts       # strict schema — unknown fields rejected
```
