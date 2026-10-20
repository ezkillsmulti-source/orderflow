# Product scope

## Problem and users

Small businesses need to know which products they sell, how much stock is
available, and which orders reserve it. Disconnected records can cause overselling
and leave inventory changes unexplained.

Administrators manage products, inventory adjustments, and all orders. Operators
read products and available stock, create orders, and view or cancel only their
own orders. The first release supports one business. Multi-tenant isolation is
planned for a later milestone; the first release must not claim to support it.

## Permissions

| Action                             | Administrator | Operator        |
| ---------------------------------- | ------------- | --------------- |
| Log in and log out                 | Yes           | Yes             |
| List products                      | Yes           | Yes             |
| Create, edit, and archive products | Yes           | No              |
| View inventory availability        | Yes           | Yes             |
| Adjust inventory                   | Yes           | No              |
| Create orders                      | Yes           | Yes             |
| List orders and view details       | All orders    | Own orders only |
| Cancel orders                      | All orders    | Own orders only |

The backend enforces permissions on every protected operation, regardless of whether the
frontend exposes a control. Catalog role checks are implemented; order ownership remains
a later requirement. Order ownership is the authenticated creator, recorded by the
backend; clients cannot assign another creator. Ownership checks apply to listing,
details, cancellation, and idempotent request replays.

## Accounts and authentication

Accounts are initially provisioned through a development seed. Public registration
is out of scope. Seed credentials must come from local configuration and must not
be committed. Production account provisioning remains unresolved.

Use PostgreSQL-backed server-side sessions with an opaque session ID in an
HttpOnly cookie, as selected in ADR 0004; Redis remains deferred. Rotate the
session ID after successful login. Logout must invalidate the server-side session
and clear its cookie.

Protect all state-changing requests, including login and logout, against CSRF using
server-validated CSRF tokens and trusted-origin validation. GET requests must not change
business state. SameSite is defense in depth, not the only CSRF control. In production,
require HTTPS and a Secure, HttpOnly, SameSite=Lax cookie with Path=/ and no Domain
attribute, using the `__Host-` name prefix. Document trusted proxy configuration for TLS
termination and never expose the session ID to frontend JavaScript. [ADR
0004](decisions/0004-session-authentication.md) implements PostgreSQL sessions,
30-minute idle/eight-hour absolute expiry, session-bound CSRF, trusted origins, and
shared login throttling. Login, identity, and logout are implemented; current-role
authorization is implemented for catalog creation, reads, editing, and archiving. Order
ownership checks remain pending.

## First-release scope

- Login and logout for development-seeded users.
- Product creation, editing, archiving, and listing.
- Available-stock visibility and recorded inventory adjustments.
- Order creation containing multiple products, with stock reserved on creation.
- Order listing and details with immutable item snapshots and totals.
- Idempotent order creation and cancellation.
- Bounded pagination with deterministic ordering on all lists.
- Backend role and ownership authorization according to the permission matrix.

These behaviors are intended to be usable through the web application and enforced by
the backend. Authentication and catalog workflows are implemented in the API and
React application. Backend inventory is implemented; inventory UI and ordering
remain planned requirements. The approved [catalog
contract](product-catalog.md) defines validation and listing policies.

## Business rules

### Products and exact numeric values

- Products have an ID, a unique SKU, name, description, price, and active status.
  Archive products only at zero on-hand stock by setting active status to false;
  positive stock returns 409 and is never silently cleared. Do not delete products. Archived
  products cannot be added to new orders. Existing order references remain valid.
- Currency is ARS. Store and calculate monetary values as integer minor units:
  100 minor units = ARS 1.00. Prices may be zero but never negative.
- The supported range for each price, line total, and order total is
  0 through 9,007,199,254,740,991 minor units (`Number.MAX_SAFE_INTEGER`). Order
  quantities are integers from 1 through that same maximum; on-hand stock and
  reserved stock are integers from 0 through that maximum. Adjustment quantities
  are signed integers from -9,007,199,254,740,991 through +9,007,199,254,740,991.
- Validate integer form and bounds at input and persistence boundaries. Reject
  fractions, non-finite numbers, out-of-range values, and operations whose results
  exceed the bounds, without partial changes. Validate exact input before any
  potentially lossy conversion. Database constraints must enforce stored bounds.
- Use exact integer arithmetic (such as BigInt) for multiplication, addition, and
  bound checks, including intermediate results. Never use floating-point business
  arithmetic or silently round, truncate, or overflow. Database types and API
  serialization must preserve these integers; choose their details before coding.

### Inventory

- Initial on-hand stock is zero. Every change to on-hand stock requires an
  adjustment record with a product reference, the authenticated actor, a signed
  integer quantity (delta), and a non-empty reason after trimming whitespace.
  Clients cannot attribute adjustments to another actor.
- Available stock equals on-hand stock minus active reservations. Only `RESERVED`
  orders hold active reservations. Available stock cannot become negative.
- Apply an adjustment and its record atomically. Adjustments cannot reduce on-hand
  stock below reserved stock or exceed numeric bounds, including during concurrent
  adjustments and order creation. Reservations affect availability, not on-hand
  stock; they are not inventory adjustments.

### Orders and idempotent effects

- An order contains one or more distinct products. Reject repeated product
  references in a request. Each item keeps its product reference and immutable
  snapshots of SKU, name, unit price, quantity, and calculated line total. Preserve
  the calculated order total as well. Line total is unit price multiplied by
  quantity; order total is the sum of line totals, all in ARS minor units.
- Product edits or archiving do not change existing order snapshots or totals.
  The backend captures catalog values and calculates totals; client-supplied
  prices or totals cannot override them.
