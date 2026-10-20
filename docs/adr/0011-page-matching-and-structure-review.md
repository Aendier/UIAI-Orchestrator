# ADR 0011: Evidence-backed page matching and structure review

## Status

Accepted, 2026-10-12.

## Context

Page planning must turn an Effect Image, optional Rough Figma Structure and explicit
instructions into a reviewable Structure Draft without hiding uncertain component
matches or allowing page composition to alter Unity-owned component internals. A visual
approximation can be useful, but an unsupported or incompatible match must remain
visible as a gap. The resulting preview also needs deterministic re-execution in Figma
while preserving prior approvals.

## Decision

- Explicit instructions take precedence over Approved Component facts and capabilities,
  which take precedence over Effect Image evidence; Rough Figma Structure is optional,
  non-authoritative evidence for grouping, naming and geometry.
- A page task freezes a Knowledge Snapshot. Candidate components must pass structural
  and capability compatibility checks and belong to that snapshot. The model proposes
  candidates; a reviewer may choose another candidate from the frozen compatible set.
- Match confidence is a multi-evidence judgment covering structure, semantic role,
  capability, dimensions and appearance. A candidate with known differences is an
  Approximate Match: it keeps the component reference, uses the protocol's
  `accepted_difference` decision, and records evidence, differences and the human
  reason in the review resolution.
- Insufficient evidence or incompatibility produces a Page Gap and a placeholder. A
  capability, component or asset gap may be approved with `accepted_placeholder` and
  a reason; a blocking structure conflict or ambiguity must be resolved. Accepted
  placeholders remain visible in the staging preview and execution report.
- Ordinary text, containers and explicitly uploaded images are editable plan content.
  A component-internal change without an Allowed Override becomes a capability gap for
  the component workflow. The reference image is evidence and a hash, not an implicit
  plan asset.
- Any change to structure, component references, approximate decisions, ordinary
  content or gap decisions creates a new Structure Draft revision. Previous approvals
  and generation plans remain immutable. Figma preflights the complete plan, creates
  it on a staging page, and registers a Generated Page only after complete success.

## Consequences

The existing page protocol can express the decisions without a new approximate-match
enum: node match fields carry confidence, rationale and evidence, while review issues
use `accepted_difference` and `accepted_placeholder`. The public coordinate contract is
a deterministic canvas-pixel layout whose serialized child coordinates are relative to
their parent. Rough Structure input, reviewer choice among all frozen compatible
candidates, and the corresponding evidence UI remain implementation work where the
current application does not yet expose them.
