# Independent protocol migration validation

Validated on 2026-10-10 in UIAI-Orchestrator / UIAIAgent, branch
`feat/platform3-structure`, base HEAD `cccc3d4`. Existing uncommitted changes were
preserved. This migration was not committed or pushed; Figma and Unity worktrees
were not modified.

## Package and scope

- Installed the immutable v0.1.0 Release archive as `@uiai/protocol@0.1.0` via pnpm.
  `package.json` references `../UIAI-Protocol/releases/uiai-protocol-0.1.0.tgz`;
  `pnpm-lock.yaml` records archive integrity.
- Archive SHA-256 matches the release:
  `fc7a6fab55ad9b708f2e9e13263a9672cbacf7f58edb15f88e251d587ed0f405`.
- Observation, Bridge, fingerprint, page, schema-version and component modules are
  compatibility reexports. Semantic and registry modules import/reexport shared
  schemas while retaining analysis, adjudication, approval and search behavior.
- Page storage, knowledge freezing, model inputs, HTTP and plan compilation use
  those same package definitions. `parsePagePlan` remains in the export path.
- Removed the source-copy script, `protocol:sync` command and local shared fixtures.
  Tests resolve fixtures through `@uiai/protocol/fixtures/page/*`.
- Local component/page JSON bundles are unchanged fixed artifacts with version,
  source and checksums documented in `protocol/README.md`.
- Pinned application Zod to the package's `4.6.5`; `pnpm why zod` reports one version.
  Package recursive Observation declarations widen child types; existing validated
  traversals use `ObservedNode[]` assertions without changing runtime behavior.

## Checks

| Check | Result |
| --- | --- |
| Pre-migration `pnpm test` | 11 files, 82 tests passed |
| Post-migration `pnpm test` | 11 files, 85 tests passed |
| `pnpm typecheck` | Passed |
| `pnpm build` | Passed |
| `pnpm install --frozen-lockfile --ignore-scripts` | Passed |
| `node dist/web/server.js --check` | Passed using the existing workbench data |
| CLI `export-protocol` | Output matches the installed package generator |
| `git diff --check` | Passed |

Regression tests retain component analysis, approval/revocation, sync, search,
page creation/editing, frozen dependencies, reanalysis, local proposals, cancellation,
revision conflicts, approval history and stable export checks. Shared fixtures cover
the valid mixed plan, all 18 invalid plans, fingerprints and nested coordinates.
New integration checks assert schema identity through compatibility exports,
byte-identical artifacts and HTTP 400 responses for malformed package contracts.
Failed import/sync/page-edit requests preserve component and page data.

An initial post-migration HTTP test run hit Node fetch's `bad port` rejection on
randomly assigned test ports. The complete subsequent run passed without changes to
port allocation. This remains a potential test-environment flake.

## Existing data and plan

The installed parser accepts the original `.local/verification/approved-plan.json`
unchanged, including complete relational validation and the original hash:

- Plan ID: `78299bb7-6efb-477a-81eb-2add144565ba:r5`.
- Plan hash: `c791d185611321e3cbd3e07f6539369fc03af88c5ddcad8a703df3131ffbd9c5`.

SHA-256 checks against the pre-migration bytes passed for both local JSON bundles,
the approved plan, `.local/workbench.json`, `.local/pages.json`, and both state files
under `.local/verification/data/`. No data reset, approval rewrite or version change
was needed. Both workbench states and all stored page revisions/approvals remain
readable through the installed schemas.

The original workbench contains 16 observations, 10 drafts, 7 approved components and
1 page; isolated verification data contains 14 observations, 8 drafts, 6 approved
components and 1 page. Local evidence can be rechecked with
`node .local/verification/check-protocol-migration.mjs`; the CLI output is in
`.local/verification/exported-component-protocol.json`.

The migrated built application runs at `http://127.0.0.1:4320` (PID 56144).
HTTP smoke checks returned 200 for `/`, `/api/state`, `/page-planner.js`,
`/page-editor.js`, `/library-view.js` and `/lucide.js`. Reading state did not change
the data hashes. Existing listeners were left running.

## Remaining validation

This migration does not include Figma or Unity consumer changes. No new browser/model
visual acceptance or live Figma execution was performed. Historical first-phase
evidence and the outstanding real Instance association, GenerationResult and Figma
screenshots are tracked in `docs/platform3-validation.md`.
