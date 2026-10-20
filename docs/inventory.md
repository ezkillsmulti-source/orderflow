# Inventory API

Milestone 4B is backend-only. Balance/history reads and zero-initialized persistence
are implemented. Adjustment writes are the next task commit; inventory UI (4C),
orders, reservations and workers remain pending.

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
