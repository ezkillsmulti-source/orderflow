# Development

## Toolchain

Use Node.js 24.22.0 (`.nvmrc`) and pnpm 10.34.7 (`packageManager`). For example,
with nvm installed, run `nvm install` and `nvm use`, then
`npm install --global pnpm@10.34.7`. The workspace rejects incompatible engines.
Run all documented pnpm commands from the repository root.

Install with `pnpm install --frozen-lockfile`. Dependency versions and transitive
resolution are committed; update dependencies deliberately and review the lockfile.
The workspace contains the API and React frontend. TypeScript uses strict checking and native
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

### Isolated Compose persistence verification

Use a unique project name with `docker compose -p`, a temporary `--env-file`
containing fresh POSTGRES_* values, and the repository's `compose.yaml`. To avoid
the normal port mapping, add a temporary override file with `-f` after the base
file (the `!override` tag requires Compose 2.24.4 or later):

```yaml
services:
  postgres:
    ports: !override
      - '127.0.0.1::5432'
```

Keep the same project name, environment file, and Compose files for every command.
Start with `up -d --wait postgres`, discover the assigned port with
`port postgres 5432`, and export DATABASE_URL and TEST_DATABASE_ADMIN_URL for that
isolated server before running migrations and integration tests. Use the temporary
application database for DATABASE_URL and `postgres` for TEST_DATABASE_ADMIN_URL.
Shell variables override any root `.env` values; leave the local `.env` untouched.

Apply `pnpm db:migrate` twice, insert a disposable Product row, and verify the row
and migration history after `stop postgres` / `up -d --wait postgres`, then after
`down` / `up -d --wait postgres`. Confirm that `down` retains the named volume and
that the recreated container has a different ID. Finally, run
`down -v --remove-orphans` **only for this disposable project**, check that its
containers, network, and volume are gone, and remove temporary configuration.
Clean up the isolated project even if a verification step fails.

## Migrations

API startup now also requires SESSION_SECRET (64 random hex characters) and
AUTH_TRUSTED_ORIGINS (comma-separated exact origins). Generate the secret locally
with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
Set `AUTH_TRUSTED_ORIGINS=http://127.0.0.1:3000` for local HTTP. Use the same secret
and database on every API instance. Never commit the generated secret or overwrite
your existing `.env`. Provisioning and migration commands do not require these API
settings. Production additionally requires HTTPS origins and AUTH_TRUST_PROXY with
explicit proxy IPs/CIDRs; wildcard/hop-count/unrestricted trust is rejected.
The API currently listens on loopback; deploy behind an explicitly trusted local
TLS proxy and prevent access that bypasses it. See [ADR 0004](decisions/0004-session-authentication.md).

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
together. Use migrations, not `db push`, for normal setup. Migrations create no users.
See [ADR 0002](decisions/0002-product-storage.md) for BIGINT and JSON boundaries.

## Development account provisioning

After starting the dedicated local PostgreSQL server, install dependencies and
apply migrations from the root:

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:migrate
```

Edit your existing local `.env` without replacing other settings. Add these
variables using your own credentials; `.env.example` contains placeholders only:

```dotenv
NODE_ENV=development
DEV_ADMIN_EMAIL=admin@example.test
DEV_ADMIN_PASSWORD=replace_with_a_unique_admin_passphrase
DEV_OPERATOR_EMAIL=operator@example.test
DEV_OPERATOR_PASSWORD=replace_with_a_unique_operator_passphrase
```

Replace both password placeholders before proceeding. Use quotes in `.env` when
values contain whitespace or `#`; passwords are never trimmed or normalized.
They must be well-formed Unicode, 15–128 code points, at most 512 UTF-8 bytes.
Use two distinct normalized email addresses. Emails are trimmed and lowercased;
supported syntax, limits, and the absence of provider-specific transformations are
documented in [ADR 0003](decisions/0003-user-accounts.md).

Confirm DATABASE_URL points to the intended **development** database, then run:

```bash
pnpm users:provision:dev
```

This builds the CLI and loads root `.env` using Node, with shell variables taking
precedence. It requires NODE_ENV to equal `development` exactly; unset, test, and
production modes fail. The guard does not identify a production server for you.
Do not put passwords on command lines, commit `.env`, or copy real credentials to
documentation. The command prints only created/unchanged counts, with no email,
password, or hash. Failures return a nonzero exit code with fixed diagnostic text.

The command creates one active ADMIN and one active OPERATOR in a single
transaction. Repeating with matching role, active status, and password leaves
existing rows (including password hashes and timestamps) untouched. An existing
account with a different password/role, inactive status, or an unusable hash causes
the entire pair to fail; a newly created companion account is rolled back. No
account is silently reset, reactivated, or elevated. Inspect conflicts with a
trusted database tool and resolve account management deliberately; this command is
not a reset tool. Concurrent invocations retry uniqueness/serialization conflicts
up to three attempts; an exhausted retry fails safely and can be rerun.

Provisioning never runs during API startup or migrations. Password recovery and
production account provisioning remain pending. Provisioned users can authenticate
through the following API.

## Authentication API

