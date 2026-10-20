# ADR 0009: Independent protocol repository

## Status

Accepted, 2026-10-10. Supersedes protocol ownership/publication in ADR 0004 and
source-copy synchronization in ADR 0008; their other workflow decisions remain valid.

## Context

The user requested extraction of the increasingly shared contracts into an independent
repository and local migration documents for the agents responsible for each consumer.

## Decision

- Canonical protocol maintenance moves to https://github.com/Aendier/UIAI-Protocol
  (private), local repository
  `C:/Users/TU/AIOA/UIAI-Protocol`, package `@uiai/protocol@0.1.0`.
- It owns component/page schemas and types, Bridge projection, hashing, consistency
  fixtures, language-neutral artifacts and the extracted Unity C# data classes.
- Preserve Bridge `0.1.0`, Observation `1.0.0`, `uiai-protocol/v1`, `uiai-page/v1`,
  existing field semantics, fingerprint results and plan hashes during extraction.
- Consumers pin a package/artifact version. End source copying after migration.
  Compatibility reexports and explicitly versioned generated artifacts are allowed.
- Model calls, approval/search/storage behavior, Figma execution and Unity export
  behavior remain in their existing repositories. No Manager is introduced.
- The planning application consumes the immutable `0.1.0` Release archive with lockfile
  integrity. Its shared modules and original public entries only reexport that package.
  Semantic analysis, approval, search and page storage remain local business behavior.
  Figma and Unity dependency migrations are separate consumer tasks.

## Consequences

- Migration instructions are in `UIAI-Protocol/docs/migrations`; handoff is possible
  without recovering this conversation.
- The immutable initial `.tgz` and checksum are distributed through the v0.1.0 GitHub
  Release; a local copy is also available. The package is not published to npm.
- Subsequent protocol simplification is a separate change with explicit compatibility tests.
- The application pins Zod `4.6.5` to the package's runtime version; shared validation
  errors must retain their HTTP 400 classification. Local component/page JSON files
  are byte-identical fixed artifacts, documented in `protocol/README.md`, not definitions
  maintained here. Tests resolve shared fixtures through the package's public paths.
