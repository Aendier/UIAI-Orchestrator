import { z } from "zod";

import {
  ComponentObservationSchema,
  ObservationDocumentSchema
} from "../observation/index.js";
import {
  ApprovedComponentSchema,
  ComponentRegistrySchema
} from "../registry/index.js";
import {
  CapabilitySchema,
  SemanticDraftSchema,
  SemanticProposalSchema,
  SemanticRoleSchema,
  SemanticTypeSchema
} from "../semantic/index.js";

export const SHARED_PROTOCOL_VERSION = "uiai-protocol/v1" as const;

export {
  ApprovedComponentSchema,
  CapabilitySchema,
  ComponentObservationSchema,
  ComponentRegistrySchema,
  ObservationDocumentSchema,
  SemanticDraftSchema,
  SemanticProposalSchema,
  SemanticRoleSchema,
  SemanticTypeSchema
};

export type { ApprovedComponent, ComponentRegistry } from "../registry/index.js";
export type {
  ComponentObservation,
  ObservationDocument
} from "../observation/index.js";
export type { SemanticDraft, SemanticProposal } from "../semantic/index.js";

const sharedContracts = [
  ["componentObservation", ComponentObservationSchema],
  ["observationDocument", ObservationDocumentSchema],
  ["semanticDraft", SemanticDraftSchema],
  ["approvedComponent", ApprovedComponentSchema],
  ["componentRegistry", ComponentRegistrySchema]
] as const;

export const SharedProtocolSchema = z.object({
  version: z.literal(SHARED_PROTOCOL_VERSION),
  name: z.literal("uiai-component"),
  contracts: z.array(z.object({
    name: z.string().min(1),
    format: z.literal("json-schema"),
    schema: z.record(z.string(), z.unknown())
  })).min(1)
});

export type SharedProtocol = z.infer<typeof SharedProtocolSchema>;

export function createSharedProtocol(): SharedProtocol {
  return SharedProtocolSchema.parse({
    version: SHARED_PROTOCOL_VERSION,
    name: "uiai-component",
    contracts: sharedContracts.map(([name, schema]) => ({
      name,
      format: "json-schema" as const,
      schema: schema.toJSONSchema()
    }))
  });
}