All authentication responses use `Cache-Control: no-store`. Never log cookie/CSRF
headers, token responses, or request bodies containing credentials. Do not enable
session-library debug logging, verbose curl traces, or proxy logging of these values.
There is no CORS middleware: use a same-origin browser deployment. Safe requests
may omit Origin; if present, it must exactly match AUTH_TRUSTED_ORIGINS. Every
unsafe request requires a trusted Origin, including CLI clients; there is no CLI
bypass. Future unsafe routes inherit CSRF checks and the default authentication
guard; public endpoints must opt out of authentication explicitly.

| Endpoint            | Request                                                   | Success                                                                                                                          | Relevant errors                                                                                             |
| ------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GET /auth/csrf`    | Current cookie if available                               | 200 `{ "csrfToken": "..." }`, anonymous session if needed                                                                        | 429 admission limit, 503 store failure                                                                      |
| `POST /auth/login`  | JSON email/password; cookie, trusted Origin, X-CSRF-Token | 200 `{ "user": { "id": "...", "email": "...", "role": "ADMIN" }, "csrfToken": "..." }`; regenerated cookie/token persisted first | 400 malformed/out-of-bounds input, 401 generic credentials, 403 origin/CSRF, 429 limits, 503 infrastructure |
| `GET /auth/me`      | Authenticated cookie                                      | 200 `{ "user": { "id": "...", "email": "...", "role": "ADMIN" } }`                                                               | 401 missing/expired/inactive account, 429 admission limit, 503 storage                                      |
| `POST /auth/logout` | Cookie, trusted Origin, current X-CSRF-Token              | 204, server session destroyed and cookie cleared                                                                                 | 403 stale/missing token or origin, 429 admission limit, 503 store failure                                   |

Email normalization and password bounds follow ADR 0003; no password trimming or
Unicode normalization occurs. Login rejects unknown input fields, and invalid,
nonexistent, and inactive accounts receive the same credential error for valid
credential syntax. Absent accounts still undergo dummy Argon2id verification.
The default JSON parser bounds bodies to 100 KiB; email/password validation applies
the much smaller documented limits before password verification. Password hashes
and session IDs never appear in JSON responses.

Sessions expire server-side after 30 idle minutes or eight hours total, including
anonymous sessions. Successful identity/token access refreshes activity with a
conditional UPDATE, capped at the absolute deadline. Login creates a fresh session
and token; clients must replace the old token. Current active status and role are
read on every protected request. A failed store operation returns 503 and must not
be treated as login failure or successful logout. Retry logout once storage
recovers. Login persistence failures discard the request's session without issuing
an authenticated cookie. Response-end duplicate saves reuse the first write
result; they cannot recreate a session revoked by another instance. To repeat
logout after success, fetch a fresh anonymous token/cookie and
submit that pair; reusing the destroyed session's token returns 403.

Shared PostgreSQL limits admit 200 non-health requests per fixed minute globally;
login additionally allows 30 attempts per source IP and 10 per normalized account
per 15-minute window. Successful and failed logins count. Responses include
Retry-After on 429; attempts do not extend the window or cause permanent lockout.
Account keys are standard SHA-256 digests, not plaintext passwords or a secrecy
guarantee for email. Counter failure returns 503 with no local fallback. The
admission limit bounds new rows; expired session and limiter cleanup deletes up to
500 rows per table per minute per instance, without overlapping jobs. Monitor
backlog/capacity and keep API/database clocks synchronized. Thresholds are initial
capacity choices, not a production traffic sizing claim.

For production, set NODE_ENV=production, use HTTPS origins and a shared random
SESSION_SECRET, and configure AUTH_TRUST_PROXY with only actual proxy addresses (for a
local proxy, for example `127.0.0.1/32,::1/128`). The proxy must replace client-supplied
forwarded headers and keep the loopback API unreachable directly. Production cookies are
`__Host-orderflow.sid`, Secure, HttpOnly, SameSite=Lax, Path=/, without Domain;
untrusted/plain HTTP is rejected. Local HTTP uses `orderflow.sid` with the same
attributes except Secure. Browser SameSite behavior is not established by HTTP/header
tests. Catalog role authorization is implemented; order ownership remains pending.

### Curl walkthrough

Start the migrated API and explicitly provision local users as described above.
From the repository root, run this with the pinned Node version. It reads matching
credentials from local `.env` (shell values take precedence), keeps tokens and
credentials in a private temporary directory, and prints only safe identity and
HTTP status. Use the configured trusted origin; local defaults are shown.

```bash
umask 077
auth_tmp=$(mktemp -d)
auth_origin=http://127.0.0.1:3000
trap 'rm -rf -- "$auth_tmp"' EXIT

node --env-file-if-exists=.env --input-type=module -e '
  import { writeFileSync } from "node:fs";
  writeFileSync(process.argv[1], JSON.stringify({
    email: process.env.DEV_ADMIN_EMAIL, password: process.env.DEV_ADMIN_PASSWORD
  }), { mode: 0o600 });
' "$auth_tmp/credentials.json"

curl --fail --silent --show-error -c "$auth_tmp/cookies" \
  -o "$auth_tmp/csrf.json" "$auth_origin/auth/csrf"
node --input-type=module -e '
  import { readFileSync, writeFileSync } from "node:fs";
  writeFileSync(process.argv[2], "X-CSRF-Token: " +
    JSON.parse(readFileSync(process.argv[1], "utf8")).csrfToken);
