import { readFile } from "node:fs/promises";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";
import * as editor from "../public/page-editor.js";
import * as reviewSession from "../public/page-review-session.js";

// Execute the actual browser handlers with a minimal DOM and an isolated HTTP stub.
class Element {
  children = []; disabled = false; hidden = false; inert = false; value = "";
  textContent = ""; style = {}; classList = { toggle() {} };
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  setAttribute() {}
  querySelector() { return this.submit ??= new Element(); }
  scrollIntoView() {}
  focus() { this.focused = true; }
}

async function planner() {
  const elements = new Map();
  const el = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  el("page-reviewer").value = "tester";
  let draft = { revision: 2, review: { status: "in_review" }, input: { page: { name: "Page" }, instructions: "" },
    root: { id: "root", name: "Page", kind: "container", rect: { x: 0, y: 0, width: 640, height: 480 }, children: [
      { id: "gap", name: "Progress", kind: "placeholder", rect: { x: 20, y: 20, width: 100, height: 50 },
        placeholder: { issueId: "gap-issue", category: "capability", reason: "动态进度能力待补齐" } }
    ] }, issues: [{ id: "gap-issue", nodeId: "gap", category: "capability", message: "动态进度能力待补齐", decision: "pending", blocking: false }] };
  const requests = []; let failNext = null;
  const fetch = async (path, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : undefined;
    requests.push({ path, body });
    const result = (value, status = 200) => Response.json(value, { status });
    if (failNext && body) { const error = failNext; failNext = null; return result({ error }, 500); }
    if (path.endsWith("/edit")) {
      draft = { ...draft, revision: draft.revision + 1, root: body.root, issues: body.issues, review: { status: "in_review" } };
      return result(draft);
    }
    if (path.endsWith("/approve-structure")) {
      if (draft.issues.some(issue => issue.decision === "pending")) return result({ error: "Review decisions are still pending." }, 409);
      draft.review = { status: "structure_approved" }; return result(draft);
    }
    if (path === "/api/pages") return result([{ pageId: "page", name: "Page", revision: draft.revision, status: draft.review.status }]);
    return result({ pageId: "page", draft, reference: { mime: "image/png", base64: "", width: 1, height: 1 },
      revisions: [draft], approvals: [], assets: [], candidates: [], dependencyErrors: [] });
  };
  const context = createContext({ ...editor, ...reviewSession, structuredClone, fetch, Response, console,
    document: { getElementById: el, createElement: () => new Element() },
    window: { addEventListener() {} }, Option: class extends Element { constructor(text, value) { super(); this.textContent = text; this.value = value; } }
  });
  const source = await readFile(new URL("../public/page-planner.js", import.meta.url), "utf8");
  runInContext(source.replace(/^import[^\n]+\n/gm, ""), context);
  await runInContext("openPage('page')", context);
  const decide = () => {
    const row = el("page-issues").children[0];
    row.children[1].value = "accepted_placeholder"; row.children[1].onchange();
    row.children[2].value = "本轮仅验收静态结构"; row.children[2].oninput();
  };
  return { el, requests, decide, failNext: message => { failNext = message; } };
}

