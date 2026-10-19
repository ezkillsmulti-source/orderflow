# ADR 0004: PostgreSQL sessions and authentication boundaries

Status: Accepted; endpoint/CSRF/throttling implementation follows the infrastructure commit.

Use express-session with connect-pg-simple and the existing PostgreSQL server.
The maintained store supports PostgreSQL 9.5+ and the pinned Node 24 runtime.
Session IDs and cookie signing come from express-session; no custom session or
cryptographic framework is introduced. Version the store table in Prisma SQL
migrations and disable runtime table creation and the store's unbounded pruner.

Sessions have a 30-minute idle lifetime and an eight-hour absolute lifetime,
including anonymous CSRF sessions. Server timestamps enforce both independently
of browser cookies. Explicit persistence refreshes idle expiry, capped by the
absolute deadline; uninitialized requests do not create rows. Only identity ID,
lifetime metadata, and CSRF state may be stored, never passwords or hashes.
Session load/save/destroy failures produce sanitized 503 responses.

The store handles creation/load/destruction. Activity renewal uses a conditional
UPDATE of expiry/lastSeen on an existing live row, without changing the loaded
session's serialized fields or invoking an upsert. This applies the lifetime
policy while preventing an in-flight read request from recreating a logged-out
session. Automatic store touch is disabled; authenticated requests renew explicitly
before responding. Cookie renewal is rolling and capped by the absolute deadline.

Delete at most 500 expired rows per minute per instance with SKIP LOCKED, an expiry
index, query deadlines, and no overlapping ticks. Cleanup failure retries on the
next tick. Shutdown stops the timer, awaits pending cleanup, and closes the pool.
Expired rows are rejected even when cleanup lags. Monitor table growth/capacity.

The cookie is HttpOnly, SameSite=Lax, Path=/, and has no Domain. In production it
is Secure and named __Host-orderflow.sid; local HTTP uses orderflow.sid without
Secure. Production requires explicit HTTPS origins and proxy IP/CIDR allowlists.
No unrestricted trust proxy or credentialed CORS is enabled. SESSION_SECRET is
a required generated 32-byte hex value shared by all instances. Replacing it
invalidates existing cookies; coordinated secret rotation remains operational work.

## References

- [express-session](https://expressjs.com/en/resources/middleware/session/)
- [connect-pg-simple](https://github.com/voxpelli/node-connect-pg-simple)
- [OWASP session guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
