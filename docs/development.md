# Development, commands and operations

This is the single command reference. Unless a section explicitly says otherwise,
run commands from the **repository root of the checkout you intend to run**, after
selecting its pinned toolchain. [Project status](project-status.md) identifies the
main baseline and local-only 4C; this documentation checkout does not include that
frontend implementation. Examples below are procedures, not claims that they were
executed during the documentation task.

## Toolchain

Required: Node **24.22.0** from `.nvmrc`, pnpm **10.34.7** from `packageManager`.
The engine range accepts Node 24 from 24.22.0, but reproducible verification uses
the exact pin. Native argon2/sharp packages need a supported platform/prebuild or
their documented compiler prerequisites. Prisma/argon2 install builds are explicitly
allowlisted in `pnpm-workspace.yaml`; review that policy when upgrading dependencies.
Dependencies are exactly pinned in the lockfile.

No version manager is assumed. Use an already installed manager that can select
the pin, or obtain the matching official [Node distribution](https://nodejs.org/dist/v24.22.0/)
for your OS/architecture, verify its published checksum and extract it into a
user-owned tool directory. Prepend that distribution's `bin` to PATH in the current
terminal. Do not replace system packages merely to run this project.

If pnpm is absent, with the correct Node already selected, the following optional
installation is local tooling, **not an application dependency change**. It writes
to a version-specific user tool directory and npm cache; it requires registry
access. Run outside the repository and choose another directory if one is already
managed by a different tool:

```sh
npm install --prefix "$HOME/.local/share/orderflow/pnpm-10.34.7" --no-save --package-lock=false pnpm@10.34.7
export PATH="$HOME/.local/share/orderflow/pnpm-10.34.7/node_modules/.bin:$PATH"
node --version
pnpm --version
```

Expected version output is `v24.22.0` and `10.34.7`. A manager's `nvm use` command
is an alternative only if nvm is actually installed; it is not a prerequisite.

An optional pre-existing isolated toolchain used in this development environment
has wrappers under `$HOME/.local/share/orderflow/toolchains/bin`. If present, select
it in **each terminal** instead of installing/changing global tools:

```sh
export PATH="$HOME/.local/share/orderflow/toolchains/bin:$PATH"
node --version
pnpm --version
```

That path is an environment-specific convenience, not a committed bootstrapper or
portable installation requirement. Do not rely on toolchains in temporary folders.

## Environment and local PostgreSQL

### Check prerequisites before configuration

Docker daemon access and Compose v2 with `up --wait` are required for the documented
local database. These commands inspect access/resources without changing them:

```sh
docker info >/dev/null
docker compose version
docker ps --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'
docker volume ls
```

If Docker access fails, stop before startup/configuration changes. On Linux, a shell
can have stale supplementary groups after approved Docker-group membership changes:
check `id -nG` and `stat -c '%U:%G %a' /var/run/docker.sock`. Reopen the login session,
or use `newgrp docker` if the user already belongs to that group, then retry
`docker info >/dev/null` inside the refreshed shell. Otherwise ask the machine
administrator to establish daemon access. Docker-group access is privileged; do
not change socket permissions or run the application as root to bypass it.

Inspect project containers/volumes before choosing credentials. Never print raw
container environment/configuration or `.env` contents into logs or support reports.
An existing PostgreSQL volume retains its original role/password/database:
POSTGRES_* initializes **only a fresh volume**. Changing `.env` cannot reset it.
Unknown existing credentials are a blocker to resolve with the owner, not a reason
to delete/reset data or invent replacement credentials.

### Local variables

Preserve an existing `.env`. For a new checkout only:

```sh
umask 077
test -e .env || cp .env.example .env
chmod 600 .env
git check-ignore .env
```

This creates an ignored private configuration file if missing and restricts its
permissions; it changes no database. Expected ignore output is `.env`. Edit it
locally, retaining existing values and replacing placeholders only where required.
Never commit credentials. Quote values containing spaces or `#`. The table contains
**placeholders**, not usable credentials:

| Variable                                      | Purpose / format                                                                                                   | Needed by                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| `POSTGRES_USER`                               | Local Compose initial role, e.g. `orderflow_dev`                                                                   | Fresh Compose database                    |
| `POSTGRES_PASSWORD`                           | Generated local password; match existing volume if present                                                         | Compose                                   |
| `POSTGRES_DB`                                 | Initial application database name, e.g. `orderflow_dev`                                                            | Compose                                   |
| `DATABASE_URL`                                | `postgresql://USER:PERCENT_ENCODED_PASSWORD@127.0.0.1:5432/DATABASE`; only optional `sslmode` query keys           | API, migration/provisioning/cleanup CLI   |
| `PORT`                                        | API port 1–65535, default `3000`                                                                                   | API/configuration                         |
| `NODE_ENV`                                    | `development`, `test` or `production`; exactly `development` for provisioning                                      | Auth configuration / account CLI          |
| `SESSION_SECRET`                              | Fresh random 32-byte secret encoded as 64 hexadecimal characters; same on every API replica                        | API                                       |
| `AUTH_TRUSTED_ORIGINS`                        | Comma-separated exact origins, e.g. `http://127.0.0.1:3000,http://127.0.0.1:5173`; no path/wildcard/trailing slash | API, including CLI HTTP requests          |
| `AUTH_TRUST_PROXY`                            | Empty for local HTTP; production requires actual proxy IP/CIDR allowlist and HTTPS origins                         | API                                       |
| `DEV_ADMIN_EMAIL`, `DEV_OPERATOR_EMAIL`       | Distinct normalized synthetic addresses, e.g. `admin@example.test` / `operator@example.test`                       | Explicit development account provisioning |
| `DEV_ADMIN_PASSWORD`, `DEV_OPERATOR_PASSWORD` | Independent private passphrases: 15–128 Unicode code points, at most 512 UTF-8 bytes, no normalization/trimming    | Account CLI / private manual client       |
| `PRODUCT_IMAGE_STORAGE_DIR`                   | Absolute private directory outside the workspace; no symlinks, mode 700, writable by API user                      | Image bytes and cleanup apply             |
| `TEST_DATABASE_ADMIN_URL`                     | Private URL to a dedicated local/CI PostgreSQL server; role must create/drop test databases                        | Integration/browser runner                |
| `API_PROXY_TARGET`                            | Optional server-only Vite setting, default `http://127.0.0.1:3000`                                                 | Frontend proxy when API port differs      |
| `E2E_VISUAL_DIR`                              | Optional private capture directory outside Git; never a public artifact destination                                | Deliberate local browser visual review    |

Generate independent secrets/passphrases using a password manager or a cryptographic
random generator. For example, the following **prints a new secret to your private
terminal**; do not run it in shared logs or paste its output into reports. It does
not read existing `.env` or modify data:

```sh
node --input-type=module -e "import { randomBytes } from 'node:crypto'; console.log(randomBytes(32).toString('hex'))"
```

Generate separate values for session, database and each account. Hex database
passwords avoid URL escaping; otherwise percent-encode URL credentials and keep
DATABASE_URL aligned with POSTGRES_* and the actual volume. Secret replacement
invalidates existing signed cookies; rotation is not a routine startup step.

Compose reads root `.env` for interpolation but passes only POSTGRES_USER/PASSWORD/DB
to PostgreSQL. Node dev/start/provision/cleanup commands explicitly load root `.env`;
Prisma loads it through dotenv in `apps/api/prisma.config.ts`. Existing shell values
win in both cases. Vite reads API_PROXY_TARGET from its environment or local Vite
environment file, such as `apps/web/.env.local`; never put API secrets in VITE_ keys.
Browser-runner E2E_DATABASE_URL/E2E_WEB_ORIGIN/E2E_IMAGE_FIXTURE are generated private
internal settings, not extra application setup variables.

### Start PostgreSQL

After confirming intended credentials/volume and port availability:

```sh
docker compose up -d --wait postgres
docker compose ps
```

This starts or creates the project's PostgreSQL 17.6 container and persistent named
volume, publishing only `127.0.0.1:5432`. A new volume initializes accounts/database;
an existing volume is reused without resetting it. `--wait` uses readiness checks.
Expected result: the postgres service is healthy. It starts no API or frontend. A different checkout/worktree can change the default
Compose project name and therefore its volume identity; inspect the intended project
and use explicit project options when needed. A worktree alone does not isolate
ports or databases.
Compose files with a different project name/override can isolate another database,
but choose a non-conflicting loopback port and matching private URLs; do not reuse
or dismantle somebody else's project.

## Workspace command reference

All commands in this table run from the root. Install requires registry/native
package access; subsequent checks use the pinned toolchain and installed packages.
Expected successful commands exit zero. Version/format/build success does not prove
that migrations, authentication or application data are ready.

| Command                                                                     | Prerequisite / purpose                                                      | Writes / expected result                                                                                                               |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                            | Correct Node/pnpm; install committed resolution                             | Writes dependencies/cache and native artifacts, not business data; fails on manifest/lock mismatch                                     |
| `pnpm db:generate`                                                          | Installed Prisma; generate client                                           | Writes ignored generated source; no database needed; supplied DATABASE_URL must still be valid                                         |
| `pnpm db:migrate`                                                           | Intended DATABASE_URL, reachable DB; deploy committed migrations            | Mutates schema/data as specified by pending SQL; repeated execution reports no pending migrations                                      |
| `pnpm db:migrate:dev --name describe_change --create-only`                  | Disposable developer DB and shadow-DB creation privileges; author migration | Creates migration files and may apply pending development migrations; may request destructive drift reset, never accept on valued data |
| `pnpm users:provision:dev`                                                  | Migrated intended development DB and account variables                      | Builds CLI, creates/validates atomic account pair; counts only, conflict fails without reset                                           |
| `pnpm dev`                                                                  | Migrated DB, valid API environment                                          | Generates/builds API then watches TypeScript and Node; opens loopback PORT and uses sessions/counters when requested                   |
| `pnpm dev:web`                                                              | API for data; trusted web Origin                                            | Starts Vite on loopback 5173 with strictPort, no fallback to another port                                                              |
| `pnpm --filter @orderflow/api start`                                        | Prior API build and valid environment                                       | Starts compiled API with root `.env`; no migration or account seeding                                                                  |
| `pnpm format:check`                                                         | Installed Prettier                                                          | Read-only formatting check                                                                                                             |
| `pnpm format`                                                               | Deliberate formatting change                                                | Rewrites supported source/docs; review diff                                                                                            |
| `pnpm lint`                                                                 | Installed ESLint                                                            | Read-only lint, warnings fail                                                                                                          |
| `pnpm typecheck`                                                            | Installed Prisma/TypeScript                                                 | Generates client and checks API/web types; no DB connection needed                                                                     |
| `pnpm test`                                                                 | Dependencies and permission to bind loopback test ports                     | Generates/compiles API tests, runs Jest unit/HTTP and web Vitest/proxy tests; no PostgreSQL server needed                              |
| `pnpm test:integration`                                                     | Dedicated TEST_DATABASE_ADMIN_URL                                           | Creates/migrates/tests/drops random test databases; never run with production privileges/resources                                     |
| `pnpm --filter @orderflow/web browser:install`                              | Playwright download access                                                  | Installs Chromium into browser cache, no business data                                                                                 |
| `pnpm --filter @orderflow/web exec playwright install --with-deps chromium` | CI/Linux OS-package installation authority                                  | Installs Chromium and system dependencies; explain/authorize machine changes first                                                     |
| `pnpm test:browser`                                                         | Dedicated test server and Chromium/system libraries                         | Starts isolated real API/Vite and synthetic storage/accounts; tears down owned processes/database/storage                              |
| `pnpm build`                                                                | Installed toolchain/dependencies                                            | Generates client and builds API then web into ignored output; no running database needed                                               |
| `pnpm images:cleanup --limit=100`                                           | Migrated intended DB; review matching storage configuration                 | Builds CLI; bounded dry-run with short row locks, aggregate counts, no persistent/file deletion                                        |
| `pnpm images:cleanup --limit=100 --apply`                                   | Explicit maintenance decision after dry-run                                 | Deletes eligible unreferenced image files and persists lifecycle claims/tombstones; **not routine startup**                            |

Package-level scripts are also available through `pnpm --filter @orderflow/api`
(`dev`, `build`, `start`, `typecheck`, `test`, `test:integration`, `db:generate`,
`db:migrate`, `db:migrate:dev`, `users:provision:dev`, `images:cleanup`) and
`pnpm --filter @orderflow/web` (`dev`, `build`, `typecheck`, `test`, `test:browser`,
`browser:install`). The root browser command owns setup/cleanup: do not invoke raw
web `test:browser` against an application database or expect it to provision servers.

## Migrations

Use `pnpm db:generate`, then `pnpm db:migrate` for a committed checkout. Startup does
not migrate or provision accounts. Before a schema change, read the schema **and**
existing SQL constraints. Author a new migration against disposable development
resources, review generated SQL and retain custom price/stock bounds, image owner
foreign keys and immutable-history triggers. Do not edit applied migrations or use
`db push` as setup. Verify fresh and upgrade paths with isolated real PostgreSQL.

`db:migrate:dev` requires a shadow database and can propose a reset for drift; stop
and diagnose rather than accepting it on data you need. Do not export a production
DATABASE_URL merely to generate migration files. The initial image/inventory
migrations preserve existing products, initialize stock to zero and add no synthetic
movements. Privileged direct SQL must respect API text rules and explicit timestamp
management; CHECKs alone cannot enforce the whole service protocol.

## Development account provisioning

Set NODE_ENV=development and the four DEV_ADMIN/DEV_OPERATOR credential variables,
using distinct synthetic normalized emails and private passwords. With migrations
already applied, run `pnpm users:provision:dev` explicitly. It never runs on startup.
Expected result is created/unchanged counts; failures use fixed text without hashes
or credentials. Matching role/password/active accounts and timestamps are untouched.
A mismatch or inactive account rolls back the entire pair, including a newly created
companion. Resolve the conflict deliberately with the owner; provisioning is not a
password reset, role elevation or reactivation tool. Concurrent creation has bounded
serialization/uniqueness retries. NODE_ENV is not proof that the database is local.
Email/password syntax and Argon2id choices are in [ADR 0003](decisions/0003-user-accounts.md).

## React frontend

After configuration, migration and explicit provisioning, use separate terminals:

```sh
# Terminal 1, root: builds once, then watches API source/output.
pnpm dev
```

```sh
# Terminal 2, root: select the same pinned Node/pnpm first.
pnpm dev:web
```

Open http://127.0.0.1:5173. API defaults to http://127.0.0.1:3000. The browser uses
relative `/api` requests; Vite strips the prefix and preserves Origin/cookie
attributes. AUTH_TRUSTED_ORIGINS must include the exact frontend origin. No permissive
credentialed CORS is enabled. Changing API PORT requires matching API_PROXY_TARGET;
changing web origin requires updating the trusted list explicitly. Vite's dev proxy
is not production hosting. For compiled execution use `pnpm build` then
`pnpm --filter @orderflow/api start`; web output still needs deliberate hosting.

These read-only probes require an API listener and print no secrets:

```sh
curl --fail http://127.0.0.1:3000/health/live
curl --fail http://127.0.0.1:3000/health/ready
```

Expected body: `{"status":"ok"}`. Readiness is 503/`{"status":"not_ready"}` when the
database is unavailable; liveness remains independent. Readiness does not establish
migration currency. Health routes bypass session/throttling allocation.

### Manual web walkthrough

Use configured credentials locally; do not paste them into issues or screenshots.
The main UI supports these checks, which create/update only deliberately selected
development products:

1. ADMIN: sign in, create a synthetic SKU with an exact ARS price; view details,
   edit one field and try a duplicate SKU without losing form input.
2. Confirm archival on a zero-stock product; read the archived record using the
   filter. Positive stock is blocked by the backend (main UI feedback is generic).
3. With private image storage configured, choose a synthetic JPEG/PNG/WebP, inspect
   local preview and explicitly upload. Verify actual thumbnail/detail loading,
   replacement, confirmed removal and absent/failed-image fallbacks.
4. OPERATOR: browse active/archived records/images; mutation controls are absent and
   direct backend mutations remain forbidden. Reload restores identity; sign out
   returns to login. A failed logout must not be reported as success.
5. Use keyboard navigation, field-error associations, modal cancellation/focus and
   narrow screens. Automated checks do not replace assistive-technology review.

Inventory UI acceptance is specific to the committed local 4C checkout, not this
main baseline. Its exact commits and remaining checklist are in
[project status](project-status.md#remaining-milestone-4-acceptance). Do not switch a
checkout used by a running preview merely to follow another branch's instructions.

### Manual catalog walkthrough

The browser steps above cover the main catalog/image UI. The authenticated example
below additionally demonstrates catalog and inventory endpoints in one client;
[contracts](product-catalog.md) define all payload/query/error cases.

## Authentication API

The [feature guide's wire table](features.md#authentication-api) defines login/me/
logout/csrf responses and failures. Use HttpOnly cookies, trusted Origin and the
actual `csrfToken` field. Login rotates the session/token; never reuse the old token.
Do not enable verbose curl/session debug or print cookie/token headers. A 403 does
not prove token expiry; no client should blindly refresh and replay a mutation.

### Authenticated API walkthrough

This optional example is **not executed by documentation checks**. It requires a
running migrated API, explicitly provisioned development accounts and root `.env`.
It creates one new synthetic product, performs two compensating movements and leaves
it archived; run only against the intended development database. Credentials,
cookie, CSRF and idempotency keys stay in memory. The second matching POST is an
intentional replay demonstration, not an automatic retry on failure. If execution
fails, inspect the synthetic record/history before starting a new operation.

```sh
node --env-file-if-exists=.env --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base = `http://127.0.0.1:${process.env.PORT ?? '3000'}`;
const origin = process.env.AUTH_TRUSTED_ORIGINS.split(',')[0].trim();
let cookie = '', token = '';
async function call(method, path, expected, body, key) {
  const headers = { Origin: origin };
  if (cookie) headers.Cookie = cookie;
  if (method !== 'GET' && token) headers['X-CSRF-Token'] = token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (key) headers['Idempotency-Key'] = key;
  const response = await fetch(base + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal(response.status, expected);
  const cookies = response.headers.getSetCookie();
  if (cookies.length) cookie = cookies[0].split(';')[0];
  const data = expected === 204 ? undefined : await response.json();
  if (typeof data?.csrfToken === 'string') token = data.csrfToken;
  return { response, data };
}
await call('GET', '/auth/csrf', 200);
await call('POST', '/auth/login', 200, {
  email: process.env.DEV_ADMIN_EMAIL, password: process.env.DEV_ADMIN_PASSWORD,
});
const { data: identity } = await call('GET', '/auth/me', 200);
assert.equal(identity.user.role, 'ADMIN');
const { data: product } = await call('POST', '/products', 201, {
  sku: `HANDOFF-${randomUUID()}`, name: 'Handoff walkthrough product', priceMinor: '125000',
});
const path = `/products/${product.id}`;
await call('PATCH', path, 200, { description: 'Synthetic development walkthrough' });
const key = randomUUID(), payload = { delta: '2', reason: 'Synthetic receipt' };
const created = await call('POST', `${path}/inventory/adjustments`, 201, payload, key);
const replay = await call('POST', `${path}/inventory/adjustments`, 200, payload, key);
assert.equal(replay.response.headers.get('Idempotency-Replayed'), 'true');
assert.equal(replay.data.id, created.data.id);
await call('POST', `${path}/inventory/adjustments`, 201,
  { delta: '-2', reason: 'Synthetic compensation' }, randomUUID());
const { data: balance } = await call('GET', `${path}/inventory`, 200);
assert.equal(balance.onHand, '0');
const { data: history } = await call('GET', `${path}/inventory/adjustments?limit=1`, 200);
assert.equal(history.pagination.hasMore, true);
await call('GET', `${path}/inventory/adjustments?limit=1&before=${history.pagination.nextCursor}`, 200);
await call('POST', `${path}/archive`, 200);
await call('GET', path, 200);
await call('POST', '/auth/logout', 204);
await call('GET', '/auth/me', 401);
console.log('API walkthrough passed; one synthetic product remains archived.');
JS
```

Image API verification uses the same authenticated session with one FormData `image`
file, current X-CSRF-Token and trusted Origin; let the HTTP client generate multipart
Content-Type/boundary. Read descriptor backend paths with the cookie; add `/api`
only through the frontend proxy. DELETE is 204 and requires an active product.
No remote-image URL fetching exists. The image browser walkthrough avoids storing
manual cookie jars or header files.

## Checks and isolation

The complete root sequence is:

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm --filter @orderflow/web browser:install
pnpm test:browser
```

Installation is needed first. Unit/HTTP/proxy tests bind local ports but need no
PostgreSQL; Jest's experimental VM Modules warning is expected. Integration and
browser checks require TEST_DATABASE_ADMIN_URL on a **dedicated local/CI server**,
never production or an application's operational server. Its role needs CREATEDB,
ownership/permission to migrate/drop its new databases, and permission to terminate
its test connections for forced cleanup. A local Docker POSTGRES_USER is normally
a superuser: suitable for isolated testing, not a production runtime role.

Each suite creates a random `orderflow_test_*` database; it does not migrate/reset
the database named in the admin URL. Fresh/upgrade tests preserve products/images
and custom constraints. Fixtures may TRUNCATE related tables only within the random
database; SQL immutability remains enabled. Teardown drops only owned generated DBs
and removes temporary migration/storage resources. SIGKILL/host failure can prevent
cleanup: inspect ownership and active test runs before manually removing leftovers,
never bulk-drop databases by an unverified name pattern.

The root browser runner applies migrations/provisions ephemeral accounts in its
random DB, chooses free loopback API **and Vite** ports, explicitly trusts that
origin, and uses private synthetic image storage. It never reuses port 5173 or user
image storage. It stops owned child processes and drops/removes resources on success
and ordinary failure/signals. Chromium traces/video/screenshots/storage-state
persistence and public artifact upload are disabled by default. E2E_VISUAL_DIR
explicitly enables private local captures; review them for identifiers/content and
never commit/upload them as public artifacts. Tests use conditions/gates and SQL
lock observations, not arbitrary sleeps to assert concurrency.

### Dedicated test server example

The URLs in `.env.example` are placeholders: repeating loopback port 5432 does not
create isolation. Configure TEST_DATABASE_ADMIN_URL for a separate local/CI server
before running integration/browser suites. Do not copy the application URL blindly.

For a local Docker example, first inspect resources and ensure the chosen project
name and loopback port 55432 are unused. These commands use the root Compose file
with private configuration elsewhere; they do not touch the default app project.
The `!override` ports tag in this example needs **Compose 2.24.4 or later**.
Exported POSTGRES_* values also override the private env file; use a shell without
application overrides or confirm they match the test configuration without logging
credentials.

```sh
# Root; choose an unused project and a private user-owned configuration directory.
ORDERFLOW_TEST_PROJECT=orderflow-dev-test
ORDERFLOW_TEST_CONFIG_DIR="$HOME/.local/share/orderflow/test-config"
mkdir -p -m 700 "$ORDERFLOW_TEST_CONFIG_DIR"
```

This creates a directory if missing, not a database. Preserve any files already
there; select another directory/project rather than overwrite unknown configuration.
Create private `postgres.env` and `ports.yaml` files in that directory with an
editor. Restrict the env file to mode 600 and replace the password placeholder with
an independently generated value. The env-file template is:

```dotenv
POSTGRES_USER=orderflow_test
POSTGRES_PASSWORD=replace_with_independent_test_password
POSTGRES_DB=postgres
```

The ports override file is:

```yaml
services:
  postgres:
    ports: !override
      - '127.0.0.1:55432:5432'
```

Start the positively identified test project, retaining every option for later
commands:

```sh
docker compose -p "$ORDERFLOW_TEST_PROJECT" --env-file "$ORDERFLOW_TEST_CONFIG_DIR/postgres.env" -f compose.yaml -f "$ORDERFLOW_TEST_CONFIG_DIR/ports.yaml" up -d --wait postgres
```

This creates/reuses only that test project's container/volume and should report a
healthy service. Existing test-volume credentials still apply; do not reset them.
In root `.env`, set **only the test variable** to the matching dedicated URL shape,
`postgresql://orderflow_test:PERCENT_ENCODED_TEST_PASSWORD@127.0.0.1:55432/postgres`,
using the actual private value in your editor. Leave application POSTGRES_*/
DATABASE_URL unchanged. An exported shell value overrides `.env`; ensure it is not
pointing to another server. Then the ordinary root `pnpm test:integration` and
`pnpm test:browser` commands use the dedicated server and drop only generated DBs.

To pause this test server without deleting its volume, in the same configured shell:

```sh
docker compose -p "$ORDERFLOW_TEST_PROJECT" --env-file "$ORDERFLOW_TEST_CONFIG_DIR/postgres.env" -f compose.yaml -f "$ORDERFLOW_TEST_CONFIG_DIR/ports.yaml" stop postgres
```

Keep its private configuration for restart. Never substitute an unverified project
name or append volume-deletion options as a routine cleanup step. Missing Compose,
port access or test-admin privileges is a prerequisite failure to diagnose first.

### Inventory backend development

Use isolated configuration for focused cases:

```sh
pnpm --filter @orderflow/api test:integration --testPathPatterns=inventory.integration
pnpm --filter @orderflow/api test:integration --testPathPatterns=inventory.integration --testNamePattern="bounds real product lock waits"
```

They still compile API tests and create/drop their own DB. The lock regression
forces competing deadline orders and asserts rollback/no late business writes,
not merely an HTTP status. Source-level unit tests cover narrow structured error
classification. [Project status](project-status.md#lock-timeout-incident) records
its cause/fix and historical evidence. On the local 4C checkout, focused UI cases
are `pnpm test:browser inventory.spec.ts inventory-archive.spec.ts`; those inventory
UI tests are not present in this main frontend.

### CI

`.github/workflows/ci.yml` runs on pull requests and main pushes. The job is named
`backend` for historical reasons, but runs formatting, lint, API/web types/unit tests,
real PostgreSQL integration, both builds, Chromium installation and the full browser
suite. It uses a fresh PostgreSQL service, read-only repository permissions and no
public artifact upload. A local pass is not hosted CI. Check the exact current HEAD
and resolve failures without skipping/weakening tests; see [Contributing](../CONTRIBUTING.md).

## Private product image storage

Set PRODUCT_IMAGE_STORAGE_DIR to a private absolute directory outside this workspace,
owned/writable by the API user, with mode 700 and no symlinked path. New directories
are created privately; existing permissions are not silently fixed. Do not use the
web source tree or serve it through a public static directory. An unset optional
setting permits the API to start but storage-dependent operations return 503;
an invalid configured path can prevent startup. Preserve files alongside metadata.

### Image cleanup and recovery

These are maintenance operations against the configured database/storage, not setup
or background jobs. Review the target, age eligibility and current backup first:

```sh
pnpm images:cleanup --limit=100
```

Default dry-run takes short transactional row locks but persists no lifecycle
changes/deletions. Expected output contains only mode/eligible/deleted/missing/failed
counts. Limit is 1–1000, default 100. Failed work exits nonzero. Never infer that an
unreferenced directory is safe to delete merely from its filename.

**Explicit deletion:** after reviewing a dry-run for the intended storage, apply
only when you intend to retire eligible files:

```sh
pnpm images:cleanup --limit=100 --apply
```

Apply claims eligible unreferenced PENDING/RETIRED/retry/tombstone rows with
FOR UPDATE SKIP LOCKED, then deletes outside the transaction. PUBLISHED/currently
referenced images are excluded. The safety age, claim/retry lease and tombstone
resweeps are 24 hours; synchronize API/CLI/database clocks. Failed deletion keeps
its claim for later retry. A crash after deletion before marking DELETED is
recoverable; missing directories are counted. Publication cannot revive a claimed
or expired candidate. DELETED tombstones allow late-file resweeps; metadata grows
until a separate compaction policy exists. No automatic cleanup scheduler is installed.
Unknown unregistered directories are not traversed/deleted by this CLI.

A missing current file returns sanitized 503. Restore the matching immutable version
from a coordinated DB/file backup or deliberately replace/remove through the ADMIN
API. Cleanup cannot reconstruct bytes or repair backups. After ambiguous publication,
do not blindly delete candidates: persisted lifecycle/reference checks decide what
can be reclaimed. See [ADR 0005](decisions/0005-product-image-storage.md) for durability
limits, partial receive failure and concurrent writer/cleanup behavior.

### Destructive operations are not routine startup

`docker compose down -v` deletes the Compose database volume. Prisma migration reset,
manual TRUNCATE/DROP, force-removing volumes and image cleanup apply destroy data or
files. They are not recovery shortcuts for unknown credentials, drift, occupied ports
or a failed test. This guide deliberately provides no bulk-reset command. Only use
such operations on positively identified disposable resources after reviewing scope,
ownership and backups. Application provisioning never performs a reset.

## Graceful stopping

Ctrl-C in each API/Vite terminal stops that process. API shutdown hooks stop expiry
cleanup, await owned pending cleanup and close session/business pools. The API dev
script stops sibling watchers when one exits. If another manager launched a preview,
use that manager's normal stop procedure rather than stopping unrelated Node processes.

```sh
docker compose stop postgres
```

This stops only this Compose service and preserves its named volume/data. Restart
with `docker compose up -d --wait postgres`. Ordinary `docker compose down` removes
project containers/network while retaining the named volume, but is unnecessary
for a pause. Preserve image directories, private environment/credentials and backups.

## Troubleshooting

| Symptom                                  | Diagnose / resolve without resetting user data                                                                                                                                                                        |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wrong Node/pnpm                          | Check versions in each terminal and select the pinned tools; system defaults may differ. No assumption that nvm exists                                                                                                |
| Docker socket denied                     | Check daemon, group list and socket ownership; refresh an already authorized group session. Do not chmod the socket or run the application as root                                                                    |
| Port 5432/3000/5173 occupied             | Inspect listeners/project containers; preserve unknown processes. Deliberately choose an isolated port and align Compose URLs or API_PROXY_TARGET/trusted Origin. Vite strictPort will fail rather than silently move |
| Startup/config failure                   | Check missing/invalid variable **names**, shell overrides and target port. Avoid printing `.env`, raw container config or URLs with credentials                                                                       |
| Readiness 503                            | Check database/container health, credentials and connectivity; migrations are separate. Liveness can remain 200                                                                                                       |
| Existing DB rejects new .env credentials | POSTGRES_* does not alter an initialized volume. Recover the correct credentials with its owner; do not delete/reset the volume                                                                                       |
| Provisioning conflict                    | Confirm configured email/password/role/active state with authorized tooling. Existing accounts are not reset or elevated; the pair rolls back                                                                         |
| 403 in browser/CLI                       | Exact Origin and current CSRF are required; login rotates tokens. Revalidate identity/current role as appropriate, but do not auto-replay a mutation or assume every 403 is CSRF                                      |
| 401                                      | Missing/expired/revoked session or inactive account; clear account-specific client state and sign in again                                                                                                            |
| 429                                      | Respect Retry-After; global admission/login/upload slots are bounded. Do not weaken checks to make a test pass                                                                                                        |
| Missing/unavailable image                | Check private storage configuration/access and current file existence; obsolete versions are 404, missing current bytes 503. Recover/replace deliberately, never expose disk paths                                    |
| Positive-stock archive 409               | Correct stock with attributed compensating movements; do not clear stock silently. Main UI is generic; 4C consults inventory                                                                                          |
| Uncertain mutation / 503                 | A write may have committed. Inventory: deliberately reuse original key/content. Catalog/images: read state before another deliberate action. Do not install a replay's historical balance as current                  |
| Integration permissions / leftover DB    | Use dedicated admin/test privileges; inspect only generated owned resources after confirming no active suite. Never point tests at production                                                                         |
| Browser fails before readiness           | Check Chromium/system libraries and dedicated test server, then runner-owned ports/processes; do not reuse a manual preview                                                                                           |
| Stale compiled API after type error      | Fix compilation before trusting old output; dev builds once then watches TypeScript and Node                                                                                                                          |

## Documentation verification

Compare commands with root/package scripts and configuration, and validate local
Markdown paths/heading anchors, terminology, Mermaid syntax when a renderer/parser
is available, and formatting with `pnpm format:check`. Diagram review must preserve
middleware/guard/controller ordering and implemented-vs-future boundaries.

This documentation task uses safe source/Git/CI inspection and documentation checks.
It does not run application migrations, provisioning, image cleanup apply, test DB
creation, builds or application suites against user resources. Historical evidence
is retained by commit/run in [project status](project-status.md), not relabeled as
fresh tests. The previous chronological execution records were consolidated there;
contracts, SQL guarantees, failure recovery and ADRs remain first-class references.

Documentation-pass checks: Node/pnpm version output matched 24.22.0/10.34.7;
`pnpm format:check` passed using the existing pinned tooling; all 92 local Markdown
links/anchors across 18 documents resolved. Every root/API/web script was matched
to the reference. Shell blocks passed `bash -n`, and the API walkthrough passed
Node's module syntax check without execution. Both Mermaid blocks received manual
and structural checks; no Mermaid renderer/parser was available, so rendered
GitHub output was not verified. External HTTP links were not exhaustively fetched.
No install, secret generation, daemon startup, migration, provisioning, cleanup,
application tests or build was executed for this documentation-only pass.
