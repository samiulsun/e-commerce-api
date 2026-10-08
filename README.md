# E-Commerce API

A production-style e-commerce REST API built with **NestJS**, **Prisma ORM**,
**PostgreSQL** and **Stripe** (test mode). Authentication via Passport + JWT
(access + refresh rotation), Stripe Payment Intents + verified webhooks, and
integer-cents money handling throughout.

- API docs (Swagger UI): `http://localhost:3000/api/docs` (OpenAPI JSON: `/api/docs-json`)
- Postman collection: [`postman/e-com-api.postman_collection.json`](postman/e-com-api.postman_collection.json)
- Phase-by-phase decisions: [`CHANGELOG.md`](CHANGELOG.md)

## Features

| Endpoint | Method | Access | Description |
|---|---|---|---|
| `/health` | GET | public | Liveness probe |
| `/auth/signup` | POST | public (rate-limited) | Create account (role `USER`), returns token pair |
| `/auth/login` | POST | public (rate-limited) | Log in, returns token pair |
| `/auth/refresh` | POST | public | Rotate the refresh token (old token is invalidated) |
| `/users/me` | GET | user | Current profile (`passwordHash` never leaves the API) |
| `/categories` | GET | public | List categories |
| `/categories/:id` | GET | public | Category by id |
| `/categories` | POST | ADMIN | Create category |
| `/categories/:id` | PATCH / DELETE | ADMIN | Update / delete empty category |
| `/products` | GET | public | Paginated list (`skip`,`take`), `q` search, `categoryId`, `minPrice`, `maxPrice` (cents) |
| `/products/:id` | GET | public | Product with category (hidden after soft delete) |
| `/products` | POST | ADMIN | Create product |
| `/products/:id` | PATCH / DELETE | ADMIN | Update / **soft-delete** (`isActive=false`, row never removed) |
| `/cart` | GET | user | Your cart (created lazily) with line totals + subtotal |
| `/cart/items` | POST | user | Add product — increments existing line, rejects over stock with 400 |
| `/cart/items/:id` | PATCH / DELETE | user | Change quantity (stock-checked) / remove line |
| `/cart` | DELETE | user | Clear cart |
| `/checkout` | POST | user | Server-side checkout: PENDING order + price snapshots + Stripe PaymentIntent; returns `clientSecret` |
| `/orders` | GET | user | Your orders (paginated) |
| `/orders/:id` | GET | user | Your order with snapshots + payment state |
| `/payments/webhook` | POST | public (signature-verified) | Stripe events: mark PAID + decrement stock + clear cart, or mark FAILED |

**Auth:** all routes except `@Public()` ones require `Authorization: Bearer <accessToken>`.
Admin routes additionally require the `ADMIN` role (403 otherwise).

**Stock rule:** stock is decremented in exactly one place — the
`payment_intent.succeeded` webhook transaction, guarded atomically
(`stock >= quantity`), so two simultaneous “last unit” checkouts can never
both succeed.

## Tech stack

NestJS 11 (strict TypeScript) · Prisma 6 + PostgreSQL 16+ · Passport/JWT ·
bcrypt · Stripe SDK 23 · class-validator/transformer · @nestjs/swagger ·
@nestjs/throttler · Jest + Supertest

## Prerequisites

- **Node.js ≥ 22** and npm
- **PostgreSQL** — either via Docker (recommended) or the bundled embedded fallback (see below)

## Quick start

### 1. Database

**Option A — Docker (canonical):**

```bash
docker compose up -d          # postgres:16 on localhost:5432, user/pass ecom
```

**Option B — no Docker? (embedded PostgreSQL):**

Machines without Docker/WSL2 get a real PostgreSQL server from bundled
binaries, run as your user:

```bash
npm run db:start:detached     # or: npm run db:start (foreground)
```

Both options provision the `ecom` database plus the isolated `ecom_test`
database used by the e2e suite.

### 2. Environment

```bash
cp .env.example .env
# fill in JWT secrets; optionally STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET
npm install
```

### 3. Migrate + seed + run

