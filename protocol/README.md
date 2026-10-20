# Fixed protocol artifacts

These JSON bundles are generated artifacts from `@uiai/protocol@0.2.0`, a fixed
local candidate from [UIAI-Protocol](https://github.com/Aendier/UIAI-Protocol).
This candidate is not yet published to GitHub Releases.
Maintain all shared definitions and fixtures in that repository. Do not edit these
copies by hand or copy shared source into other consumer repositories.

Source archive: `uiai-protocol-0.2.0.tgz`.
Archive SHA-256: `b874b74cd02a7e5411b46e0efa915fd6f7ba6825ea5834e858665ed60d2da1ed`.
The relative dependency path is `../UIAI-Protocol/releases/uiai-protocol-0.2.0.tgz`;
`pnpm-lock.yaml` also records the archive's SHA-512 integrity.

| Artifact | Data Version | SHA-256 |
| --- | --- | --- |
| `uiai-component.json` | `uiai-protocol/v1` | `2b6e7b92bf39f0d46d3a842e569a8e9b9e007495cecab5a3d661b7df96a0fae3` |
| `uiai-page.json` | `uiai-page/v1` | `66fbd40a9fad1fe5e096f818da4d67b6513ef6108ac8d8617caabbcec5e4f717` |

Both files are copied byte-for-byte from the fixed candidate package.
`tests/protocol.test.ts` checks their bytes, upstream checksums and runtime
generators. Tests read valid/invalid page plans and fingerprint vectors through
`@uiai/protocol/fixtures/page/*`; fixtures are not generated or maintained here.

Runtime code imports package entry points. The existing application protocol entries
and `src/shared` paths remain thin compatibility reexports. Bridge `0.1.0` and
Observation `1.0.0` are unchanged. A future artifact update requires a new fixed
protocol package version and matching provenance and lockfile updates.

0.2.0 adds optional `definitionFingerprint` to reviewed records and page refs and
`assetDependencyHash` to Bridge observations. Stable approvals survive changes to
capture paths/IDs, root placement and previews; actual definitions/resources still
invalidate them. Legacy records/plans remain unchanged and require one explicit
reanalyze/review/export cycle. See the protocol's ADR 0004 and migration 04.
