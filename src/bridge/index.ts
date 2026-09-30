import { z } from "zod";

import {
  ObservationDocumentSchema,
  type ObservationDocument,
  type ObservedNode
} from "../observation/index.js";
import { BRIDGE_SCHEMA_VERSION, SCHEMA_VERSION } from "../schema-version.js";

const BridgeComponentRefSchema = z
  .object({
    prefabGuid: z.string().nullish(),
    prefabPath: z.string().nullish(),
    scriptType: z.string().nullish(),
    componentTypes: z.array(z.string()).nullish(),
    isNested: z.boolean().nullish()
  })
  .passthrough();

const BridgeRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  rotation: z.number().default(0)
});

const BridgeNodeSchema = z
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
        rect: BridgeRectSchema.nullish(),
        text: z
          .object({
            characters: z.string().nullish(),
            fontSize: z.number().nullish(),
            fontName: z
              .object({
                family: z.string().nullish(),
                style: z.string().nullish()
              })
              .nullish()
          })
          .nullish(),
        style: z
          .object({
            backgroundColor: z.string().nullish(),
            backgroundOpacity: z.number().nullish(),
            fillType: z.string().nullish()
          })
          .nullish(),
        imageBase64: z.string().nullish()
      })
      .nullish(),
    screenshot: z.string().nullish(),
    get children() {
      return z.array(BridgeNodeSchema).default([]);
    }
  })
  .passthrough();

type BridgeNode = z.infer<typeof BridgeNodeSchema>;

const BridgeDocumentSchema = z
  .object({
    version: z.literal(BRIDGE_SCHEMA_VERSION),
    sourceCanvas: z.string().min(1),
    exportTime: z.string().datetime().optional(),
    nodes: z.array(BridgeNodeSchema).min(1)
  })
  .passthrough();

export function adaptBridgeDocument(input: unknown): ObservationDocument {
  const source = BridgeDocumentSchema.parse(input);
  return ObservationDocumentSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    observations: source.nodes.map((node, index) => ({
      schemaVersion: SCHEMA_VERSION,
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
    ...(node.opacity == null ? {} : { opacity: node.opacity }),
    ...(componentRef == null
      ? {}
      : {
          componentRef: {
            ...(componentRef.prefabGuid ? { prefabGuid: componentRef.prefabGuid } : {}),
            ...(componentRef.prefabPath ? { prefabPath: componentRef.prefabPath } : {}),
            ...(componentRef.scriptType ? { scriptType: componentRef.scriptType } : {}),
            componentTypes: componentRef.componentTypes ?? [],
            ...(componentRef.isNested == null
              ? {}
              : { isNested: componentRef.isNested })
          }
        }),
    ...(node.layout?.rect == null ? {} : { bounds: node.layout.rect }),
    ...(text == null
      ? {}
      : {
          text: {
            characters: text.characters ?? "",
            ...(text.fontName?.family ? { fontFamily: text.fontName.family } : {}),
            ...(text.fontName?.style ? { fontStyle: text.fontName.style } : {}),
            ...(text.fontSize == null ? {} : { fontSize: text.fontSize })
          }
        }),
    ...(style == null
      ? {}
      : {
          style: {
            ...(style.backgroundColor
              ? { backgroundColor: style.backgroundColor }
              : {}),
            ...(style.backgroundOpacity == null
              ? {}
              : { backgroundOpacity: style.backgroundOpacity }),
            ...(style.fillType ? { fillType: style.fillType } : {})
          }
        }),
    ...(node.layout?.imageBase64
      ? { imageBase64: node.layout.imageBase64 }
      : node.screenshot
        ? { imageBase64: node.screenshot }
        : {}),
    children: (node.children ?? []).map((child, index) =>
      adaptNode(child, `${sourcePath}.children[${index}]`)
    )
  };
}