```bash
npm run migrate        # prisma migrate dev (applies prisma/migrations)
npm run seed           # admin@example.com / Admin123!, user@example.com / User123!,
                       # 3 categories, 10 products
npm run start:dev      # http://localhost:3000/api/docs
```

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | yes | — | `postgresql://ecom:ecom@localhost:5432/ecom?schema=public` |
| `JWT_ACCESS_SECRET` | yes | — | Signs access tokens |
| `JWT_REFRESH_SECRET` | yes | — | Signs refresh tokens |
| `JWT_ACCESS_TTL` | no | `15m` | Access token lifetime |
| `JWT_REFRESH_TTL` | no | `7d` | Refresh token lifetime |
| `STRIPE_SECRET_KEY` | no* | — | Stripe (test mode) secret key; without it `/checkout` answers 503 |
| `STRIPE_WEBHOOK_SECRET` | no* | — | Verifies webhook signatures (`whsec_...` from `stripe listen`) |
| `PORT` | no | `3000` | HTTP port |

`*` The API boots without Stripe keys; the e2e suite overrides the Stripe
provider with a mock, so it runs offline (signatures are still verified with
the SDK against `STRIPE_WEBHOOK_SECRET`).

## Testing

```bash
npm test            # unit tests (Jest, no database needed)
npm run test:e2e    # e2e (Supertest): resets the ecom_test schema first
```

The e2e suite requires the database running (`docker compose up -d` or
`npm run db:start:detached`). It creates its own users/products/orders and
never touches the development database.

From a clean checkout:

```bash
npm ci && npm run migrate && npm run seed && npm test && npm run test:e2e
```

## Exercising the Stripe flow (test mode)

1. **Set your test key** in `.env`: `STRIPE_SECRET_KEY=sk_test_...`
   (from <https://dashboard.stripe.com/test/apikeys>).

2. **Forward webhooks locally** with the [Stripe CLI](https://stripe.com/docs/stripe-cli):

   ```bash
   stripe listen --forward-to localhost:3000/payments/webhook
   # prints: whsec_xxxxxxxxxxxxxxxxxxxxxxxx  -> set this as STRIPE_WEBHOOK_SECRET
   ```

3. **Restart the API** (`npm run start:dev`) so it picks up the keys.

4. **Flow:** sign up → add products to cart → `POST /checkout` (returns
   `client_secret`) → confirm the PaymentIntent with any test card. The
   webhook then marks the order `PAID`, decrements stock and clears the cart.
   Trigger it with the Stripe CLI too:

   ```bash
   stripe trigger payment_intent.succeeded
   ```

5. **Test cards** (any future expiry & CVC work):

   | Card | Result |
   |---|---|
   | `4242 4242 4242 4242` | Payment succeeds |
   | `4000 0000 0000 0002` | Payment is declined (`payment_intent.payment_failed`) |
   | `4000 0000 0000 9995` | Insufficient funds (failed event) |
   | `4000 0000 0000 3220` | 3-D Secure required (needs `stripe listen` to confirm) |

   Confirming the PaymentIntent from a client library triggers the webhook;
   for a quick curl-style check you can also use the CLI:
   `stripe payment_intents confirm pi_... --payment-method="pm_card_visa"`.

## Money and IDs

- Every monetary value is an **integer in cents** — no floats anywhere.
- Product prices are snapshotted into `OrderItem.priceAtPurchaseCents` at
  checkout; later price changes never rewrite order history.
- `Order.status`: `PENDING → PAID | FAILED` (webhook-driven);
  `Payment.status`: `PENDING → SUCCEEDED | FAILED`.

## Project structure

```
src/
  auth/          signup/login/refresh, JWT strategy, token hashing
  users/         safe user projection, /users/me
  common/        guards (JwtAuth, Roles, Throttler), decorators, exception filter
  config/        env validation
  prisma/        PrismaService + global module
  products/      products (pagination/search/filters, soft delete)
  categories/    categories CRUD
  cart/          lazy cart, upsert lines, stock checks
  orders/        checkout + orders (snapshots, PaymentIntent)
  payments/      StripeService, webhook verification + transaction handling
prisma/          schema, migrations, seed
scripts/         embedded-postgres runner (no-Docker fallback)
test/            jest e2e setup + per-feature suites
```

## Design decisions

Every ambiguous requirement was resolved with a documented decision — see
`CHANGELOG.md` (e.g. SHA-256 digests for refresh tokens, webhook
idempotency, rollback-on-stock-conflict behaviour, entity shapes). The repo
history is organized in phase branches merged with `--no-ff` and tagged
`v0.0` … `v1.0`.