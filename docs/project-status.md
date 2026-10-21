# Project status and continuation

This is the authoritative delivery-status snapshot. API contracts describe behavior;
ADRs record decisions; the roadmap preserves planned requirements. None of them
should be read as evidence that an unmerged branch is available on `main`.

## Baselines

| Work                                        | Branch / commit                                                          | Delivery state                                         |
| ------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------ |
| Application baseline for this documentation | `main` / `origin/main` at `38a2a44ae96796d9e9faa1449fd2800df2ee3d2c`     | Merged through PR #10                                  |
| Documentation                               | `docs/developer-handoff`, based on that main commit                      | Documentation-only handoff; no runtime changes         |
| Inventory frontend 4C                       | Local `feat/inventory-web` at `fc0971eca4f509fad51b953232d807b197b1a5e4` | Implemented, unmerged and unpublished at this snapshot |

The two local `feat/inventory-web` commits are absent from this main baseline:

- `114359cf242fed0a2df4517f0d2a89211742dd45` — inventory balances and movement history.
- `fc0971eca4f509fad51b953232d807b197b1a5e4` — idempotent inventory adjustments.

Inspect their code and recorded verification without changing a checkout:

```sh
git log --oneline origin/main..feat/inventory-web
git diff origin/main...feat/inventory-web
git show fc0971e:docs/development.md
```

## Implemented and merged

- Pinned Node/pnpm workspace, NestJS modular monolith, PostgreSQL/Prisma,
  migration-managed SQL constraints, health probes, CI and isolated tests.
- Users with normalized unique emails, ADMIN/OPERATOR roles, Argon2id passwords
  and explicit conflict-preserving development provisioning.
- PostgreSQL sessions, login/me/logout/CSRF endpoints, current-user role/status
  lookup, trusted-origin checks, request admission and shared login throttling.
- Product create/list/detail/partial edit/archive, exact ARS integer minor units,
  case-sensitive unique SKUs, bounded pagination and sanitized errors.
- React authentication/catalog UI and burgundy workspace redesign, including
  ADMIN catalog forms, OPERATOR read-only views and archived browsing.
- One primary product image: validated ADMIN upload/replacement/removal,
  authenticated variants, recoverable private-disk lifecycle and cleanup CLI;
  thumbnails, detail display, local previews and image administration in the UI.
- Inventory backend 4B: zero-default BIGINT balances, immutable attributed
  adjustments, cursor history, transactional row locking and retained per-actor
  idempotency keys. Positive on-hand stock blocks archival.
- The structured PostgreSQL lock-timeout fix in `1606a05`, merged by PR #10.

There is **no inventory workspace in the selected main frontend**. Its archive
dialog has generic conflict feedback; the backend still enforces zero-stock archival.

## Implemented only on inventory-web

4C adds on-hand stock and cursor history inside product details; both roles read
archives, while ADMIN adjusts active products. It uses positive whole-unit input,
explicit Add/Remove and confirmation, bigint/string conversion, retained form input
and current balance/history reads after success or replay. Actor IDs and UTC server
timestamps identify historical movements; no email or key is added to history.

An immutable in-memory operation binds one UUID v4 to product/delta/trimmed reason.
It blocks double submission and retains uncertain operations for deliberate same-key
retry without automatic replay. A replay's historical balance is never installed as
current stock. Failed logout and product refresh preserve the operation; confirmed
logout/session changes clear account-specific state. Navigation/reload loses it and
the UI explains this limitation. Archived records offer no new adjustment; a retained
uncertain operation can still be resolved with its original key.

Stock-specific archival feedback consults inventory and rechecks after conflict;
generic 409 responses are not classified as stock conflicts. Existing auth/image/
catalog behavior remains covered by the branch's browser tests. These statements
refer to `fc0971e`, not to code merged into this documentation baseline.

## Verification evidence and its limits

