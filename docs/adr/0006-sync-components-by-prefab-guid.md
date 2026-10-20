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
- `POST /api/sync/unity` is the workbench's local Unity pull entry point; it fetches a fresh Bridge export and delegates to the same sync operation. With no object name it exports the loaded scene; with an object name it refreshes one selected component.
- Automatic export rejects duplicate prefab GUIDs. Components absent from one loaded-scene export remain in the library because they may belong to another scene or project; a named lookup that returns `target_not_found` may mark an existing component as missing.
- Observations carry an optional `enginePresence` marker. A successful sync marks the matched Observation as `present`; a `target_not_found` response for a known object marks it `missing` and records `missingSince` without removing the Observation, Draft, or Registry entry. Existing observations without a live Unity check remain `unknown`.
- Drafts and approved entries store a fingerprint of the Observation used for analysis or approval. When a later sync changes the structure or screenshot, the workbench exposes approvedChanged and keeps the approved conclusion until a reviewer re-analyzes it, revokes it, or deletes the component. An outdated Draft cannot be approved again without new analysis.
- POST /api/approval/revoke removes only the Registry conclusion and keeps the Observation and Draft. POST /api/approval/reset removes the Registry conclusion and Draft while keeping the Observation. POST /api/observation/delete removes the Observation, Draft, and Registry entry for one sourceId.
- This repository still does not write Figma or Unity.

## Consequences

- An approved component can describe an Observation that has since changed. A new analysis is required before the Draft matches the new structure.
- A missing Unity object remains visible for dependency review and can return to `present` when a later sync finds the same `prefabGuid`.
- ADR 0001 and ADR 0005 remain in force. Sync only changes how imported Observations merge.
