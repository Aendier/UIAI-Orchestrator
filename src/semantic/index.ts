import { z } from "zod";

import {
  ComponentObservationSchema,
  type ComponentObservation
} from "../observation/index.js";
import { SCHEMA_VERSION } from "../schema-version.js";

export { type ComponentObservation } from "../observation/index.js";

export const SemanticTypeSchema = z.enum([
  "button",
  "item",
  "navigation",
  "container",
  "text",
  "image",
  "progress",
  "unknown"
]);

export const SemanticRoleSchema = z.enum([
  "reward.claim",
  "reward.display",
  "common.close",
  "navigation.tab",
  "primary.action",
  "shop.purchase",
  "content.header",
  "progress.display",
  "generic",
  "unknown"
]);

export const CapabilitySchema = z.enum([
  "click",
  "text",
  "image",
  "disabled.state",
  "selected.state",
  "display.icon",
  "display.quantity",
  "display.rarity",
  "display.progress",
  "navigation.select",
  "container.children"
]);

export const EvidenceSchema = z.object({
  sourcePath: z.string().min(1),
  value: z.unknown(),
  rationale: z.string().min(1)
});

export const SemanticProposalSchema = z.object({
  semanticType: SemanticTypeSchema,
  role: SemanticRoleSchema,
  capabilities: z.array(CapabilitySchema),
  confidence: z.object({
    semanticType: z.number().min(0).max(1),
    role: z.number().min(0).max(1),
    capabilities: z.number().min(0).max(1)
  }),
  evidence: z.array(EvidenceSchema).min(1),
  summary: z.string().min(1)
});

export type SemanticProposal = z.infer<typeof SemanticProposalSchema>;

export const SemanticDecisionSchema = SemanticProposalSchema.extend({
  status: z.enum(["draft", "needs_review"])
});

export interface AnalysisAgent {
  analyze(observation: ComponentObservation): Promise<unknown>;
}

export interface SemanticAdjudicator {
  adjudicate(input: {
    observation: ComponentObservation;
    structural: SemanticProposal;
    visual: SemanticProposal;
  }): Promise<unknown>;
}

export const SemanticDraftSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  sourceId: z.string().min(1),
  name: z.string().min(1),
  proposals: z.object({
    structural: SemanticProposalSchema,
    visual: SemanticProposalSchema
  }),
  decision: SemanticDecisionSchema,
  conflicts: z.array(z.string().min(1))
});

export type SemanticDraft = z.infer<typeof SemanticDraftSchema>;

export async function analyzeComponent(input: {
  observation: ComponentObservation;
  structuralAgent: AnalysisAgent;
  visualAgent: AnalysisAgent;
  adjudicator: SemanticAdjudicator;
}): Promise<SemanticDraft> {
  const observation = ComponentObservationSchema.parse(input.observation);
  const [structuralResult, visualResult] = await Promise.all([
    input.structuralAgent.analyze(observation),
    input.visualAgent.analyze(observation)
  ]);
  const structural = SemanticProposalSchema.parse(structuralResult);
  const visual = SemanticProposalSchema.parse(visualResult);

  const conflicts = collectConflicts(structural, visual);
  const adjudicated =
    conflicts.length > 0
      ? SemanticProposalSchema.parse(
          await input.adjudicator.adjudicate({ observation, structural, visual })
        )
      : undefined;

  const selected = adjudicated ?? structural;
  const confidence = adjudicated
    ? adjudicated.confidence
    : {
        semanticType: average(
          structural.confidence.semanticType,
          visual.confidence.semanticType
        ),
        role: average(structural.confidence.role, visual.confidence.role),
        capabilities: average(
          structural.confidence.capabilities,
          visual.confidence.capabilities
        )
      };
  const capabilities = adjudicated
    ? adjudicated.capabilities
    : [...new Set([...structural.capabilities, ...visual.capabilities])];
  const evidence = adjudicated
    ? [...structural.evidence, ...visual.evidence, ...adjudicated.evidence]
    : [...structural.evidence, ...visual.evidence];

  return {
    schemaVersion: SCHEMA_VERSION,
    sourceId: observation.root.sourceId,
    name: observation.root.name,
    proposals: { structural, visual },
    decision: {
      semanticType: selected.semanticType,
      role: selected.role,
      capabilities: [...new Set(capabilities)].sort(),
      confidence,
      evidence: deduplicateEvidence(evidence),
      summary: selected.summary,
      status: Math.min(...Object.values(confidence)) >= 0.8 ? "draft" : "needs_review"
    },
    conflicts
  };
}

function collectConflicts(
  structural: SemanticProposal,
  visual: SemanticProposal
): string[] {
  const conflicts: string[] = [];
  if (structural.semanticType !== visual.semanticType) conflicts.push("semanticType");
  if (structural.role !== visual.role) conflicts.push("role");
  return conflicts;
}

function average(left: number, right: number): number {
  return Math.round(((left + right) / 2) * 1000) / 1000;
}

function deduplicateEvidence(
  evidence: SemanticProposal["evidence"]
): SemanticProposal["evidence"] {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    const key = JSON.stringify([item.sourcePath, item.value, item.rationale]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
