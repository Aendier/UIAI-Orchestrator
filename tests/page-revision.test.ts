import { describe, expect, it } from "vitest";
import { PageStructureDraftSchema, type StructureNode } from "../src/shared/page.js";
import { StructureRevision } from "../src/pages/revision.js";

const root: StructureNode = { id: "root", name: "Page", kind: "container", rect: { x: 0, y: 0, width: 640, height: 480 }, children: [] };

function draft(value: StructureNode = root) {
  return PageStructureDraftSchema.parse({ schemaVersion: "uiai-page/v1", stage: "structure", pageId: "page", revision: 1,
    input: { reference: { sha256: "0".repeat(64), mime: "image/png", width: 640, height: 480 }, instructions: "", page: { name: "Page", width: 640, height: 480 } },
    knowledgeSnapshot: { id: "snapshot", dependencies: [] }, root: value, issues: [], review: { status: "draft", scope: "structure" } });
}

describe("StructureRevision", () => {
  it("owns revision creation and appends the validated draft", () => {
    const current = draft();
    const record = { knowledge: [], assets: [], revisions: [current], approvals: [] };
    const next = new StructureRevision(record, []).next(current.root, [], "in_review");
    expect(next.revision).toBe(2);
    expect(next.review.status).toBe("in_review");
    expect(record.revisions).toHaveLength(2);
  });

  it("turns a stale instance dependency into a needs_review revision", () => {
    const instance: StructureNode = { id: "instance", name: "Button", kind: "instance", rect: { x: 0, y: 0, width: 10, height: 10 }, componentRef: {
      componentId: "button", prefabGuid: "guid", observationFingerprint: "1".repeat(64), originalSize: { width: 10, height: 10 }
    } };
    const current = draft({ ...root, children: [instance] });
    const record = { knowledge: [], assets: [], revisions: [current], approvals: [] };
    const errors = new StructureRevision(record, []).invalidate();
    expect(errors).toEqual(["组件审核或 Observation 已失效：button"]);
    expect(record.revisions.at(-1)?.review.status).toBe("needs_review");
    expect(record.revisions.at(-1)?.revision).toBe(2);
  });
});
