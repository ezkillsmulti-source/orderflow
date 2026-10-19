# OrderFlow

OrderFlow is a planned application for small businesses to manage products, inventory,
and orders. The backend foundation is implemented: a NestJS API, PostgreSQL/Prisma
schema and initial migration, health routes, automated tests, and a GitHub Actions
workflow. User persistence with normalized unique emails and ADMIN/OPERATOR roles,
Argon2id password hashing, and explicit development account provisioning are
implemented. Session login/identity/logout, PostgreSQL-backed sessions, CSRF protection,
and shared login throttling are implemented. The backend catalog implements product
creation, listing, detail reads, editing, and archiving with current-role authorization.
The React/Vite application in `apps/web` implements login, identity restoration,
logout, product browsing/detail reads, and administrator creation, editing, and
archival. Both roles can read archived products. Inventory and orders remain planned.
Milestone 3 implements a warm burgundy product workspace with clear filters,
role-aware actions, grouped forms, and responsive keyboard-accessible browsing.
Inventory and later milestones remain planned. See the [UI design guide](docs/ui-design.md).
See the [frontend startup instructions](docs/development.md#react-frontend).

## Local setup

Requirements: Node.js **24.22.0 LTS**, pnpm **10.34.7**, and Docker with Compose v2
supporting `up --wait`. See [development](docs/development.md) for installing the
pinned toolchain and configuration details. From the repository root:

```bash
test -e .env || cp .env.example .env
# Replace the local database password and generate SESSION_SECRET as documented.
pnpm install --frozen-lockfile
docker compose up -d --wait postgres
pnpm db:generate
pnpm db:migrate
pnpm dev
```

Start the frontend in another terminal and open http://127.0.0.1:5173:

```bash
pnpm dev:web
```

Include `http://127.0.0.1:5173` in AUTH_TRUSTED_ORIGINS and provision development
accounts as described below. The Vite proxy is for development, not production hosting.
To check API health:

```bash
curl --fail http://127.0.0.1:3000/health/live
curl --fail http://127.0.0.1:3000/health/ready
```

Both return `{"status":"ok"}` with HTTP 200 when PostgreSQL is available.
Readiness returns HTTP 503 and `{"status":"not_ready"}` when PostgreSQL is
unavailable; liveness stays independent. Use Ctrl-C to stop the API. For compiled
execution, run `pnpm build` then `pnpm --filter @orderflow/api start`.

To provision development users, configure NODE_ENV=development, DEV_ADMIN_EMAIL,
DEV_ADMIN_PASSWORD, DEV_OPERATOR_EMAIL, and DEV_OPERATOR_PASSWORD locally, then
run `pnpm users:provision:dev` after migrations. See the [manual provisioning
procedure](docs/development.md#development-account-provisioning) for credential
handling, repeat behavior, and conflicts. Provisioning is never automatic.

Authentication endpoints are `GET /auth/csrf`, `POST /auth/login`, `GET /auth/me`,
and `POST /auth/logout`. Follow the [API contract and curl walkthrough](docs/development.md#authentication-api)
to use cookies, trusted Origin, and session-bound CSRF tokens. Sessions expire
after 30 idle minutes or eight hours total and work across configured API instances.
All instances must share PostgreSQL and SESSION_SECRET.

## Verification

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm --filter @orderflow/web browser:install
pnpm test:browser
```

Integration checks require TEST_DATABASE_ADMIN_URL from `.env` and create/drop a
random database on the dedicated local PostgreSQL server. They never use the
application database. See [development](docs/development.md) for isolation,
migrations, shutdown, and troubleshooting. CI runs these checks on pull requests
and pushes to `main`; adding the workflow does not imply a hosted run has passed.

## Scope and documents

There is no public registration, password recovery, production account
provisioning, inventory, ordering, Redis, worker, or deployment yet. Catalog endpoints
enforce ADMIN writes and ADMIN/OPERATOR reads, including archived products. Order
ownership authorization remains pending. See the [catalog
contract](docs/product-catalog.md). React/Vite and Chromium browser tests are implemented. Background processing will
be added only when needed.

- [Product scope and business rules](docs/product-scope.md)
- [Roadmap and current progress](docs/roadmap.md)
- [Current architecture](docs/architecture.md)
- [Development workflow](docs/development.md)
- [Architecture decisions](docs/decisions/0001-backend-foundation.md)
- [Contributing](CONTRIBUTING.md)
- [Instructions for coding agents](AGENTS.md)

The backend supports validated primary product image upload/replacement/removal,
private authenticated variant reads, recoverable cleanup, and image metadata in
catalog responses. Image UI remains pending; see the
[catalog contract](docs/product-catalog.md) and
[storage ADR](docs/decisions/0005-product-image-storage.md).
