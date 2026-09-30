# ADR 0006: Sync UFB components by prefabGuid without clearing review

## Status

Accepted

## Context

`POST /api/import` replaces the whole Observation library and clears Drafts and the Registry. That is safe for loading a fixture, but it cannot be the daily path from Unity to the workbench. A later UFB export may contain one changed Main Component, and the human review of the others must stay.

## Decision

- `POST /api/sync` accepts the same Bridge `0.1.0` document as import.
- Every root component must have a unique `prefabGuid` that does not contain `/`. That guid is the Observation `sourceId`.
- A matching `sourceId` replaces that Observation. A new `prefabGuid` adds one. Observations absent from the document stay.
- Sync does not clear Drafts or the Registry. `POST /api/import` still replaces the library and clears both.
- `POST /api/sync/unity` is only the workbench's local Unity pull entry point; it fetches one Bridge export and delegates to the same sync operation.
- This repository still does not write Figma or Unity.

## Consequences

- An approved component can describe an Observation that has since changed. A new analysis is required before the Draft matches the new structure.
- ADR 0001 and ADR 0005 remain in force. Sync only changes how imported Observations merge.
