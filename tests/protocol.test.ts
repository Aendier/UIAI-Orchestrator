import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { z } from "zod";
import * as componentProtocol from "@uiai/protocol/component";
import * as observationProtocol from "@uiai/protocol/observation";
import * as semanticProtocol from "@uiai/protocol/semantic";
import * as registryProtocol from "@uiai/protocol/registry";
import { createPageProtocol } from "@uiai/protocol/page";
import * as localObservation from "../src/observation/index.js";
import * as localSemantic from "../src/semantic/index.js";
import * as localRegistry from "../src/registry/index.js";
import * as localComponent from "../src/protocol/index.js";

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

  it("keeps legacy entry points on the package's shared schemas and generators", () => {
    for (const [local, shared] of [
      [localObservation, observationProtocol],
      [localSemantic, semanticProtocol],
      [localRegistry, registryProtocol],
      [localComponent, componentProtocol]
    ] as const) {
      for (const [name, value] of Object.entries(shared)) {
        expect(local, name).toHaveProperty(name);
        expect((local as Record<string, unknown>)[name], name).toBe(value);
      }
    }
    const invalid = ComponentObservationSchema.safeParse({ schemaVersion: "1.0.0" });
    expect(invalid.success).toBe(false);
    if (!invalid.success) expect(invalid.error).toBeInstanceOf(z.ZodError);
  });

  it.each([
    ["uiai-component.json", createSharedProtocol],
    ["uiai-page.json", createPageProtocol]
  ] as const)("keeps %s byte-identical to the fixed package artifact", (name, generate) => {
    const bytes = readFileSync(new URL(`../protocol/${name}`, import.meta.url));
    const packaged = readFileSync(new URL(import.meta.resolve(`@uiai/protocol/protocol/${name}`)));
    const checksums = JSON.parse(readFileSync(new URL(import.meta.resolve("@uiai/protocol/protocol/artifacts.sha256.json")), "utf8"));
    expect(bytes.equals(packaged)).toBe(true);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(checksums.files[`protocol/${name}`]);
    expect(JSON.parse(bytes.toString("utf8"))).toEqual(generate());
  });
});
