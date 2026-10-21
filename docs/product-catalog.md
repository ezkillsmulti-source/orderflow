# Backend product catalog

This contract defines the merged catalog and primary-image API. Delivery state and
local-only frontend work are tracked in [project status](project-status.md).
Catalog JSON does not expose writable stock fields; dedicated
[inventory endpoints](inventory.md) own balances and immutable movements.

## Authentication and permissions

Every catalog route requires an authenticated active user. The authentication guard
reloads current role/status from PostgreSQL; the following role guard checks permissions
before controller validation or product lookup. ADMIN can create, read, edit, and
archive products. OPERATOR can read products, including archived ones. Roles cannot come
from clients or session snapshots. This first release supports one business, not
tenants.

Unsafe requests require the existing session cookie, exact trusted Origin, and
current X-CSRF-Token. Origin/CSRF checks run before authentication and can return
403 before an unauthenticated request reaches the 401 check. Shared throttling and
health exclusions remain unchanged. Responses use Cache-Control: no-store.

## Endpoint contract

| Endpoint                   | Success                              | Status      |
| -------------------------- | ------------------------------------ | ----------- |
| GET /products              | 200 list envelope                    | Implemented |
| GET /products/:id          | 200 product                          | Implemented |
| POST /products             | 201 product; Location: /products/:id | Implemented |
| PATCH /products/:id        | 200 product                          | Implemented |
| POST /products/:id/archive | 200 archived product                 | Implemented |

Catalog request bodies must use application/json with UTF-8 encoding; other media
types return 400. An archive with no body needs no Content-Type. Form payloads are
rejected before writes, including malformed percent-encoded text.

Create accepts sku, name, priceMinor, and optional description. Required fields
must be present. Unknown fields are rejected, including id, active, and timestamps.
Creation always sets active=true. IDs are server-generated UUIDs. Malformed UUID
path parameters return 400; syntactically valid missing IDs return 404.

```json
{
  "sku": "CAF-001",
  "name": "Ground coffee",
  "description": "250 g bag",
  "priceMinor": "125000"
}
```

Individual responses contain exactly id, sku, name, description, priceMinor,
active, image, createdAt, and updatedAt. Timestamps are UTC ISO 8601 strings with
millisecond precision; description is a string or null. No raw Prisma models are
returned. Currency is ARS; 100 minor units equal ARS 1.00.

## Validation and SKU policy

- SKU: trim surrounding JavaScript whitespace; 1–64 ASCII characters matching
  `[A-Za-z0-9][A-Za-z0-9._-]*`. Case-sensitive uniqueness includes archived rows:
  CAF-001 and caf-001 are distinct; archive never releases a SKU.
- Name: trim surrounding whitespace; 1–200 Unicode code points.
- Description: optional or null; trim surrounding whitespace; at most 2,000
  Unicode code points. Empty becomes null; omission at creation also yields null.
- Reject malformed Unicode, including unpaired escaped surrogates and invalid
  UTF-8 wire bytes. Catalog JSON uses UTF-8. Reject U+0000 in text because
  PostgreSQL TEXT cannot persist it. No case folding or Unicode normalization.
- priceMinor: canonical decimal string matching `0|[1-9][0-9]*`, from "0" through
  "9007199254740991". Reject JSON numbers, signs, whitespace, leading zeros,
  fractions, exponents, and overflow. Validate syntax/length before BigInt parsing;
  no intermediate Number conversion. Store Prisma bigint/PostgreSQL BIGINT and
  serialize explicitly with toString(). Preserve the SQL monetary CHECK.
- Reject non-object bodies, arrays, null, wrong types, and unknown fields.
  The existing JSON parser limit is 100 KiB.

SKU/name/description text policies are API validation; SQL enforces SKU
uniqueness and monetary bounds. Direct SQL writers must obey API text policies
themselves. Additive image/inventory migrations extend persistence separately;
historical migrations and the monetary CHECK must remain intact.

## Listing

GET /products accepts only status, limit, and offset, each at most once.

| Parameter | Default | Accepted values                   |
| --------- | ------- | --------------------------------- |
| status    | active  | active, archived, all             |
| limit     | 25      | Canonical decimal integer 1–100   |
| offset    | 0       | Canonical decimal integer 0–10000 |

Order is fixed: createdAt ASC, id ASC. Unknown, repeated, empty, or invalid query
parameters return 400. Filters apply before pagination. Fetch at most limit+1
records; return at most limit. There is no total count, search, or configurable
sorting. Both roles can list archives and read their detail by ID.

```json
{
  "items": [],
  "pagination": { "limit": 25, "offset": 0, "hasMore": false }
}
```

Pagination is deterministic for unchanged data, not a consistent snapshot across
requests. Concurrent creation/archiving can change page membership. Offset is
bounded at 10,000; deeper navigation would require a separate cursor decision.

## Editing and archival policy

PATCH accepts a non-empty subset of sku, name, description, and priceMinor. Omitted
fields remain unchanged; description=null clears it. Archived products cannot be edited
or reactivated. Edits atomically require active=true in the SQL write predicate.
PostgreSQL rechecks that predicate after waiting for concurrent row writers. A failed
conditional edit returns 404 for a missing ID or 409 for an archived product.
Simultaneous edits use last-write-wins for submitted fields; optimistic locking is not
implemented. A SKU edit releases its previous value.

