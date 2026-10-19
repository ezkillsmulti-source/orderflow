# Architecture

OrderFlow currently has one NestJS REST API and one PostgreSQL database. It is a
modular monolith: one process, with explicit module dependencies and no generic
repository layer or shared workspace package.

## Current modules

- `AppModule` composes configuration and health.
- `ConfigModule` validates the database URL and API port, exposing one configuration
  provider. Invalid configuration prevents startup; values are not printed.
- `DatabaseModule` owns one Prisma client and its PostgreSQL driver adapter. The
  pool is lazy: an unavailable database does not prevent liveness from starting.
  Nest shutdown hooks disconnect the client and release the adapter's pool.
- `HealthModule` exposes the only two HTTP routes.

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

The initial `Product` table is schema groundwork only. It has UUID identifiers,
case-sensitive unique SKUs, nullable descriptions, bounded `BIGINT` prices in ARS
minor units, active status, and timezone-aware timestamps. Prisma generates UUIDs
and updates `updatedAt`; direct SQL writers must supply IDs and update timestamps.
The SQL migration adds the price check constraint that Prisma schema syntax cannot
represent. Future migrations must preserve it.

The User table adds UUID identities, normalized unique emails, password hashes,
explicit ADMIN/OPERATOR roles, active status, and timestamps. The email policy and
database constraints are recorded in [ADR 0003](decisions/0003-user-accounts.md).
Hashes remain internal; no user HTTP representations exist.

There are no product endpoints, authentication endpoints, inventory, orders, frontend,
Redis, or worker. Future business features remain governed by the
[product scope](product-scope.md). See the [decisions](decisions/0001-backend-foundation.md)
for runtime, schema, and serialization choices.
