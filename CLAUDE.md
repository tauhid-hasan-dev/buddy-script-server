# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Express 5 + TypeScript (strict, CommonJS) + PostgreSQL (Prisma) social-feed API: JWT auth via httpOnly cookies, posts with image uploads to Supabase Storage, likes, one-level-nested comments, cursor-paginated feed. The database is remote Supabase Postgres — there is no local DB; tests and dev both hit it (config in `.env`).

**For any feature/endpoint/module/middleware change, use the `feature-workflow` skill** (`.claude/skills/feature-workflow/SKILL.md`). It defines the module pattern, security conventions, and the mandatory verification loop (tests → build → newman → README). Don't skip it for "small" changes.

## Commands

```bash
npm run dev          # tsx watch → http://localhost:5000
npm test             # Vitest + Supertest integration tests (needs DB; no mocks)
npx vitest run src/modules/posts/posts.test.ts   # single test file
npm run build        # tsc strict (excludes *.test.ts)
npm run typecheck    # tsc --noEmit
npm run db:migrate   # prisma migrate dev (uses DIRECT_URL, session pooler)
npm start            # run compiled dist/server.js
```

Tests run files serially (`fileParallelism: false` in `vitest.config.mts`) with 30s timeouts because of the remote DB — don't "fix" slow tests by parallelizing. Each test suite uses a `test_<module>_` email prefix and cleans up its own rows in `afterAll`. The auth rate limiter is disabled when `NODE_ENV=test`.

Postman/newman verification (after endpoint changes):
```bash
npx --yes newman run postman/buddy-script-server.postman_collection.json
```
against a running server, then delete the `user_*@example.com` rows it creates.

## Architecture

Request flow: `app.ts` (helmet, CORS locked to `CLIENT_URL`, 100kb JSON cap) → module router → per-route middleware (`requireAuth`, `validate(schema)`, upload) → controller → service → Prisma.

- **Five-file modules** in `src/modules/<name>/`: `route` (wiring + middleware), `controller` (HTTP in/out only), `service` (all business logic and Prisma calls, throws `HttpError`), `validation` (Zod), `interface` (types) — plus `<name>.test.ts`. New modules get wired in `src/app.ts` under `/api/<name>`.
- **Error handling is centralized** (`src/middleware/error.ts`): throw `HttpError(status, msg)` from services; `ZodError` → 400 with per-field details; everything else → generic 500. Express 5 auto-forwards async rejections, so controllers have no try/catch. Never send error responses from services.
- **Validation split**: request bodies go through the `validate(schema)` middleware; query params are parsed in the controller with `schema.parse(req.query)` because Express 5's `req.query` is read-only. Update endpoints use `z.strictObject` so unknown fields are rejected.
- **Auth**: `requireAuth` (`src/middleware/auth.ts`) accepts the `token` cookie or a Bearer header and attaches `req.user`. Writes always target `req.user.id` — never a user id from body/URL. Ownership violations → 403; private posts viewed by others → 404 (existence must not leak).
- **IDs and pagination**: `users.id` is UUID; `posts.id`/`comments.id` are BigInt identities — serialize with `.toString()` in DTOs. Deep lists (feed, comments) use cursor pagination (`WHERE id < cursor`, capped limit ≤ 50, rejected not clamped); shallow lists (users, likers) use offset + `meta`. Indexes in `prisma/schema.prisma` are designed for these exact queries — check them before changing a read path.
- **Likes** are join tables with composite PKs (`(post_id, user_id)`), idempotent endpoints, and `likedByMe` fetched as a filtered relation in the same query (no N+1).
- **Storage** is optional config: without `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, the API boots fine and image uploads return 503. Uploads are in-memory buffers, stored under random UUID names; a failed DB insert removes its just-uploaded object.
- **Schema changes** only via `prisma migrate dev --name <change>` — never manual DDL. Columns are snake_case via `@map`, timestamps are timestamptz.

## Security invariants (don't regress)

Responses never include `passwordHash`; login failures are generic and enumeration-safe (dummy-hash compare); duplicate emails rely on the DB unique constraint (catch Prisma `P2002`), not check-then-insert; register/login are rate-limited; bcrypt cost 12 with 72-byte password cap.

README.md is part of the deliverable: its API table, structure tree, and design-rationale sections must be updated alongside endpoint or schema changes.
