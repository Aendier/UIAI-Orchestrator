import {
  SemanticProposalSchema,
  type SemanticDraft,
  type SemanticProposal
} from "@uiai/protocol/semantic";

import {
  ComponentObservationSchema,
  type ComponentObservation
} from "../observation/index.js";
import { SCHEMA_VERSION } from "../schema-version.js";
import { createObservationFingerprint, createDefinitionFingerprint } from "../shared/fingerprint.js";
import { describeAnalysisError } from "../ai/diagnostics.js";

export { type ComponentObservation } from "../observation/index.js";
export * from "@uiai/protocol/semantic";

export interface AnalysisAgent {
  analyze(observation: ComponentObservation, signal?: AbortSignal): Promise<unknown>;
}

export interface SemanticAdjudicator {
  adjudicate(input: {
    observation: ComponentObservation;
    structural: SemanticProposal;
    visual: SemanticProposal;
  }, signal?: AbortSignal): Promise<unknown>;
}

export async function analyzeComponent(input: {
  observation: ComponentObservation;
  structuralAgent: AnalysisAgent;
  visualAgent: AnalysisAgent;
  adjudicator: SemanticAdjudicator;
  signal?: AbortSignal | undefined;
}): Promise<SemanticDraft> {
  const observation = ComponentObservationSchema.parse(input.observation);
  throwIfAborted(input.signal);
  const [structuralResult, visualResult] = await Promise.allSettled([
    input.signal
      ? input.structuralAgent.analyze(observation, input.signal)
      : input.structuralAgent.analyze(observation),
    input.signal
      ? input.visualAgent.analyze(observation, input.signal)
      : input.visualAgent.analyze(observation)
  ]);
  throwIfAborted(input.signal);
  if (structuralResult.status === "rejected" || visualResult.status === "rejected") {
    const failures = [["结构分析", structuralResult], ["视觉分析", visualResult]] as const;
    const failure = new Error(failures.flatMap(([role, result]) => result.status === "rejected"
      ? [`${role}失败：${describeAnalysisError(result.reason)}`] : []).join("\n"));
    if (failures.some(([, result]) => result.status === "rejected" && result.reason instanceof Error && result.reason.name === "AbortError")) {
      failure.name = "AbortError";
    }
    throw failure;
  }
  const structural = parseProposal(structuralResult.value, "结构分析结果");
  const visual = parseProposal(visualResult.value, "视觉分析结果");

  const conflicts = collectConflicts(structural, visual);
  const adjudicated =
    conflicts.length > 0
      ? parseProposal(
          await (input.signal
            ? input.adjudicator.adjudicate({ observation, structural, visual }, input.signal)
            : input.adjudicator.adjudicate({ observation, structural, visual })),
          "冲突裁决结果"
        )
      : undefined;
  throwIfAborted(input.signal);

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
    observationFingerprint: createObservationFingerprint(observation),
    ...(observation.root.componentRef?.assetDependencyHash
      ? { definitionFingerprint: createDefinitionFingerprint(observation) } : {}),
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

function parseProposal(value: unknown, label: string): SemanticProposal {
  try { return SemanticProposalSchema.parse(value); }
  catch (error) { throw new Error(describeAnalysisError(error, label)); }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("Analysis aborted");
  error.name = "AbortError";
  throw error;
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
