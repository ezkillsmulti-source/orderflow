# ADR 0003: User identities and development accounts

Status: Accepted.

## Decision

Add a User table with Prisma-generated UUIDs, email, passwordHash, an explicit
ADMIN or OPERATOR PostgreSQL enum role, active status (default true), and
TIMESTAMPTZ(3) creation/update timestamps. Roles have no default: callers must choose.
Prisma manages updatedAt, as it does for Product. The new migration leaves the
original Product migration and its monetary constraint unchanged.

Email identifiers are case-insensitive across the entire address. The application
rejects raw inputs over 320 characters, trims surrounding JavaScript whitespace,
lowercases, and accepts ASCII dot-atom local parts (up to 64 characters) and dotted
DNS domains with labels up to 63 characters; the complete normalized address is at
most 254 characters. Quoted local
parts, Unicode/IDN addresses, and domain literals are unsupported. Dots and plus
tags remain significant; no provider-specific transformations are applied.
PostgreSQL rejects non-lowercase, non-printable-ASCII, and whitespace-containing
stored identifiers and uniquely indexes email. Thus direct writers must supply
normalized values; the application additionally validates address syntax.
This is an identifier policy, not email delivery or ownership verification.

Password hashes are internal persistence values. No user HTTP representation or
endpoint exists yet; future public representations must explicitly select safe
fields and never return raw Prisma User objects.

## Password handling and development provisioning

Use the maintained `argon2` 0.45.1 package with its reference Argon2 implementation,
bundled TypeScript declarations, and native prebuilds. Its tagged official README
supports Node >=22, including our pinned Node 24.22.0. The native install script
is explicitly allowed by pnpm. Other platforms
may require a compiler and node-gyp as described upstream.

PasswordService selects Argon2id with 19,456 KiB (19 MiB) memory, two iterations,
parallelism one, and a 32-byte output. The memory, iteration, and parallelism
settings meet OWASP's current minimum Argon2id work factors, checked on 2026-10-19.
The library generates a fresh random salt and
stores parameters/salt/hash in an encoded PHC string. Verification uses the library;
malformed or non-Argon2id stored values do not match. No custom crypto is used.
Assess higher work factors against deployment capacity before production login.

Passwords must contain 15 through 128 Unicode code points and at most 512 UTF-8
bytes, with well-formed Unicode. The minimum follows OWASP guidance without MFA;
the maximum supports long passphrases while bounding input work. Both hashing and
verification reject invalid input. Whitespace and Unicode are preserved exactly:
no trimming, case folding, normalization, composition rules, or silent truncation.
Common/breached-password screening and login throttling remain future work.

Provisioning is an explicit CLI operation requiring NODE_ENV=development and four
DEV_ADMIN/DEV_OPERATOR credential variables. It creates one ADMIN and one OPERATOR
atomically. A pre-existing normalized email must have the requested role, be active,
and verify the supplied password; otherwise the entire pair fails without changes.
Matching accounts are untouched, including their hashes and timestamps. There is
no reset, reactivation, or role elevation path. Distinct normalized emails are
required. Serializable transactions with up to three attempts for uniqueness or
serialization conflicts handle concurrent runs without duplicate effects. Hashing
new passwords happens before the transaction. Only created/unchanged counts are
returned; the CLI prints fixed failure text and never credentials, hashes, or driver
errors. It opens no HTTP server and never runs during startup or migration.
The NODE_ENV guard is not proof that a database is local: select a dedicated
development DATABASE_URL. Production provisioning remains unresolved.

## References

- [node-argon2 0.45.1 README](https://github.com/ranisalt/node-argon2/tree/v0.45.1#readme)
- [node-argon2 0.45.1 manifest](https://github.com/ranisalt/node-argon2/blob/v0.45.1/package.json)
- [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)

## Consequences

Existing Product data survives migration. New accounts require an explicit role
and password hash. Authentication endpoints, sessions, CSRF, account recovery,
email verification, and production provisioning remain pending.