' "$auth_tmp/csrf.json" "$auth_tmp/csrf.header"

curl --fail --silent --show-error -b "$auth_tmp/cookies" -c "$auth_tmp/cookies" \
  -H "Origin: $auth_origin" -H 'Content-Type: application/json' \
  -H "@$auth_tmp/csrf.header" --data-binary "@$auth_tmp/credentials.json" \
  -o "$auth_tmp/login.json" "$auth_origin/auth/login"
curl --fail --silent --show-error -b "$auth_tmp/cookies" \
  "$auth_origin/auth/me"

# Login rotated the token. Retrieve the current token before logout.
curl --fail --silent --show-error -b "$auth_tmp/cookies" -c "$auth_tmp/cookies" \
  -o "$auth_tmp/csrf.json" "$auth_origin/auth/csrf"
node --input-type=module -e '
  import { readFileSync, writeFileSync } from "node:fs";
  writeFileSync(process.argv[2], "X-CSRF-Token: " +
    JSON.parse(readFileSync(process.argv[1], "utf8")).csrfToken);
' "$auth_tmp/csrf.json" "$auth_tmp/csrf.header"
curl --fail --silent --show-error -b "$auth_tmp/cookies" -c "$auth_tmp/cookies" \
  -H "Origin: $auth_origin" -H "@$auth_tmp/csrf.header" -X POST \
  -o /dev/null -w '%{http_code}\n' "$auth_origin/auth/logout"
