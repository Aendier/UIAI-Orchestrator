import { z } from "zod";

import {
  CapabilitySchema,
  EvidenceSchema,
  SemanticRoleSchema,
  SemanticTypeSchema,
  SemanticDraftSchema
} from "../semantic/index.js";
import { SCHEMA_VERSION } from "../schema-version.js";

const SEARCH_MATCH_THRESHOLD = 0.6;

export const ApprovedComponentSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string().min(1),
  sourceId: z.string().min(1),
  name: z.string().min(1),
  status: z.literal("approved"),
  semanticType: SemanticTypeSchema,
  role: SemanticRoleSchema,
  capabilities: z.array(CapabilitySchema),
  useCases: z.array(z.string().min(1)),
  visualTraits: z.array(z.string().min(1)),
  evidence: z.array(EvidenceSchema),
  approvedBy: z.string().min(1),
  approvedAt: z.string().datetime()
});

export type ApprovedComponent = z.infer<typeof ApprovedComponentSchema>;

export const ComponentRegistrySchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  components: z.array(ApprovedComponentSchema)
});

export type ComponentRegistry = z.infer<typeof ComponentRegistrySchema>;

export const ComponentQuerySchema = z.object({
  text: z.string().min(1),
  semanticType: SemanticTypeSchema.optional(),
  role: SemanticRoleSchema.optional(),
  requiredCapabilities: z.array(CapabilitySchema).default([])
});

export type ComponentQuery = z.input<typeof ComponentQuerySchema>;

export interface ApprovalInput {
  id: string;
  approvedBy: string;
  useCases?: string[];
  visualTraits?: string[];
  approvedAt?: string;
}

export interface SearchMatch {
  componentId: string;
  name: string;
  score: number;
  breakdown: {
    semanticType: number;
    role: number;
    capabilities: number;
    useCase: number;
  };
  reasons: string[];
}

export interface RegistrySearchResult {
  status: "match" | "no_match";
  matches: SearchMatch[];
  threshold: number;
}

export function approveDraft(
  draftInput: unknown,
  registryInput: unknown,
  approval: ApprovalInput
): ComponentRegistry {
  const draft = SemanticDraftSchema.parse(draftInput);
  const registry = ComponentRegistrySchema.parse(registryInput);
  const component = ApprovedComponentSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    id: approval.id,
    sourceId: draft.sourceId,
    name: draft.name,
    status: "approved",
    semanticType: draft.decision.semanticType,
    role: draft.decision.role,
    capabilities: draft.decision.capabilities,
    useCases: approval.useCases ?? [],
    visualTraits: approval.visualTraits ?? [],
    evidence: draft.decision.evidence,
    approvedBy: approval.approvedBy,
    approvedAt: approval.approvedAt ?? new Date().toISOString()
  });
  const components = registry.components.filter((entry) => entry.id !== component.id);
  components.push(component);
  return ComponentRegistrySchema.parse({
    schemaVersion: SCHEMA_VERSION,
    components
  });
}

export function interpretQuery(text: string): ComponentQuery {
  const normalized = normalizeText(text);
  const query: ComponentQuery = { text, requiredCapabilities: [] };

  if (containsAny(normalized, ["按钮", "button"])) {
    query.semanticType = "button";
    query.requiredCapabilities = ["click"];
  }
  if (containsAny(normalized, ["领取奖励", "领奖", "claimreward"])) {
    query.semanticType = "button";
    query.role = "reward.claim";
    query.requiredCapabilities = ["click"];
  } else if (
    containsAny(normalized, ["奖励", "reward"]) &&
    containsAny(normalized, ["图标", "icon", "数量", "quantity", "品质", "rarity"])
  ) {
    query.semanticType = "item";
    query.role = "reward.display";
    query.requiredCapabilities = ["display.icon", "display.quantity", "display.rarity"];
  } else if (containsAny(normalized, ["关闭", "close"])) {
    query.semanticType = "button";
    query.role = "common.close";
    query.requiredCapabilities = ["click"];
  } else if (containsAny(normalized, ["tab", "页签", "选项卡"])) {
    query.semanticType = "navigation";
    query.role = "navigation.tab";
    query.requiredCapabilities = ["navigation.select", "selected.state"];
  }

  return query;
}

export function searchRegistry(
  registryInput: ComponentRegistry,
  queryInput: ComponentQuery,
  options: { limit?: number } = {}
): RegistrySearchResult {
  const registry = ComponentRegistrySchema.parse(registryInput);
  const query = ComponentQuerySchema.parse(queryInput);
  const limit = options.limit ?? 5;

  const matches = registry.components
    .filter((component) =>
      query.requiredCapabilities.every((capability) =>
        component.capabilities.includes(capability)
      )
    )
    .map((component) => scoreComponent(component, query))
    .filter((match) => match.score >= SEARCH_MATCH_THRESHOLD)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);

  return {
    status: matches.length > 0 ? "match" : "no_match",
    matches,
    threshold: SEARCH_MATCH_THRESHOLD
  };
}

function scoreComponent(
  component: ApprovedComponent,
  query: z.output<typeof ComponentQuerySchema>
): SearchMatch {
  const semanticType =
    query.semanticType === undefined
      ? 0
      : component.semanticType === query.semanticType
        ? 0.3
        : 0;
  const role =
    query.role === undefined ? 0 : component.role === query.role ? 0.35 : 0;
  const matchedCapabilities = query.requiredCapabilities.filter((capability) =>
    component.capabilities.includes(capability)
  );
  const capabilities =
    query.requiredCapabilities.length === 0
      ? 0
      : round((matchedCapabilities.length / query.requiredCapabilities.length) * 0.25);
  const useCase = textMatches(component, query.text) ? 0.1 : 0;
  const breakdown = { semanticType, role, capabilities, useCase };
  const reasons: string[] = [];

  if (semanticType > 0) reasons.push(`语义类型匹配: ${component.semanticType}`);
  if (role > 0) reasons.push(`角色匹配: ${component.role}`);
  if (matchedCapabilities.length > 0) {
    reasons.push(`能力匹配: ${matchedCapabilities.join(", ")}`);
  }
  if (useCase > 0) reasons.push("用途文本匹配");

  return {
    componentId: component.id,
    name: component.name,
    score: round(Object.values(breakdown).reduce((sum, value) => sum + value, 0)),
    breakdown,
    reasons
  };
}

function textMatches(component: ApprovedComponent, text: string): boolean {
  const query = normalizeText(text);
  return [...component.useCases, ...component.visualTraits, component.name].some((value) => {
    const candidate = normalizeText(value);
    return query.includes(candidate) || candidate.includes(query);
  });
}

function normalizeText(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s_-]+/g, "");
}

function containsAny(value: string, candidates: string[]): boolean {
  return candidates.some((candidate) => value.includes(normalizeText(candidate)));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
