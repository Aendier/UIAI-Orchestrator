# UI AI Generation Context

## Purpose

This system turns Unity-authored component facts and effect-image evidence into
reviewed component knowledge and structured Figma pages. Unity owns Prefab internals;
an Approved Page owns page composition.

## Core Flow

The page-generation and sync stages below describe the target workflow. The current
MVP imports each UFB Main Component as structure plus one stable screenshot, then runs
component analysis, human review, and Approved Registry search. This repository does not
write Figma or Unity. ADR 0001 remains authoritative for that write-back boundary,
ADR 0005 records the import scope, and ADR 0006 records sync by prefabGuid.

1. People author Prefabs in Unity; UFB mirrors their Main Components and Instances into Figma.
2. Independent agents propose controlled component semantics for human approval into the Registry.
3. Agents interpret explicit text, an Effect Image and optional Rough Figma Structure as a Page Draft; explicit text and approved component facts constrain the visual evidence.
4. Matching proposes compatible Component Instances for human confirmation and leaves unsupported regions explicit.
5. A human approves page composition before UFB converts it into a Unity sandbox artifact.
6. Validation, correction, promotion, and component sync return changes to their responsible stage.

## Language

**Observation**:
Source facts extracted without semantic judgment. A Main Component observation may
include one stable screenshot produced by UFB; that screenshot is evidence, not a
semantic judgment.

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

**统筹**:
The single person-facing owner of one UI task. It is not a repository, a Figma writer, or a second workbench.
_Avoid_: Manager, Orchestrator, 对话代理

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
Optional, non-authoritative Figma nodes that provide grouping, text, naming, or geometry
evidence and may be rebuilt. It is evidence for planning, never an authoritative
component or final page structure.

**Page Draft**:
A mutable revision of Generated Page composition awaiting review.

**Structure Draft**:
A versioned Page Draft containing a deterministic pixel layout, original-size component
references, ordinary static nodes, evidence and review issues (`uiai-page/v1`). Inputs
may use canvas-global coordinates; the plan serializes child nodes relative to their
parent and keeps the root at the canvas origin.

**Structure Approval**:
Human approval of one Structure Draft revision for a Figma structure preview. This is
not an Approved Page and does not authorize Unity publication. See ADR 0008.

**Structure Generation Plan**:
A deterministic, portable execution list compiled from a Structure Approval, including
used dependency fingerprints, uploaded image bytes, accepted approximate-match
decisions and accepted unresolved gaps.

**Compatible Component**:
An Approved Component whose structure and capabilities can satisfy a proposed page
node while preserving its approved internals and original size.

**Match Confidence**:
The strength of evidence for a component candidate, combining structure, semantic
role, capabilities, dimensions and appearance. It is interpreted with evidence and
human review rather than used as an isolated automatic threshold.

**Approximate Match**:
A compatible component proposed despite known differences from the reference. It
requires a human decision that records the evidence, differences and reason for
accepting the approximation.

**Page Gap**:
A page region for which no sufficiently supported compatible component or required
asset has been selected.

**Accepted Placeholder**:
A human-accepted representation of a Page Gap in a structure preview. The gap remains
unresolved and is carried into the execution report.

**Knowledge Snapshot**:
A fixed collection of reviewed component knowledge and component definitions available
to a page task. Only components from this snapshot may be referenced by its drafts.

**Ordinary Node**:
A page node whose content is authored by the page plan rather than supplied by a
Unity component instance, such as static text, containers or explicitly uploaded
images.

**Approved Page**:
A reviewed Generated Page revision that is authoritative for page hierarchy, positions, component choices, Overrides, and ordinary nodes.

**Component Revision**:
A version of one Unity Prefab identity, tracked by stable prefabGuid plus Revision or content hash.

**Component Family**:
A group of Approved Components that share semantic role, capabilities and reusable
meaning, such as the three sizes of a primary button. A family is a matching concept;
it is not a Registry record and does not replace component identity.

