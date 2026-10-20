# Inventory API

Milestone 4B implements backend balances, immutable history and atomic idempotent
adjustments. Inventory UI (4C), orders, reservations and workers remain pending.

## Reads

Both current ADMIN and OPERATOR users may read active and archived products:

- `GET /products/:id/inventory`: `{productId,onHand,reserved,available}`.
- `GET /products/:id/inventory/adjustments`: `{items,pagination}`.

Quantities are canonical decimal strings. `onHand` is bounded from `"0"` through
`"9007199254740991"`; `reserved` is currently derived as `"0"` and `available`
equals `onHand`. No reservation rows or operations are implemented. Existing and
new products begin at zero without synthetic history. Catalog product responses
are unchanged; inventory fields cannot be assigned through product JSON writes.

History accepts only `limit` (1–100, default 25) and optional `before` (canonical
positive sequence string through `9007199254740991`), each once. Order is descending
unique per-product sequence, not timestamp. The cursor is exclusive and scoped by
the product URL. Fetch at most limit+1; pagination is `{limit,hasMore,nextCursor}`,
with null nextCursor when no following page exists. There is no total count or
cross-request snapshot guarantee. Newer insertions do not shift older cursor pages.

Movement fields are `id,productId,sequence,delta,reason,balanceAfter,actorId,createdAt`.
Sequence, delta and balanceAfter are strings; createdAt is server-generated UTC
ISO 8601 with millisecond precision. Actor ID identifies the authenticated author;
no password hash, session, email or idempotency key is exposed in history.

Unknown/repeated/invalid queries and malformed IDs return sanitized 400; missing
products return 404; anonymous/inactive users receive 401. Existing security
middleware and current-role guards remain authoritative. Responses are no-store.
Identified database availability errors return 503 with `Inventory storage
unavailable.`; unexpected failures remain sanitized 500.

## Persistence

A new migration adds zero-default Product balance and inventory sequence, plus an
immutable movement table with bounded BIGINT values, owner foreign keys and unique
product/sequence and actor/idempotency-key indexes. Existing migrations and image
ownership constraints remain unchanged. Initial stock is not an adjustment.

SQL rejects movement UPDATE and DELETE, including statements affecting no rows.
Administrative TRUNCATE/DROP remain privileged destructive operations, not business
APIs; isolated random test databases use TRUNCATE including all related tables or
are dropped in teardown. Tests never disable the production trigger. Deployment
roles must not grant application users destructive administrative privileges.

## Adjustments

`POST /products/:id/inventory/adjustments` requires current ADMIN permission,
trusted Origin, current X-CSRF-Token and one `Idempotency-Key` header containing a
canonical lowercase UUID v4. JSON/UTF-8 only, with the existing 100 KiB body limit.
No query parameters. The body accepts exactly these fields:

```json
{ "delta": "-2", "reason": "Damaged units" }
```

Delta is a nonzero signed canonical decimal string within ±9007199254740991.
Reject numbers, fractions, exponents, leading zeros, sign +, -0 and whitespace.
Reason is trimmed, 1–500 Unicode code points, with malformed Unicode/NUL rejected.
No Unicode normalization or case folding. Clients cannot assign actor, sequence,
resulting balance, timestamp, IDs or image metadata. Product IDs normalize to
lowercase UUIDs. Every rejected/failed transaction leaves balance/history unchanged.

An accepted new adjustment returns 201 and the movement shape documented above.
It changes onHand and inventorySequence together with one movement, leaving catalog
updatedAt, product fields and image state unchanged. Sequence is bounded at
9007199254740991; reaching that operationally remote limit returns 409.

The key namespace is authenticated actor + inventory-adjustment operation, across
all products. Matching normalized product/delta/trimmed reason returns 200 with
`Idempotency-Replayed: true` and the original movement, including its original
balanceAfter and timestamp. JSON field order and surrounding reason whitespace do
not change the normalized payload. Different content with the same key returns 409.
Another ADMIN has an independent namespace. Keys have no expiry and remain with
immutable history; they are not exposed in history or diagnostic output.

Only successful commits associate a key. Concurrent identical requests create one
movement; a cross-product collision rolls back the losing product before resolving
the original key outside the aborted transaction. Each request locks exactly one
product; there is no cross-product lock cycle or automatic mutation retry. Lock
waiting is bounded by existing database deadlines; transactions have a 1-second
acquisition budget and a 3-second overall budget. SQL lock/query timeouts identified
by PostgreSQL code become sanitized 503. The shared row-lock helper also recognizes
pg's exact `Query read timeout` error only at that SQL boundary and tags it for
the route-specific sanitizer; arbitrary errors/substrings are not classified.
Unexplained failures remain 500.

After a timeout, network failure or ambiguous commit response, do not generate a
new key or infer failure. Deliberately repeat the same key and normalized payload
to retrieve the original movement if committed, or apply it once if it was not.
Every replay rechecks current ADMIN authorization. A failed operation does not
reserve the key and a later deliberate attempt can succeed after conditions change.

## Archive coordination and errors

Intentional catalog change: products with positive onHand cannot be archived.
The archive transaction locks Product FOR UPDATE, checks zero stock, then changes
active status. Image publication/removal and adjustments use the same shared lock
helper. No stock is silently cleared. SQL also forbids positive stock on archived
rows. Correct stock with recorded compensating movements before archival; there is
still no reactivation. Repeated zero-stock archival performs no write.

Archived balances/history remain readable by both roles; new adjustments return 409. Successful-key replay is checked before archived status and returns the
original movement without writes. Race outcomes follow row-lock order: an increment
committed first blocks archive; archive committed first blocks a new adjustment.

All errors keep `{statusCode,message}` with fixed sanitized English messages:

| Status    | Condition / message                                            |
| --------- | -------------------------------------------------------------- |
| 400       | Invalid request, body, key, Unicode, ID or query               |
| 401 / 403 | Existing authentication, current-role or Origin/CSRF rejection |
| 404       | Missing product                                                |
| 409       | `Archived products cannot be adjusted.`                        |
| 409       | `Inventory balance would be outside its allowed range.`        |
| 409       | `Idempotency key conflicts with a previous adjustment.`        |
| 409       | `Inventory sequence limit reached.`                            |
| 409       | `Products with positive stock cannot be archived.`             |
| 413 / 429 | Existing body size / shared throttle limits                    |
| 503       | Identified database availability/SQL timeout failure           |
| 500       | Unexpected failure                                             |

No raw SQL, paths, constraints, keys or submitted values appear in errors. Only the
identified actor/key unique violation triggers replay resolution; an ID/sequence
collision remains an unexpected failure. Read responses are not aggregate snapshots.

There is no adjustment editing/deletion API. Corrections append a compensating delta
with a clear reason. Runtime writers must use the service protocol: CHECK constraints
cannot by themselves prove ledger/balance correspondence for arbitrary direct SQL.
Administrative schema owners can still TRUNCATE/DROP; production least-privilege
role provisioning belongs to deployment. History and retained keys grow over time.
Future reservations must use available=onHand-reserved and reject adjustments below
reserved under the same lock protocol; reservations are not implemented here.
