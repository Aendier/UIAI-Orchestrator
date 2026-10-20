# Platform 3 structure phase validation

Validated on 2026-10-09 against [Issue #16](https://github.com/Aendier/UIAI-Orchestrator/issues/16).

## Implementation

- Workbench: `C:/Users/TU/AIOA/UIAIAgent`, branch `feat/platform3-structure`.
- Figma plugin: `C:/Users/TU/AIOA/UnityFigmaBridge-Figma`, same branch.
- Both worktrees remain uncommitted. Existing workbench changes and the Figma Auto Layout fix were preserved. The original desktop Figma worktree was not modified.
- This historical validation used shared runtime source copies and local fixtures.
  On 2026-10-10 the application migrated to `@uiai/protocol@0.1.0` and retired source
  copying. Current migration checks are in [protocol-migration.md](protocol-migration.md).
- Completed in spec order: shared protocol and fingerprints; deterministic Figma executor with a manual fixture; independent page persistence, review and plan compiler; planning Tab; model analysis and subtree proposals.

## Automated checks

Workbench: `npm run typecheck`, `npm run build`, `npm test -- --reporter=dot`: passed, 11 test files and 82 tests.

Figma: `npm test`: build and 6 default tests passed. With `UIAI_PLAN_FILE` pointing to the browser-exported `approved-plan.json` and `UIAI_RESULT_FILE` pointing to `figma-simulated-result.json`, all 7 tests passed.

Checks cover shared valid and 18 invalid plans, cross-runtime fingerprints, strict instance leaves and original dimensions, approved dependency eligibility, local coordinates, revision conflicts, immutable approval history, dependency invalidation and reanalysis recovery, model errors/cancellation, both model message protocols, and existing library behavior. The plugin tests cover dependency/font/image preflight, linked `createInstance`, unchanged definitions, rerun integrity conflicts, revision retention, staging rollback, component-sync fingerprint stamping, and the bundled Figma runtime without Node globals or native text encoders.

## Browser and model evidence

Artifacts are local ignored files under `../.local/verification/`, relative to this document:

| Artifact | Evidence |
| --- | --- |
| `reference.png` | 960 x 640 mixed reference with an approved library component, ordinary text, and an explicit capability gap |
| `model-analysis.json` | Real configured Responses model analysis |
| `model-revision-proposal.json` | Real selected-text modification proposal; stored draft unchanged until explicit acceptance |
| `approved-plan.json` | Downloaded portable plan with 1 dependency, 1 uploaded image and 1 accepted capability placeholder |
| `acceptance-report.json` | Browser checks, stable export hash, instance size controls, untouched nodes outside the selected subtree |
| `desktop-approved.png`, `mobile-approved.png` | 1440 x 1080 and 390 x 844 screenshots; no horizontal overflow |
| `figma-simulated-result.json` | Full bundled plugin execution of that plan using a PluginAPI test double; 6 mapped nodes, unchanged definition children, rerun reused the same page |

Plan ID: `78299bb7-6efb-477a-81eb-2add144565ba:r5`.

Plan hash: `c791d185611321e3cbd3e07f6539369fc03af88c5ddcad8a703df3131ffbd9c5`.

Browser tests operated the human review controls with reviewer `结构流程验收测试`. This is test approval, not the user's production signoff. Model credentials were neither exposed to the browser nor included in plan data. Test data is isolated from the original component library.

The latest built workbench was started at `http://127.0.0.1:1389`, using the original workbench data. The home page, page API, editor scripts and icon resource returned HTTP 200, and both new browser modules passed syntax checks. A final additional browser launch was not executed because automatic approval review returned 502. The completed full browser acceptance above remains available; this additional smoke check must not be reported as passed.

## Remaining live Figma acceptance

No live Figma file was modified. The simulated report is not a live Figma generation report, and browser screenshots are not Figma screenshots. Complete these steps in the intended Figma file:

1. Load the development plugin from `C:/Users/TU/AIOA/UnityFigmaBridge-Figma/manifest.json`.
2. Sync the same Unity component export so Main Components carry current Observation fingerprints. Plans deliberately block older definitions without fingerprints or mismatched component versions.
3. Import `approved-plan.json` through the independent page-plan input. Check Generated Page hierarchy, local positions, original instance dimensions and the actual Main Component association; verify ordinary text/image nodes remain editable and the capability placeholder is reported.
4. Repeat the same import and confirm it selects the existing unchanged result. Confirm an edited result conflicts, a new approved revision preserves the previous page, and a failed import preserves the library and previous results.
5. Download the actual GenerationResult and capture the Figma page and instance association. Retain them alongside the local artifacts above.

The first phase implementation is ready for this integration check. Final Figma acceptance remains pending until the live report and screenshots exist.

## 2026-10-20 live acceptance update

The real Figma desktop flow has now been validated in the user-confirmed `TheWarAIUI` file using a frozen, isolated plugin build and explicitly labelled test approvals. Actual GenerationResult downloads cover generation, reuse, deletion and regeneration, manual-edit conflict protection, new revision retention, images and accepted placeholders. Existing file pages were retained. See [the current audit](2026-10-20-token-figma-audit.md) for the real file identity, evidence, version differences and limits; this does not replace production approval or validate subsequent plugin source changes.
