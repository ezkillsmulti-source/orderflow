# Architecture

OrderFlow currently has one NestJS REST API and one PostgreSQL database. It is a
modular monolith: one process, with explicit module dependencies and no generic
repository layer or shared workspace package.

## Current modules

- `AppModule` composes configuration, health, authentication, and products.
- `ConfigModule` validates the database URL and API port, exposing one configuration
  provider. Invalid configuration prevents startup; values are not printed.
- `DatabaseModule` owns one Prisma client and its PostgreSQL driver adapter. The
  pool is lazy: an unavailable database does not prevent liveness from starting.
  Nest shutdown hooks disconnect the client and release the adapter's pool.
- `HealthModule` exposes two public health routes, outside the session pipeline.
- `SessionModule` provides express-session with a PostgreSQL store for non-health
  routes. It manages bounded expired-session/limiter cleanup and closes its separate,
  bounded pool on shutdown. Configuration and lifetimes are in [ADR 0004](decisions/0004-session-authentication.md).
- `AuthModule` installs session loading before origin/CSRF/shared-admission checks,
  exposes CSRF/login/me/logout, and registers a default authentication guard followed by a role guard.
  Routes can declare explicit allowed roles through `@Roles`; the role guard uses
  only the freshly authenticated identity and runs before controllers or services.
  Routes without role metadata retain their existing authentication policy.
  Protected routes read current User status and role. A fixed-response exception
  filter prevents parser and infrastructure details from echoing input or being logged.

`GET /health/live` returns HTTP 200 and `{"status":"ok"}` without accessing the
pool. `GET /health/ready` runs `SELECT 1` through Prisma and returns the same success
body, or HTTP 503 with `{"status":"not_ready"}`. The response contains no database
errors or configuration. Readiness checks connectivity, not migration currency;
apply migrations before serving the application.

The readiness deadline is 1.5 seconds; pool connection acquisition, driver query
waiting, and PostgreSQL statement execution each have a 1-second timeout. Timer
scheduling can add small delays under load. Concurrent probes share one pending
query and one deadline. After timeout, later probes reuse the settled failure
result until that query settles; they do not attach more observers or start more
queries. A completed query permits the next probe, allowing recovery. This bounds
pending database work and retained observers during outages. These small pool
settings are for the foundation; assess capacity when business requests exist.

## Persistence boundary

The existing `Product` table supports the implemented backend catalog. It has UUID
identifiers, case-sensitive unique SKUs, nullable descriptions, bounded `BIGINT` prices
in ARS minor units, active status, and timezone-aware timestamps. Prisma generates UUIDs
and updates `updatedAt`; direct SQL writers must supply IDs and update timestamps. The
SQL migration adds the price check constraint that Prisma schema syntax cannot
represent. Future migrations must preserve it.

The User table adds UUID identities, normalized unique emails, password hashes,
explicit ADMIN/OPERATOR roles, active status, and timestamps. The email policy and
database constraints are recorded in [ADR 0003](decisions/0003-user-accounts.md).
Hashes remain internal; authentication responses expose only ID, email, and role.

`PasswordService` is a small internal class using Argon2id through node-argon2.
The explicit provisioning CLI uses Prisma directly and imports the shared email
and password rules; it does not start Nest or listen on a port. One serializable
transaction creates or validates the two development accounts. Its only result is
created/unchanged counts. There is no generic user repository or additional service
process. The auth module uses direct Prisma access and the same password rules.

Sessions use express-session identifiers/signatures and connect-pg-simple storage.
csrf-sync binds tokens to session state. rate-limiter-flexible uses atomic shared
PostgreSQL counters for source/account login limits and global admission. Automatic
table creation and unbounded library cleanup are disabled; migrations create both
tables. Store/counter failures return sanitized 503 with no in-memory fallback.

`ProductsModule` composes a focused controller/service with DatabaseModule. The
controller validates bodies, path IDs, and original query strings, enforces wire
encoding, and maps products to explicit JSON responses. Main enables Nest rawBody
capture so invalid UTF-8 cannot be silently replaced before validation. Raw bytes
are request-local and never logged or returned. Custom test applications exercising
catalog writes must also enable rawBody=true.

ProductsService uses DatabaseService directly; PostgreSQL arbitrates SKU races.
There is no repository abstraction. Monetary strings are validated before BigInt
conversion and serialized explicitly. Catalog error types permit fixed conflict
and availability messages without changing authentication contracts. Unrecognized
failures remain sanitized 500.

ProductsService edits with an atomic id/active=true predicate and returned row, and
archives only active rows. A repeated archive reads the existing row without updating
timestamps. Submitted fields use last-write-wins; optimistic locking is not implemented.
These single-row writes need no explicit multi-statement transaction. No prior migration
changes or new migration are required.

The backend catalog and role authorization are implemented. Order ownership checks
remain pending. See the [catalog contract](product-catalog.md). There is no inventory,
orders, Redis, or worker. Future business features remain governed by the
[product scope](product-scope.md). See the
[decisions](decisions/0001-backend-foundation.md) for runtime, schema, and serialization
choices.

## Web application

apps/web adds a React/Vite application with strict TypeScript and plain CSS. Vite's
local /api proxy preserves Origin and cookie attributes; the API continues to enforce
authentication, roles, CSRF, and trusted origins. SessionClient owns memory-only CSRF and session identity. Epochs and AbortController
prevent stale requests from restoring old account data. React subscribes through
useSyncExternalStore; no global state framework or token persistence is used.
Login/logout, catalog listing/detail reads, and administrator catalog forms are implemented.
The [workspace design](ui-design.md) uses CSS tokens and small shared presentation
components, keeping full-page detail/forms and one native archive dialog. Query-only
navigation retains control focus; page navigation focuses the destination heading.
Hash navigation
keeps browser history without an extra router dependency. Read effects ignore
results after unmount; session boundaries additionally reject stale requests.
Monetary JSON strings are validated and formatted with bigint quotient/remainder,
never Number division. Form prices use ungrouped decimal text with a dot and at most
two fractional digits, converted using bigint. Client validation improves feedback;
the backend remains authoritative for permissions, validation, SKU uniqueness, and
active-only updates. PATCH sends only normalized changed fields. There is no
optimistic locking. Confirmed writes navigate to or reload fresh server data.

403 responses revalidate identity without assuming CSRF expiry or replaying the
request. Mutations that lose their response report an uncertain outcome, preserve
form input, and require deliberate action. Requests have a 15-second timeout;
timeouts cannot prove whether a write committed. Native modal dialogs confirm
archival and restore focus on cancellation. React renders product text, never HTML.

Root formatting/lint/typecheck/unit/build checks include the web package. Playwright
uses the real API and a random, migrated PostgreSQL database with ephemeral accounts;
its runner cleans up children and the database on success or failure. CI retains the
backend checks and adds Chromium installation and browser workflows. Production web
hosting and reverse-proxy configuration remain planned.
