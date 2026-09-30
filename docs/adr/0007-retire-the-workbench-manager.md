# ADR 0007: Retire the workbench Manager

## Status

Accepted. Supersedes the workbench Manager in ADR 0003 and the ADR 0004 bullet that kept it available.

## Context

Component review is a single-agent workflow. The Manager API, its worker queue, and the GitHub coordination adapter are unused. Leaving them in the server and README makes a handoff look as if cross-repository coordination is a current feature.

## Decision

- Remove `/api/manager/*`, the Manager store, and the GitHub repository adapter from this repository.
- Do not add them back for component review, UFB import, or page generation.
- Cross-repository coordination is out of scope here. Shared component data remains `protocol/uiai-component.json` (`uiai-protocol/v1`).
- ADR 0003 stays as history and is not an implementation requirement.

## Consequences

- Former Manager routes, including `GET /api/manager/state`, return 404.
- Handoff documents must not ask another agent to register workers or create Coordination Plans in this repository.