```

Logout returns 204. A subsequent `/auth/me` with that cookie jar returns 401.
Repeat the CSRF GET/header extraction and logout POST to demonstrate safe repeated
logout with a fresh anonymous session. Temporary files are deleted on shell exit;
remove them sooner if desired. This walkthrough creates no accounts implicitly.

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

The integration suites create random `orderflow_test_*` databases, override
DATABASE_URL only for their migration subprocesses and application instances, apply
migrations twice, test real readiness, monetary constraints, uniqueness, and
outage/recovery, then drop only their generated databases. They never migrate or
reset the database named in TEST_DATABASE_ADMIN_URL. Use a dedicated server
because the suite has database creation/deletion privileges. A killed test process
may leave a random test database; inspect its name before removing it manually.
Missing test configuration fails rather than silently skipping integration tests.

User integration tests exercise the full migration history on a fresh database,
an upgrade from the original Product-only history preserving Product data and its
price constraint, PostgreSQL email/role constraints, and development provisioning
(including rollback, conflicts, concurrency, and the CLI). Each suite drops only
its generated databases. Temporary migration configurations are removed as well.

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
Actions execution were not verified during that run.

The foundation review reran frozen installation, formatting, lint, typecheck, build,
Prisma validation, 22 unit/HTTP tests, and five real PostgreSQL integration tests.
A controlled failure injected into a generated test artifact after database
creation also verified fixture cleanup; that intentionally failing run left no
test database behind. The review fixed shared readiness deadlines/retained
observers and separated Prisma URL validation from the API port. Docker Compose
startup and volume persistence were still pending during that review because
Docker was unavailable; hosted GitHub Actions had not yet been verified.

The follow-up on 2026-10-19 verified Docker Compose startup and persistence using
Docker Engine 29.9.1, Compose 5.6.0, and `postgres:17.6-bookworm`. A unique project,
fresh temporary credentials, and a dynamically assigned loopback port isolated the
run from local development configuration. With Node.js 24.22.0 and pnpm 10.34.7,
frozen installation, client generation, two migration deployments, formatting,
lint, typecheck, 22 unit/HTTP tests, five integration tests, and build passed.
The integration suite left no `orderflow_test_*` database behind.

A disposable Product row retained the exact `9007199254740991` price and the
completed migration count remained one after both stop/start and down/up.
The named volume survived `down`, and the replacement container had a different
ID. Final project-scoped `down -v --remove-orphans` removed the test containers,
network, and volume; label-filtered checks confirmed none remained. Temporary
configuration was removed and local `.env` was untouched.

Hosted [CI run 39298019283](https://github.com/ezkillsmulti-source/orderflow/actions/runs/39298019283)
also completed successfully for foundation commit `e42db66`. This records that
specific run; consult the PR checks for results on subsequent commits.

## User account verification record

On 2026-10-19, with Node.js 24.22.0 and pnpm 10.34.7, frozen installation,
Prisma schema validation, formatting, lint, typecheck, 53 unit/HTTP tests, 25
integration tests, and build passed locally. The integration tests used a unique
Compose project with PostgreSQL 17.6, temporary credentials, and a dynamically
assigned loopback port. They covered fresh migrations, a Product-preserving
upgrade, normalized uniqueness, role constraints, password verification, and
atomic/repeatable/concurrent development provisioning.

The documented root `pnpm db:migrate` and `pnpm users:provision:dev` commands were
also exercised on a separate random database. Provisioning created two accounts,
then reported two unchanged accounts with identical stored fields on repetition.
Production mode returned a nonzero exit code without mutations. Captured output
contained no generated passwords or stored hashes. No local `.env` was changed.
All generated test databases, project containers, network, volume, and temporary
configuration were removed. These are local results; this branch has not been
pushed and no hosted check is claimed for it.

## Session infrastructure verification

On 2026-10-19, using pinned Node/pnpm and an isolated PostgreSQL 17.6 Compose
project, frozen installation, Prisma validation, formatting, lint, typecheck,
68 unit/HTTP tests, 34 integration tests, and build passed. Tests exercised shared
session persistence, server expiry, missing-store failure, cookie attributes,
bounded cleanup, and renewal that cannot recreate a deleted session. Test databases
and the project's containers, network, volume, and temporary configuration were
removed. Authentication endpoints are added in the subsequent task commit.

## Session authentication verification

On 2026-10-19, the completed authentication task passed frozen installation,
Prisma validation, formatting, lint, typecheck, 69 unit/HTTP tests, 57 real
PostgreSQL integration tests, and build using Node 24.22.0/pnpm 10.34.7. The full
four-migration history works on fresh databases; the original Product/User
migrations remain unchanged. Tests also upgrade the Product-only history without
changing Product data or its monetary constraints.

HTTP tests cover rotation, safe identity, dummy credential verification,
cross-instance sessions, CSRF/origin checks, expiration without sleeps, current
role/status, default route protection, storage failures, and shared account/source/
admission limits. Cleanup tests bound both tables' deletion batches. The final
suite passed after correcting health-route path handling and suppressing a second
response attempt from session failure callbacks. No existing assertions were weakened.

The curl walkthrough above was executed against the compiled API on a separate
random development database, with only its ephemeral port substituted. Observed:
CSRF 200, login 200 with session/token rotation, identity 200, current-token 200,
logout 204, identity 401, and fresh-token repeated logout 204. The API completed
SIGTERM shutdown, and captured logs contained no test passwords/hashes or CSRF
tokens. All generated databases, temporary credential/cookie/token files, and
isolated Compose resources were removed; local `.env` was unchanged. Results are
local, not hosted CI or browser SameSite verification.

### Publication review

The 2026-10-19 review reproduced two persistence failures before fixing them:
a transient explicit login-save failure could be retried automatically at response
end, and a delayed duplicate save could recreate a session revoked by another
instance. Regression tests now reject both behaviors and cover an HTTP identity
request whose renewal follows concurrent logout. The two affected PostgreSQL
integration suites passed all 35 tests using the pinned toolchain and a disposable
Compose server. The previous full-suite record above remains separate evidence;
the publication review did not repeat unrelated local suites. Formatting, lint,
and typecheck also passed after the fix.

Local Gitleaks 8.30.1 (official release with verified SHA-256) found no leaks in
reachable Git history or a snapshot of tracked files. Targeted inspection also
checked reachable blobs for credential URLs, literal secret assignments, private
keys, and common service-token formats. Candidates were placeholders or synthetic
test fixtures. No repository content was uploaded and no secret values were printed.
This does not prove the absence of every possible secret; ignored local files,
unreachable objects, external logs/artifacts, and remote-only refs were not scanned.

## Backend catalog development

The [catalog contract](product-catalog.md) records the implemented backend catalog and
approved validation, editing, and archival policies. Use the existing authentication
walkthrough to obtain a cookie and the rotated CSRF token. Catalog writes require the
same trusted Origin and X-CSRF-Token; there is no CLI bypass.

Catalog integration tests use the existing random-database fixture and migrations. They
cover current roles/status, exact monetary strings, validation, SKU races, archive
visibility, bounded deterministic pagination, conditional edit/archive races,
repeated/concurrent archival, and sanitized errors. One concurrency test observes
PostgreSQL row-lock waiting before committing the competing archive. Race tests
synchronize request arrivals explicitly rather than sleeping. Test Nest apps exercising
catalog writes enable rawBody=true, matching main, to validate UTF-8 bytes before any
catalog mutation. No previous migration is modified.

### Manual catalog walkthrough

Start the migrated API and provision both development accounts using the existing
procedures. From the root, run this with the pinned Node version and your trusted origin
in AUTH_TRUSTED_ORIGINS. Credentials come from local configuration, not command
arguments. The script keeps cookies/tokens in process memory and prints only method,
path, and status. It creates one uniquely named product and leaves it archived; run
against a dedicated development database. It does not change stock.

```bash
node --env-file-if-exists=.env --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const origin = process.env.AUTH_TRUSTED_ORIGINS.split(',')[0].trim();
const base = process.env.CATALOG_API_URL ?? origin;
const unsafe = (method) => !['GET', 'HEAD', 'OPTIONS'].includes(method);
async function api(session, method, path, body, expected) {
  const headers = { Origin: origin };
  if (session.cookie) headers.Cookie = session.cookie;
  if (unsafe(method) && session.token) headers['X-CSRF-Token'] = session.token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${base}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const issued = response.headers.getSetCookie()[0];
  if (issued) session.cookie = issued.split(';')[0];
  assert.equal(response.status, expected, `${method} ${path}`);
  console.log(`${method} ${path}: ${response.status}`);
  return response.status === 204 ? null : response.json();
}
async function login(email, password) {
  assert.ok(email && password, 'Development credentials are required.');
  const session = {};
  const csrf = await api(session, 'GET', '/auth/csrf', undefined, 200);
  session.token = csrf.csrfToken;
  const logged = await api(session, 'POST', '/auth/login', { email, password }, 200);
  session.token = logged.csrfToken; // Login rotates the token and cookie.
  return session;
}

