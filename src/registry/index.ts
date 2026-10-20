import { z } from "zod";
import {
  ApprovedComponentSchema,
  ComponentRegistrySchema,
  type ApprovedComponent,
  type ComponentRegistry
} from "@uiai/protocol/registry";

import {
  CapabilitySchema,
  SemanticRoleSchema,
  SemanticTypeSchema,
  SemanticDraftSchema
} from "../semantic/index.js";
import { SCHEMA_VERSION } from "../schema-version.js";
import type { DefinitionFingerprint } from "../shared/fingerprint.js";

const SEARCH_MATCH_THRESHOLD = 0.6;

export type ComponentVariantKey = "xs" | "s" | "m" | "l" | "xl";

const VARIANT_ALIASES: Record<string, ComponentVariantKey> = {
  "extra-small": "xs", extrasmall: "xs", xs: "xs",
  small: "s", s: "s", medium: "m", m: "m",
  large: "l", l: "l", "extra-large": "xl", extralarge: "xl", xl: "xl"
};
const VARIANT_SUFFIX = /\.(xs|s|m|l|xl|small|medium|large|extra-small|extra-large)$/i;

export interface ComponentIdentity {
  componentId: string;
  familyId: string;
  variantKey?: ComponentVariantKey;
}

export function inferVariantKey(value: string): ComponentVariantKey | undefined {
  const normalized = value.toLocaleLowerCase().replace(/[\s_-]+/g, "-");
  const suffix = normalized.match(/(?:^|-)((?:extra-)?(?:small|medium|large)|xs|s|m|l|xl)$/)?.[1];
  return suffix ? VARIANT_ALIASES[suffix] : undefined;
}

export function componentIdentity(component: Pick<ApprovedComponent, "id" | "name">): ComponentIdentity {
  const idMatch = component.id.match(VARIANT_SUFFIX);
  const variantKey = idMatch ? VARIANT_ALIASES[idMatch[1]!.toLocaleLowerCase()] : undefined;
  const resolvedVariant = variantKey ?? inferVariantKey(component.name);
  return {
    componentId: component.id,
    familyId: idMatch ? component.id.slice(0, -idMatch[0].length) : component.id,
    ...(resolvedVariant ? { variantKey: resolvedVariant } : {})
  };
}

export * from "@uiai/protocol/registry";

export const ComponentQuerySchema = z.object({
  text: z.string().min(1),
  semanticType: SemanticTypeSchema.optional(),
  role: SemanticRoleSchema.optional(),
  requiredCapabilities: z.array(CapabilitySchema).default([]),
  variantKey: z.enum(["xs", "s", "m", "l", "xl"]).optional()
});

export type ComponentQuery = z.input<typeof ComponentQuerySchema>;

export interface ApprovalInput {
  id: string;
  approvedBy: string;
  useCases?: string[];
  visualTraits?: string[];
  observationFingerprint?: string;
  definitionFingerprint?: DefinitionFingerprint;
  approvedAt?: string;
}

export interface SearchMatch {
  componentId: string;
  familyId: string;
  variantKey?: ComponentVariantKey;
  name: string;
  score: number;
  variantMatch: "exact" | "approximate" | "unspecified";
  breakdown: {
    semanticType: number;
    role: number;
    capabilities: number;
    useCase: number;
    variant: number;
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
  const observationFingerprint = approval.observationFingerprint ?? draft.observationFingerprint;
  const definitionFingerprint = approval.definitionFingerprint ?? draft.definitionFingerprint;
  const current = registry.components.find((entry) => entry.sourceId === draft.sourceId);
  const id = uniqueComponentId(
    current?.id ?? approval.id,
    draft.name,
    draft.sourceId,
    registry,
    current === undefined
  );
  const component = ApprovedComponentSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    id,
    sourceId: draft.sourceId,
    name: draft.name,
    status: "approved",
    semanticType: draft.decision.semanticType,
    role: draft.decision.role,
    capabilities: draft.decision.capabilities,
    useCases: approval.useCases ?? [],
    visualTraits: approval.visualTraits ?? [],
    evidence: draft.decision.evidence,
    ...(observationFingerprint === undefined
      ? {}
      : { observationFingerprint }),
    ...(definitionFingerprint === undefined ? {} : { definitionFingerprint }),
    approvedBy: approval.approvedBy,
    approvedAt: approval.approvedAt ?? new Date().toISOString()
  });
  const components = registry.components.filter((entry) => entry.sourceId !== component.sourceId);
  components.push(component);
  return ComponentRegistrySchema.parse({
    schemaVersion: SCHEMA_VERSION,
    components
  });
}

