# UI AI Component Registry Context

## Purpose

This system turns UI component facts from Figma and Unity into reviewed, searchable
component knowledge. Its first objective is accurate component understanding, not UI
generation or write-back.

## Core Flow

1. A read-only Bridge Adapter converts source exports into observations.
2. Independent structural and visual agents propose controlled semantics.
3. An adjudicator resolves semantic type or role disagreements.
4. The system stores the result as a Draft, never as approved knowledge.
5. A human reviewer explicitly approves the Draft into the Registry.
6. Search considers only approved Registry entries and explains its score.

## Glossary

- **Observation**: source facts extracted without semantic judgment.
- **Proposal**: one analysis agent's semantic interpretation with confidence and evidence.
- **Draft**: the combined analysis result. A Draft is untrusted until reviewed.
- **Approved Component**: a human-approved Registry entry.
- **Registry**: the collection of Approved Components available to downstream agents.
- **Taxonomy**: the controlled semantic types, roles, and capabilities accepted by schemas.
- **Bridge Adapter**: the read-only boundary for UnityFigmaBridge export data.
- **Adjudicator**: the third analysis role invoked when independent proposals conflict.

## Invariants

- Source adapters do not invent semantics.
- Model output is validated against the Taxonomy at runtime.
- Private serialized fields and resource GUID payloads do not enter observations.
- AI analysis cannot directly create an Approved Component.
- Unknown requests may return `no_match`; search must not force a match.
- Unity and Figma write-back are outside the MVP boundary.
