# ADR 0003: User identities and development accounts

Status: Accepted for persistence; password handling and provisioning follow in the next task commit.

## Decision

Add a User table with Prisma-generated UUIDs, email, passwordHash, an explicit
ADMIN or OPERATOR PostgreSQL enum role, active status (default true), and
TIMESTAMPTZ(3) creation/update timestamps. Roles have no default: callers must choose.
Prisma manages updatedAt, as it does for Product. The new migration leaves the
original Product migration and its monetary constraint unchanged.

Email identifiers are case-insensitive across the entire address. The application
rejects raw inputs over 320 characters, trims surrounding JavaScript whitespace,
lowercases, and accepts ASCII dot-atom
local parts (up to 64 characters) and dotted DNS domains with labels up to 63
characters; the complete normalized address is at most 254 characters. Quoted local
parts, Unicode/IDN addresses, and domain literals are unsupported. Dots and plus
tags remain significant; no provider-specific transformations are applied.
PostgreSQL rejects non-lowercase, non-printable-ASCII, and whitespace-containing
stored identifiers and uniquely indexes email. Thus direct writers must supply
normalized values; the application additionally validates address syntax.
This is an identifier policy, not email delivery or ownership verification.

Password hashes are internal persistence values. No user HTTP representation or
endpoint exists yet; future public representations must explicitly select safe
fields and never return raw Prisma User objects.

## Consequences

Existing Product data survives migration. New accounts require an explicit role
and password hash. Authentication endpoints, sessions, CSRF, account recovery,
email verification, and production provisioning remain pending.
