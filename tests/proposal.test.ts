import { describe, expect, it } from "vitest";
import { ProposalIntake } from "../src/pages/proposal.js";
import type { StructureNode } from "../src/shared/page.js";

const container = (id: string, x = 0, y = 0): StructureNode => ({ id, name: id, kind: "container", rect: { x, y, width: 100, height: 100 }, children: [] });

describe("ProposalIntake", () => {
  it("normalizes global coordinates before a page revision is committed", () => {
    const root = container("root") as Extract<StructureNode, { kind: "container" }>;
    const child = container("child", 120, 80) as Extract<StructureNode, { kind: "container" }>;
    child.children = [container("leaf", 10, 20)]; root.children = [child];
    const result = new ProposalIntake([]).page({ coordinateSpace: "global", root, issues: [] });
    expect(result.root.kind === "container" && result.root.children[0]?.rect).toMatchObject({ x: 120, y: 80 });
    expect(result.root.kind === "container" && result.root.children[0]?.kind === "container" && result.root.children[0].children[0]?.rect).toMatchObject({ x: -110, y: -60 });
  });

  it("rejects malformed, self-approved and unknown component proposals at one seam", () => {
    const intake = new ProposalIntake([]);
    expect(() => intake.page({ nonsense: true })).toThrow(/模型输出不符合页面协议/);
    expect(() => intake.page({ coordinateSpace: "local", root: container("root"), issues: [{ id: "issue", nodeId: "root", category: "component", message: "x", blocking: false, candidateIds: [], decision: "resolved" }] })).toThrow(/不能代替人工作出审核决定/);
    const instance: StructureNode = { id: "instance", name: "Button", kind: "instance", rect: { x: 0, y: 0, width: 10, height: 10 }, componentRef: {
      componentId: "unknown", prefabGuid: "guid", observationFingerprint: "1".repeat(64), originalSize: { width: 10, height: 10 }
    } };
    expect(() => intake.page({ coordinateSpace: "local", root: instance, issues: [] })).toThrow(/允许集合之外/);
  });

  it("rejects a local proposal that escapes the selected subtree", () => {
    const selected = container("selected");
    expect(() => new ProposalIntake([]).revision(selected, { coordinateSpace: "local", root: container("other"), issues: [] })).toThrow(/保留所选节点 ID/);
  });
});
