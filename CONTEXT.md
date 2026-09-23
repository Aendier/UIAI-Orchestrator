# UI AI Generation Context

## Purpose

This system turns Unity-authored component facts and effect-image evidence into
reviewed component knowledge and structured Figma pages. Unity owns Prefab internals;
an Approved Page owns page composition.

## Core Flow

The page-generation and sync stages below describe the target workflow. The current
MVP remains limited to read-only Bridge import, component analysis, human review, and
Approved Registry search; ADR 0001 remains authoritative for the current write-back
boundary.

1. People author Prefabs in Unity; UFB mirrors their Main Components and Instances into Figma.
2. Independent agents propose controlled component semantics for human approval into the Registry.
3. Agents interpret an Effect Image and optional Rough Figma Structure as a Page Draft.
4. Matching reuses compatible Component Instances and leaves unsupported regions explicit.
5. A human approves page composition before UFB converts it into a Unity sandbox artifact.
6. Validation, correction, promotion, and component sync return changes to their responsible stage.

## Language

**Observation**:
Source facts extracted without semantic judgment.

**Proposal**:
One analysis agent's interpretation with field-level confidence and cited evidence.

**Component Draft**:
An untrusted semantic description of a component revision awaiting human review.
_Avoid_: Draft when the component or page scope is unclear

**Approved Component**:
A human-approved Registry revision that may be considered for reuse.

**Registry**:
The independent store of Approved Components, semantic evidence, allowed Overrides, lifecycle state, and history.

**Taxonomy**:
The controlled semantic types, roles, capabilities, and states accepted by schemas.

**UFB**:
The deterministic Unity-Figma converter. It does not infer semantics, match components, or approve knowledge.
_Avoid_: AI bridge, generator

**Component Definition Page**:
The Figma Page containing Main Components created or updated from Unity Prefabs by UFB.
_Avoid_: Component Catalog Page, Generated Page

**Component Catalog Page**:
The Figma Page containing automatically arranged Instances of the Component Definition Page for inspection and evaluation.
_Avoid_: Component Definition Page

**Generated Page**:
A Figma Page whose business UI is generated from an Effect Image and optional Rough Figma Structure.
_Avoid_: Component Catalog Page

**Effect Image**:
The primary visual reference for a Generated Page.

**Rough Figma Structure**:
Optional, non-authoritative Figma nodes that provide grouping, text, naming, or geometry evidence and may be rebuilt.

**Page Draft**:
A mutable revision of Generated Page composition awaiting review.

**Approved Page**:
A reviewed Generated Page revision that is authoritative for page hierarchy, positions, component choices, Overrides, and ordinary nodes.

**Component Revision**:
A version of one Unity Prefab identity, tracked by stable prefabGuid plus Revision or content hash.

**Change Manifest**:
The machine-readable record of component additions, modifications, deletions, identities, revisions, and sync batch.

**Promotion Candidate**:
A repeated or human-marked ordinary structure proposed for manual creation as a Unity Prefab.

**Allowed Override**:
A Registry-approved Instance content slot, such as text, icon, quantity, or Variant, that a Generated Page may change.

**Needs Revalidation**:
The state of an Approved Page whose linked component revisions changed and whose visual and structural result awaits review.

**Blocked Page**:
A page preserved for inspection but prohibited from Unity publication because a required dependency has no valid replacement.

**Deprecated Component**:
A retired component retained for dependency discovery and migration but prohibited from new reuse.

**Adjudicator**:
The analysis role invoked only when independent proposals materially conflict.

**Manager**:
The sole coordination interface for cross-repository requests, protocol decisions, task assignment, and worker reports.

**Repository Descriptor**:
A manager-owned description of one GitHub repository, including its stable reference, default branch, and remote URL.

**Coordination Plan**:
A versioned, cross-repository work proposal that remains awaiting confirmation until the manager receives explicit approval.

**Work Item**:
A repository-scoped or manager-scoped task in a Coordination Plan with dependencies, write intent, and lifecycle status.

**Worker Report**:
A versioned result returned through the Manager for one Work Item, including worker identity, evidence, changed files, tests, and blockers.

**Protocol Decision**:
A versioned, structured contract decision with language-neutral schemas, compatibility rules, migration steps, and evidence, produced by the Manager's protocol-unification Work Item and consumed by repository-scoped proposals.

## Invariants

- Source adapters do not invent semantics.
- Model output is validated against the Taxonomy at runtime.
- Model credentials are never returned in browser state or Registry data; browser-entered
  overrides are accepted only for the current process and are never persisted.
- Private serialized fields and resource GUID payloads do not enter observations.
- AI analysis cannot directly create an Approved Component.
- Unknown requests may return `no_match`; search must not force a match.
- Unity Prefabs are authoritative for component internals; Approved Pages are authoritative for page composition.
- Changing an Approved Page's composition creates a new Page Draft.
- Linked Component Instances may update through an atomic UFB sync and then require page revalidation.
- AI may propose a Promotion Candidate but cannot publish it as a component.
- Cross-repository changes are coordinated through the Manager and one versioned Coordination Plan.
- A Coordination Plan cannot unlock write-intent Work Items until explicit manager confirmation.
- Workers register capabilities, claim Work Items, and report results through the Manager; the Manager is the only cross-repository coordination interface.
- A completed protocol-unification Work Item produces one structured, versioned Protocol Decision used by downstream proposals.
