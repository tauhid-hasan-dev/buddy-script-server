# Buddy Script Server

Express 5 + TypeScript + PostgreSQL (Prisma) API with JWT authentication delivered via httpOnly cookies.

## Setup

```bash
npm install
cp .env.example .env   # fill in the Supabase URLs, keys, and JWT_SECRET
npm run db:deploy      # applies migrations to Supabase (uses DIRECT_URL)
npm run storage:setup  # one-time: creates the public post-images bucket
npm run dev            # tsx watch mode → http://localhost:5000
```

Database is Supabase Postgres: the app connects through the transaction-mode
pooler (`DATABASE_URL`, port 6543, `pgbouncer=true`), while Prisma migrations
use the session-mode pooler (`DIRECT_URL`, port 5432). Post images live in
Supabase Storage; the server uses the `service_role` key (server-side only —
never expose it to a client).

Production: `npm run build` then `npm start` (runs compiled JS from `dist/`).

## Tests

```bash
npm test          # Vitest + Supertest integration tests (needs the database)
npm run test:watch
```

81 integration tests across auth, users, posts, comments, and feed — covering
the security cases (password never echoed, bcrypt at rest, generic 401s,
private-post 404s, ownership 403s, malformed/deleted-user tokens, httpOnly
cookie flags, upload type/size limits) and the product behavior (like/unlike
idempotency, per-viewer `likedByMe`, reply nesting limits, cursor pagination
without overlap). Test rows use per-module email prefixes (`test_auth_`,
`test_posts_`, …) and are removed after each run. The auth rate limiter is
skipped when `NODE_ENV=test`.

## API

| Method | Path                 | Auth | Description                                  |
| ------ | -------------------- | ---- | -------------------------------------------- |
| POST   | `/api/auth/register` | —    | `{ firstName, lastName, email, password }`   |
| POST   | `/api/auth/login`    | —    | `{ email, password }`                        |
| POST   | `/api/auth/logout`   | —    | Clears the auth cookie                       |
| GET    | `/api/auth/me`       | ✓    | Current user                                 |
| GET    | `/api/feed`          | ✓    | Paginated feed: `?cursor=<postId>&limit=20`  |
| GET    | `/api/users`         | ✓    | Paginated profiles: `?page=1&limit=20`       |
| GET    | `/api/users/:id`     | ✓    | User profile (includes email)                |
| PATCH  | `/api/users/me`      | ✓    | Update own `firstName` / `lastName`          |
| POST   | `/api/posts`         | ✓    | Create post: JSON or multipart with `image`  |
| GET    | `/api/posts/:id`     | ✓    | Single post (visibility-checked)             |
| PATCH  | `/api/posts/:id`     | ✓    | Edit own `content`/`visibility` (403 otherwise) |
| DELETE | `/api/posts/:id`     | ✓    | Delete own post (403 otherwise)              |
| POST   | `/api/posts/:id/like`| ✓    | React (idempotent); optional `{ type }` (LIKE default) → `{ liked, likeCount, myReaction, reactions }` |
| DELETE | `/api/posts/:id/like`| ✓    | Remove reaction (idempotent)                 |
| GET    | `/api/posts/:id/likes`| ✓   | Who reacted (with `type`): `?page=1&limit=20`|
| POST   | `/api/posts/:id/comments` | ✓ | Comment, or reply via `parentId`          |
| GET    | `/api/posts/:id/comments` | ✓ | Top-level comments, newest first (cursor) |
| GET    | `/api/comments/:id/replies` | ✓ | Replies, oldest first (cursor)          |
| POST   | `/api/comments/:id/like` | ✓ | Like comment (idempotent)                  |
| DELETE | `/api/comments/:id/like` | ✓ | Unlike comment (idempotent)                |
| GET    | `/api/comments/:id/likes`| ✓ | Who liked the comment                      |
| GET    | `/health`            | —    | Liveness check                               |

### Posts & feed semantics

- **Visibility**: `PUBLIC` (default, everyone sees it) or `PRIVATE` (only the
  author — in their feed, single-post reads, likes, and comments). Private
  posts return **404** to other users, not 403, so their existence leaks
  nothing.
- **Images**: optional `image` file in multipart form-data (JPEG/PNG/WebP/GIF,
  ≤5MB, validated by MIME type). Files upload to **Supabase Storage** (public
  `post-images` bucket) under random UUID names — client filenames are never
  trusted — and `image_url` stores the public CDN URL. Uploads are in-memory
  buffers (no local disk), so the API stays stateless across replicas; a
  failed insert removes its just-uploaded object.