| Scope         | Evidence                                                                                                                                              | Meaning                                                                                                                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main baseline | [CI run 39354393598](https://github.com/ezkillsmulti-source/orderflow/actions/runs/39354393598), exact SHA `38a2a44ae96796d9e9faa1449fd2800df2ee3d2c` | Hosted `backend` job succeeded; the workflow includes API/web checks, PostgreSQL integration and Chromium browser tests                                                                 |
| Local 4C      | Verification record in `fc0971e:docs/development.md`                                                                                                  | Previously recorded 78 web tests, 84 full browser cases plus two focused cases, formatting/lint/types and both builds; not a fresh run during this documentation task and not hosted CI |
| Documentation | Review procedure in [development](development.md#documentation-verification)                                                                          | Link, diagram, scope and formatting checks are separate from application verification                                                                                                   |

Historical UI verification is retained in
`38a2a44:docs/development.md` under the dated redesign and image frontend sections:

- Workspace redesign: 43 web tests and 30 real-API Chromium cases, plus formatting,
  lint, types and both builds; visual review at 1280×900 and 390×844 and selected
  320px keyboard, long-content, exact-price, reflow and contrast checks.
- Image frontend: 58 web tests and 52 real-API Chromium cases, including 20 image
  cases for decoded reads, ADMIN management, role/session boundaries, preview
  disposal and uncertain committed responses; desktop/mobile visual and focus checks.

These are historical local results, not additional hosted runs or fresh verification.

The foundation's isolated Compose persistence record is retained in Git at
`b3e6710:docs/development.md`: a disposable Product and migration history survived
stop/start and container recreation with the named volume. This is historical local
evidence, not a fresh test, a production storage guarantee or a backup/restore drill.

CI does not prove production readiness, complete accessibility or user acceptance.
Browser evidence covers Chromium desktop/mobile and selected 320px cases, not every
engine, device or assistive technology. No deployment is claimed.

### Lock-timeout incident

PR #9's successful run `39348192969` and failed main run `39349154252` contained
identical application/dependency/workflow code. A real row-lock wait sometimes
returned 500 instead of the required sanitized 503. The existing one-second pg
client and PostgreSQL statement timers could win in either order:

- Client-first: exact unstructured `Error('Query read timeout')`, already handled.
- Server-first: Prisma P2010 with PostgreSQL SQLSTATE in
  `meta.driverAdapterError.cause`, rather than `meta.code`, previously missed.

The fix recognizes only PostgreSQL 57014/55P03 in those identified shapes at the
shared product-lock query. Original causes stay private; unrelated errors,
including unexplained P2028 transaction failures, remain sanitized 500. Production
timeout budgets, rollback, idempotency and the image/archive lock protocol did not
change. A pg client deadline is not SQL cancellation.

The recorded regression forced five deadline orders, observed the exact PostgreSQL
blocker/waiter, required 503, observed transaction end and asserted unchanged
balance, sequence, movements, catalog/image state and idempotency association.
Three bounded rounds passed 15/15; the full integration suite passed 289 cases.
The post-merge CI above subsequently passed. See
`apps/api/src/products/product-row.ts`, `apps/api/test/product-row.spec.ts` and
`apps/api/test/inventory.integration.ts` for executable regression coverage.

## Remaining milestone 4 acceptance

Implementation is not a declaration of full milestone acceptance. The next task is
**review and publish 4C**, followed by combined manual acceptance:

1. Review the two committed frontend changes against updated main, preserving
   exact quantities, session/CSRF boundaries, operation keys and image behavior.
2. Run affected checks for any confirmed fixes; publish through a PR and require
   CI for its exact current HEAD. Do not infer CI from the historical main run.
3. Demonstrate ADMIN add/remove, rejected insufficient stock/overflow, reason/actor
   history, cursor navigation, positive-stock archive denial and zero-stock archive.
4. Demonstrate OPERATOR and archived read-only behavior, role/session changes,
   keyboard/focus, long content and maximum quantities on desktop and narrow mobile.
5. Verify a lost committed response and deliberate same-key retry create one
   movement, and the UI fetches current stock instead of using historical balance.
6. Check existing image create/replace/remove/read flows together with inventory.
   Record actual user acceptance separately from automated checks and merge only
   through the protected workflow when authorized.

## Remaining work after milestone 4

These are planned deliverables, not additional implementation in this handoff:

| Deliverable                 | Boundary / acceptance focus                                                                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Orders and reservations (5) | Select contracts; atomically reserve multiple active products, preserve snapshots/totals, ownership filters, bounded lists, per-user idempotency and compensating cancellation; prove no overselling/partial writes |
| Operable release (6)        | Production accounts, same-origin HTTPS hosting, least-privilege DB role, coordinated backup/restore and image persistence; demonstrate deployment and recovery before claiming operability                          |
| Expiration/worker (7)       | Agree expiry policy first; introduce Redis/BullMQ only for the concrete workflow and tolerate duplicate delivery                                                                                                    |
| Payments (8)                | Select provider and state relationships before sandbox integration; verify webhook authenticity and idempotent effects                                                                                              |
| Tenant isolation (9)        | Define membership/ownership and migration policy before enforcing cross-tenant boundaries                                                                                                                           |

The [roadmap](roadmap.md) and [scope](product-scope.md) retain the full requirements.

## Operational limitations and technical debt

- `.env.example` supplies URL shapes, not a second test server. Its repeated local
  port must not be mistaken for isolation; use the dedicated-server procedure in
  [development](development.md#dedicated-test-server-example). Configuration was not
  rewritten as part of the handoff.
- One business; no orders, reservations, payments, public registration, recovery,
  production provisioning, Redis, worker or deployed hosting.
- Reserved is derived zero and available equals on-hand; future reservations must
  enforce `onHand >= reserved` under the same row-lock protocol.
- PostgreSQL pool/query limits and the 200-request/minute admission ceiling are
  conservative starting settings, not capacity sizing. Monitor limiter/session
  cleanup, disk growth and clock synchronization.
- No optimistic locking: product edits are last-write-wins for submitted fields.
  Offset/cursor lists are not cross-request snapshots and expose no total count.
- Image bytes and metadata need coordinated backups. Local disk requires durable
  shared storage for replicas; object storage, galleries and tombstone compaction
  are deferred. Native processing budgets do not bound filesystem stalls.
- Ledger rows/idempotency keys are retained indefinitely. SQL CHECKs and triggers
  do not prove balance/history correspondence for arbitrary privileged direct SQL;
  production runtime roles must not have destructive administrative privileges.
- Secret rotation, proxy hardening, production capacity and restore drills need
  deployment decisions. Do not enable session/header/body debug logging.

## Repository map

| Location                                    | Responsibility                                                                                                         |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/auth`, `users`                | Session security, current roles, passwords and explicit account CLI                                                    |
| `apps/api/src/products`, `products/images`  | Catalog validation/mapping, shared row lock, image lifecycle/storage/cleanup                                           |
| `apps/api/src/inventory`                    | Exact balances, history and atomic idempotent adjustments                                                              |
| `apps/api/src/config`, `database`, `health` | Startup validation, Prisma/pool lifecycle and public probes                                                            |
| `apps/api/prisma`                           | Prisma model plus seven ordered SQL migrations; custom constraints are part of the design                              |
| `apps/api/test`                             | Unit/HTTP and real PostgreSQL suites, test DB support and browser process runner                                       |
| `apps/web/src`                              | React UI, memory-only session client, exact money and view-owned previews; additional inventory files exist only on 4C |
| `apps/web/test`, `apps/web/e2e`             | Vitest/proxy checks and real-API Playwright behavior tests                                                             |
| `.github/workflows`, root manifests         | Full CI job, workspace/toolchain, formatting and lint configuration                                                    |
| `docs/decisions`                            | Historical ADRs 0001–0006 and explicit follow-up notes                                                                 |

## Continuing independently

Start with this snapshot, then the [feature guide](features.md),
[architecture](architecture.md), relevant contracts/ADRs, and the
[command reference](development.md).

Follow requirements → contract/model → implementation → tests/docs → focused
commits → PR → required CI → protected merge. Start each task with the status
snapshot, actual Git state and its relevant contract. Validate business integer
strings before bigint conversion; map responses explicitly. Keep authorization
before product lookup, SQL locks short and external file processing outside
transactions. Add migrations without editing historical SQL, preserving custom
checks, owner foreign keys and history triggers.

Read the existing concurrency/failure tests before changing the lock or storage
protocol. Reproduce a failure with isolated resources and structured safe metadata;
never generalize unexpected database errors into conflicts or availability errors.
Update this status document when delivery state changes, keeping historical evidence
attached to its SHA rather than rewriting it as a new successful run.
