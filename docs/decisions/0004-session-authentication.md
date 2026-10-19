# ADR 0004: PostgreSQL sessions and authentication boundaries

Status: Accepted.

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

Authentication uses the existing email/password services. Absent users undergo an
Argon2id verification against a dummy hash prepared at startup; inactive users
still undergo password verification. Valid credentials regenerate the session ID,
issue a fresh CSRF token, and save before success. Session data contains no role
snapshot: the default authentication guard loads current identity/active status/
role from User on every protected request. Public routes are explicit. This is
authentication; business role/ownership authorization is still future work.

Use csrf-sync's maintained synchronizer-token implementation, with 32 random bytes,
stored in the server session and submitted only through X-CSRF-Token. Protect all
unsafe methods, including login/logout and future routes. Exact trusted Origin is
required for unsafe methods, including CLI calls; safe calls with an Origin must
also match. Missing Origin on GET is accepted, with no CORS enabled. Regeneration
invalidates the old token. After logout, clients fetch a new anonymous token before
another logout; this flow is safe and returns 204 even if already anonymous.
Passwords, hashes, and raw parser/driver errors are never logged or returned.
Session IDs travel only in HttpOnly cookies; CSRF tokens travel in no-store JSON
responses and request headers. Neither belongs in URLs or application logs.
Cookies and CSRF responses must be excluded from proxy/access
logs and library session debugging must remain disabled. Auth responses are no-store.

Use rate-limiter-flexible's atomic PostgreSQL counters, with migration-managed
tables and no in-memory fallback or automatic DDL/cleanup. Admit 200 non-health
requests per minute globally across instances, before session allocation endpoints
can persist new rows. Login then consumes 30 attempts per source IP and 10 per
normalized account per fixed 15-minute window before Argon2. Successful attempts
also count; blocked attempts do not extend the window. Account keys use Node's
standard SHA-256 digest to avoid plaintext email keys, not as a secrecy guarantee.
No attempted passwords are stored. Return 429 with Retry-After when limited and
sanitized 503 on storage failure. No permanent lockout exists; targeted temporary
account denial remains a tradeoff of account-level limiting.

Delete at most 500 expired limiter rows per minute per instance using its expiry
index. The shared admission limit bounds new limiter keys to at most 400 per
minute-long window and sessions to 200 per window, below average cleanup capacity
for each table. Expiry still
applies if cleanup fails; monitor cleanup backlog/disk space and tune capacity as
traffic becomes known. This intentionally modest global ceiling is a foundation
limit and can cause 429 responses during busy periods. Trust forwarded client IPs
only from the configured proxy allowlist; the proxy must replace untrusted
forwarded headers, and direct network access must be prevented. Keep clocks on
API instances and PostgreSQL synchronized. No Redis or worker is introduced.

## References

- [express-session](https://expressjs.com/en/resources/middleware/session/)
- [connect-pg-simple](https://github.com/voxpelli/node-connect-pg-simple)
- [csrf-sync](https://github.com/Psifi-Solutions/csrf-sync)
- [rate-limiter-flexible PostgreSQL](https://github.com/animir/node-rate-limiter-flexible/wiki/PostgreSQL)
- [OWASP session guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [OWASP authentication guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
