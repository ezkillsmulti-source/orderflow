# Repository instructions

- Write all repository content, code, documentation, and commit messages in English.
- Inspect relevant code, documentation, and instructions before editing.
- Preserve unrelated user changes and work within the requested scope.
- Favor simple, maintainable solutions. Start with a modular monolith; add a worker
  only when background processing is needed. Avoid speculative infrastructure.
- Explain consequential decisions and tradeoffs. Identify unresolved requirements
  instead of silently inventing them.
- Validate business behavior with meaningful tests, including authorization,
  transactions, and concurrency when relevant. Match verification to the change.
- Follow the product scope for ownership, exact integer monetary arithmetic,
  numeric bounds, stock reservations, and idempotency. Do not claim exactly-once
  event delivery.
- Update documentation when relevant, keeping planned and implemented work distinct.
- Report changes, checks actually performed, and remaining limitations.
- Never fabricate commands, successful checks, or results.
- Review untracked file contents as well as tracked diffs; normal diffs omit them.
- Follow the task-focused commit policy in `CONTRIBUTING.md#task-focused-commits`.
- Do not commit or push unless explicitly instructed.

Implementation has not started. The initial task is documentation only; do not
scaffold the application or install dependencies without a subsequent request.
