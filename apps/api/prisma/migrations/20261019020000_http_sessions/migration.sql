CREATE TABLE "http_session" (
    "sid" VARCHAR(255) NOT NULL PRIMARY KEY,
    "sess" JSON NOT NULL,
    "expire" TIMESTAMPTZ(6) NOT NULL
);
CREATE INDEX "http_session_expire_idx" ON "http_session"("expire");