- **Reactions (posts)**: a post like is a Facebook-style reaction — one of
  `LIKE, LOVE, CARE, HAHA, WOW, SAD, ANGRY`. `POST /like` with an optional
  `{ type }` body sets or **switches** the viewer's reaction (a user has at
  most one per post, enforced by the composite PK); omitting the body means
  `LIKE`, so the legacy endpoint is unchanged. Responses are idempotent and
  authoritative: `{ liked, likeCount, myReaction, reactions }`, where
  `reactions` is the per-type tally (most popular first) for the stacked-faces
  summary. Every post DTO carries `likeCount` (total of all types),
  `likedByMe`, `myReaction`, and `reactions`, all per-viewer.
- **Comment likes stay a simple binary like** (`{ liked, likeCount }`) —
  reactions are a post-only feature, so comments keep their own shape rather
  than inheriting the post reaction payload.
- **Comments**: one level of nesting — replies attach to a top-level comment
  (`parentId`); replies-to-replies are rejected with 400. Comments paginate
  newest-first by cursor; replies oldest-first (conversation order).
- **Editing a post** (`PATCH`) is owner-only and partial: send `content`,
  `visibility`, or both — an empty body is a 400, unknown fields are rejected
  (`z.strictObject`, so a client can't smuggle `authorId`), and editing a post
  you don't own is a 403 that leaves the row untouched. The response is the
  same `IPostDto` shape as create/get (with the viewer's `likedByMe` and
  counts), so the client can swap it into the feed without a refetch. Image
  edits are out of scope — the stored `image_url` is preserved.

Register and login set a `token` cookie (`HttpOnly`; `SameSite=Lax` in
development, `SameSite=None; Secure` in production because the deployed
frontend and API live on different sites) and return the user. Protected
routes also accept `Authorization: Bearer <token>` for non-browser clients.

Errors are JSON: `{ "error": "..." }`, with a `details` array of
`{ field, message }` for validation failures (400). Duplicate email → 409,
bad credentials / missing auth → 401.

## Security decisions

- **JWT in an httpOnly cookie** — stateless (no session store to scale), and
  the cookie is invisible to JavaScript, so an XSS bug can't exfiltrate the
  token the way it could from localStorage. `SameSite=Lax` mitigates CSRF in
  development; production uses `SameSite=None; Secure` (required for the
  cross-site Vercel → Render deployment), with CSRF contained by CORS locked
  to the single `CLIENT_URL` origin and JSON-only request bodies.
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

- **`posts.id` / `comments.id` are `BIGINT` identities** — compact,
  monotonically increasing primary keys, so the B-tree index stays
  insert-ordered and cache-friendly. Users keep UUIDs (no ID enumeration of
  accounts).
- **Cursor pagination** (`WHERE id < cursor ORDER BY id DESC LIMIT n`) —
  O(page) regardless of scroll depth; `OFFSET` would scan and discard every
  skipped row. Offset+total is used only where shallow browsing needs page
  counts (user directory, likers lists), always with a capped limit.
- **Feed visibility predicate is index-friendly**: `(visibility, id DESC)` and
  `(author_id, id DESC)` indexes let Postgres BitmapOr the
  `PUBLIC OR own` filter instead of scanning.
- **Likes are join tables with composite PKs** (`(post_id, user_id)`) — the PK
  doubles as the one-like-per-user constraint and the "who liked" index; no
  separate surrogate key to maintain.
- **Reactions reuse that table, not a new one**: `post_likes` gained a `type`
  enum column (`@default(LIKE)`), so the composite PK still enforces one
  reaction per user and existing rows needed no backfill. A
  `(post_id, type)` index serves the per-post `GROUP BY type` breakdown.
- **`likedByMe`/`myReaction` without N+1**: the viewer's own reaction is
  fetched as a filtered relation in the same query as the post page (at most
  one row per post). The per-type **tally** for a whole feed page is one extra
  `GROUP BY (post_id, type)` query over the page's ids — O(reactions on the
  page), so the feed stays at two queries regardless of page size.
- **Stateless auth** — any number of horizontal API replicas without shared
  session state. At larger scale, like/comment counts would denormalize onto
  posts and the hot first feed page would cache in Redis; the current shape
  makes both drop-in changes.

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
      users.route.ts            # GET /, GET /:id, PATCH /me (all protected)
      users.service.ts          # profile reads + self-only updates
      users.validation.ts       # strict schema — unknown fields rejected
    posts/
      posts.controller.ts
      posts.interface.ts        # IPostDto (+ myReaction/reactions), ILikeState, ILikersPage
      posts.route.ts            # create (multipart), get, delete, like, likers
      posts.service.ts          # visibility gate, shared post select/DTO
      posts.validation.ts
    comments/
      comments.controller.ts
      comments.interface.ts     # ICommentDto, ICommentsPage, IRepliesPage
      comments.route.ts         # nested under posts + /api/comments/:id/*
      comments.service.ts       # replies (1 level), likes, visibility inherit
      comments.validation.ts
```