**Component Variant**:
One independently approved size or presentation of a Component Family. Each variant
has its own Unity prefabGuid/sourceId and its own Registry entry, even when its
semantic content and internal structure are otherwise the same.

**Variant Key**:
A normalized size label (`xs`, `s`, `m`, `l`, `xl`) inferred from the authored
component name or Registry ID. It ranks matching candidates but does not change the
underlying Prefab identity.

**Component ID**:
The human-readable Registry reference used by pages. For a known size variant it is
encoded as `familyId.variantKey` (for example `button.primary.s`); sourceId remains
the stable Unity prefab identity.

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

## Invariants

- Source adapters do not invent semantics.
- This repository imports UFB Main Component structure and screenshots. It does not publish to Figma or write back to Unity.
- Syncing a Bridge document updates Observations by prefabGuid and preserves Drafts and the Registry. Replacing the library still clears both.
- Model output is validated against the Taxonomy at runtime.
- Model credentials are never returned in browser state or Registry data; browser-entered
  overrides are accepted only for the current process and are never persisted. AIOA's
  injected credential may be cached only with Windows current-user encryption and
  must remain bound to its provider address. See ADR 0012.
- Private serialized fields and resource GUID payloads do not enter observations.
- AI analysis cannot directly create an Approved Component.
- Unknown requests may return `no_match`; search must not force a match.
- A Component Family may contain multiple Component Variants with identical semantics;
  every variant remains independently reviewable, addressable and reusable.
- `sourceId` is the stable Prefab identity and is never derived from semantic role,
  family or size. Approval updates an existing Registry entry by `sourceId`.
- A Component ID must be unique within the Registry. When a requested family ID is
  shared by distinct Prefabs, the workbench appends the normalized Variant Key and,
  only if still necessary, a source token; it never removes another source's entry.
- Page matching may return a same-family size variant as an Approximate Match. The
  size difference stays visible in evidence and requires the existing
  `accepted_difference` review decision when the page is approved.
- A page task freezes a Knowledge Snapshot. Human selection may move among its compatible candidates but cannot introduce a component outside that snapshot.
- An Approximate Match uses the existing `accepted_difference` decision with a recorded resolution; a Page Gap uses `accepted_placeholder` and remains unresolved.
- Ordinary nodes are limited to declared static capabilities. An undeclared component-internal change becomes a capability gap for the component workflow.
- Reference images are evidence and hashes only; only explicitly uploaded, referenced images become plan assets.
- Every change to structure, component references, approximate decisions, ordinary content or gap decisions creates a new Structure Draft revision; previous approvals and plans remain immutable.
- Figma execution preflights the full plan, uses a staging page, and registers a Generated Page only after complete success.
- Unity Prefabs are authoritative for component internals; Approved Pages are authoritative for page composition.
- Changing an Approved Page's composition creates a new Page Draft.
- Linked Component Instances may update through an atomic UFB sync and then require page revalidation.
- AI may propose a Promotion Candidate but cannot publish it as a component.
- This repository does not provide a Manager, worker queue, or cross-repository coordination API.
- Component observations, semantic drafts, and approved components use the fixed
  `@uiai/protocol@0.2.0` local candidate package from the independent `UIAI-Protocol` repository.
- Versioned definition fingerprints separate component/resource revisions from
  capture evidence. Legacy approvals/plans keep their original rules and require
  explicit reanalysis/review once; no upgrade rewrites approval snapshots.
- Public component/page schemas, Bridge projection and hashing have one implementation
  in that package. Local shared modules are compatibility reexports; `protocol/*.json`
  are fixed generated artifacts with provenance in `protocol/README.md`.
- Model calls, approval, search, page persistence and HTTP behavior remain in this
  application. Consumers install the protocol package instead of copying its source.
- New product functionality is implemented by one agent against that shared protocol.
