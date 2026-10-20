# ADR 0006: Exact inventory balances and immutable adjustments

Status: accepted for milestone 4B; read/persistence increment implemented first.

Keep inventory in the modular monolith using InventoryModule and DatabaseService.
Product owns bounded BIGINT onHand and inventorySequence, both initially zero.
InventoryAdjustment stores signed nonzero delta, trimmed reason, resulting balance,
authenticated actor, per-product sequence, server timestamp and UUID v4 idempotency
key. SQL constrains bounds, foreign keys and uniqueness, and rejects history UPDATE
or DELETE. Administrative test reset uses TRUNCATE on isolated random databases;
production constraints are not disabled. No history cleanup or key expiry exists.

The approved write increment will lock one Product row FOR UPDATE, check replay
before archived status, and atomically update balance/sequence and insert history.
The actor/key namespace spans products. Only an identified actor/key uniqueness
race is resolved outside the aborted transaction by reading the committed movement;
no unbounded retry loop or second product lock is needed. Keys persist with history.
Different normalized product/delta/reason conflicts; matching replays return the
original movement. Failed operations leave no successful association. Clients must
retry deliberately with the same key after ambiguous network/commit outcomes.

Stock changes will not update catalog updatedAt. Positive stock will prohibit
archival under the same row locking protocol as image publication. Zero-stock
archives remain readable; new adjustments on archives are forbidden, while prior
successful replays remain valid after current ADMIN authorization. Corrections use
compensating movements. Numeric values use exact bigint and decimal JSON strings.

No reservation persistence is added. Reserved is derived zero; available equals
onHand. Future orders must coordinate on the same product row and enforce
onHand >= reserved, with deterministic multi-product lock ordering. Workers,
frontend inventory and speculative repositories remain deferred. See inventory.md
for the public contract and development.md for isolated verification.
