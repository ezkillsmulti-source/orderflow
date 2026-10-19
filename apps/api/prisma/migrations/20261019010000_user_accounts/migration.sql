CREATE TYPE "Role" AS ENUM ('ADMIN', 'OPERATOR');

CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "User_email_normalized" CHECK (
        "email" = lower("email" COLLATE "C")
        AND "email" ~ '^[!-~]+$'
        AND char_length("email") BETWEEN 3 AND 254
    )
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
