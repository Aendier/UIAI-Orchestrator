# ADR 0008: Reviewed structure plans and deterministic Figma execution

## Status

Accepted. Clarifies ADR 0005's page-generation restriction: this service may produce
reviewed page data; all Figma node creation remains in the Figma plugin.

Shared protocol ownership and source-copy synchronization are superseded by ADR 0009.
The structure/review/execution rules below remain valid. This application now consumes
`@uiai/protocol@0.1.0`; shared-source synchronization has been removed.

## Context

[Issue #16](https://github.com/Aendier/UIAI-Orchestrator/issues/16) defines the first
structure round of page planning using the reviewed component library.

## Decision

- `uiai-page/v1` is independent of `uiai-protocol/v1` and Bridge `0.1.0`.
- Publish JSON Schema in `protocol/uiai-page.json`. The normative runtime schemas and
  relational validators are `src/shared/page.ts`; both repositories consume the same
  files and consistency fixtures via `npm run protocol:sync -- <figma-repository>`.
- Shared Bridge projection and root fingerprints live in `src/shared`. Object keys
  are recursively sorted, array order retained, JSON UTF-8 bytes hashed with SHA-256.
- Freeze eligible reviewed component knowledge when creating a page task. Recheck only
  used dependencies at approval and export. Legacy approvals without fingerprints
  require explicit component reapproval.
- Explicit whole-page reanalysis freezes fresh reviewed knowledge and creates a new
  draft. Keep prior knowledge snapshots and approvals; never rewrite approved refs.
- Keep page inputs, assets, revisions, proposals and immutable approval snapshots in
  `pages.json`, independent of component library replacement or deletion.
- Structure approval authorizes a `structure-preview` plan. It is not an Approved Page
  or permission to publish Unity assets.
- The page layout is deterministic in canvas pixels. Model and editing inputs may use
  canvas-global coordinates; serialized child nodes use coordinates relative to their
  parent, with the root at `(0,0)`.
- Instances are leaves at their original dimensions. No internal overrides, scripts,
  scaling, rotation or application-side mockup renderer are supported.
- The Figma plugin preflights the complete plan, creates linked instances in a staging
  page, preserves definitions and old results, and registers only successful results.
  Reruns recheck dependencies and generated-page integrity before reuse.

## Consequences

- Schema handles field/type constraints. The shared parser also checks exact approval
  revision, hash, unique IDs, root coordinates, dependency identity, asset bytes, and
  unresolved issue decisions. Consumers must run these relational checks as well.
- The reference image is evidence; only explicitly uploaded ordinary images are bundled
  as plan assets. Missing capabilities and assets remain visible in `unresolved`.
- Local model calls run outside short page writes. Expected revisions reject concurrent
  updates, and disconnected browser requests abort model execution.
