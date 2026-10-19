# OrderFlow

OrderFlow is a planned web application for small businesses to manage products,
inventory, and orders. It aims to replace disconnected records with a consistent
view of available stock and the orders reserving it.

The first release supports one business. Administrators manage products, inventory
adjustments, and all orders. Operators read products and available stock, create
orders, and view or cancel only their own orders. The
[product scope](docs/product-scope.md) defines the full rules.

The planned first release uses archived products, ARS prices in integer minor
units, atomic stock reservations, and idempotent order creation and cancellation.
Accounts will initially come from a development seed; authentication will use
server-side sessions with an HttpOnly cookie and CSRF protection.

This portfolio project is intended to demonstrate practical backend engineering:
delivering business behavior, documenting decisions, testing correctness, and
operating an application.

## Status

Implementation has not started. This repository currently contains initial
planning and contribution documentation only. There is no application to run,
and no setup commands, test results, or deployment URLs are available yet.

## Planned stack and architecture

- TypeScript and Node.js with NestJS for the backend.
- PostgreSQL with Prisma for persistence.
- React with Vite for the frontend.
- Jest/Supertest for backend tests and Playwright for browser tests.
- Docker Compose and Nginx for the runtime environment.
- GitHub Actions for automated verification.
- Redis and BullMQ when a later milestone introduces background processing.

Start with a modular monolith. Add a worker only when background processing is
needed; microservices and speculative infrastructure are outside the plan.

## Project documents

- [Product scope, business rules, and unresolved decisions](docs/product-scope.md)
- [Incremental roadmap and completion criteria](docs/roadmap.md)
- [Contribution workflow](CONTRIBUTING.md)
- [Instructions for coding agents](AGENTS.md)
