# Roadmap

Milestone 1 delivered the backend foundation. Milestone 2 has accounts, sessions,
role authorization, the backend catalog, and the React authentication/catalog UI.
Administrator forms and real-API browser workflows are implemented; the development
guide records verification separately from production deployment. The [product scope](product-scope.md)
remains the source of business rules.

## 1. Reproducible backend foundation

Implemented: a pinned pnpm workspace, NestJS API with validated environment
configuration, liveness and bounded PostgreSQL readiness checks, graceful shutdown,
Prisma schema and initial constrained Product migration, local PostgreSQL Compose,
unit/HTTP and isolated real-database integration tests, and a CI workflow.

The [development guide](development.md) defines setup and checks and includes a
dated verification record. Isolated Docker Compose startup, volume persistence
across container recreation, cleanup, and a hosted backend CI run have passed;
the guide links the specific CI run, and PR checks show results for later commits.
That foundation increment did not include frontend, authentication, business endpoints,
Redis, or a worker; the catalog increment below adds authentication and products.

## 2. Authenticated product catalog

Implemented groundwork: User persistence, explicit ADMIN/OPERATOR roles, normalized
email uniqueness, Argon2id password hashing, and explicit development provisioning,
PostgreSQL-backed sessions with idle/absolute expiry, CSRF/origin protection,
login/me/logout endpoints, current-user authentication, and shared login throttling.
Current-role authorization and catalog creation, listing, detail reads, editing, and
archiving are implemented. The React/Vite UI supports login/logout, identity restoration,
read-only browsing for both roles, and administrator create/edit/archive workflows.
Browser tests cover desktop/mobile Chromium with the real API and isolated PostgreSQL.
Order ownership authorization, inventory, production account provisioning, and hosting
remain pending. The
[catalog contract](product-catalog.md) records the approved policies. Use ARS integer
minor units with the documented numeric bounds and exact arithmetic; zero initial stock
remains a requirement for the later inventory implementation.

Completion: provisioned users can demonstrate their permitted catalog actions;
backend tests cover session rotation, logout invalidation, CSRF rejection,
production cookie requirements, role denials, unique SKUs, archiving, numeric
bounds, and price validation. Lists use bounded, deterministic pagination. A
browser test demonstrates the authenticated catalog workflow.

## 3. Accountable inventory

Deliver available-stock visibility and administrator adjustments using signed
integer deltas, non-empty reasons, and authenticated actors. Select the
adjustment-history interface and access policy.

Completion: a user can demonstrate an adjustment and inspect its recorded reason
and actor through the agreed interface. Backend tests verify authorization,
attribution, atomic records and stock changes, numeric bounds, and rejection of
changes that would reduce on-hand stock below reserved stock.

## 4. Orders and reservations — first-release behavior

Deliver orders with distinct active products, immutable item snapshots and totals,
atomic stock reservation, and the `RESERVED`/`CANCELLED` lifecycle. Implement
per-user creation idempotency, idempotent cancellation, ownership-filtered order
listing with bounded pagination, and order details. Administrators manage all
orders; operators view and cancel only their own.

Completion: all first-release acceptance criteria pass in the agreed test suite.
Database-backed tests exercise competing reservations, concurrent and repeated
cancellations, competing adjustments, duplicate creation retries, changed-content
conflicts, numeric overflow, and rollback on insufficient stock. Tests verify
operator ownership restrictions and pagination metadata. Browser tests demonstrate
the order creation and cancellation flow. Documentation explains the initial
lifecycle and its limitations; no exactly-once event delivery is promised.

## 5. Operable first release

Package the first-release behavior using Docker Compose and Nginx, and document
configuration, production session/cookie and proxy settings, migrations, logs,
health checks, backup/restore, and recovery. Resolve production account provisioning.

Completion: the documented deployment procedure works in a chosen demonstration
environment; smoke checks pass, a backup is restored successfully, and operational
limitations and actual verification evidence are recorded. Publish a deployment
URL only if a deployment exists. CI runs the relevant automated checks.

## 6. Reservation expiration and background processing

Agree an expiration policy, then introduce Redis, BullMQ, and a worker for the
concrete expiration workflow while retaining the modular monolith.

Completion: eligible orders expire according to policy; retries, duplicate delivery,
and races with cancellation have idempotent reservation-release effects. Tests
demonstrate this behavior, and worker failure/recovery procedures are documented
and exercised. Expiration states and policy remain unresolved until this milestone.

## 7. Payment integration

Choose a provider and define payment states and their relationship to reservation,
expiration, cancellation, and fulfillment before adding an integration.

Completion: a provider sandbox flow demonstrates the agreed payment lifecycle;
tests verify webhook authenticity, idempotent effects under duplicate delivery,
and relevant payment/order races. Provider selection, payment states, and their
business effects remain unresolved. No live-money capability is implied by a
sandbox demo.

## 8. Multi-tenant isolation

Define tenant ownership, membership, and access rules, then implement isolation.
These boundaries remain unresolved until this milestone.

Completion: separate tenants can demonstrate independent workflows, cross-tenant
access tests fail safely for every tenant-owned resource, and data migration and
operational procedures account for tenant boundaries.
