import { describe, expect, it } from "vitest";
import { approvalProblem, createPageReviewSession, deriveReviewActions } from "../public/page-review-session.js";

function draft(overrides = {}) {
  return {
    revision: 2,
    review: { status: "in_review" },
    root: { id: "root", name: "Page", kind: "container", rect: { x: 0, y: 0, width: 640, height: 480 }, children: [
      { id: "heading", name: "Heading", kind: "text", rect: { x: 20, y: 20, width: 120, height: 32 }, text: { characters: "Title", fontSize: 16 } }
    ] },
    issues: [],
    ...overrides
  };
}

function record(value = {}) {
  const current = draft();
  return { pageId: "page", draft: current, dependencyErrors: [], revisions: [current], approvals: [], candidates: [], assets: [], ...value };
}

describe("page review session", () => {
  it("keeps approval guidance independent from the DOM", () => {
    expect(approvalProblem(draft({ issues: [{ id: "issue", nodeId: "heading", decision: "pending", message: "缺少依据" }] }))).toContain("还有 1 项待确认");
    expect(approvalProblem(draft({ issues: [{ id: "issue", nodeId: "heading", decision: "resolved", message: "缺少依据" }] }))).toContain("缺少依据");
  });

  it("derives action state from review state", () => {
    const value = deriveReviewActions({ record: record(), draft: record().draft, selectedId: "heading", dirty: false, busy: false });
    expect(value.analyzeDisabled).toBe(false);
    expect(value.approveLabel).toBe("批准结构");
    expect(value.reviseDisabled).toBe(false);
  });

  it("centralizes draft edits and clears a pending proposal", () => {
    const session = createPageReviewSession();
    session.open(record());
    session.setProposal({ id: "proposal" });
    session.edit(value => { value.root.children[0].text.characters = "Updated"; });
    const state = session.getState();
    expect(state.draft.root.children[0].text.characters).toBe("Updated");
    expect(state.dirty).toBe(true);
    expect(state.proposal).toBeNull();
  });

  it("keeps a valid selected node when a page is reopened", () => {
    const session = createPageReviewSession();
    session.open(record());
    session.selectNode("heading");
    session.open(record());
    expect(session.getState().selectedId).toBe("heading");
  });
});