await api({}, 'GET', '/products', undefined, 401);
const admin = await login(process.env.DEV_ADMIN_EMAIL, process.env.DEV_ADMIN_PASSWORD);
const operator = await login(process.env.DEV_OPERATOR_EMAIL, process.env.DEV_OPERATOR_PASSWORD);
const body = { sku: `MANUAL-${randomUUID()}`, name: ' Manual coffee ', priceMinor: '9007199254740991' };
const product = await api(admin, 'POST', '/products', body, 201);
assert.equal(product.priceMinor, '9007199254740991');
assert.equal(product.name, 'Manual coffee');
const path = `/products/${product.id}`;
await api(operator, 'GET', path, undefined, 200);
await api(operator, 'GET', '/products?status=all&limit=1&offset=0', undefined, 200);
await api(operator, 'POST', '/products', body, 403);
await api(operator, 'PATCH', path, { name: 'Denied' }, 403);
await api(operator, 'POST', `${path}/archive`, undefined, 403);
await api(admin, 'POST', '/products', body, 409);
await api(admin, 'PATCH', path, { priceMinor: '1.5' }, 400);
const changed = await api(admin, 'PATCH', path, { priceMinor: '0', description: ' ' }, 200);
assert.equal(changed.priceMinor, '0');
assert.equal(changed.description, null);
const token = admin.token;
admin.token = 'invalid';
await api(admin, 'PATCH', path, { name: 'Denied' }, 403);
admin.token = token;
const archived = await api(admin, 'POST', `${path}/archive`, undefined, 200);
assert.equal(archived.active, false);
assert.deepEqual(await api(admin, 'POST', `${path}/archive`, {}, 200), archived);
await api(admin, 'PATCH', path, { name: 'Denied' }, 409);
assert.deepEqual(await api(operator, 'GET', path, undefined, 200), archived);
await api(operator, 'GET', '/products?status=archived', undefined, 200);
await api(admin, 'POST', '/auth/logout', undefined, 204);
await api(operator, 'POST', '/auth/logout', undefined, 204);
await api(admin, 'GET', '/products', undefined, 401);
JS
```

CATALOG_API_URL can select an API address separately from the configured trusted Origin,
for example an ephemeral local port. This does not bypass Origin or CSRF validation.
This HTTP walkthrough does not verify browser SameSite behavior.

### Backend catalog verification record

On 2026-10-19, using Node 24.22.0 and pnpm 10.34.7, frozen installation,
formatting, lint, typecheck, all 82 unit/HTTP tests, all 169 PostgreSQL integration
tests, and build passed. Docker access was unavailable; tests used a dedicated
PostgreSQL 17.6 server compiled from the official source archive with its published
SHA-256 verified. No schema or migration changes were needed.

Catalog tests cover current-role authorization before product access, inactive
users, anonymous requests with valid CSRF, Origin/CSRF denials, exact price limits,
malformed Unicode/UTF-8, rejected mutation rollback, SKU races, filtering and
bounded pagination, submitted-field last-write-wins, concurrent/repeated archival,
and an SQL edit blocked behind an uncommitted archive. Synchronization uses explicit
gates and observed database lock state, not arbitrary sleeps.

The manual walkthrough above was executed against the compiled API on a separate
random database, using root pnpm db:migrate and users:provision:dev with ephemeral
credentials. Observed: unauthenticated read 401; both logins 200; creation 201;
operator reads 200 and all three mutation types 403; duplicate SKU 409; invalid
price 400; valid edit 200; invalid CSRF 403; first/repeated archive 200 with the same
representation/timestamp; archived edit 409; operator archived reads 200; both
logouts 204; subsequent protected read 401. PostgreSQL retained one archived row
with exact zero price and no remaining sessions. Captured API logs contained
neither generated account password nor SESSION_SECRET.

The compiled API completed SIGTERM shutdown. All generated test/manual databases
were removed, and the disposable PostgreSQL server was stopped. Local .env was
untouched. These are local HTTP/database results; no hosted CI or browser/SameSite
verification is claimed. Frontend, inventory, orders, optimistic locking, and
snapshot-consistent pagination remain unimplemented.

### Catalog publication review

The publication review reproduced acceptance of form-encoded catalog bodies,
including malformed percent-encoded UTF-8 that the form parser replaced before
validation. Catalog bodies now require application/json; unrelated route parsers
retain their existing behavior. Raw JSON bytes still use Nest rawBody capture and
a fatal UTF-8 decoder without a second JSON parser or a higher body-size limit.

Buffer-based HTTP regressions explicitly bypass Superagent JSON serialization so
they send the intended wire bytes. A valid raw Buffer control verifies the test
transport; malformed raw UTF-8 and non-UTF-8 JSON are rejected before service calls.
Focused HTTP tests also preserve the 100 KiB JSON limit and unrelated JSON/form
parsing. The original full-suite verification above is separate evidence.

With the pinned Node/pnpm versions, formatting, lint, typecheck, build, 40 focused
unit/HTTP tests (encoding, error classification, health, and auth configuration),
and 136 PostgreSQL catalog/authentication integration tests passed after the fix.
The full local suite was not repeated. All random review databases were removed
and the dedicated PostgreSQL 17.6 server was stopped. No existing migration or
local .env was changed. Hosted CI results are tracked separately on the PR.

## React frontend

The frontend is in apps/web (React, Vite, strict TypeScript). Login, identity
restoration, logout, product list/detail reads, and administrator forms are implemented. Run `pnpm dev` for
the API, and `pnpm dev:web` in another terminal. Open http://127.0.0.1:5173.
Set AUTH_TRUSTED_ORIGINS to include that exact origin while retaining any CLI origin.
Existing .env files are never rewritten: update the trusted-origin list locally.

Vite binds 127.0.0.1:5173 with strictPort. Relative /api requests are proxied to
127.0.0.1:3000 with the prefix removed and browser Origin preserved. An optional
server-only API_PROXY_TARGET in apps/web/.env.local can select another local API
address; for example `API_PROXY_TARGET=http://127.0.0.1:3000`. No API secret belongs
in a VITE_ variable or browser bundle. The Vite development proxy is not production
hosting. A future deployment needs a same-origin reverse proxy and HTTPS.

