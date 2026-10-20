-- Existing active and archived products start at zero, without synthetic movements.
ALTER TABLE "Product"
  ADD COLUMN "onHand" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "inventorySequence" BIGINT NOT NULL DEFAULT 0,
  ADD CONSTRAINT "Product_onHand_check" CHECK ("onHand" BETWEEN 0 AND 9007199254740991),
  ADD CONSTRAINT "Product_inventorySequence_check" CHECK ("inventorySequence" BETWEEN 0 AND 9007199254740991);

CREATE TABLE "InventoryAdjustment" (
  "id" UUID NOT NULL PRIMARY KEY,
  "productId" UUID NOT NULL REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "sequence" BIGINT NOT NULL CHECK ("sequence" BETWEEN 1 AND 9007199254740991),
  "delta" BIGINT NOT NULL CHECK ("delta" BETWEEN -9007199254740991 AND 9007199254740991 AND "delta" <> 0),
  "reason" TEXT NOT NULL CHECK (char_length("reason") BETWEEN 1 AND 500 AND char_length(btrim("reason")) > 0),
  "balanceAfter" BIGINT NOT NULL CHECK ("balanceAfter" BETWEEN 0 AND 9007199254740991),
  "actorId" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  "idempotencyKey" UUID NOT NULL CHECK ("idempotencyKey"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  CONSTRAINT "InventoryAdjustment_previous_balance_check" CHECK ("balanceAfter" - "delta" BETWEEN 0 AND 9007199254740991)
);
CREATE UNIQUE INDEX "InventoryAdjustment_productId_sequence_key" ON "InventoryAdjustment"("productId", "sequence");
CREATE UNIQUE INDEX "InventoryAdjustment_actorId_idempotencyKey_key" ON "InventoryAdjustment"("actorId", "idempotencyKey");

CREATE FUNCTION reject_inventory_history_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Inventory history is immutable.' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "InventoryAdjustment_immutable"
  BEFORE UPDATE OR DELETE ON "InventoryAdjustment"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_inventory_history_change();
-- TRUNCATE remains an administrative privilege for isolated test databases, like DROP.
-- No application operation truncates history or disables this trigger.
