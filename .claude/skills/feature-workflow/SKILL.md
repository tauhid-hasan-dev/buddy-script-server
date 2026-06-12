---
name: feature-workflow
description: The established work process for this Express 5 + TypeScript + Prisma server. Use this skill whenever adding, changing, or removing any endpoint, module, model, or middleware in this repo — including requests phrased as "add X feature", "create a Y module", "add an endpoint", "update the API", or bug fixes that touch routes/services. It defines the five-file module pattern, security conventions, and the mandatory test → build → Postman/newman → README verification loop that every change must complete.
---

# Feature Workflow

How features get built in this repo. The structure exists so every module looks
the same, and the verification loop exists so nothing ships unproven — follow
both even for small changes.

## Guiding principles (from the assignment brief)

These four requirements outrank convenience whenever a design decision comes up:

1. **Best practices for development, security, and performance** — if a
   shortcut conflicts with an established practice (validation, hashing,
   indexes, error hygiene), take the practice. When two valid approaches
   exist, pick the one with a defensible written rationale and record it in
   the README's design sections.
2. **Standard database design and modeling** — normalized tables, real foreign
   keys with `onDelete` behavior, unique constraints enforced in the DB (not
   just app code), snake_case mapped columns, timestamptz, and indexes that
   match the actual read paths. Model changes go through Prisma migrations,
   never manual DDL.
3. **Design for millions of posts and reads** — every list endpoint must stay
   O(page size): cursor pagination over indexed monotonic keys for deep lists,
   capped limits everywhere, no unbounded queries, no OFFSET on hot paths.
   Prefer stateless request handling (JWT, no server session) so the API can
   scale horizontally. Think about what the index looks like *before* writing
   the query.
4. **Security and UX are the top priorities** — security: nothing sensitive in
   responses, generic auth failures, httpOnly cookies, rate-limited credential
   endpoints, strict input validation. UX: error responses must be actionable
   (per-field validation details, correct status codes), reads fast (proper
   indexes, small payloads), and behavior predictable (trimmed/normalized
   input, consistent response shapes `{ user }`, `{ posts, nextCursor }`,
   `{ error, details? }`).

## Architecture snapshot

- Express 5 (async handlers auto-forward rejections — no try/catch wrappers in
  controllers), TypeScript strict mode, CommonJS modules.
- PostgreSQL via Prisma; schema at `prisma/schema.prisma`, shared client at
  `src/lib/prisma.ts`.
- Auth: JWT in an httpOnly `SameSite=Lax` cookie (Bearer header also accepted).
  `requireAuth` middleware at `src/middleware/auth.ts` attaches `req.user`.
- Global error handler (`src/middleware/error.ts`): throw `HttpError(status, msg)`
  from anywhere; `ZodError` → 400 with per-field details; anything else → logged,
  generic 500. Never send error responses manually from services.

## The five-file module pattern

Every domain lives in `src/modules/<name>/` with exactly these files:

| File | Owns | Does not own |
|------|------|--------------|
| `<name>.route.ts` | Router wiring, per-route middleware (requireAuth, validate, rate limits) | Logic |
| `<name>.controller.ts` | HTTP in/out: parse query params, call service, set cookies, send JSON | Business rules, DB access |
| `<name>.service.ts` | Business logic, all Prisma calls, throws `HttpError` | req/res objects |
| `<name>.validation.ts` | Zod schemas (trim, normalize, cap lengths) | — |
| `<name>.interface.ts` | TypeScript interfaces for inputs/outputs | — |

Plus `<name>.test.ts` in the same directory (see Verification).

Wire new routes in `src/app.ts` under `/api/<name>`. Cross-cutting code
(middleware, token helpers, HttpError) stays in `src/middleware/` and
`src/utils/` — modules may import from other modules' services when needed
(e.g., users reuses `toPublicUser` from auth).

## Conventions that are easy to miss

- **Validation**: body validation via the `validate(schema)` middleware
  (replaces `req.body` with parsed output). Query params are parsed inside the
  controller with `schema.parse(req.query)` because Express 5's `req.query` is
  a read-only getter. Use `z.strictObject` for update endpoints so unknown
  fields (e.g., smuggled `email`) are rejected, not silently dropped.
- **Authorization is structural**: writes target `req.user.id` from the
  verified JWT — never accept a user id from the body or URL for a write. For
  owned resources, the service checks ownership and throws `HttpError(403, ...)`.
- **No user enumeration**: login-style failures return one generic message;
  rely on DB unique constraints (catch Prisma `P2002`) instead of
  check-then-insert.
- **Responses never include `passwordHash`** — map through a public-user shape.
- **Pagination**: cursor-based (`WHERE id < cursor`, BigInt PK) for deep/
  infinite lists like the feed; offset + `meta {page, limit, total, totalPages}`
  for shallow directories like users. Cap `limit` at 50 via Zod (reject, don't
  clamp). Serialize BigInt ids with `.toString()`.
- **Schema changes**: edit `prisma/schema.prisma`, run
  `npx prisma migrate dev --name <change>`. snake_case column names via `@map`,
  timestamptz timestamps, indexes designed for the query that will read them.

## Verification loop (run for every change)

A change is not done until all of these pass. Run them in this order — each
step catches what the previous can't.

1. **Integration tests** — extend or add `<name>.test.ts` (Vitest + Supertest
   against the real `app` and database, no mocks). Conventions:
   - Test emails use a module-unique prefix `test_<module>_` so suites clean up
     independently; delete them in `afterAll` via `prisma.user.deleteMany` and
     call `$disconnect`.
   - Cover the happy path, each 4xx (401 unauthenticated, 400 validation with
     field names, 404, 409 where relevant), persistence checked at the DB
     level, and the security cases (no hash in responses, ownership isolation).
   - The auth rate limiter is skipped when `NODE_ENV=test` — Vitest sets that.
   - Run `npm test`; everything must pass.
2. **Build** — `npm run build` (tsc strict; `*.test.ts` is excluded from the
   build, so test-only type errors surface in `npm test`, build errors here).
3. **Postman collection** — update
   `postman/buddy-script-server.postman_collection.json` whenever endpoints
   change: add requests with test scripts (status + body assertions), keep the
   collection runnable top-to-bottom (auth cookie flows via the cookie jar;
   Register saves `userId`/`email` collection variables; negative auth checks
   live after Logout). Verify with:
   `npx --yes newman run postman/buddy-script-server.postman_collection.json`
   against a running server (`npm start` in background). Zero failed assertions.
4. **Cleanup** — delete rows the newman run created (`user_*@example.com`
   pattern), stop the background server.
5. **Docs** — update `README.md`: the API table for endpoint changes, the
   structure tree for new files, and the design-decision sections when a
   choice deserves a recorded rationale (it's part of the deliverable).
6. If the user keeps a copy of the collection on the Desktop, refresh it after
   collection changes.

## Definition of done

`npm test` green · `npm run build` clean · newman 0 failures · README current ·
test data cleaned up. Report results plainly, including anything that failed.
