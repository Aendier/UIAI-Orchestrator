import { z } from "zod";

import { SCHEMA_VERSION } from "../schema-version.js";

export const BoundsSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  rotation: z.number()
});

export const ComponentRefSchema = z.object({
  prefabGuid: z.string().min(1).optional(),
  prefabPath: z.string().min(1).optional(),
  scriptType: z.string().min(1).optional(),
  componentTypes: z.array(z.string().min(1)).default([]),
  isNested: z.boolean().optional()
});

export const ObservedNodeSchema = z.object({
  sourceId: z.string().min(1),
  name: z.string().min(1),
  nodeType: z.string().min(1),
  visible: z.boolean(),
  opacity: z.number().min(0).max(1).optional(),
  componentRef: ComponentRefSchema.optional(),
  bounds: BoundsSchema.optional(),
  text: z
    .object({
      characters: z.string(),
      fontFamily: z.string().optional(),
      fontStyle: z.string().optional(),
      fontSize: z.number().positive().optional()
    })
    .optional(),
  style: z
    .object({
      backgroundColor: z.string().optional(),
      backgroundOpacity: z.number().min(0).max(1).optional(),
      fillType: z.string().optional()
    })
    .optional(),
  imageBase64: z.string().optional(),
  get children() {
    return z.array(ObservedNodeSchema);
  }
});

export type ObservedNode = z.infer<typeof ObservedNodeSchema>;

export const ComponentObservationSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  source: z.object({
    kind: z.literal("unity-figma-bridge"),
    documentName: z.string().min(1),
    observedAt: z.string().datetime().optional()
  }),
  root: ObservedNodeSchema
});

export type ComponentObservation = z.infer<typeof ComponentObservationSchema>;

export const ObservationDocumentSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  observations: z.array(ComponentObservationSchema)
});

export type ObservationDocument = z.infer<typeof ObservationDocumentSchema>;
