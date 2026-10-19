CREATE TABLE "login_limit" (
    "key" VARCHAR(255) NOT NULL PRIMARY KEY,
    "points" INTEGER NOT NULL DEFAULT 0,
    "expire" BIGINT
);
CREATE INDEX "login_limit_expire_idx" ON "login_limit"("expire");
