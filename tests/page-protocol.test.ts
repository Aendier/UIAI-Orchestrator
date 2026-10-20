import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parsePagePlan, normalizeGlobalCoordinates, computePlanHash, type StructureNode } from "../src/shared/page.js";
import { projectBridgeNode } from "../src/shared/bridge.js";
import { createObservationFingerprint, hashJson, canonicalJson } from "../src/shared/fingerprint.js";

const json = async (name: string) => JSON.parse(await readFile(new URL(import.meta.resolve(`@uiai/protocol/fixtures/page/${name}.json`)), "utf8"));
describe("uiai-page/v1 contracts", () => {
  it("accepts the portable mixed plan and rejects every invalid consistency fixture", async () => {
    const plan = await json("valid-plan");
    expect(parsePagePlan(plan).dependencies).toHaveLength(1);
    expect(computePlanHash(plan)).toBe(plan.planHash);
    for (const sample of await json("invalid-plans")) expect(() => parsePagePlan(sample.plan), sample.name).toThrow();
  });
  it("uses the published Observation projection and canonical UTF-8 SHA-256", async () => {
    for (const sample of await json("fingerprints")) {
      const root = projectBridgeNode(sample.bridge, sample.sourcePath);
      expect(root).toEqual(sample.observationRoot);
      expect(createObservationFingerprint({ root })).toBe(sample.fingerprint);
    }
    expect(hashJson({ z: 1, a: { b: "中文", a: [1, 2] } })).toBe(hashJson({ a: { a: [1, 2], b: "中文" }, z: 1 }));
    expect(hashJson([1, 2])).not.toBe(hashJson([2, 1]));
    const unicode = { z: 1, a: { b: "中文\n\u2028", a: [1, 2] } };
    expect(hashJson(unicode)).toBe(createHash("sha256").update(canonicalJson(unicode), "utf8").digest("hex"));
  });
  it("normalizes nested global evidence coordinates without changing paint order", () => {
    const tree: StructureNode = { id: "root", name: "root", kind: "container", rect: { x: 0, y: 0, width: 600, height: 400 }, children: [
      { id: "group", name: "group", kind: "container", rect: { x: 100, y: 50, width: 300, height: 200 }, children: [
        { id: "label", name: "label", kind: "text", rect: { x: 120, y: 80, width: 100, height: 30 }, text: { characters: "A", fontSize: 16 } }
      ] }
    ] };
    const result = normalizeGlobalCoordinates(tree);
    if (result.kind !== "container" || result.children[0]?.kind !== "container") throw new Error("fixture");
    expect(result.children[0].children[0]?.rect).toEqual({ x: 20, y: 30, width: 100, height: 30 });
    expect(tree.children[0]?.rect.x).toBe(100);
  });
});
