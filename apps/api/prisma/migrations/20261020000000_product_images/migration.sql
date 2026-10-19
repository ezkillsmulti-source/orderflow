CREATE TYPE "ProductImageState" AS ENUM ('PENDING', 'PUBLISHED', 'RETIRED', 'DELETING', 'DELETED');
CREATE TABLE "ProductImage" (
  "id" UUID PRIMARY KEY,
  "productId" UUID NOT NULL,
  "state" "ProductImageState" NOT NULL DEFAULT 'PENDING',
  "detailWidth" INTEGER,
  "detailHeight" INTEGER,
  "thumbnailWidth" INTEGER,
  "thumbnailHeight" INTEGER,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cleanupAfter" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ProductImage_dimensions_check" CHECK (
    ("state" <> 'PUBLISHED') OR (
      "detailWidth" BETWEEN 1 AND 1600 AND "detailHeight" BETWEEN 1 AND 1600 AND
      "thumbnailWidth" BETWEEN 1 AND 320 AND "thumbnailHeight" BETWEEN 1 AND 320 AND
      "detailWidth" IS NOT NULL AND "detailHeight" IS NOT NULL AND
      "thumbnailWidth" IS NOT NULL AND "thumbnailHeight" IS NOT NULL
    )
  )
);
CREATE UNIQUE INDEX "ProductImage_id_productId_key" ON "ProductImage"("id", "productId");
CREATE INDEX "ProductImage_state_cleanupAfter_idx" ON "ProductImage"("state", "cleanupAfter");
ALTER TABLE "Product" ADD COLUMN "imageId" UUID;
CREATE UNIQUE INDEX "Product_imageId_key" ON "Product"("imageId");
ALTER TABLE "Product" ADD CONSTRAINT "Product_imageId_fkey"
  FOREIGN KEY ("imageId") REFERENCES "ProductImage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Prevent assigning another product's image, including outside the application.
ALTER TABLE "Product" ADD CONSTRAINT "Product_image_owner_fkey"
  FOREIGN KEY ("imageId", "id") REFERENCES "ProductImage"("id", "productId") ON DELETE RESTRICT;
