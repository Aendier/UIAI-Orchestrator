import { describe, expect, it } from "vitest";
import { flatten, reparentNode } from "../public/page-editor.js";
describe("page editor hierarchy", () => {
  it("reparents ordinary nodes in local coordinates and rejects cycles or instance children", () => {
    const root = { id: "root", kind: "container", rect: { x: 0, y: 0 }, children: [
      { id: "a", kind: "container", rect: { x: 100, y: 50 }, children: [{ id: "label", kind: "text", rect: { x: 20, y: 30 } }] },
      { id: "b", kind: "container", rect: { x: 200, y: 100 }, children: [] },
      { id: "instance", kind: "instance", rect: { x: 10, y: 10 } }
    ] };
    expect(() => reparentNode(root, "a", "label")).toThrow();
    expect(() => reparentNode(root, "label", "instance")).toThrow();
    reparentNode(root, "label", "b");
    expect(root.children[1].children[0].rect).toEqual({ x: -80, y: -20 });
    expect(flatten(root).map(item => item.node.id)).toEqual(["root", "a", "b", "label", "instance"]);
  });
});
