# ADR 0005: Import UFB structure and screenshots without writing Figma or Unity

## Status

Accepted

## Context

ADR 0001 limits this repository to a read-only Bridge adapter and forbids writing UI
back to Unity or Figma. UFB is the deterministic publisher that mirrors Unity Main
Components into a Figma component library. Visual analysis needs each published Main
Component's stable screenshot, not only its node tree. Rebuilding Prefab parsing or
Figma writes here would duplicate UFB and cross the write boundary.

## Decision

- Import each UFB Main Component as structure plus one stable screenshot.
- When a Bridge node has no `layout.imageBase64`, map its `screenshot` to that
  observation node's existing `imageBase64`. An existing layout image stays the
  observation image.
- Do not add a protocol version. `imageBase64` is already part of `uiai-protocol/v1`.
- Workbench state reports `hasPreview` and does not embed image bytes in the component
  list. `GET /api/observations/:sourceId/preview` serves the root PNG.
- Do not generate pages, write Figma, or write Unity from this repository. UFB remains
  the only publisher.

## Consequences

- ADR 0001's write-back prohibition stays in force. Its accepted input now includes the
  Main Component screenshot.
- Recognition, human review, and the Approved Registry stay where they are.
- Shared-protocol consumers read the screenshot as `imageBase64` without a new schema.
