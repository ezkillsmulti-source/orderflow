# ADR 0002: Initial product storage and exact integer boundaries

Status: Accepted.

## Context

Prices must remain exact from zero through 9,007,199,254,740,991 minor units.
PostgreSQL INTEGER cannot hold that range, and floating point is unsuitable.
JSON cannot directly serialize JavaScript bigint values.

## Decision

Store `priceMinor` as PostgreSQL BIGINT with a SQL CHECK constraint enforcing the
product scope's range. Use Prisma's JavaScript `bigint` representation and exact
integer arithmetic internally. Future endpoints will accept and emit canonical
base-10 decimal strings for monetary amounts and other potentially large integer
business values; validate their syntax and bounds before converting to bigint.
Do not globally patch BigInt JSON serialization or return Prisma models directly.
No monetary HTTP contract is implemented in this milestone.

Use Prisma-generated UUIDs for product IDs, case-sensitive unique SKUs, TEXT for
names/descriptions, and TIMESTAMPTZ(3) for creation/update instants. Prisma manages
`updatedAt`; there is no database update trigger. SKU normalization, API text bounds,
and reactivation policy remain decisions for the catalog milestone.

## Consequences

BIGINT's larger native range does not relax product bounds: SQL rejects negative
and oversized values even outside Prisma. Handwritten migration constraints must
be reviewed in later schema changes. Direct SQL writers must supply IDs and
update timestamps. Integration tests verify limits, uniqueness, migration
repeatability, and persistence against real PostgreSQL in an isolated database.

## Catalog follow-up

The backend catalog now implements the selected decimal-string/BIGINT boundary.
The [catalog contract](../product-catalog.md) records the approved SKU normalization,
text bounds, archive visibility, and no-reactivation policy. These API policies
reuse the original table, unique index, and price CHECK; no migration is added.