- Initial states are `RESERVED` and `CANCELLED`. Creation atomically persists the
  order, all snapshots, and all reservations, or changes nothing. Insufficient
  stock, archived products, invalid items, or numeric overflow reject the whole
  creation. Concurrent requests must not oversell.
- Order creation requires a client-provided idempotency key scoped to the
  authenticated user. A retry with the same key and request content returns the
  existing order without another reservation. Different content with the same key
  returns a conflict. Concurrent identical requests produce one order. Commit the
  successful key association with the order and reservations atomically; a failed
  creation leaves no partial business state or successful key association.
- A different user has an independent key namespace. A replay refers to the same
  order even if it has since been cancelled; it must not create a new reservation.
- Cancellation atomically changes `RESERVED` to `CANCELLED` and releases that
  order's reservation. Cancelling a `CANCELLED` order returns its current state
  without another release. Repeated and concurrent attempts have idempotent
  effects. Authorization still applies to every attempt.
- These are guarantees about persisted effects, not exactly-once event delivery.
  Later jobs and payment handlers must tolerate retries and duplicate delivery.

An order remains `RESERVED` until cancelled in the first release. Payment and
fulfillment states, shipment, and consumption of reserved stock are deferred.

### Lists

All lists use a bounded page size and deterministic ordering with a unique
tie-breaker. Apply role and ownership filters before pagination, including any
counts or metadata, so operators cannot infer other users' orders. Choose default
and maximum page sizes, pagination style, and sort fields before implementation.

## Testable acceptance criteria

1. Seeded accounts can log in; invalid credentials are rejected. Login rotates the
   session ID. Logout invalidates the session server-side and clears its cookie;
   replaying that session ID cannot authorize a protected request. Unauthenticated
   requests to protected operations are rejected.
2. State-changing requests without valid CSRF protection are rejected. Production
   session cookies have all required attributes; untrusted origins are rejected.
3. An administrator can create, edit, archive, and list products. Duplicate SKUs
   and invalid prices are rejected without changes. Operators can read products
   and available stock but cannot mutate products or inventory via the backend.
4. A new product has zero stock. An adjustment records the signed delta, reason,
   and authenticated actor atomically with the stock change. Empty or whitespace
   reasons and adjustments taking on-hand stock below reservations are rejected.
5. Creating an order for two available products reserves both quantities and
   exposes the order to its creator and administrators. Empty orders and zero,
   negative, fractional, repeated-product, and archived-product items are rejected
   without changes. Snapshots and totals come from backend catalog data and
   calculations, even if a client submits different prices or totals.
6. If any item lacks stock, no order or reservation is persisted. Concurrent
   orders and adjustments competing for the last units never violate stock bounds.
7. Product edits and archiving leave order snapshots unchanged. Three items priced
   at 10 minor units yield exactly 30 minor units (ARS 0.30). Numeric boundary tests
   accept valid limits, reject values beyond them and total overflow, and verify
   exact arithmetic and persistence without floating-point business calculations.
8. Cancelling a `RESERVED` order releases its reservation. Repeated and concurrent
   cancellation returns `CANCELLED` without increasing availability again.
9. Identical retries with one user's idempotency key, including concurrent retries,
   produce one order and reservation. Changed content conflicts. Another user's
   same key is independent. Replaying after cancellation does not reserve again.
10. With two operators, each sees and cancels only their own orders, including
    through direct backend requests and retries. Administrators can view and cancel
    both users' orders. Ownership cannot be overridden in a request.
11. Lists enforce the chosen default and maximum page sizes, reject invalid
    pagination, and return deterministic ordering even when primary sort values
    tie. Operator list data and metadata expose only their own orders.

## Exclusions and future milestones

Payments and payment-provider integrations, reservation expiration, background
jobs, and multi-tenant isolation are explicitly planned for later milestones.
Redis, BullMQ, and a worker are deferred until background processing is needed.

The first release also excludes shipment and fulfillment workflows, refunds,
tax and discount engines, and public account registration. Shipment, fulfillment,
refund, tax, and discount features require separate scope decisions. Microservices
are outside the current architecture direction.

## Unresolved product decisions

- User identity/email policy, password hashing/bounds, and explicit development
  provisioning are implemented in [ADR 0003](decisions/0003-user-accounts.md).
  [ADR 0004](decisions/0004-session-authentication.md) implements the session store,
  lifetimes, CSRF/origin policy, and login limits. Define production account provisioning
  and whether role management needs an administrator interface.
- Initial product storage uses bounded PostgreSQL BIGINT and Prisma bigint.
  [ADR 0002](decisions/0002-product-storage.md) selects decimal strings for
  JSON integer business values; catalog price serialization now implements it. Apply these decisions
  to later quantities and totals. First-release totals need no fractional rounding;
  later taxes, discounts, and provider conversions need their own rounding policies.
- Product IDs use UUIDs and stored SKUs are currently case-sensitive. Other ID formats remain future decisions. The
  [catalog contract](product-catalog.md) selects SKU/text limits, archive visibility,
  and no reactivation for this task.
- Backend inventory history, permissions and idempotency are implemented in the
  [inventory contract](inventory.md). The inventory UI remains milestone 4C.
- Catalog listing policy is implemented in the [catalog contract](product-catalog.md).
  Decide required customer information and listing policies for future orders.
  Inventory history pagination is documented in the inventory contract.
- Inventory adjustments use retained per-actor UUID v4 keys and normalized payload
  comparison as documented in the inventory contract. Order idempotency details
  remain to be selected without weakening accepted retry guarantees.
- Before later milestones, define fulfillment, payment effects on order state,
  reservation-expiration policy, and tenant boundaries.
