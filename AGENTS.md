## Repository boundaries

- Before editing, confirm the repository root and assigned working copy, inspect `git status` and `git diff`, and preserve existing changes.
- Keep file writes, generated output, and verification artifacts inside the assigned working copy. Other repositories and working copies may be read to inspect contracts and diagnose problems.
- Public contract changes belong in `UIAI-Protocol`. Consumers report required changes through an Issue or handoff document, then update fixed-version dependencies and tests in their own repositories.
- Write outside the assigned working copy only when the user has explicitly authorized that scope. Filesystem permissions and upgrade Issues do not grant cross-repository write authorization; preserve the boundary when fixing failing tests.

## Agent skills

### Issue tracker

Issues and specs are tracked in GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the five canonical triage labels without aliases. See `docs/agents/triage-labels.md`.

### Domain docs

Use the single-context layout: root `CONTEXT.md` plus system-wide ADRs in `docs/adr/`. See `docs/agents/domain.md`.

### Task continuity

At the start of a new conversation, read `STATUS.md` and continue from its `下一步` section. Read only the ADRs linked from `STATUS.md`'s `已定` section when their rules are needed.
