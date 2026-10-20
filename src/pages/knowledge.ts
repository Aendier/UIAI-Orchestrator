import { z } from "zod";
import { ApprovedComponentSchema, type ComponentRegistry } from "../registry/index.js";
import { ComponentObservationSchema, type ObservationDocument } from "../observation/index.js";
import { canonicalJson, hashJson, matchesComponentRevision } from "../shared/fingerprint.js";
import { PageComponentRefSchema, type PageComponentRef } from "../shared/page.js";

export const KnowledgeSchema = z.strictObject({
  ref: PageComponentRefSchema,
  approved: ApprovedComponentSchema,
  observation: ComponentObservationSchema
});

export type PageKnowledge = z.infer<typeof KnowledgeSchema>;
export type KnowledgeFacts = { observations: ObservationDocument; registry: ComponentRegistry };

/**
 * Returns the component evidence that is safe to use for a page review.
 * A component is eligible only when its approved record maps to one current,
 * dimensioned observation with matching revision evidence.
 */
export function eligibleKnowledge(facts: KnowledgeFacts): PageKnowledge[] {
  const candidates: PageKnowledge[] = [];
  for (const approved of facts.registry.components) {
    const observations = facts.observations.observations.filter(item => item.root.sourceId === approved.sourceId);
    if (observations.length !== 1) continue;
    const observation = observations[0]!;
    const bounds = observation.root.bounds;
    if (observation.enginePresence === "missing" || !bounds || bounds.width <= 0 || bounds.height <= 0 ||
        !matchesComponentRevision(observation, approved)) continue;
    const ref = PageComponentRefSchema.safeParse({
      componentId: approved.id,
      prefabGuid: observation.root.componentRef?.prefabGuid,
      observationFingerprint: approved.observationFingerprint,
      ...(approved.definitionFingerprint ? { definitionFingerprint: approved.definitionFingerprint } : {}),
      originalSize: { width: bounds.width, height: bounds.height }
    });
    if (ref.success) candidates.push({ ref: ref.data, approved, observation });
  }
  return candidates.filter(candidate => candidates.filter(other =>
    other.ref.componentId === candidate.ref.componentId || other.ref.prefabGuid === candidate.ref.prefabGuid
  ).length === 1);
}

/**
 * A single, named view of the currently eligible component evidence.
 * The snapshot ID is shared by page creation, invalidation, analysis and
 * approval so those flows cannot drift into different matching rules.
 */
export class KnowledgeSnapshot {
  readonly id: string;

  constructor(readonly knowledge: PageKnowledge[]) {
    this.id = hashJson(knowledge.map(item => ({ ref: item.ref, approved: item.approved })));
  }

  static from(facts: KnowledgeFacts): KnowledgeSnapshot {
    return new KnowledgeSnapshot(eligibleKnowledge(facts));
  }

  has(ref: PageComponentRef): boolean {
    return this.knowledge.some(item => canonicalJson(item.ref) === canonicalJson(ref));
  }

  availableCandidates(frozenKnowledge: PageKnowledge[]): PageKnowledge[] {
    const currentRefs = new Set(this.knowledge.map(item => canonicalJson(item.ref)));
    return frozenKnowledge.filter(item => currentRefs.has(canonicalJson(item.ref)));
  }
}
