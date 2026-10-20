-- Intentional catalog contract change: never archive positive on-hand stock.
-- All pre-inventory archived products were initialized to zero by the prior migration.
ALTER TABLE "Product" ADD CONSTRAINT "Product_archived_stock_check"
  CHECK ("active" OR "onHand" = 0);
