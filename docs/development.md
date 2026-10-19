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

## API bootstrap

`pnpm dev` builds once and then watches TypeScript and the compiled server.
`pnpm build` compiles the API; `pnpm --filter @orderflow/api start` runs that build.
`pnpm typecheck` checks strict TypeScript. `pnpm test` compiles and runs the Jest
ESM configuration/startup tests. Use `pnpm lint` and `pnpm format:check` to check
code/style; `pnpm format` applies formatting.

The API runs at 127.0.0.1 with PORT defaulting to 3000 (integer 1 through 65535).
DATABASE_URL must be a PostgreSQL URL with host, database, user and password; only
sslmode query parameters are supported. Validation errors identify the field but
never print its value. No database connection is made at this stage. Set these
variables in the shell, or in an ignored root `.env`; Node explicitly loads it for
dev/start without overriding existing shell variables. There is no `.env.example`
yet. There are no API routes, migrations or database tests at this stage.

Use Ctrl-C to shut down. Jest's native ESM runner uses Node's experimental VM
modules flag. After a compile error, fix it before trusting previous server output.
