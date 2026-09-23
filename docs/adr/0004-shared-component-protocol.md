# ADR 0004: Shared component protocol for a single agent

## Status

Accepted

## Context

Cross-repository work was previously routed through a Manager, workers, and coordination plans. That machinery is not how the component feature should be implemented. Other repositories still need the same observation, semantic draft, and approved-component data structures.

## Decision

- New product functionality is implemented by one agent. Do not add Manager workers, claims, or coordination plans for it.
- The public component contract is `uiai-protocol/v1`, produced by `createSharedProtocol()`.
- The contract is published at `protocol/uiai-component.json` and importable as `uiai-orchestrator/protocol`.
- The contract covers component observations, observation documents, semantic drafts, approved components, and the component registry.
- ADR 0003 still describes the existing workbench Manager. That Manager is not required to read or validate these component structures, and it is not extended for new feature work.

## Consequences

- Another repository can validate component data from the JSON Schema file without running this workbench.
- Component analysis, approval, and search continue to use the same schemas through the existing single-agent commands.