Archive accepts an omitted body or an empty JSON object. Unknown fields and other body
types are rejected. Since milestone 4B, archival locks the product row and requires
onHand=0. Positive stock returns sanitized 409: "Products with positive stock cannot
be archived." No stock is cleared. This intentionally changes the prior archival
contract; stock must be corrected with recorded movements before archive. Archive
changes active to false and never deletes a row. Only active
rows are updated; an already archived row is read without a write. Repeating archive
returns the existing representation without changing updatedAt. No reactivation or
physical deletion endpoint exists. Future orders must reject archived
products and preserve immutable snapshots; orders are not implemented.

## Errors

Errors retain the existing envelope: statusCode and a fixed English message.

| Status | Meaning                                                  |
| ------ | -------------------------------------------------------- |
| 400    | Invalid body, encoding, UUID, or list query              |
| 401    | Missing/expired/revoked session or inactive account      |
| 403    | Role, CSRF, or Origin denial                             |
| 404    | Product does not exist                                   |
| 409    | Duplicate SKU, archived edit, or positive-stock archival |
| 413    | Request body too large                                   |
| 429    | Existing shared throttle, with Retry-After               |
| 503    | Identified storage availability failure                  |
| 500    | Unexpected internal failure                              |

Catalog conflicts use "Product conflict." except the explicit positive-stock
archival message above; catalog availability failures use
"Product storage unavailable.". Existing authentication messages are unchanged.
Only the identified Product SKU unique violation maps to a SKU conflict. Known connection,
query/pool timeout, connection closure, and connection-capacity Prisma codes map
to 503; unknown database errors remain sanitized 500. No raw driver errors, SQL,
constraints, or submitted values appear in error responses.

Edits use a single conditional write with returned rows. Archive uses a short
transaction locking Product, checking zero stock, and conditionally updating active
status, coordinating with adjustments and image publication. SKU conflicts roll
back the whole statement. Read fallback only distinguishes missing/archived IDs or
returns an existing archive; it does not authorize a later unconditional write. No
physical deletion endpoint exists; inventory operations have their own contract.

For authenticated catalog verification instructions, see
[development](development.md#manual-catalog-walkthrough).

## Primary image (milestone 4A backend)

Each product response includes `image: null` or:

```json
{
  "version": "00000000-0000-4000-8000-000000000001",
  "thumbnail": {
    "url": "/products/PRODUCT_ID/image/VERSION/thumbnail",
    "width": 320,
    "height": 240
  },
  "detail": {
    "url": "/products/PRODUCT_ID/image/VERSION/detail",
    "width": 1600,
    "height": 1200
  }
}
```

URLs are backend paths. The Vite frontend's `/api` proxy prefix must be added once
by the image client, never stored in metadata. Dimensions describe the encoded
variants. JSON product writes cannot assign image fields, IDs, or storage keys.

`GET /products/:id/image/:version/:variant` accepts `thumbnail` or `detail` and no
query parameters. ADMIN and OPERATOR may read current images, including archived
products. Missing products, absent images, and obsolete versions return 404.
Invalid identifiers/variants return 400. Missing current files return a sanitized
503, rather than exposing paths or silently deleting metadata. Responses stream
WebP with private/no-store caching, nosniff, and same-origin resource policy.

`PUT /products/:id/image` is ADMIN-only and accepts `multipart/form-data` with
exactly one file named `image`, no text fields, query parameters, or extra files.
It returns 200 with the complete updated product representation. Creation of a
product remains separate. Authentication and current-role guards precede Multer;
the existing origin, CSRF header, and shared throttling middleware precede uploads.

Inputs are static JPEG, PNG, or WebP. File bytes (not filename extensions) determine
format; declared MIME must match that format or be `application/octet-stream`.
Unsupported signatures or mismatched MIME return 415. Corrupt, truncated, animated
(including APNG), excessive-dimension, or excessive-pixel inputs return 422. File
bytes are limited to 5 MiB and the whole multipart body to 6 MiB (413), including
chunked requests. Unknown fields, missing/extra files, and malformed multipart
return 400. Dimensions are at most 8192 per side and 24,000,000 decoded pixels.

Processing autoorients, converts to sRGB, strips metadata, and emits WebP quality 82. Detail fits within 1600x1600; thumbnail fits within 320x320. Neither variant is
cropped or enlarged. Thumbnail derives from the normalized detail. Originals are
removed before successful publication; failed candidates are cleaned immediately
when possible, otherwise by operational cleanup. No original download exists.

At most two uploads are received/processed per API process, with no application
queue; excess uploads return 429 with Retry-After. Reception, including rejected
body drains, ends after ten seconds with 408/connection close. sharp uses its native
five-second processing timeout per transform. This is a native processing budget,
not a guarantee for filesystem I/O or waiting for a libuv thread. No mutation is
automatically replayed after any failure or uncertain response.

`DELETE /products/:id/image` is ADMIN-only, takes no body or query, and returns 204. Absence is idempotent and preserves updatedAt; successful replacement/removal
updates the product. Archived products reject either mutation with 409, including
removal of an absent image. Missing products return 404. Both roles can still read
archived images. Repeated product archival preserves image state and updatedAt.

Publication, removal, and archival serialize on the product row. Simultaneous
uploads use last-successful-publication semantics. An upload prepared before an
archive cannot publish afterward. A deliberately later publication may replace an
image removed while that upload was being prepared. Clients must refresh after a
confirmed mutation. A network failure can leave the outcome uncertain: read current
state and require deliberate user action rather than automatically resubmitting.
Only known database availability errors become 503; unexpected errors remain 500.
All error messages are fixed and exclude submitted values and internal paths.
