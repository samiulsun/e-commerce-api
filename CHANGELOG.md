# Changelog

All notable changes to this project are documented here — one entry per merged
phase, including decisions taken where the requirements left room.

## [v0.2] — Phase 2: Products & Categories

### Added

- `GET /products` — public: `skip`/`take` pagination (`take` capped at 100,
  default 20), `q` ILIKE search over name/description/sku, `categoryId`,
  `minPrice`/`maxPrice` (integer cents) filters. Returns
  `{ data, total, skip, take }` with each product's category.
- `GET /products/:id` — public; 404 for missing or soft-deleted products.
- `POST /products` and `PATCH /products/:id` (ADMIN); unknown `categoryId`
  -> 404, duplicate `sku` -> 409.
- `DELETE /products/:id` (ADMIN) — soft delete only (`isActive = false`),
  because OrderItem rows must keep referencing the product.
- Categories CRUD: public reads; ADMIN writes; deleting a category that still
  has products returns 409.
- Unit tests: `ProductsService` (11 cases: pagination/search/filter/CRUD/
  soft-delete) and `CategoriesService` (7 cases). E2E suite (16 cases)
  covering the 401/403 role gates, validation, soft-delete hiding and
  duplicate conflicts.

### Decisions

- List responses use the `{ data, total, skip, take }` envelope — products
  first, to be reused by orders in later phases.
- `q` matches name, description and sku with case-insensitive `contains`
  (Postgres ILIKE through Prisma `mode: 'insensitive'`).
- `PATCH /products/:id` can update inactive products (admins can edit or
  reactivate); public reads still hide them.
- Category deletion is hard but guarded with a 409 pre-check, matching the
  database FK restriction with a clearer message.
- Public product routes are marked `@Public()` explicitly; everything else
  stays behind the global JWT guard.

### Verified

- `npm run test` — 29/29 pass; `npm run test:e2e` — 26/26 pass; build and
  lint clean.

## [v0.1] — Phase 1: Auth

### Added

- `POST /auth/signup` (bcrypt cost 12, role `USER`), `POST /auth/login` and
  `POST /auth/refresh` with refresh-token rotation. Access JWT ~15 min,
  refresh JWT 7 days.
- `JwtStrategy` + global `JwtAuthGuard` (routes opt out with `@Public()`),
  global `RolesGuard` + `@Roles(...)` decorator.
- `GET /users/me` protected route returning the safe user projection.
- Rate limiting via `@nestjs/throttler`: global 100 req/min; 5 req/min on
  `/auth/signup` and `/auth/login`.
- `userSafeSelect` Prisma projection — `passwordHash` can never leave the API.
- Unit tests for `AuthService` (10 cases) and an auth e2e flow (8 cases),
  including rotated-token reuse rejection and the standard error shape.

### Decisions

- Refresh tokens are stored as SHA-256 digests rather than bcrypt: bcrypt
  truncates input at 72 bytes, so two rotated JWTs sharing a prefix would be
  indistinguishable. A digest mismatch clears the stored session.
- Login answers 401 `"Invalid email or password"` for both unknown emails and
  wrong passwords (no account enumeration).
- One private `issueTokens` helper means signup/login/refresh all persist the
  new refresh digest atomically with issuance.
- `@nestjs/jwt` pinned to 11.x and `@nestjs/passport` to 11.x (the 12.x lines
  are ESM-only and incompatible with Jest's CJS runtime on Node 22).
- Global `ValidationPipe` runs with `transform: true` so DTO/query coercion
  applies consistently.

### Verified

- `npm run test` — 11/11 pass; `npm run test:e2e` — 10/10 pass (schema reset
  of `ecom_test` exercised); `npm run build` and `npm run lint` clean.

## [v0.0] — Phase 0: Scaffold

### Added

- NestJS 11 scaffold (npm, strict TypeScript) with Jest + Supertest defaults.
- Prisma 6 schema for the full data model: `User`, `Category`, `Product`,
  `Cart`, `CartItem`, `Order`, `OrderItem`, `Payment`; initial migration
  (`20261008193632_init`).
- `docker-compose.yml` (`postgres:16-alpine`) plus `docker/initdb` provisioning
  the isolated `ecom_test` database used by the e2e suite.
- `.env.example` and `.env.test`; environment validation
  (`src/config/env.validation.ts`) fails fast when `DATABASE_URL` or the JWT
  secrets are missing.
- Global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`)
  and a global exception filter emitting `{ statusCode, message, error }`
  (Prisma P2002/P2025/P2003 are mapped to 409/404/409).
- Swagger UI + OpenAPI document at `/api/docs` (`/api/docs-json`).
- `GET /health` liveness endpoint.
- Prisma seed: one admin (`admin@example.com` / `Admin123!`), one customer
  (`user@example.com` / `User123!`), both bcrypt-hashed at cost 12; 3
  categories; 10 products.
- E2E infrastructure: `.env.test` loaded into every worker, `ecom_test`
  schema reset before the run (`test/global-setup.ts`), serial workers.

### Decisions

- IDs use `cuid()`; every money field is an `Int` (cents) — no floats anywhere.
- `User.refreshTokenHash String?` added to the mandated model: the auth phase
  requires the refresh token to be stored hashed in the database.
- `Payment.status` is an enum: `PENDING | SUCCEEDED | FAILED`.
- Pinned Prisma to the 6.19.x line: 7.x changes the client generator and 8.x
  is still an RC; 6.19 supports the interactive transactions and isolation
  levels the stock-decrement guarantee relies on.
- Pinned `@nestjs/config` to 4.x: 12.x is ESM-only and cannot be `require()`d
  by Jest 30 in CJS mode on Node 22. (`@nestjs/jwt`/`@nestjs/passport` are
  likewise pinned to CJS-compatible majors in later phases.)
- This machine cannot run Docker (no WSL2 feature, Docker Desktop service
  needs admin), so `scripts/embedded-db.mjs` runs real PostgreSQL 17.10
  binaries as the current user (`npm run db:start[:detached]`). The compose
  stack remains the canonical local-dev path; migrations, seed and all tests
  run against real PostgreSQL in both paths.
- Added `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL` and `PORT` beyond the five
  required env vars.
- Replaced the template hello-world route with `GET /health`; `AppService`
  removed accordingly.

### Verified

- `npm run test` — 1/1 pass; `npm run test:e2e` — 2/2 pass (`ecom_test`
  reset exercised); `npm run build` clean; `npm run lint` clean.
- `npm run start:dev` boots, connects to PostgreSQL, `/health` returns
  `{"status":"ok"}`, Swagger UI responds 200.
- `npm run seed` completes: 2 users, 3 categories, 10 products.
