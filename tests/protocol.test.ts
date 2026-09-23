import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  ComponentObservationSchema,
  createSharedProtocol,
  SemanticDraftSchema
} from "../src/protocol/index.js";

describe("shared component protocol", () => {
  it("publishes the data structures other repositories consume", () => {
    const protocol = createSharedProtocol();

    expect(protocol).toMatchObject({
      version: "uiai-protocol/v1",
      name: "uiai-component"
    });
    expect(protocol.contracts.map((contract) => contract.name)).toEqual([
      "componentObservation",
      "observationDocument",
      "semanticDraft",
      "approvedComponent",
      "componentRegistry"
    ]);
    expect(protocol.contracts.every((contract) => contract.format === "json-schema")).toBe(true);
    expect(protocol.contracts.every((contract) => "properties" in contract.schema || "$ref" in contract.schema || "$defs" in contract.schema)).toBe(true);
  });

  it("validates a component observation without the manager", () => {
    const observation = ComponentObservationSchema.parse({
      schemaVersion: "1.0.0",
      source: { kind: "unity-figma-bridge", documentName: "Sample" },
      root: {
        sourceId: "guid-button",
        name: "Button",
        nodeType: "FRAME",
        visible: true,
        children: []
      }
    });

    expect(observation.root.sourceId).toBe("guid-button");
    expect(SemanticDraftSchema.safeParse({ schemaVersion: "1.0.0" }).success).toBe(false);
  });

  it("matches the published protocol file", () => {
    const published = JSON.parse(readFileSync(new URL("../protocol/uiai-component.json", import.meta.url), "utf8"));
    expect(published).toEqual(createSharedProtocol());
  });
});
