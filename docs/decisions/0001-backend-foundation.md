# ADR 0001: Backend foundation and reproducible tooling

Status: Accepted.

## Context

The first runnable increment needs an API, persistence, and repeatable checks.
The original roadmap also included a frontend; the requested milestone now
explicitly defers it. There is no background workflow or shared package consumer.

## Decision

Use one pnpm workspace package, `apps/api`, with NestJS modules and direct Prisma
access. Pin Node.js 24.22.0 LTS in `.nvmrc`, pnpm 10.34.7 in `packageManager`, and
exact direct dependencies with a committed lockfile. Use NestJS 12.2.0, Prisma
7.10.1, PostgreSQL 17.6, and TypeScript 6.0.3 with native ESM and strict checking.
Use ESLint 10 and Prettier 3. Tests compile with TypeScript before Jest 30 runs,
so tests exercise the same decorator metadata and module semantics as the build.
Jest's ESM runner currently requires Node's experimental VM modules flag.

Prisma 7 uses `prisma.config.ts`, explicit environment loading, a generated client
with an explicit output path, and `@prisma/adapter-pg`. Keep all Prisma packages at
the same version. Generation needs no database; migrations require DATABASE_URL.
No generated source is committed.

## Consequences

Contributors need the pinned toolchain and Docker Compose v2 with `up --wait`.
There is no frontend or browser test yet. No generic repositories, shared packages,
Redis, or worker are introduced. Root scripts target only the API. Future patch
updates require a deliberate version and lockfile change. Container tags pin a
release, not an immutable image digest.

## References

- [Node release schedule](https://github.com/nodejs/Release)
- [NestJS migration and runtime compatibility](https://docs.nestjs.com/migration-guide)
- [Prisma 7 configuration, ESM, and adapter requirements](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7)
- [pnpm installation and compatibility](https://pnpm.io/installation)
- [PostgreSQL image and persistence](https://hub.docker.com/_/postgres)