describe("page approval recovery", () => {
  it("keeps review actionable after pending approval is rejected, then saves and approves the corrected revision", async () => {
    const ui = await planner();
    await ui.el("page-approve").onclick();
    expect(ui.el("page-review").inert).toBe(false);
    expect(ui.el("page-approve").disabled).toBe(false);
    expect(ui.el("page-download").disabled).toBe(true);
    ui.decide();
    expect(ui.el("page-approve").disabled).toBe(false);
    expect(ui.el("page-approve-label").textContent).toBe("保存并批准");
    expect(ui.el("page-approval-hint").textContent).toContain("保存");
    await ui.el("page-approve").onclick();
    const writes = ui.requests.filter(item => item.body);
    expect(writes.map(item => item.path)).toEqual(["/api/pages/page/edit", "/api/pages/page/approve-structure"]);
    expect(writes[0].body.issues[0].decision).toBe("accepted_placeholder");
    expect(writes[1].body.expectedRevision).toBe(3);
    expect(ui.el("page-download").disabled).toBe(false);
  });

  it("shows a Chinese pending count without sending a rejected approval request", async () => {
    const ui = await planner();
    await ui.el("page-approve").onclick();
    expect(ui.el("page-message").textContent).toContain("还有 1 项待确认");
    expect(ui.el("page-approval-hint").textContent).toContain("待确认");
    expect(ui.requests.filter(item => item.body)).toEqual([]);
  });

  it("explains why entering a reason alone leaves the issue pending and focuses its decision", async () => {
    const ui = await planner();
    const row = ui.el("page-issues").children[0];
    const decision = row.children[1], resolution = row.children[2];
    resolution.value = "本轮仅验收静态结构"; resolution.oninput();
    await ui.el("page-approve").onclick();
    expect(ui.el("page-message").textContent).toContain("已填写依据");
    expect(ui.el("page-message").textContent).toContain("下拉框");
    expect(decision.focused).toBe(true);
    expect(decision.value).toBe("pending");
    expect(resolution.value).toBe("本轮仅验收静态结构");
    expect(ui.requests.filter(item => item.body)).toEqual([]);
    expect(ui.el("page-approve").disabled).toBe(false);
  });

  it("updates issue guidance and the pending count without replacing controls while reviewing", async () => {
    const ui = await planner();
    const row = ui.el("page-issues").children[0];
    expect(row.children[1].children[0].textContent).toBe("请选择审核决定");
    expect(row.children[3].textContent).toContain("选择审核决定");
    ui.decide();
    expect(ui.el("page-issue-count").textContent).toBe("0 待确认 / 1 项");
    expect(row.children[3].textContent).toContain("已接受占位");
    expect(row.children[3].textContent).toContain("已填写依据");
    expect(ui.el("page-issues").children[0]).toBe(row);
    await ui.el("page-approve").onclick();
    expect(ui.el("page-download").disabled).toBe(false);
  });

  it("renders page overview progress and issue categories for the reviewer", async () => {
    const ui = await planner();
    expect(ui.el("page-empty-state").hidden).toBe(true);
    expect(ui.el("page-summary-pending").textContent).toBe("1");
    expect(ui.el("page-summary-progress").textContent).toBe("0%");
    expect(ui.el("page-summary-blocking").textContent).toBe("无阻塞项");
    expect(ui.el("page-issue-summary").children[0].textContent).toContain("能力缺口");
  });

  it("restores controls and preserves unsaved decisions when saving fails", async () => {
    const ui = await planner(); ui.decide(); ui.failNext("保存失败，请重试。");
    await ui.el("page-approve").onclick();
    expect(ui.el("page-message").textContent).toBe("保存失败，请重试。");
    expect(ui.el("page-approve").disabled).toBe(false);
    expect(ui.el("page-save").disabled).toBe(false);
    expect(ui.el("page-review").inert).toBe(false);
    expect(ui.requests.filter(item => item.body).map(item => item.path)).toEqual(["/api/pages/page/edit"]);
    await ui.el("page-approve").onclick();
    expect(ui.el("page-download").disabled).toBe(false);
  });

  it("allows retry when the approval request fails after the decisions have been saved", async () => {
    const ui = await planner(); ui.decide();
    await ui.el("page-save").onclick();
    ui.failNext("审批服务暂时失败，请重试。");
    await ui.el("page-approve").onclick();
    expect(ui.el("page-message").textContent).toBe("审批服务暂时失败，请重试。");
    expect(ui.el("page-approve").disabled).toBe(false);
    expect(ui.el("page-review").inert).toBe(false);
    expect(ui.el("page-download").disabled).toBe(true);
    await ui.el("page-approve").onclick();
    expect(ui.el("page-download").disabled).toBe(false);
  });
});
