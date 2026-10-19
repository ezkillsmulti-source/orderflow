# OrderFlow

OrderFlow is a planned product, inventory, and order application. Workspace tooling
and the NestJS bootstrap are implemented. There are no application routes yet;
PostgreSQL persistence and health checks are the next foundation tasks.

Use Node.js 24.22.0 and pnpm 10.34.7. From the repository root:

```bash
pnpm install --frozen-lockfile
DATABASE_URL=postgresql://test:placeholder@127.0.0.1:5432/test pnpm dev
```

This bootstrap validates DATABASE_URL and PORT but does not connect to a database.
Unknown routes return 404. Stop with Ctrl-C.

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

See [development](docs/development.md), [architecture](docs/architecture.md),
[product scope](docs/product-scope.md), and [contribution policy](CONTRIBUTING.md).
