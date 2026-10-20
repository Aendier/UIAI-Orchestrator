# ADR 0010: Local model usage and analysis diagnostics

## Status

Accepted

## Context

The workbench discarded model usage and batch-analysis failures. Users could not
inspect consumption or explain failures, including retries that consumed tokens
without producing a valid semantic draft.

## Decision

- Record provider-reported usage for each structure, vision, adjudication, page
  analysis and subtree-revision call. Support both configured wire APIs. Cache
  input and reasoning output are subsets of input/output; do not add them again.
- Keep missing counts unknown. Historical results without records cannot be
  reconstructed, and aborted requests may have unreported consumption.
- Persist operations, call metadata and sanitized error messages in local
  `usage.json`. Never persist credentials, request headers, prompts, model
  response content or images in that ledger.
- Keep the ledger separate from public component/page contracts and approval
  snapshots. Bind a successful component operation to its returned observation
  fingerprint. A failed retry preserves the prior draft and its usage association.
- Settings exposes detailed searchable history; component review exposes its
  result's usage and the latest persistent failure. Usage history survives server
  restart, component deletion and whole-library replacement.
- The settings dashboard aggregates the selected local-calendar range by each
  call's start time. A date drilldown selects calls rather than whole operations,
  including operations that span midnight. Cache/reasoning chart segments do not
  overlap; incomplete or inconsistent subdivisions remain explicitly unclassified.
- New calls record the configured service host for backend distribution. Do not
  store URL credentials, paths or query strings, or infer a historical backend from
  the current configuration. This optional local field keeps version-1 ledgers
  readable; unsupported cache-write measurements remain unknown.
- Component-wide sync and JSON import live in the component library. JSON import
  replaces the library and clears drafts/approvals; incremental sync retains them.

## Consequences

No changes to UIAI-Protocol or other repositories are required. Token totals cover
the local workbench's model requests with reported measurements; they are not a
provider billing report or retrospective estimates.
