# Roadmap

This document defines deliverables and acceptance criteria, not release status.
[Project status](project-status.md) is authoritative for merged, branch-only and
pending work. [Product scope](product-scope.md) retains first-release business rules.

## 1. Reproducible backend foundation

Deliver pinned tooling, a modular NestJS API, PostgreSQL/Prisma migrations,
validated configuration, liveness/readiness, graceful shutdown and CI with isolated
database tests. Acceptance requires repeatable install/build/check commands,
migration compatibility and persistence across ordinary database restarts.

## 2. Authenticated product catalog

Deliver provisioned roles, Argon2id passwords, PostgreSQL session login/me/logout,
CSRF/origin protection and shared throttling. Add exact-money catalog APIs and
React login/browsing/ADMIN forms. Acceptance covers current-role authorization,
session rotation/invalidation, strict validation, duplicate SKUs, archiving,
bounded lists and real-API browser workflows.

## 3. Product workspace redesign

Scope change: the catalog workspace redesign precedes inventory; inventory and
subsequent milestones moved forward without dropping business requirements.
Deliver the warm burgundy, responsive, accessible working catalog with useful
empty/error/loading states, role-aware actions, forms and confirmation focus.
Acceptance includes ADMIN/OPERATOR workflows, desktop/narrow layouts, keyboard,
long content, maximum prices and actual contrast checks. Automated checks do not
replace manual accessibility review. See [UI design](ui-design.md).

## 4A. Product images

Deliver one optional primary image, authenticated thumbnail/detail access, validated
ADMIN add/replace/remove on active products and recoverable private storage cleanup.
Acceptance includes content/size/dimension limits, metadata stripping, image/archive/
cleanup races, failure recovery and real browser display/management. Gallery,
object storage and production hosting are separate decisions.

## 4B/4C. Accountable inventory

Deliver backend balances/history and a product-detail workspace with ADMIN
adjustments and both-role reads. New products start at zero; history records
signed delta, reason, actor and historical balance atomically with stock. Positive
stock blocks archive; correction uses compensating movements. Exact bounds,
retained idempotency keys, row-lock coordination, bounded cursor history and
uncertain-outcome recovery follow the [inventory contract](inventory.md) and
[ADR 0006](decisions/0006-inventory-ledger.md).

Acceptance requires a user to demonstrate adjustments and inspect attribution,
reason and balance through the UI. Tests cover authorization, atomicity, concurrent
decrements/overflow, rollback, duplicate keys and archival races. The UI must retain
uncertain operations for deliberate same-key retry and refresh current reads after
replay. Full milestone 4 acceptance also checks image/catalog/session regressions.
4C's local implementation is not a release on main; the status document records
its review/CI/manual acceptance work. Reservations remain milestone 5: until then
reserved is derived zero and available equals on-hand. Later adjustments must also
reject reductions below active reservations.

## 5. Orders and reservations — first-release behavior

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

## 6. Operable first release

Package the first-release behavior using Docker Compose and Nginx, and document
configuration, production session/cookie and proxy settings, migrations, logs,
health checks, backup/restore, and recovery. Resolve production account provisioning.

Completion: the documented deployment procedure works in a chosen demonstration
environment; smoke checks pass, a backup is restored successfully, and operational
limitations and actual verification evidence are recorded. Publish a deployment
URL only if a deployment exists. CI runs the relevant automated checks.

## 7. Reservation expiration and background processing

Agree an expiration policy, then introduce Redis, BullMQ, and a worker for the
concrete expiration workflow while retaining the modular monolith.

Completion: eligible orders expire according to policy; retries, duplicate delivery,
and races with cancellation have idempotent reservation-release effects. Tests
demonstrate this behavior, and worker failure/recovery procedures are documented
and exercised. Expiration states and policy remain unresolved until this milestone.

## 8. Payment integration

Choose a provider and define payment states and their relationship to reservation,
expiration, cancellation, and fulfillment before adding an integration.

Completion: a provider sandbox flow demonstrates the agreed payment lifecycle;
tests verify webhook authenticity, idempotent effects under duplicate delivery,
and relevant payment/order races. Provider selection, payment states, and their
business effects remain unresolved. No live-money capability is implied by a
sandbox demo.

## 9. Multi-tenant isolation

Define tenant ownership, membership, and access rules, then implement isolation.
These boundaries remain unresolved until this milestone.

Completion: separate tenants can demonstrate independent workflows, cross-tenant
access tests fail safely for every tenant-owned resource, and data migration and
operational procedures account for tenant boundaries.
