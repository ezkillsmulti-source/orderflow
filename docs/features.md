# Feature guide

This guide explains the implemented main API/catalog/image UI. For merged vs
branch-only delivery, acceptance and limitations, read [project status](project-status.md)
first. Detailed request schemas belong in the linked contracts rather than being
redefined here. The application serves one business with ADMIN and OPERATOR roles.

## Accounts and roles

Administrators maintain product information, images and inventory adjustments.
Operators can read active/archived catalog records, images, balances and history.
Controls in the UI help users discover permitted actions; backend guards enforce
current role and active status on every protected request before product lookup.
Clients cannot choose actor IDs or roles through product/inventory writes.

Development provisioning creates or validates one account of each role atomically.
It never resets a password, changes an existing role or reactivates an account;
a conflict rolls back the pair. This is an explicit CLI, not startup seeding or
public registration. Emails are normalized identifiers, not verified ownership;
passwords preserve Unicode/whitespace and use Argon2id. Syntax, limits, parameters,
concurrency retries and consequences are in [ADR 0003](decisions/0003-user-accounts.md).
See [provisioning commands](development.md#development-account-provisioning).
Production account administration and recovery are not implemented.

## Authentication API

Paths here are backend paths. Browser requests use `/api` once through Vite; API
clients use the backend origin directly. Auth JSON is no-store and identity exposes
only `{id,email,role}`. Tokens/cookies/credential bodies must stay out of logs,
URLs, persisted browser storage and public test artifacts.

| Endpoint            | Request                                                  | Success                                                                       | Expected failures                                                                                          |
| ------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `GET /auth/csrf`    | Current cookie if present                                | 200 `{csrfToken}`; creates an anonymous session if needed                     | 401 expired touched session, 429 admission, 503 storage                                                    |
| `POST /auth/login`  | JSON `{email,password}`, trusted Origin and X-CSRF-Token | 200 `{user:{id,email,role},csrfToken}`; session/token rotated and saved first | 400 syntax/unknown fields, 401 generic credentials, 403 request protection, 429 limits, 503 infrastructure |
| `GET /auth/me`      | Authenticated cookie                                     | 200 `{user:{id,email,role}}`                                                  | 401 absent/expired/inactive, 403 supplied untrusted Origin, 429/503                                        |
| `POST /auth/logout` | Current cookie, trusted Origin and X-CSRF-Token          | 204 after server destruction and cookie clearing                              | 403 stale token/origin, 429/503; no success claim on failure                                               |

Login first needs an anonymous CSRF token and cookie. Replace the in-memory token
with login's `csrfToken` after rotation. Identity restoration calls `/auth/me`.
Repeated logout is safe with a freshly acquired anonymous token/cookie; the old
revoked token is invalid. Unexpected errors use fixed `{statusCode,message}`
responses; password hashes, session IDs and database details are not public JSON.

Sessions expire after 30 idle minutes/eight hours absolute. Conditional renewal and
creation-save handling avoid resurrecting sessions after concurrent logout. Local
cookies are HttpOnly, SameSite=Lax, Path=/, no Domain; production additionally uses
Secure and the `__Host-orderflow.sid` name, HTTPS origins and explicit proxy trust.
There is no permissive credentialed CORS: use same-origin requests. Safe requests
can omit Origin but a supplied Origin is checked; unsafe requests always need it.
CSRF/origin middleware runs before business authentication/authorization, so a 403
alone does not identify whether CSRF or role changed.

Shared PostgreSQL admission permits 200 non-health requests/minute; login additionally
counts 30 attempts/source IP and 10/normalized account per 15-minute window, including
successful logins. 429 includes Retry-After; storage failure returns 503 without an
in-memory fallback. Fixed-size expiry cleanup and conservative capacity limits need
monitoring. Account digest keys are not an email-secrecy guarantee. See
[ADR 0004](decisions/0004-session-authentication.md) for tradeoffs and
[the API walkthrough](development.md#authenticated-api-walkthrough).

## Product catalog and exact money

The catalog keeps a durable shared product reference. ADMIN creates, partially edits
and archives; both roles read archives. The endpoints are `GET /products`,
`GET /products/:id`, `POST /products`, `PATCH /products/:id` and
`POST /products/:id/archive`. There is no physical deletion/reactivation API.

SKU uniqueness is case-sensitive and includes archives. Names/descriptions are
trimmed with Unicode bounds and malformed Unicode/NUL rejection. Clients cannot
assign IDs, timestamps, active state, stock or image metadata. PATCH accepts only
changed permitted fields; the database write atomically requires active=true.
Submitted fields use last-write-wins, not optimistic version checking.

Price is an exact ARS minor-unit decimal string in JSON, bigint in the API and
BIGINT with a SQL bound from zero through 9007199254740991. The UI parses ungrouped
pesos with a dot and at most two fractional digits and formats ARS without converting
amounts to Number. Zero and the maximum are valid; rounding/exponents are not.

Lists filter active/archived/all, default active; fixed createdAt/id ordering and
bounded limit/offset expose only hasMore, never invented totals or a snapshot.
Archive locks the product and requires zero on-hand stock; positive stock returns
409 without clearing it. Repeated archive preserves updatedAt. These rules and
all body/query/error/response details are in the
[catalog contract](product-catalog.md), with numeric rationale in
[ADR 0002](decisions/0002-product-storage.md).

## Primary product images

Images let users recognize products without exposing public file storage. There is
one optional primary image, not a gallery. Both roles read current variants,
including archives. ADMIN can add/replace/remove only on active products through:

- `PUT /products/:id/image`: exactly one multipart file field `image`, no extra fields.
- `DELETE /products/:id/image`: 204, absence idempotent on active products.
- `GET /products/:id/image/:version/:variant`: authenticated `thumbnail` or `detail`.

Creation remains separate from upload. Archived mutations are 409 even when no
image exists; obsolete versions are 404. Descriptors carry relative backend paths,
version and dimensions, never disk keys. The frontend validates paths and adds
`/api` exactly once. Authenticated streams use WebP, private/no-store, nosniff,
same-origin resource policy and restrictive content headers.

Static JPEG/PNG/WebP input must pass actual content decoding and declared MIME
checks (or octet-stream), 5 MiB file / 6 MiB multipart, 8192px per side and 24 million
pixels. Animation, SVG, corrupt/truncated/spoofed input and extra fields/files are
rejected. Autoorientation, sRGB and WebP re-encoding remove metadata; detail fits
1600px and thumbnail 320px without crop/upscaling. Originals are not retained.
Two in-flight slots/process, a ten-second receive budget and native five-second
sharp transform budgets bound work, without claiming to cancel filesystem stalls.

The old published image survives until both variants are durable and database
publication commits. Row locks coordinate replacement/removal/archive; last
successful publication wins. Registered PENDING/RETIRED versions, DELETING claims
and DELETED tombstones make partial failures recoverable. DB and disk are not one
transaction; ambiguous publication is not blindly undone. Cleanup is bounded,
dry-run by default, with 24-hour safety/retry leases and reference exclusion.
It cannot restore missing current bytes or delete unknown unregistered directories.

See the [image contract](product-catalog.md#primary-image-milestone-4a-backend),
[ADR 0005](decisions/0005-product-image-storage.md) and
[storage/cleanup operations](development.md#private-product-image-storage).
Local disk needs coordinated backups and shared persistent storage for replicas;
object storage, originals, remote URL import and cropping remain deferred.

## Inventory backend

Inventory makes every stock change attributable. Both roles read balances/history,
including archives; ADMIN adjusts active products through
`GET /products/:id/inventory`, `GET /products/:id/inventory/adjustments` and
`POST /products/:id/inventory/adjustments`. These backend endpoints are merged;
their product-detail UI is local-only 4C.

Existing/new products start at zero without synthetic movements. Quantity JSON uses
canonical decimal strings; calculations/storage use bigint/BIGINT. An adjustment is
a bounded nonzero signed delta, trimmed 1–500-code-point reason, authenticated actor,
server timestamp, per-product sequence and historical balance. Corrections append
compensating movements; no movement editing/deletion API exists and SQL rejects
history UPDATE/DELETE. Reserved is derived zero; available equals on-hand. No orders
or reservations are implied by these fields.

One transaction locks Product, checks an actor/key replay before archived status,
checks nonnegative/max stock and sequence, updates balance/sequence and inserts
history. Catalog updatedAt and image state are untouched. Image/archive decisions
use the same product lock. Foreign keys and unique indexes enforce ownership and
key/sequence uniqueness; runtime transactions preserve balance/history agreement.
Privileged direct SQL is not a substitute for that protocol.

Every POST needs a canonical UUID v4 Idempotency-Key scoped to actor + adjustment
operation across products. Same normalized product/delta/reason returns the original
movement with 200 and Idempotency-Replayed; changed content is 409. New commits are 201. Keys persist with immutable history. Current ADMIN authorization is required
for every replay, including after archival. Concurrent uniqueness losers roll back
before looking up a winner outside the aborted transaction. Only identified errors
receive conflict/availability classification; unknown errors remain sanitized 500.

After an uncertain response, retain the original key/content and retry deliberately.
A replay can return an old resulting balance: fetch current inventory separately.
History uses descending exclusive sequence cursors with bounded limit/hasMore/
nextCursor, no total count or cross-request snapshot. The
[inventory contract](inventory.md), [ADR 0006](decisions/0006-inventory-ledger.md) and
[transaction sequence](architecture.md#inventory-adjustment-sequence) define details.

## Frontend behavior and accessibility

The merged UI restores identity, signs in/out, browses filters/pages/details and
supports ADMIN product/image actions. OPERATOR and archives have complete read-only
catalog/image views. Loading, empty, unavailable, forbidden and missing states are
distinct; recoverable form errors preserve input. SessionClient's epoch/generation
checks reject stale previous-account responses even if fetch ignores cancellation.
A network/store failure is not an unauthenticated response or successful logout.

Forms have labels, helper/error associations and focus on invalid inputs. Navigation
focuses headings; query-only changes retain controls. Tables use named keyboard
scroll regions; dialogs restore focus and avoid nested confirmations. Images have
separate absent/failed-load fallbacks and reserved dimensions. Local object URLs
are revoked on selection/view/session boundaries. Mutation controls are role-aware,
but backend permissions remain authoritative. No password, cookie, CSRF token or
file is persisted by application code in localStorage.

The burgundy tokens, reduced-motion behavior, responsive choices and testing limits
are in [UI design](ui-design.md). 4C's branch-only exact-stock forms, memory-only
operation retention and archival feedback are described in
[project status](project-status.md#implemented-only-on-inventory-web); they are not
features of the selected main UI. See [manual web walkthrough](development.md#manual-web-walkthrough)
for the main experience and the branch acceptance checklist for 4C.
