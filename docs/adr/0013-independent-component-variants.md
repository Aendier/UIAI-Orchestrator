# ADR 0013: Keep same-semantic component variants independent

## Status

Accepted, 2026-10-15.

## Context

Unity commonly contains several Prefabs with the same semantic meaning and internal
structure but different authored sizes, such as small, medium and large primary
buttons. The previous approval path treated the suggested semantic Registry ID as a
record identity. Approving a second Prefab with the same role could therefore remove
the first approved entry or make the page candidate set ambiguous.

The stable source identity is already the Unity `prefabGuid` exposed as `sourceId`.
The fixed `@uiai/protocol@0.2.0` package does not yet expose separate `familyId` and
`variantKey` fields, and this consumer cannot edit that public contract in place.

## Decision

- Treat every distinct `sourceId` as an independent Approved Component, even when
  semantic role, capabilities and internal structure are identical.
- Treat components with shared semantics as a Component Family. Infer a normalized
  Variant Key (`xs`, `s`, `m`, `l`, `xl`) from the authored name or an existing ID
  suffix when possible.
- Encode the family and known variant in the compatible Registry `id`, for example
  `button.primary.s`, until a future protocol version provides first-class fields.
- Approval replacement is keyed by `sourceId`; a collision on `id` is resolved by
  adding the inferred variant and then a sanitized source token. No other source's
  record is removed.
- Search returns all semantically compatible family members. A requested size ranks
  the matching Variant Key first but keeps other sizes as approximate candidates.
- Page planning explains the size difference and uses the existing
  `accepted_difference` decision for human approval.

## Consequences

- S/M/L Prefabs remain independently reviewable and can all be used by pages.
- Existing Registry records keep their IDs on re-approval; migration is non-destructive.
- The application can provide family and variant behavior without changing the fixed
  public protocol package.
- A future protocol release should add optional `familyId` and `variantKey` fields,
  after which the application can migrate the encoded ID convention without changing
  source identity or page references.
