import { z } from "zod";

import {
  ObservationDocumentSchema,
  type ObservationDocument,
  type ObservedNode
} from "../observation/index.js";

const BridgeComponentRefSchema = z
  .object({
    prefabGuid: z.string().optional(),
    prefabPath: z.string().optional(),
    scriptType: z.string().optional(),
    componentTypes: z.array(z.string()).optional(),
    isNested: z.boolean().optional()
  })
  .passthrough();

const BridgeRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  rotation: z.number().default(0)
});

interface BridgeNode {
  id?: string | undefined;
  name: string;
  displayName?: string | undefined;
  type?: string | undefined;
  visible?: boolean | undefined;
  opacity?: number | undefined;
  u2f?: z.infer<typeof BridgeComponentRefSchema> | undefined;
  layout?: {
    rect?: z.infer<typeof BridgeRectSchema> | undefined;
    text?: {
      characters?: string | undefined;
      fontSize?: number | undefined;
      fontName?: {
        family?: string | undefined;
        style?: string | undefined;
      } | undefined;
    } | undefined;
    style?: {
      backgroundColor?: string | undefined;
      backgroundOpacity?: number | undefined;
      fillType?: string | undefined;
    } | undefined;
    imageBase64?: string | undefined;
  } | undefined;
  children: BridgeNode[];
}

const BridgeNodeSchema: z.ZodType<BridgeNode> = z.lazy(() =>
  z
    .object({
      id: z.string().optional(),
      name: z.string().min(1),
      displayName: z.string().optional(),
      type: z.string().optional(),
      visible: z.boolean().optional(),
      opacity: z.number().optional(),
      u2f: BridgeComponentRefSchema.optional(),
      layout: z
        .object({
          rect: BridgeRectSchema.optional(),
          text: z
            .object({
              characters: z.string().optional(),
              fontSize: z.number().optional(),
              fontName: z
                .object({
                  family: z.string().optional(),
                  style: z.string().optional()
                })
                .optional()
            })
            .optional(),
          style: z
            .object({
              backgroundColor: z.string().optional(),
              backgroundOpacity: z.number().optional(),
              fillType: z.string().optional()
            })
            .optional(),
          imageBase64: z.string().optional()
        })
        .optional(),
      children: z.array(BridgeNodeSchema).default([])
    })
    .passthrough()
);

const BridgeDocumentSchema = z
  .object({
    version: z.literal("0.1.0"),
    sourceCanvas: z.string().min(1),
    exportTime: z.string().datetime().optional(),
    nodes: z.array(BridgeNodeSchema).min(1)
  })
  .passthrough();

export function adaptBridgeDocument(input: unknown): ObservationDocument {
  const source = BridgeDocumentSchema.parse(input);
  return ObservationDocumentSchema.parse({
    schemaVersion: "1.0.0",
    observations: source.nodes.map((node, index) => ({
      schemaVersion: "1.0.0",
      source: {
        kind: "unity-figma-bridge",
        documentName: source.sourceCanvas,
        ...(source.exportTime === undefined ? {} : { observedAt: source.exportTime })
      },
      root: adaptNode(node, `nodes[${index}]`)
    }))
  });
}

function adaptNode(node: BridgeNode, sourcePath: string): ObservedNode {
  const componentRef = node.u2f;
  const text = node.layout?.text;
  const style = node.layout?.style;
  return {
    sourceId: componentRef?.prefabGuid || node.id || sourcePath,
    name: node.displayName || node.name,
    nodeType: node.type || "UNKNOWN",
    visible: node.visible !== false,
    ...(node.opacity === undefined ? {} : { opacity: node.opacity }),
    ...(componentRef === undefined
      ? {}
      : {
          componentRef: {
            ...(componentRef.prefabGuid ? { prefabGuid: componentRef.prefabGuid } : {}),
            ...(componentRef.prefabPath ? { prefabPath: componentRef.prefabPath } : {}),
            ...(componentRef.scriptType ? { scriptType: componentRef.scriptType } : {}),
            componentTypes: componentRef.componentTypes ?? [],
            ...(componentRef.isNested === undefined
              ? {}
              : { isNested: componentRef.isNested })
          }
        }),
    ...(node.layout?.rect === undefined ? {} : { bounds: node.layout.rect }),
    ...(text === undefined
      ? {}
      : {
          text: {
            characters: text.characters ?? "",
            ...(text.fontName?.family ? { fontFamily: text.fontName.family } : {}),
            ...(text.fontSize === undefined ? {} : { fontSize: text.fontSize })
          }
        }),
    ...(style === undefined
      ? {}
      : {
          style: {
            ...(style.backgroundColor
              ? { backgroundColor: style.backgroundColor }
              : {}),
            ...(style.backgroundOpacity === undefined
              ? {}
              : { backgroundOpacity: style.backgroundOpacity }),
            ...(style.fillType ? { fillType: style.fillType } : {})
          }
        }),
    ...(node.layout?.imageBase64 === undefined
      ? {}
      : { imageBase64: node.layout.imageBase64 }),
    children: node.children.map((child, index) =>
      adaptNode(child, `${sourcePath}.children[${index}]`)
    )
  };
}