Root build/typecheck/test commands include both packages. `pnpm test:integration`
continues to run the isolated PostgreSQL backend suite. The proxy test exercises
real local HTTP forwarding and preserves cookie attributes.

Dependency compatibility was checked on 2026-10-19 against official documentation:
[React versions](https://react.dev/versions), [Vite requirements](https://vite.dev/guide/),
[Vitest requirements](https://vitest.dev/guide/), and [Playwright installation](https://playwright.dev/docs/intro).
Exact stable versions are pinned in apps/web/package.json. Node 24.22.0 satisfies
the selected tools' engine ranges. No UI kit, state framework, or client-side router
is added at this stage.

### Browser checks

From the root run `pnpm --filter @orderflow/web browser:install` once, then
`pnpm test:browser`. Linux CI installs OS dependencies with
`pnpm --filter @orderflow/web exec playwright install --with-deps chromium`.
The runner loads TEST_DATABASE_ADMIN_URL, creates only a random test database,
applies migrations, provisions ephemeral accounts, starts API/Vite, and cleans up
servers/database even on failure. It never migrates the database in the admin URL.
Port 5173 must be free; an existing developer frontend is never reused.

Playwright runs Chromium at desktop/mobile sizes, with isolated browser contexts
and condition-based assertions. Traces, video, screenshots, persisted storage state,
and public artifact uploads are disabled. Test account secrets are redacted from
runner output. No credentials or tokens belong in browser storage or logs.

Authentication uses relative /api requests and browser-managed HttpOnly cookies.
CSRF is memory-only, acquired before login and replaced using login's csrfToken.
Identity is restored through /auth/me. A generation boundary cancels old requests
and rejects stale responses after logout/account changes. The generation check also
covers already-decoded 401/403 errors before their rejection handlers can invalidate
or revalidate a newer session. A failed logout retains
identity and reports an uncertain outcome; 503 does not imply unauthenticated.
403 triggers identity revalidation and invalidates the cached CSRF token, without
assuming token expiration or replaying a mutation. No mutation retries are automatic.

The authentication increment passed formatting, lint, typecheck, both builds, seven
web unit/proxy tests, and four real-API browser checks at 1280x900 and 390x844.
The rendered login was inspected at both sizes. Automated checks do not establish
complete accessibility compliance. These are intermediate authentication checks;
the final catalog verification record below includes the combined application.

### Browsing the catalog

After login, both roles can list products and open details, including archives.
Use Product status and Products per page; Previous/Next use hasMore rather than
an invented total count. List state is encoded in the hash URL and detail back-links
retain it. Invalid list bounds are rejected; offset never exceeds 10,000.

Prices display in ARS using es-AR grouping with exactly two fractional digits.
For example the API maximum "9007199254740991" displays as
"ARS 90.071.992.547.409,91". Formatting splits bigint minor units into pesos and
centavos; no floating-point monetary conversion occurs. Loading, empty, forbidden,
unavailable, and missing-product states are distinct. Product text is rendered
through React text nodes, never HTML. Read-only browser flows cover both viewports.
The [workspace design guide](ui-design.md) describes the warm burgundy tokens,
page hierarchy, grouped forms, and responsive/accessibility decisions. Status uses
always-visible Active/Archived/All products radios; query changes keep control focus.
Use View on any record and Edit on active ADMIN records. A horizontal table region
is named Product catalog, has keyboard focus, and does not widen the page.

The browsing increment passed 14 web unit/proxy tests and eight real-API browser
checks across desktop/mobile, plus formatting, lint, typecheck, and the web build.
Catalog captures were inspected at both sizes. Narrow screens use a keyboard-focusable
horizontally scrollable table, with a visible scrolling hint and readable columns.

### Administrator catalog actions

Administrators can create a product, edit only changed fields, and archive after
confirmation. Operators have read controls only; direct requests remain subject to
backend authorization. Archived products have no edit/reactivation controls. A role
change during editing revalidates identity on 403 and removes disallowed controls;
a confirmed expired/inactive session returns to sign-in and clears user-specific data.

Price entry uses ungrouped ASCII decimal ARS with a dot and zero, one, or two
fractional digits: `0`, `1.5`, `1250.50`, and `90071992547409.91` are valid. Leading
zeros other than `0`, surrounding whitespace, commas/grouping, signs, exponents,
trailing dots, and more than two fractional digits are rejected. The maximum is
90071992547409.91 ARS (9007199254740991 minor units); conversion uses bigint only.
Display uses es-AR grouping and a comma, so input and display formats intentionally
differ and the field explains its format. SKU/name/description follow the
[catalog contract](product-catalog.md), including trimming, valid Unicode, and
case-sensitive SKU reservation across archives.

Validation errors are associated with fields. Conflicts and forbidden requests keep
form values when the identity/role remains valid. A failed network response or
15-second timeout can leave an uncertain write outcome: check the current catalog
before deliberately resubmitting. No mutation is automatically retried after CSRF
refresh or a transport failure. Confirmed writes load fresh server data. PATCH sends
only changed normalized values; concurrent submitted fields use last-write-wins,
without optimistic locking. Pagination is not a consistent snapshot.

Use the keyboard-accessible archive dialog to confirm or cancel. Initial focus is
on Keep product active; Escape cancels and returns focus. Busy confirmation cannot
be dismissed. Navigation moves focus to the destination heading, including the archived-edit
notice after its asynchronous product read. Skip to content
focuses the main landmark without changing the catalog route. Narrow tables scroll
horizontally with a visible hint. Accessibility has not been audited for full compliance.

### Manual web walkthrough

1. Follow Local setup above, apply migrations, and provision both development accounts
   using local DEV_ADMIN_EMAIL/DEV_ADMIN_PASSWORD and operator equivalents. Keep
   passwords out of shell history and source control.
2. In the root .env, configure NODE_ENV=development and
   `AUTH_TRUSTED_ORIGINS=http://127.0.0.1:3000,http://127.0.0.1:5173`.
   Retain your existing database URL and generated SESSION_SECRET. Restart the API
   after configuration changes.
3. Run `pnpm dev` in one terminal and `pnpm dev:web` in another. Open
   http://127.0.0.1:5173 and sign in as the provisioned administrator.
4. Choose Create product, enter a unique SKU, a name, and `1250.50` as Price (ARS).
   The detail view displays `ARS 1.250,50`. Edit only the price to `0`; confirm it
   displays `ARS 0,00`. Archive the product, cancelling once with Escape before
   confirming. Archived details have no edit controls.
5. Select Archived in Product status; open its detail. Reload to verify session
   restoration. Sign out; sign in as the operator and read the same archive.
   Creation/edit/archive controls are absent. Sign out again.

Real-browser verification exercises this workflow with ephemeral accounts and
synthetic products at both viewports, including the maximum monetary value. Browser
checks also exercise invalid credentials, actual origin/CSRF rejection without
writes, session invalidation, role changes, duplicate SKUs, concurrent archival
before an edit, and a committed creation whose response is lost. Screenshots/traces
with credentials or real data must never be committed or uploaded as public artifacts.
For private synthetic visual review only, set E2E_VISUAL_DIR to a directory outside
the repository before `pnpm test:browser`; captures include empty login fields and
synthetic catalog/form/dialog screens. The default and CI do not capture them.

### Frontend catalog verification — 2026-10-19

Using Node 24.22.0, pnpm 10.34.7, and a dedicated temporary PostgreSQL 17.6 server,
the final combined application passed:

- `pnpm install --frozen-lockfile`, `pnpm format:check`, `pnpm lint`, and `pnpm typecheck`.
- `pnpm test`: 90 API unit/HTTP tests and 37 web unit/proxy tests.
- `pnpm test:integration`: 170 isolated PostgreSQL tests.
- `pnpm build`: API TypeScript compilation and frontend TypeScript/Vite build.
- `pnpm test:browser`: 18 real-API Chromium checks, at 1280x900 and 390x844.

Rendered login, catalog, creation form, and archive confirmation were visually
inspected at both sizes using private synthetic captures outside Git. The mobile
catalog uses horizontal table scrolling; forms/dialogs remain within the viewport.
Keyboard assertions cover destination focus, skip navigation, dialog cancellation,
and return focus. This is not a complete accessibility or browser compatibility audit;
Firefox, WebKit, physical mobile devices, and production HTTPS hosting were not tested.

A deliberate no-matching-tests run returned a nonzero exit code to exercise the
runner's failure cleanup. After successful and failed browser runs, a database check
confirmed zero remaining generated test databases. The temporary PostgreSQL server
was stopped after verification. No application database, existing .env file, previous
migration, or backend production source was changed. The workflow includes browser
checks, but hosted CI was not run because this branch was not pushed.

### Frontend review: settled session errors — 2026-10-19

Review reproduced a narrow race where a previously decoded 401/403 reached its
rejection handler after a different login began. The old handler could invalidate
or revalidate the new session. Public request/logout and identity-revalidation error
handlers now check their captured generation before touching session state. Four
microtask-synchronized regression cases failed before the fix and pass afterward.
The 41 web unit/proxy tests, root lint, web typecheck, and web build passed. The
unchanged backend suite was not repeated for this client-only fix.

### Frontend review: archived edit focus — 2026-10-19

Opening an archived product's edit URL displayed a notice after its asynchronous
read but left keyboard focus on the document. The notice heading is now focusable
and receives focus when the archived state arrives. The strengthened browser
assertion failed on desktop/mobile before the fix. Six focused real-API Chromium
checks now pass across both viewports, covering the administrator workflow and
session restoration/logout failures. Root lint, web typecheck, and web build also
passed. Workspace and catalog documentation no longer describe implemented web
screens/browser tests as pending. The complete local backend suite was not repeated.

### Product workspace redesign verification — 2026-10-19

With Node 24.22.0 and pnpm 10.34.7 selected from the persistent local toolchain,
the redesign passed:

- `pnpm format:check`, `pnpm lint`, and `pnpm typecheck`.
- `pnpm --filter @orderflow/web test`: 43 tests, including the real HTTP development
  proxy, session/API behavior, exact monetary conversion, form normalization, and
  design-token contrast checks. The proxy test needs permission to bind loopback;
  its initial sandbox EPERM was resolved by running with execution approval.
- `pnpm build`: both API compilation and the frontend TypeScript/Vite build.
- `pnpm test:browser`: all 30 Chromium checks with the real API, ephemeral users,
  and random migrated databases on a separate PostgreSQL 17.6 container. Both roles,
  read/write denials, session restoration/invalidation, CSRF/origin rejection,
  changed-field PATCH, recoverable drafts, and uncertain outcomes remain covered.

Additional browser checks exercise native status-radio keyboard navigation without
losing focus, purposeful empty states, explicit loading synchronization, error
associations and first-invalid-field focus, modal Tab/Shift+Tab wrapping and Escape
restoration, named table scrolling, and no page-level horizontal overflow. They
measure computed foreground/background contrast and control/focus boundaries.
Long records use a 200-character name, 64-character SKU, 2,000-character description,
and the maximum exact price. Reduced-motion preferences are exercised in the narrow
form/detail workflow. No arbitrary sleeps were added.

Actual synthetic screenshots of login, catalog, detail, create/edit, errors, and
archive confirmation were inspected at 1280x900 and 390x844, plus 320px login,
long catalog/detail/edit, and confirmation cases. Visual iteration aligned fields
with different helper lengths and placed the price before long record information
on mobile. Private captures stay outside the repository and public artifacts.
The [design guide](ui-design.md) records measured contrast and accessibility limits.

The browser runner removed its API/Vite children and random databases, including
after failed development assertions; a final query confirmed zero generated databases.
Local `.env`, existing database resources/data, and the initial stopped-service state
were preserved. No backend behavior, migration, API contract, dependency, or CI check
changed, so the unchanged backend integration suite was not rerun for this milestone.
Inventory, orders, production hosting, cross-browser/device review, and manual
assistive-technology evaluation remain pending.

To review locally, use the existing configured `.env` and provisioned accounts;
do not overwrite configuration or rerun provisioning to reset accounts. From the
root with the pinned toolchain selected:

```bash
docker compose up -d --wait postgres
pnpm db:generate
pnpm db:migrate
pnpm dev
```

In another terminal with the same toolchain, run `pnpm dev:web`, then open
http://127.0.0.1:5173. See [Manual web walkthrough](#manual-web-walkthrough) for both
roles. Use Ctrl-C in each terminal to stop the API/frontend; use
`docker compose stop postgres` to stop the local database without removing its volume.
For a fresh configuration only, follow [Development account provisioning](#development-account-provisioning)
explicitly; existing account credentials and roles are never silently reset.

### Product workspace publication review — 2026-10-19

Review reproduced lost keyboard focus in pagination: results loading removed the
Previous/Next buttons. They now stay mounted, expose guarded aria-disabled states,
and retain focus through loading, first/last-page boundaries, and read failures.
The regression gates the real API request, checks returned page content before the
next action, and verifies inactive keyboard activation sends no extra reads.

Focused verification passed: formatting, lint, web TypeScript/Vite build, two token
contrast tests, and eight real-API Chromium browser checks across desktop/mobile
(pagination regression, bounded browsing, keyboard filters, and explicit loading).
Review used a new PostgreSQL container with random migrated databases, a random API
port, and Vite on 127.0.0.1:5183; it did not reuse or modify the manual preview.
The complete local suite was not repeated. Existing hosted CI retains the complete
backend/frontend and browser checks. User feedback is recorded separately in the
[design guide](ui-design.md#review-feedback), not counted as an additional test run.

## Private product image storage

Optionally set `PRODUCT_IMAGE_STORAGE_DIR` to an absolute directory outside the
repository, owned by the API user with mode 700. New directories are created with
mode 700; existing directory permissions are not silently changed. Never use the
web source directory or publish this directory through a static server. Preserve
this directory alongside PostgreSQL backups. When unset, existing routes continue
to work and operations requiring image storage return sanitized 503 responses.
Apply the committed image migration with `pnpm db:migrate`. See
[ADR 0005](decisions/0005-product-image-storage.md) for lifecycle and deployment limits.
