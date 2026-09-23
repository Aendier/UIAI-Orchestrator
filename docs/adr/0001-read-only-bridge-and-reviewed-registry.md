# ADR 0001: Read-only Bridge input and human-reviewed Registry

## Status

Accepted. ADR 0005 extends the accepted import with one UFB Main Component screenshot.
This ADR still prohibits this repository from writing Unity or Figma.

## Context

The existing UnityFigmaBridge projects contain valuable component identity, hierarchy,
layout, text, style, and prefab metadata. Their import/write-back paths also have known
identity and reconstruction risks, and their wire format contains fields that should not
be sent to model providers.

Semantic accuracy benefits from independent evidence sources, but model agreement alone
does not make a result trusted project knowledge.

## Decision

- Consume Bridge `0.1.0` JSON through a versioned read-only adapter.
- Retain observable structure and component metadata; discard serialized fields and
  resource GUID payloads.
- Run structural and visual analysis independently.
- Invoke an adjudicator when semantic type or role differs.
- Store all model results as Drafts.
- Require an explicit reviewer identity before creating or replacing an Approved
  Component in the Registry.
- Search only the Approved Registry.

## Consequences

- Existing Bridge repositories remain unchanged and can evolve independently.
- A protocol version change fails validation until an adapter is added.
- Human review remains in the critical path for trusted knowledge.
- The MVP cannot reconstruct or write UI back to Unity or Figma.
