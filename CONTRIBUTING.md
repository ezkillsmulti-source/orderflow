# Contributing

All repository content, code, documentation, and commit messages must be in English.
Read the [product scope](docs/product-scope.md), [roadmap](docs/roadmap.md), and any
relevant existing code or instructions before making changes.

## Workflow

- Use a short-lived branch for each task, such as `docs/initial-scope` or
  `feat/product-catalog`.
- Keep changes focused and commits small and coherent. Preserve unrelated work.
- Check [project status](docs/project-status.md) and actual branches before choosing
  a base; local-only implementation is not automatically part of main. Use an
  isolated worktree when an active checkout or unfinished changes must be preserved.
- Use Conventional Commit messages in English, such as
  `docs: define initial product scope` or `feat: add product listing`.
- Inspect the working diff, stage only intended changes, and review
  `git diff --staged` before committing. Check `git status` for unintended files.
  A normal `git diff` excludes untracked files: inspect their complete contents
  before staging, then review the complete staged diff.
- Update documentation alongside behavior changes, including limitations and
  decisions that affect users or operation.

## Task-focused commits

Each commit should deliver one specific, coherent task. Keep its implementation,
meaningful tests, and relevant documentation together; do not split by file type.
Use a descriptive Conventional Commit message in English. Separate independent
tooling, bootstrap, persistence, health, and CI tasks when their intermediate
states remain usable. Keep tightly coupled changes together and explain why.

Introduce root scripts only when their packages and prerequisites exist. Validate
each commit with the checks applicable at that stage. Review generated lockfiles
with their manifests; distinguish generated dependency lines from handwritten
implementation when assessing scope. Preserve unrelated changes. Rewrite only
explicitly authorized unpublished history after confirming a clean tree and
creating a backup branch; preserve final contents except for documented fixes.
Never rewrite main or published commits.

## Verification

Choose verification appropriate to the change. Review documentation for accurate
status, working relative links, consistent terminology, and conflicting
requirements. For application behavior, use meaningful tests of business rules,
authorization, failure cases, and concurrency where relevant.
Verify exact integer money calculations, numeric bounds, ownership restrictions,
and idempotent effects when changing those behaviors. Do not claim exactly-once
event delivery based on tests of idempotent effects.

Use the pinned toolchain and documented checks in [development](docs/development.md).
Do not invent setup or verification commands. Report exactly which
checks were performed and their outcomes, and identify checks not run and why.
Never claim successful checks without having performed them.

## Sensitive information

Never commit credentials, tokens, private keys, production data, or other sensitive
information. Use local configuration for secrets. An `.env.example` must
contain placeholders only. Review staged content even when ignore rules exist;
ignore rules do not protect files already tracked by Git.

## Pull requests and integration

Move from requirements to explicit contract/model, implementation, meaningful tests
and relevant docs, then focused commits and a PR. Use the repository's protected
main workflow: the inspected ruleset requires a PR, resolved review conversations,
`backend` CI for the current HEAD and an up-to-date branch. That job includes web
and browser checks despite its historical name. No approving review is required
by the solo-project ruleset; this does not replace reviewing the complete diff.

Preserve task-focused commits with a merge commit. Do not bypass checks, force-push
main or delete protected branches. If updating a published task branch is needed,
merge origin/main normally and wait for CI on its new HEAD rather than rewriting
published history. Verify post-merge CI for the exact merge SHA; report pending or
failed checks honestly before beginning dependent work. Rules can change: inspect
the saved requirements before integrating rather than treating this snapshot as a
permission override. Update project status only with actual delivery/acceptance.
