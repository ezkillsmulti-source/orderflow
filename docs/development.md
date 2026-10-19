# Development

## Toolchain

Use Node.js 24.22.0 (`.nvmrc`) and pnpm 10.34.7 (`packageManager`). For example,
with nvm installed, run `nvm install` and `nvm use`, then
`npm install --global pnpm@10.34.7`. The workspace rejects incompatible engines.
Run all documented pnpm commands from the repository root.

Install with `pnpm install --frozen-lockfile`. Dependency versions and transitive
resolution are committed; update dependencies deliberately and review the lockfile.
The API is the only workspace package. TypeScript uses strict checking and native
ES modules. ESLint checks code; Prettier checks code and documentation.

## Environment and local PostgreSQL

If `.env` does not exist, copy `.env.example` to `.env`; preserve existing local
configuration. Replace the local password in both POSTGRES_PASSWORD
and DATABASE_URL (percent-encode reserved characters in URL credentials). Do the
same for TEST_DATABASE_ADMIN_URL. Never commit `.env` or actual credentials.

Docker Compose automatically reads root `.env` for interpolation. It passes only
POSTGRES_USER, POSTGRES_PASSWORD, and POSTGRES_DB into the database container.
PostgreSQL is published only at `127.0.0.1:5432`, with a persistent named volume.
The API runs on the host at `127.0.0.1:3000`, not inside Compose.

API `dev` and `start` commands explicitly load root `.env` using Node's
`--env-file-if-exists`. Prisma CLI explicitly loads the same file through dotenv
in `apps/api/prisma.config.ts`. Existing shell variables take precedence in both
cases. DATABASE_URL is required for API startup and migrations. It must include a
PostgreSQL scheme, host, database, user, and password; only `sslmode` query
parameters are accepted so connection strings cannot override timeout controls.
PORT defaults to 3000 and must be an integer from 1 through 65535. Prisma CLI
validates DATABASE_URL independently; an invalid API PORT does not block database
commands.

Start with `docker compose up -d --wait postgres`. This polls the container health
check instead of sleeping for an arbitrary duration. Use `docker compose stop
postgres` to stop it, and `docker compose up -d --wait postgres` to restart it.
Stopping or `docker compose down` preserves data. **`docker compose down -v`
deletes the local database volume**; it is not part of normal setup.

POSTGRES_* initialization settings only apply to a fresh volume. Changing `.env`
does not change an existing database's credentials. Update the database role
explicitly or use a separate fresh Compose project/volume if you need new data.

## Migrations

After installation, run `pnpm db:generate`, then `pnpm db:migrate`. The latter runs
`prisma migrate deploy` and applies committed SQL migrations; it is safe to repeat.
Generation is also included in build, typecheck, and test scripts and does not
require a running database or `.env`. Missing DATABASE_URL is allowed only for
commands such as generation; migration commands fail when it is absent.

For an intentional schema change, edit `apps/api/prisma/schema.prisma` and run
`pnpm db:migrate:dev --name describe_change` against a disposable development
database. Prisma's development migration command needs permission to create a
shadow database and may propose resets: do not accept resets against valued data.
Review generated SQL, preserve custom constraints, and commit schema and migration
together. Use migrations, not `db push`, for normal setup. There are no seed users.
See [ADR 0002](decisions/0002-product-storage.md) for BIGINT and JSON boundaries.

## Checks and isolation

From the repository root:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
```

`pnpm format` applies formatting. `pnpm test` runs configuration, startup, database
probe, and HTTP contract tests without PostgreSQL. The HTTP tests open local ports.
`pnpm test:integration` explicitly loads root `.env` and requires
TEST_DATABASE_ADMIN_URL pointing to a **dedicated local or CI PostgreSQL server**.
Its role needs CREATEDB and permission to terminate its own test connections.
The example local PostgreSQL image creates a superuser suitable only for local
work, not production.

The integration suite creates a random `orderflow_test_*` database, overrides
DATABASE_URL only for its migration subprocesses and application instance, applies
migrations twice, tests real readiness, monetary constraints, uniqueness, and
outage/recovery, then drops only that generated database. It never migrates or
resets the database named in TEST_DATABASE_ADMIN_URL. Use a dedicated server
because the suite has database creation/deletion privileges. A killed test process
may leave a random test database; inspect its name before removing it manually.
Missing test configuration fails rather than silently skipping integration tests.

CI uses a fresh PostgreSQL service and the same commands, with read-only repository
permissions. A local pass does not establish that GitHub Actions passed.

## Troubleshooting

- A version error: select `.nvmrc` and install the declared pnpm version.
- Port 5432 occupied: stop the conflicting local service or deliberately adjust
  the Compose mapping and both database URLs together.
- Startup exits: check DATABASE_URL and PORT, and whether the API port is occupied.
  Startup and health responses intentionally do not print configuration or driver
  errors.
- Readiness is 503: check `docker compose ps` and local database credentials; apply
  migrations separately. Liveness should still return 200 during a database outage.
- Integration permission errors: use the dedicated development/CI administrative
  role, not a production account.
- Jest prints experimental VM module warnings: expected for its native ESM runner.
- SIGINT/SIGTERM: Nest closes the application and disconnects the database pool.
  Use Ctrl-C for development shutdown. The dev command rebuilds once before
  watching TypeScript output; after a compile error, fix it before trusting the
  previously compiled server output.

## Foundation verification record

On 2026-10-19, using the pinned Node.js/pnpm versions, frozen installation,
Prisma schema validation, formatting, lint, typecheck, build, 20 unit/HTTP tests,
and four integration tests passed locally. Integration tests used an actual
PostgreSQL 17.6 server from temporary binaries because Docker was unavailable.
The root migration and development commands and compiled startup/SIGTERM shutdown
were also exercised. Docker Compose startup/volume persistence and hosted GitHub
Actions execution were not verified in that environment.

The foundation review reran frozen installation, formatting, lint, typecheck, build,
Prisma validation, 22 unit/HTTP tests, and five real PostgreSQL integration tests.
A controlled failure injected into a generated test artifact after database
creation also verified fixture cleanup; that intentionally failing run left no
test database behind. The review fixed shared readiness deadlines/retained
observers and separated Prisma URL validation from the API port. Docker Compose
startup and volume persistence remain pending because Docker is unavailable;
no hosted GitHub Actions run has been claimed.
