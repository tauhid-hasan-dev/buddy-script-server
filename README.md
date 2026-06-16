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

124 integration tests across auth, users, posts, comments, and feed — covering
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
| GET    | `/api/feed/updates`  | ✓    | Live poll: new posts since an id + refreshed like/comment state for on-screen posts: `?after=<postId>&ids=<csv>&limit=10` → `{ posts, updated, hasMore }` |
| GET    | `/api/users`         | ✓    | Paginated profiles: `?page=1&limit=20`       |
| GET    | `/api/users/:id`     | ✓    | User profile (includes email, `avatarUrl`)   |
| PATCH  | `/api/users/me`      | ✓    | Update own `firstName` / `lastName`          |
| POST   | `/api/users/me/avatar`| ✓   | Upload own avatar (multipart `avatar`, ≤5MB) → `{ user }` |
| DELETE | `/api/users/me/avatar`| ✓   | Clear own avatar back to `null`              |
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
- **Profile avatars**: every user has an optional `avatarUrl` (nullable —
  `null` until they upload one, and the client renders a default icon in that
  case). `POST /api/users/me/avatar` (multipart `avatar`, same MIME/size rules
  and Supabase pipeline as post images) sets it and best-effort deletes the
  previous object; `DELETE` clears it back to `null`. Writes target the JWT's
  user id only — never a body/URL id. `avatarUrl` is folded into the existing
  single-query post/comment author projection (`json_build_object`), so author
  avatars appear in the feed with **no extra query and no N+1**.
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
- **Rate limiting** on register/login (20 req / 15 min / IP) and on content
  writes (posts/comments/reactions — 60 / min, keyed by JWT user id so users
  behind a shared NAT aren't throttled as one). Limits are backed by **Redis
  when `REDIS_URL` is set** so they hold across replicas (the in-memory default
  would grant each replica the full quota); without it they use the in-memory
  store. Skipped under `NODE_ENV=test`. Plus `helmet` security headers, request
  body size capped at 100 KB, and CORS locked to a single configured origin with
  credentials.
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
- **Reads are one round-trip**: feed and single-post both return everything —
  author, like/comment counts, the viewer's own reaction, and the per-type
  tally as JSON — from a **single** statement (the shared `postProjection` raw
  query). The remote DB makes round-trips the dominant cost (~700ms each), so
  the old two-trip shape (page rows, then a `GROUP BY (post_id, type)` over the
  page's ids) doubled feed latency. The per-viewer reaction and the per-type
  tally are indexed correlated subqueries, while the like/comment **counts are
  denormalized columns** (next bullet), so the page stays **O(page size)** with
  no N+1 while paying one trip instead of two. `getById` likewise collapses its visibility-check →
  fetch → breakdown into one query: the `PUBLIC OR own` predicate is the WHERE
  clause, so a private post seen by a stranger returns no row → 404 (a 403 would
  leak existence).
- **Like/comment counts are denormalized columns maintained by triggers**
  (`posts.like_count` / `posts.comment_count`). At millions of posts, recounting
  `post_likes` / `comments` on every feed row is the dominant read cost, so the
  feed now reads two `O(1)` columns instead of two correlated `count(*)`
  subqueries per row. The columns are kept exact by `AFTER INSERT OR DELETE`
  row triggers on `post_likes` and `comments` (migration
  `add_denormalized_post_counts`): they fire on every reaction/comment add and
  remove — including FK **cascade deletes** — and a reaction *switch* is an
  `UPDATE` of `post_likes.type`, which the triggers ignore, so `like_count`
  stays correct. Triggers (vs. application-layer increments) cannot drift, need
  no transaction wrapping in the services, and automatically cover any future
  writer. The trigger functions resolve the `posts` table via `TG_TABLE_SCHEMA`
  (dynamic SQL), not an unqualified name, so they are correct regardless of the
  connection's `search_path` under the pgBouncer transaction pooler. A one-time
  backfill seeded existing rows; a `count(*)` parity check over all posts
  confirmed zero drift.
- **React/un-react are one round-trip**: the database is remote, so each query
  pays real network + pooler latency (≈700ms observed in dev). The naive
  visibility-check → upsert → breakdown sequence is three *serial* trips (~2.1s);
  folding them into a single SQL statement (a CTE that gates visibility, does
  the `ON CONFLICT` upsert/delete, and returns the per-type tally as JSON) cuts
  that to one (~0.7s, ~3× faster). Postgres evaluates every CTE against the same
  snapshot, so a data-modifying CTE can't see its own write — the breakdown is
  built from *all reactors except the actor* and the actor's known new reaction
  is added back, which is correct without re-reading the just-written row. The
  visibility 404 rule is preserved inside the statement (an invisible post
  performs no write and the handler rejects before returning anything).
- **Editing a post is one round-trip too**: the old ownership-check → update →
  breakdown was three serial trips. A single statement now runs the guarded
  `UPDATE ... WHERE id AND author_id = viewer` in a CTE and projects the post
  DTO in the same query. Row presence distinguishes 404 (missing) from the
  `owned` flag's 403 (not yours) — the one case a folded `WHERE` alone can't
  tell apart. Since an edit only touches content/visibility, those two fields
  come from the UPDATE's `RETURNING` while author, counts, and reactions are
  read from the (otherwise unchanged) row — correct despite the CTE's write
  being invisible to the outer SELECT's snapshot.
- **Hot feed page is cached** (`src/lib/cache.ts`). The default first feed page
  (no cursor, limit 20 — exactly what the web client loads) is the single
  hottest read, so it is cached **per viewer** for a short TTL (15s). Per-viewer
  keying means the viewer-specific fields (`likedByMe` / `myReaction`) can never
  leak across users; the key is invalidated on that viewer's own writes (create,
  edit, delete, react) so they never see their own action go missing, while
  other viewers see new public posts within the TTL. **Redis is optional config** (`REDIS_URL`): when set the cache
  is shared across replicas; when unset it falls back to an in-process store, so
  dev, tests, and single-instance deploys need no extra service (same opt-in
  shape as Supabase Storage). Deeper pages and non-default limits always hit the
  DB.
- **Near-real-time feed via an uncached delta poll** (`GET /api/feed/updates`).
  The hot-page cache above means a viewer's first feed page can be up to 15s
  stale, so another user's post would take that long to appear — too slow for a
  live feed. Rather than weaken the cache (which protects the heavy projection
  query on the hottest read), the web client polls a separate, **uncached**
  endpoint that does two cheap reads in parallel: (1) posts newer than the id
  the viewer already has on top (`WHERE id > after … LIMIT n`, a bounded
  forward-only scan of the same `(visibility, id DESC)` index), and (2) the
  refreshed like/comment state for the on-screen post `ids` (`getPostsState` —
  the reaction tallies, comment count, and the viewer's own reaction, skipping
  the immutable content/author/image). Both halves apply the same visibility
  rule as the feed, so private posts never leak. The client prepends the new
  posts and patches the counts onto existing cards, so **new posts, reactions,
  and comments all go live with the same latency** (one poll interval, ~5s)
  regardless of the feed cache, while the expensive page read stays cached. The
  state query is bounded (≤100 ids) and indexed, so it stays O(on-screen posts).
  Polling (not WebSockets) keeps the API stateless and serverless-friendly; the
  browser talks only to this JWT-authed API, so auth and privacy stay
  server-enforced. A push upgrade (Supabase Realtime) can later replace the
  client poll without changing this contract.
- **Raw queries are schema-qualified for the transaction pooler.** Supabase's
  transaction-mode pooler resets session state (including `search_path`) between
  transactions, so an unqualified table name in a `$queryRaw` would
  intermittently resolve to the wrong schema and 42P01 under load. Every
  hand-written statement qualifies its tables (`"<schema>".posts`, via
  `config.dbSchema`) — exactly what Prisma already does for its ORM queries —
  and the counter triggers do the same via `TG_TABLE_SCHEMA`. This keeps the
  single-round-trip reads correct at any replica count with no extra query.
- **Stateless auth** — any number of horizontal API replicas without shared
  session state. With the counts denormalized and the hot page cached, the
  remaining scale-out is operational: Postgres **read replicas** for the
  read-heavy feed traffic, a **CDN** in front of cacheable GETs (images already
  CDN-served), co-locating the API with the DB region, and — only if the product
  grows a follow graph — fan-out-on-write feeds.

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
  config.ts                     # env loading + fail-fast validation (optional storage/redis)
  lib/prisma.ts                 # shared Prisma client (connection pool)
  lib/redis.ts                  # shared optional ioredis client (cache + rate limit)
  lib/cache.ts                  # feed cache: Redis when configured, in-memory fallback
  middleware/
    auth.ts                     # requireAuth (cookie or Bearer)
    rateLimit.ts                # auth + write limiters (Redis-backed when configured)
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
      users.route.ts            # GET /, GET /:id, PATCH /me, POST/DELETE /me/avatar (protected)
      users.service.ts          # profile reads + self-only updates + avatar set/remove
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
