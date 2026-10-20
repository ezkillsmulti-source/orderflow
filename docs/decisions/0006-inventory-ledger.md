# ADR 0006: Exact inventory balances and immutable adjustments

Status: accepted and implemented for milestone 4B backend.

Keep inventory in the modular monolith using InventoryModule and DatabaseService.
Product owns bounded BIGINT onHand and inventorySequence, both initially zero.
InventoryAdjustment stores signed nonzero delta, trimmed reason, resulting balance,
authenticated actor, per-product sequence, server timestamp and UUID v4 idempotency
key. SQL constrains bounds, foreign keys and uniqueness, and rejects history UPDATE
or DELETE. Administrative test reset uses TRUNCATE on isolated random databases;
production constraints are not disabled. No history cleanup or key expiry exists.

The write increment locks one Product row FOR UPDATE, checks replay before
archived status, and atomically updates balance/sequence and inserts history.
The actor/key namespace spans products. Only an identified actor/key uniqueness
race is resolved outside the aborted transaction by reading the committed movement;
no unbounded retry loop or second product lock is needed. Keys persist with history.
Different normalized product/delta/reason conflicts; matching replays return the
original movement. Failed operations leave no successful association. Clients must
retry deliberately with the same key after ambiguous network/commit outcomes.

Stock changes do not update catalog updatedAt. Positive stock prohibits
archival under the same shared row locking protocol as image publication. A second
additive migration enforces active OR onHand=0 in SQL. Zero-stock
archives remain readable; new adjustments on archives are forbidden, while prior
successful replays remain valid after current ADMIN authorization. Corrections use
compensating movements. Numeric values use exact bigint and decimal JSON strings.

No reservation persistence is added. Reserved is derived zero; available equals
onHand. Future orders must coordinate on the same product row and enforce
onHand >= reserved, with deterministic multi-product lock ordering. Workers,
frontend inventory and speculative repositories remain deferred. See [inventory](../inventory.md) for the public contract and
[development](../development.md#inventory-backend-development) for isolated verification.
