# Contributing

All repository content, code, documentation, and commit messages must be in English.
Read the [product scope](docs/product-scope.md), [roadmap](docs/roadmap.md), and any
relevant existing code or instructions before making changes.

## Workflow

- Use a short-lived branch for each task, such as `docs/initial-scope` or
  `feat/product-catalog`.
- Keep changes focused and commits small and coherent. Preserve unrelated work.
- Use Conventional Commit messages in English, such as
  `docs: define initial product scope` or `feat: add product listing`.
- Inspect the working diff, stage only intended changes, and review
  `git diff --staged` before committing. Check `git status` for unintended files.
  A normal `git diff` excludes untracked files: inspect their complete contents
  before staging, then review the complete staged diff.
- Update documentation alongside behavior changes, including limitations and
  decisions that affect users or operation.

## Verification

Choose verification appropriate to the change. Review documentation for accurate
status, working relative links, consistent terminology, and conflicting
requirements. For application behavior, use meaningful tests of business rules,
authorization, failure cases, and concurrency where relevant.
Verify exact integer money calculations, numeric bounds, ownership restrictions,
and idempotent effects when changing those behaviors. Do not claim exactly-once
event delivery based on tests of idempotent effects.

Implementation and tooling have not started. Use documented project commands once
they exist; do not invent setup or verification commands. Report exactly which
checks were performed and their outcomes, and identify checks not run and why.
Never claim successful checks without having performed them.

## Sensitive information

Never commit credentials, tokens, private keys, production data, or other sensitive
information. Use local configuration for secrets. A future `.env.example` may
contain placeholders only. Review staged content even when ignore rules exist;
ignore rules do not protect files already tracked by Git.
