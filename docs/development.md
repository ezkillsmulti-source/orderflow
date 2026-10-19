# Development

## Toolchain

Use Node.js 24.22.0 (`.nvmrc`) and pnpm 10.34.7 (`packageManager`). For example,
with nvm installed, run `nvm install` and `nvm use`, then
`npm install --global pnpm@10.34.7`. The workspace rejects incompatible engines.
Run all documented pnpm commands from the repository root.

Install with `pnpm install --frozen-lockfile`. Dependency versions and transitive
resolution are committed; update dependencies deliberately and review the lockfile.
The API package will be introduced in the backend foundation. ESLint checks code;
Prettier checks code and documentation. Use `pnpm lint`, `pnpm format:check`, and
`pnpm format` from the repository root.
