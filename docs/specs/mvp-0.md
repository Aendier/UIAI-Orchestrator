# MVP 0: Component understanding and registry CLI

## Goal

Prove an auditable path from existing Unity/Figma component facts to human-approved,
searchable component knowledge for 10 to 20 representative components.

## Required behavior

### Adapt

- Accept UnityFigmaBridge `0.1.0` JSON.
- Produce versioned observations containing identity, hierarchy, layout, text, style,
  safe component metadata, and optional images.
- Exclude serialized component fields and resource GUID payloads.

### Analyze

- Run independent structural and visual roles through an OpenAI-compatible endpoint.
- Restrict semantic type, role, and capability output to the runtime Taxonomy.
- Invoke a third adjudicator when semantic type or role conflicts.
- Preserve source-path evidence and conflict records.
- Produce only `draft` or `needs_review` status.

### Approve

- Require a component ID and human reviewer identity.
- Validate the complete Draft before approval.
- Create or replace an Approved Registry entry without accepting an AI-issued approved
  status.

### Search

- Search only Approved Registry entries.
- Parse the MVP natural-language intents for reward claim buttons, reward items, close
  buttons, and navigation tabs into the controlled query shape.
- Return weighted score breakdowns and human-readable reasons.
- Return `no_match` when the best score is below the fixed threshold.

## Acceptance examples

- `用于领取奖励的按钮` resolves to `button.reward.claim` when approved.
- A request for an unavailable 3D model viewer returns `no_match`.
- The fixture Bridge export yields 12 observations and leaks no serialized payloads.
- Agent agreement skips adjudication; semantic type or role disagreement invokes it.

## Excluded

- Unity or Figma write-back
- Prefab generation
- Automatic approval
- Vector search
- Review web UI
- General-purpose natural-language query interpretation outside the MVP intents