function uniqueComponentId(
  requestedId: string,
  componentName: string,
  sourceId: string,
  registry: ComponentRegistry,
  inferNameVariant: boolean
): string {
  const occupiedIds = new Set(
    registry.components
      .filter((entry) => entry.sourceId !== sourceId)
      .map((entry) => entry.id)
  );
  const inferredVariant = inferNameVariant ? inferVariantKey(componentName) : undefined;
  const variantId = inferredVariant && !VARIANT_SUFFIX.test(requestedId)
    ? `${requestedId}.${inferredVariant}`
    : requestedId;
  if (!occupiedIds.has(variantId)) return variantId;

  const sourceToken = sourceId
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "source";
  const base = `${variantId}.${sourceToken}`;
  let candidate = base;
  let suffix = 2;
  while (occupiedIds.has(candidate)) {
    candidate = `${base}.${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export function interpretQuery(text: string): ComponentQuery {
  const normalized = normalizeText(text);
  const query: ComponentQuery = { text, requiredCapabilities: [] };

  if (containsAny(normalized, ["按钮", "button"])) {
    query.semanticType = "button";
    query.requiredCapabilities = ["click"];
  }
  if (containsAny(normalized, ["primary", "mainbutton", "\u4e3b\u6309\u94ae", "\u4e3b\u8981\u64cd\u4f5c"])) {
    query.semanticType = "button";
    query.role = "primary.action";
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

  query.variantKey = inferQueryVariant(text);
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
  const identity = componentIdentity(component);
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
  const hasStructuredSignal =
    query.semanticType !== undefined ||
    query.role !== undefined ||
    query.requiredCapabilities.length > 0;
  const useCase = textMatchScore(component, query.text, hasStructuredSignal);
  const variant = query.variantKey === undefined || identity.variantKey === undefined
    ? 0
    : query.variantKey === identity.variantKey ? 0.1 : 0;
  const variantMatch = query.variantKey === undefined
    ? "unspecified"
    : identity.variantKey === query.variantKey ? "exact" : "approximate";
  const breakdown = { semanticType, role, capabilities, useCase, variant };
  const reasons: string[] = [];

  if (semanticType > 0) reasons.push(`语义类型匹配: ${component.semanticType}`);
  if (role > 0) reasons.push(`角色匹配: ${component.role}`);
  if (matchedCapabilities.length > 0) {
    reasons.push(`能力匹配: ${matchedCapabilities.join(", ")}`);
  }
  if (useCase > 0) reasons.push("用途文本匹配");
  if (variantMatch === "exact") reasons.push(`尺寸变体匹配: ${identity.variantKey}`);
  if (variantMatch === "approximate" && identity.variantKey) reasons.push(`同一组件家族的近似尺寸变体: ${identity.variantKey}`);

  return {
    componentId: component.id,
    familyId: identity.familyId,
    ...(identity.variantKey ? { variantKey: identity.variantKey } : {}),
    name: component.name,
    score: round(Math.min(1, Object.values(breakdown).reduce((sum, value) => sum + value, 0))),
    variantMatch,
    breakdown,
    reasons
  };
}

function inferQueryVariant(text: string): ComponentVariantKey | undefined {
  const normalized = text.toLocaleLowerCase();
  if (/(?:extra[\s_-]*)?small|\u5c0f/.test(normalized)) return "s";
  if (/medium|\u4e2d/.test(normalized)) return "m";
  if (/(?:extra[\s_-]*)?large|\u5927/.test(normalized)) return "l";
  return undefined;
}

function textMatchScore(
  component: ApprovedComponent,
  text: string,
  hasStructuredSignal: boolean
): number {
  const query = normalizeText(text);
  if (!query) return 0;
  const candidates = [...component.useCases, ...component.visualTraits, component.name]
    .map(normalizeText)
    .filter(Boolean);
  const normalizedName = normalizeText(component.name);
  if (normalizedName === query) {
    return hasStructuredSignal ? 0.1 : 0.6;
  }
  if (query.includes(normalizedName) || normalizedName.includes(query)) {
    return hasStructuredSignal ? 0.1 : 0.6;
  }
  if (candidates.some((candidate) => candidate === query)) {
    return hasStructuredSignal ? 0.1 : 0.6;
  }
  return candidates.some((candidate) => {
    return query.includes(candidate) || candidate.includes(query);
  }) ? 0.1 : 0;
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
