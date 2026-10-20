# Architecture

OrderFlow is a modular monolith: one NestJS API process, one PostgreSQL database
and a React frontend. Private image bytes live outside the repository. The
[component/data-flow diagram](../README.md#architecture-overview) shows implemented
components only. Delivery state, especially local-only 4C, is in
[project status](project-status.md); future components belong in the roadmap.

## Module responsibilities

| Module / boundary                   | Business purpose                                 | Technical responsibility                                                                                                                                  |
| ----------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AppModule                           | Compose the application                          | Imports configuration, health, auth, products and inventory                                                                                               |
| ConfigModule                        | Reject unusable startup settings                 | Validates database URL/port; auth configuration validates secret, origins and explicit proxy trust without echoing values                                 |
| DatabaseModule                      | Share business persistence                       | Owns Prisma/pg client, lazy bounded pool, readiness probe and shutdown disconnect; no generic repository                                                  |
| HealthModule                        | Distinguish live process from reachable database | Public liveness and bounded readiness outside the session pipeline                                                                                        |
| SessionModule / AuthModule          | Identify permitted active users                  | PostgreSQL sessions, CSRF/origin/admission middleware, login throttling, current-identity authentication then role guard; fixed-response exception filter |
| Users CLI and PasswordService       | Provision development identities safely          | Normalized email, Argon2id and one explicit transactional account-pair operation; no account-management HTTP API                                          |
| ProductsModule                      | Maintain a durable catalog                       | Controller validation/response mapping, exact prices, conditional active edits and archive transaction                                                    |
| Image classes within ProductsModule | Associate one display image with a product       | Multipart admission, content processing, candidate lifecycle, row-locked publication, authenticated streams and bounded cleanup                           |
| InventoryModule                     | Make stock changes accountable                   | Exact balance/history reads and atomic idempotent ADMIN adjustments using DatabaseService                                                                 |
| React application                   | Make permitted catalog work usable               | SessionClient, hash navigation, explicit response validation, exact formatting and view-owned forms/previews; backend remains authoritative               |

Controllers validate wire formats/IDs/query strings and map safe DTOs. Services
express business rules and short transactions directly through DatabaseService.
The shared `products/product-row.ts` helper is the lock protocol for inventory,
archive and image publication/removal. External image processing and filesystem
operations remain outside those transactions. This keeps locks short and avoids a
speculative repository, asset framework or worker.

## Request and session boundaries

For non-health routes, session loading precedes Origin/admission/CSRF middleware.
The authentication guard then reloads current User active status/role; role guards
run before controller validation/product lookup and before upload interception.
Unsafe requests can therefore receive 403 before reaching authentication's 401.
Public auth routes opt out explicitly; new business routes are authenticated by
default. Parser and driver errors are mapped to fixed messages, never raw errors.

The existing JSON parser retains its 100 KiB limit. Nest rawBody capture lets
catalog/inventory UTF-8 validation reject malformed wire input before it is silently
replaced. Multipart has separate bounded streaming handling; it does not weaken
JSON limits or replace the unrelated auth parser contract.

Sessions have idle/absolute deadlines and use conditional renewal, not an upsert
that could recreate a logged-out row. Request-local creation saves reuse their
first persistence result on duplicate response-end saves. Login regenerates the
session and token before returning success. Session and limiter expiry cleanup is
bounded per instance; failures do not relax authorization. Details and tradeoffs
are preserved in [ADR 0004](decisions/0004-session-authentication.md).

DatabaseService's business pool has maximum two connections and one-second connect,
pg query and PostgreSQL statement deadlines. Readiness has a 1.5-second deadline,
shares a pending probe, and reuses its failure until underlying work settles rather
than accumulating observers/queries. Liveness never queries PostgreSQL. Readiness
checks connectivity, not migration currency. Timer scheduling can delay responses
under load; the client deadline alone does not cancel SQL.

## Data model and migrations

Prisma describes models, but handwritten migration SQL is also authoritative.
Generation cannot substitute for migration deployment or preserve custom SQL by
itself. There are seven ordered migrations at the selected baseline:

| Migration suffix  | Additive responsibility                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `initial_product` | Product UUID, case-sensitive unique SKU, bounded BIGINT price, active flag and timestamps                              |
| `user_accounts`   | User identity, explicit Role enum, normalized-email constraint and unique index                                        |
| `http_sessions`   | Session JSON/expiry with an expiry index                                                                               |
| `login_limits`    | Shared limiter counters and expiry index                                                                               |
| `product_images`  | Image lifecycle/dimensions, current Product image pointer and composite ownership foreign key                          |
| `inventory`       | Zero onHand/sequence, bounded immutable attributed movements, foreign keys and actor/key + product/sequence uniqueness |
| `stock_archive`   | SQL invariant `active OR onHand=0`                                                                                     |

Product owns catalog fields, current image pointer and inventory balance/sequence.
Image candidates carry product ownership intent before publication; the composite
foreign key prevents assigning another product's published descriptor. User and
Product movement foreign keys restrict deletion/update; history has an immutable
UPDATE/DELETE statement trigger. Privileged TRUNCATE/DROP remains administrative,
not a business operation. Isolated tests reset with those privileges without
disabling production constraints.

Prices, stock, sequences and movement values use PostgreSQL BIGINT and JavaScript
bigint. Public business integers serialize as canonical decimal strings; there is
no global BigInt JSON patch or raw Prisma response. SQL bounds remain tighter than
BIGINT's native range. See [ADR 0002](decisions/0002-product-storage.md) and the
[catalog](product-catalog.md) / [inventory](inventory.md) contracts.

Prisma manages catalog `updatedAt`; direct SQL writers must manage it themselves.
Inventory intentionally updates only balance/sequence and appends history, leaving
catalog time and image metadata untouched. Product editing uses an atomic active
predicate; submitted fields use last-write-wins without optimistic locking. Archive
locks Product, requires zero stock and changes active state only once.

## Inventory adjustment sequence

This flow is implemented by the main **backend**. Its client can be an authenticated
API caller; the product-detail inventory UI exists only on the local 4C branch.

```mermaid
sequenceDiagram
    participant C as API client
    participant A as Auth and request protection
    participant I as InventoryService
    participant D as PostgreSQL
    C->>A: POST /products/:id/inventory/adjustments + key
    A->>D: Load session, current active user and role
    Note over A: Origin, CSRF and admission checks; require ADMIN
    A->>I: Validated product, delta, reason and UUID v4 key
    I->>D: BEGIN; lock Product FOR UPDATE
    I->>D: Find movement by actor and key
    alt Existing key
        D-->>I: Original movement
        I->>I: Compare normalized product/delta/reason
        I->>D: Release read transaction
        I-->>C: 200 original + Idempotency-Replayed, or 409 mismatch
    else New key
        D-->>I: No movement
        I->>I: Check active state, balance and sequence bounds
        I->>D: UPDATE balance/sequence; INSERT movement; COMMIT
        D-->>I: Committed movement
        I-->>C: 201 movement
    end
    Note over I,D: Any rejected check or failed write rolls back the transaction
```

Authorization precedes product lookup. Replay is checked before archived status and
returns original historical data, not current balance. The actor/key namespace
spans products. Each adjustment locks one product; no second product/key lock is
introduced. An identified actor/key uniqueness loser rolls back fully, then reads
the winning movement outside the aborted transaction and compares content. Unknown
unique failures are not evidence of replay. No unbounded retry loop exists.

Row locks serialize decrements/overflow checks, archive and image publication;
positive stock cannot be silently cleared by archive. Idempotency association and
history commit with the balance. After an ambiguous commit acknowledgement, a
client must deliberately reuse the same key/content; a balance read cannot prove
whether that operation committed. SQL history/key retention is indefinite, not an
exactly-once delivery promise. [ADR 0006](decisions/0006-inventory-ledger.md) explains
the choice; [project status](project-status.md#lock-timeout-incident) records the
structured SQLSTATE regression and evidence.

## Image persistence and recovery

ImageUploadInterceptor validates upload IDs/query/admission and registers a PENDING
candidate before private file reception. ImageProcessor checks actual static format,
decodes/re-encodes and strips metadata. ImageStorage owns private server-generated
UUID directories and fixed filenames. ImagesService writes/syncs both variants,
removes the original, then publishes under the Product row lock. The old image is
retired only with successful publication; a failed new candidate cannot erase it.

ImageCleanup claims eligible unreferenced candidates/retirements with SKIP LOCKED,
then deletes outside the transaction. State/expiry checks prevent publication after
a cleanup claim. DELETING leases and DELETED tombstones permit recovery after
partial deletion or late writers. Ambiguous publication is not blindly deleted;
only an unpublished candidate can be abandoned. Missing current files return 503
and need restoration or deliberate API replacement/removal.

Database and filesystem are not one transaction. Durable writes, persisted lifecycle
state and reference exclusion support recovery, not a universal power-loss guarantee.
Persistent/shared storage must match deployment topology; coordinated DB/file backups
and cleanup monitoring are operational responsibilities. Object storage is deferred
behind the focused boundary. See [ADR 0005](decisions/0005-product-image-storage.md)
and [cleanup operations](development.md#image-cleanup-and-recovery).

## Frontend boundary

React uses strict TypeScript and CSS tokens with hash navigation and small shared
components, not an extra router/state/UI framework. SessionClient uses relative
`/api` requests, browser-managed cookies, memory-only CSRF and epoch/generation
checks plus AbortController to reject previous-session responses. Read effects also
ignore unmounted views. A 403 revalidates identity without assuming CSRF expiry or
replaying the mutation; transport/store failures do not mean unauthenticated.

The main UI has catalog forms and image administration. Prices use bigint division/
remainder; changed-field PATCH avoids overwriting untouched fields. Primary image
paths must match the product/version/variant before `/api` is added once; arbitrary
external descriptors are rejected. Native images use session cookies. FormData
uses the same client without a manual multipart Content-Type. Object URLs are
revoked at view/session/selection boundaries. Uncertain catalog/image writes need
deliberate reads and user action rather than automatic replay.

The 4C branch extends this client with an idempotency header and view-owned operation
state, not persistent token/draft storage. Its specific refresh/logout retention
behavior is described in [project status](project-status.md#implemented-only-on-inventory-web).
It is not part of this main code baseline. [UI design](ui-design.md) records focus,
responsive and contrast decisions; production web hosting remains planned.
