# ADR 0003: Manager-owned cross-repository coordination

## Status

Superseded by [ADR 0007](0007-retire-the-workbench-manager.md). Kept as history; it is not an implementation requirement.

## Context

The project spans multiple GitHub repositories. Direct agent-to-agent coordination
would duplicate protocol decisions, make dependencies invisible, and allow a worker to
write to a remote repository before the user has reviewed the work plan.

## Decision

- The Manager is the sole coordination interface for cross-repository requests,
  protocol decisions, task assignment, and worker reports.
- Workers register their protocol version and capabilities with the Manager, then
  claim compatible Work Items from the Manager queue. A worker may start or report
  only the Work Item assigned to its identity and current registration generation.
- A versioned Coordination Plan is created before any repository-scoped work is
  considered ready.
- Plans begin in `awaiting_confirmation`; explicit confirmation unlocks only the first
  dependency-free Work Items.
- GitHub is an adapter behind the manager protocol. The first adapter is read-only and
  uses the authenticated `gh` CLI to describe repositories.
- Inspection Work Items may invoke the adapter's read-only scan, which records selected
  context/protocol/configuration files and open Issues or pull requests as evidence.
  The scan prioritizes root context, ADRs, and protocol files, caps selected file
  contents at a bounded size, and reports tree, file-selection, or issue-pagination
  truncation instead of silently presenting partial evidence. It uses `gh api` because
  the scan contract includes pull requests as well as Issues.
- This phase does not write, commit, push, or merge remote changes. Workers return
  versioned reports with evidence and structured protocol decisions; later execution
  adapters may act only from confirmed Work Items.

## Consequences

- Users can communicate with one Manager instead of learning each repository's agent
  interface.
- Protocol mismatches are rejected at the worker-report seam.
- A completed protocol-unification Work Item stores one structured decision artifact,
  including language-neutral contract schemas, for all downstream repository proposals.
- The manager ledger can be tested without GitHub credentials or network access.
- Remote execution and merge policy remain explicit future adapters rather than hidden
  side effects.
- Worker registration is trusted inside the controlled local runtime, not exposed as
  a public remote authentication mechanism.
