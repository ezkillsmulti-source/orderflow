# Architecture

The current foundation has one NestJS process in `apps/api` with native ESM and
strict TypeScript. `AppModule` imports `ConfigModule`, which validates environment
configuration and exports a typed provider. Bootstrap validates configuration
before Nest can log errors and binds HTTP to 127.0.0.1. Nest shutdown hooks are
enabled. There are no routes, database connections, business modules or shared
packages yet. Persistence and health checks will extend this modular monolith.
