import { flatten, findNode, replaceNode, removeNode, reparentNode } from "./page-editor.js";
import { createPageReviewSession, statusLabels } from "./page-review-session.js";

const $ = id => document.getElementById(id);
const kindLabels = { container: "容器", instance: "组件实例", text: "文本", image: "图片", placeholder: "占位" };
const review = createPageReviewSession();
let reference = null;
const icons = () => window.lucide?.createIcons();
const message = (text, error = false) => { $("page-message").textContent = text; $("page-message").classList.toggle("error", error); };
function element(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; }
async function request(path, body, signal) {
  const response = await fetch(path, { ...(body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), ...(signal ? { signal } : {}) });
  const value = await response.json(); if (!response.ok) throw new Error(value.error || "请求失败。"); return value;
}
async function perform(fn) {
  if (review.getState().busy) return;
  review.setBusy(true); updateActions();
  try { await fn(); } catch (error) { message(error.name === "AbortError" ? "模型请求已取消。" : error.message, error.name !== "AbortError"); }
  finally { review.setBusy(false); review.setController(null); $("page-cancel").hidden = true; updateActions(); }
}
function changed() { review.markChanged(); $("page-proposal").hidden = true; message(""); updateActions(); }
function updateActions() {
  const { busy, record } = review.getState();
  const actions = review.actions();
  $("page-empty-state").hidden = Boolean(record);
  if (!record) $("page-review").hidden = true;
  $("page-issue-count").textContent = actions.issueCount;
  $("page-save").disabled = actions.saveDisabled;
  $("page-analyze").disabled = actions.analyzeDisabled;
  $("page-approve").disabled = actions.approveDisabled;
  $("page-approve-label").textContent = actions.approveLabel;
  $("page-approval-hint").textContent = actions.approvalHint;
  $("page-approve").title = actions.approvalHint;
  $("page-download").disabled = actions.downloadDisabled;
  $("page-revise").disabled = actions.reviseDisabled;
  $("page-state").textContent = actions.stateText;
  $("page-create-form").querySelector("button").disabled = busy;
  $("page-create-form").inert = busy;
  $("page-review").inert = busy;
  $("page-list").inert = busy;
}
function renderOverview() {
  const { record, draft, dirty } = review.getState();
  if (!record || !draft) return;
  const nodes = flatten(draft.root).map(item => item.node);
  const pending = draft.issues.filter(issue => issue.decision === "pending");
  const blocking = draft.issues.filter(issue => issue.blocking && issue.decision === "pending");
  const decided = draft.issues.filter(issue => issue.decision !== "pending" && issue.resolution?.trim()).length;
  const progress = draft.issues.length ? Math.round(decided / draft.issues.length * 100) : draft.review.status === "structure_approved" ? 100 : 0;
  const instances = nodes.filter(node => node.kind === "instance").length;
  $("page-overview-title").textContent = draft.input.page.name;
  $("page-summary-status").textContent = statusLabels[draft.review.status];
  $("page-summary-revision").textContent = `第 ${draft.revision} 版${dirty ? " · 有未保存修改" : ""}`;
  $("page-summary-pending").textContent = String(pending.length);
  $("page-summary-blocking").textContent = blocking.length ? `${blocking.length} 个阻塞项` : "无阻塞项";
  $("page-summary-nodes").textContent = String(nodes.length);
  $("page-summary-matches").textContent = `${instances} 个可复用组件`;
  $("page-summary-progress").textContent = `${progress}%`;
  $("page-summary-progress-label").textContent = draft.issues.length ? `${decided} / ${draft.issues.length} 项已处理` : "暂无待确认项";
  $("page-progress-fill").style.width = `${progress}%`;
  const summary = record.dependencyErrors.length ? record.dependencyErrors.join("；") : pending.length ? "处理完待确认项后，才能批准页面结构。" : draft.review.status === "structure_approved" ? "页面结构已批准，可以下载执行计划。" : "结构已生成，检查页面内容后即可批准。";
  $("page-summary-message").textContent = summary;
}
function renderIssueSummary() {
  const { draft } = review.getState();
  const summary = $("page-issue-summary");
  const labels = { capability: "能力缺口", component: "组件缺口", asset: "图片素材", conflict: "结构冲突", ambiguity: "存在歧义", content: "内容差异" };
  const counts = new Map();
  for (const issue of draft.issues) counts.set(issue.category, (counts.get(issue.category) ?? 0) + 1);
  const pending = draft.issues.filter(issue => issue.decision === "pending").length;
  summary.replaceChildren(...[...counts].map(([category, count]) => element("span", `${labels[category] ?? category} ${count}`, draft.issues.some(issue => issue.category === category && issue.decision === "pending") ? "warning" : "")),
    ...(pending ? [] : [element("span", "全部已选择处理方式", "success")]));
}
async function listPages() {
  const { record } = review.getState();
  const pages = await request("/api/pages"); const list = $("page-list"); list.replaceChildren();
  if (!pages.length) list.append(element("p", "暂无页面任务", "muted"));
  pages.forEach(page => {
    const button = element("button", undefined, "page-task"); button.type = "button";
    button.classList.toggle("selected", page.pageId === record?.pageId);
    button.append(element("strong", page.name), element("span", `r${page.revision} · ${statusLabels[page.status]}`, "muted"));
    button.onclick = () => perform(async () => { if (review.getState().dirty) throw new Error("请先保存当前页面修订。"); await openPage(page.pageId); }); list.append(button);
  });
}
async function openPage(pageId) {
  const record = await request(`/api/pages/${pageId}`); review.open(record);
  const state = review.getState(); const { draft } = state;
  $("page-review").hidden = false; $("page-title").textContent = draft.input.page.name;
  $("page-reference-preview").src = `data:${record.reference.mime};base64,${record.reference.base64}`;
  $("page-reference-size").textContent = `${record.reference.width} × ${record.reference.height}`;
  $("page-requirements").textContent = draft.input.instructions;
  message(record.dependencyErrors.join("\n"), record.dependencyErrors.length > 0);
  $("page-proposal").hidden = true;
  render(); await listPages();
}
function render() {
  const { record, draft } = review.getState();
  renderOverview(); renderTree(); renderInspector(); renderIssues(); renderIssueSummary(); updateActions();
  $("page-json-editor").value = JSON.stringify({ root: draft.root, issues: draft.issues }, null, 2);
  $("page-history").replaceChildren(...record.revisions.map(item => element("p", `r${item.revision} · ${statusLabels[item.review.status]}`)),
    ...record.approvals.map(item => element("p", `r${item.revision} · ${item.review.reviewer} · ${item.review.reviewedAt}`)));
  icons();
}
function renderTree() {
  const { draft, selectedId } = review.getState();
  $("page-tree").replaceChildren(...flatten(draft.root).map(({ node, depth }) => {
    const button = element("button", undefined, "page-tree-node"); button.type = "button"; button.setAttribute("role", "treeitem");
    button.setAttribute("aria-level", String(depth + 1)); button.setAttribute("aria-selected", String(node.id === selectedId));
    button.style.paddingLeft = `${12 + depth * 16}px`;
    button.append(element("span", node.name, "page-tree-name"), element("small", kindLabels[node.kind]));
    button.onclick = () => { review.selectNode(node.id); render(); }; return button;
  }));
}
function renderInspector() {
  const { record, draft, selectedId } = review.getState();
  const item = findNode(draft.root, selectedId); if (!item) { review.selectNode(draft.root.id); return renderInspector(); }
  const node = item.node, root = node === draft.root;
  $("page-node-kind").textContent = kindLabels[node.kind]; $("page-node-name").value = node.name;
  for (const prop of ["x", "y", "width", "height"]) { $("page-node-" + prop).value = node.rect[prop]; $("page-node-" + prop).disabled = root || (node.kind === "instance" && ["width", "height"].includes(prop)); }
  const excluded = new Set(flatten(node).map(item => item.node.id));
  $("page-node-parent").replaceChildren(...flatten(draft.root).filter(item => item.node.kind === "container" && !excluded.has(item.node.id)).map(item => new Option(item.node.name, item.node.id)));
  $("page-node-parent").disabled = root; $("page-node-parent").value = item.parent?.id ?? "";
  $("page-text-field").hidden = $("page-font-field").hidden = node.kind !== "text";
  if (node.kind === "text") { $("page-node-text").value = node.text.characters; $("page-node-font").value = node.text.fontSize; }
  $("page-add-node").disabled = node.kind !== "container"; $("page-delete-node").disabled = root;
  $("page-component-choice").replaceChildren(new Option("选择组件", ""), ...record.candidates.map(candidate => new Option(candidate.approved.name + " · " + candidate.ref.componentId, candidate.ref.componentId)));
  $("page-component-choice").value = node.kind === "instance" ? node.componentRef.componentId : "";
  $("page-replace-component").disabled = root || (node.kind === "container" && node.children.length > 0);
  $("page-gap-component").disabled = root;
  $("page-asset-choice").replaceChildren(new Option("选择素材", ""), ...record.assets.map(asset => new Option(`${asset.width} × ${asset.height} · ${asset.id.slice(6, 18)}`, asset.id)));
  $("page-asset-choice").value = node.kind === "image" ? node.assetId : "";
  $("page-use-asset").disabled = root || (node.kind === "container" && node.children.length > 0);
  $("page-match-evidence").replaceChildren(...(node.evidence ?? []).map(evidence => element("p", `${evidence.source}: ${evidence.detail}`)), ...(node.match ? [element("p", `${node.match.status} · ${Math.round(node.match.confidence * 100)}% · ${node.match.rationale}`)] : []));
  const region = node.evidence?.find(evidence => evidence.source === "image" && evidence.region)?.region;
  const overlay = $("page-reference-region"); overlay.hidden = !region;
  if (region) Object.assign(overlay.style, { left: `${region.x / record.reference.width * 100}%`, top: `${region.y / record.reference.height * 100}%`, width: `${region.width / record.reference.width * 100}%`, height: `${region.height / record.reference.height * 100}%` });
  renderCandidate();
}
function renderCandidate() {
  const { record, draft, selectedId } = review.getState();
  const candidate = record?.candidates.find(item => item.ref.componentId === $("page-component-choice").value);
  const view = $("page-component-preview"); view.replaceChildren(); if (!candidate) return;
  const image = candidate.observation.root.imageBase64;
  if (image) { const img = element("img"); img.alt = candidate.approved.name; img.src = image.startsWith("data:") ? image : `data:image/png;base64,${image}`; view.append(img); }
  const node = findNode(draft.root, selectedId).node;
  const evidence = node.evidence?.find(item => item.source === "image" && item.region)?.region;
  view.append(element("code", candidate.ref.prefabGuid), element("p", `${candidate.ref.originalSize.width} × ${candidate.ref.originalSize.height}`),
    element("p", candidate.approved.capabilities.join(", "), "muted"));
  if (evidence) view.append(element("p", `参考区域 ${evidence.width} × ${evidence.height} · 差值 ${candidate.ref.originalSize.width - evidence.width} / ${candidate.ref.originalSize.height - evidence.height}`, "muted"));
  const texts = []; const visit = observed => { if (observed.text?.characters) texts.push(observed.text.characters); observed.children.forEach(visit); }; visit(candidate.observation.root);
  if (texts.length) view.append(element("p", texts.join(" · "), "page-wrapping"));
}
function renderIssues() {
  const { draft } = review.getState();
  $("page-issues").replaceChildren(...draft.issues.map(issue => {
    const row = element("div", undefined, "page-issue");
    const label = issue.decision === "accepted_placeholder" ? "已接受占位 · " : issue.decision === "accepted_difference" ? "已接受差异 · " : issue.decision === "resolved" ? "已解决 · " : issue.blocking ? "需解决 · " : "";
    const focus = element("button", `${label}${issue.message}`, "page-issue-focus"); focus.type = "button"; focus.onclick = () => { review.selectNode(issue.nodeId); render(); };
    const decision = element("select"); decision.setAttribute("aria-label", issue.message + "审核决定");
    const placeholder = findNode(draft.root, issue.nodeId)?.node.kind === "placeholder";
    const choices = placeholder ? [["pending", "请选择审核决定"], ["accepted_placeholder", "接受占位"]] : [["pending", "请选择审核决定"], ["resolved", "已解决"], ...(["conflict", "ambiguity"].includes(issue.category) ? [] : [["accepted_difference", "接受实际差异"]])];
    decision.append(...choices.map(([value, label]) => new Option(label, value))); decision.value = issue.decision;
    const resolution = element("input"); resolution.value = issue.resolution ?? ""; resolution.placeholder = "第 2 步：填写审核决定依据"; resolution.setAttribute("aria-label", issue.message + "决定依据");
    const help = element("p", undefined, "page-issue-help muted");
    const updateIssue = () => {
      focus.textContent = `${issue.decision === "accepted_placeholder" ? "已接受占位 · " : issue.decision === "accepted_difference" ? "已接受差异 · " : issue.decision === "resolved" ? "已解决 · " : issue.blocking ? "需解决 · " : ""}${issue.message}`;
      help.textContent = issue.decision === "pending" ? `第 1 步：在上方下拉框选择审核决定；第 2 步：填写依据。填写文字不会自动确认。${placeholder ? "选择“接受占位”表示本轮预览保留此缺口；需要实际内容时，请先补齐素材或组件。" : ""}`
        : `${issue.decision === "accepted_placeholder" ? "已接受占位" : issue.decision === "accepted_difference" ? "已接受差异" : "已解决"} · ${issue.resolution?.trim() ? "已填写依据" : "请填写审核决定依据"}${issue.decision === "accepted_placeholder" ? "；本轮预览仍保留此占位。" : ""}`;
    };
    decision.onchange = () => { review.edit(draft => { const current = draft.issues.find(item => item.id === issue.id); if (current) current.decision = decision.value; }); updateIssue(); changed(); };
    resolution.oninput = () => { review.edit(draft => { const current = draft.issues.find(item => item.id === issue.id); if (current) current.resolution = resolution.value; }); updateIssue(); changed(); };
    row.append(focus, decision, resolution, help); updateIssue(); return row;
  }));
}
function resolveNodeIssues(nodeId) {
  review.edit(draft => { draft.issues = draft.issues.map(issue => issue.nodeId === nodeId ? { ...issue, decision: "resolved", resolution: "人工替换节点后已解决" } : issue); });
}
async function imageFile(file) {
  if (!file || file.size > 10 * 1024 * 1024) throw new Error("请选择不超过 10 MB 的 PNG/JPEG 图片。");
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve({ mime: file.type, base64: reader.result.split(",")[1] }); reader.onerror = () => reject(new Error("图片读取失败。")); reader.readAsDataURL(file); });
}
async function save(status = "draft") {
  const { record, draft } = review.getState();
  await request(`/api/pages/${record.pageId}/edit`, { expectedRevision: draft.revision, root: draft.root, issues: draft.issues, status });
  await openPage(record.pageId); message("修订已保存。");
}
$("library-tab").onclick = () => { $("library-workspace").hidden = false; $("pages-workspace").hidden = true; $("library-tab").setAttribute("aria-selected", "true"); $("pages-tab").setAttribute("aria-selected", "false"); };
$("pages-tab").onclick = () => { $("library-workspace").hidden = true; $("pages-workspace").hidden = false; $("library-tab").setAttribute("aria-selected", "false"); $("pages-tab").setAttribute("aria-selected", "true"); perform(async () => { const { record, dirty } = review.getState(); if (record && !dirty) await openPage(record.pageId); else await listPages(); }); };
$("page-refresh").onclick = () => perform(async () => { const { record, dirty } = review.getState(); if (dirty) throw new Error("请先保存当前页面修订。"); if (record) await openPage(record.pageId); else await listPages(); });
$("page-reference-file").onchange = () => perform(async () => {
  reference = await imageFile($("page-reference-file").files[0]); const image = new Image();
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error("图片内容无效。")); image.src = `data:${reference.mime};base64,${reference.base64}`; });
  $("page-width").value = image.naturalWidth; $("page-height").value = image.naturalHeight;
});
$("page-create-form").onsubmit = event => { event.preventDefault(); perform(async () => {
  if (review.getState().dirty) throw new Error("请先保存当前页面修订。"); if (!reference) throw new Error("请选择参考图。");
  const page = await request("/api/pages", { reference, name: $("page-name").value.trim(), instructions: $("page-instructions").value, width: Number($("page-width").value), height: Number($("page-height").value) }); await openPage(page.pageId);
}); };
$("page-node-form").onsubmit = event => { event.preventDefault(); const { busy, draft, selectedId } = review.getState(); if (busy || !draft) return;
  try {
    const item = findNode(draft.root, selectedId); const node = item.node;
    review.edit(next => {
      const current = findNode(next.root, selectedId).node;
      current.name = $("page-node-name").value;
      if (current !== next.root) for (const prop of ["x", "y", "width", "height"]) if (!$("page-node-" + prop).disabled) current.rect[prop] = Number($("page-node-" + prop).value);
      if (current.kind === "text") current.text = { characters: $("page-node-text").value, fontSize: Number($("page-node-font").value) };
      if (item.parent && item.parent.id !== $("page-node-parent").value) reparentNode(next.root, current.id, $("page-node-parent").value);
    });
    changed(); render();
  } catch (error) { message(error.message, true); }
};
$("page-add-node").onclick = () => {
  const { draft, selectedId, busy } = review.getState(); const parent = findNode(draft.root, selectedId).node; if (busy || parent.kind !== "container") return;
  const id = crypto.randomUUID(); const kind = $("page-add-kind").value;
  const node = { id, name: kindLabels[kind], kind, rect: { x: 16, y: 16, width: 160, height: 48 } };
  if (kind === "container") node.children = []; if (kind === "text") node.text = { characters: "文本", fontSize: 16 };
  review.edit(next => {
    const currentParent = findNode(next.root, selectedId).node;
    if (kind === "placeholder") { node.placeholder = { issueId: id + "-issue", category: "capability", reason: "待补齐能力" }; next.issues.push({ id: id + "-issue", nodeId: id, category: "capability", message: "待补齐能力", blocking: false, candidateIds: [], decision: "pending" }); }
    currentParent.children.push(node);
  });
  review.selectNode(id); changed(); render();
};
$("page-delete-node").onclick = () => {
  const { draft, selectedId, busy } = review.getState(); const item = findNode(draft.root, selectedId); if (busy || !item?.parent) return;
  const parentId = item.parent.id; const ids = new Set(flatten(item.node).map(item => item.node.id));
  review.edit(next => { removeNode(next.root, selectedId); next.issues = next.issues.filter(issue => !ids.has(issue.nodeId)); });
  review.selectNode(parentId); changed(); render();
};
for (const [button, delta] of [["page-node-up", -1], ["page-node-down", 1]]) $(button).onclick = () => {
  const { draft, selectedId, busy } = review.getState(); const item = findNode(draft.root, selectedId); if (busy || !item?.parent) return; const siblings = item.parent.children, from = siblings.findIndex(node => node.id === selectedId), to = from + delta;
  if (to < 0 || to >= siblings.length) return; review.edit(next => { const current = findNode(next.root, selectedId).parent.children; [current[from], current[to]] = [current[to], current[from]]; }); changed(); render();
};
$("page-component-choice").onchange = renderCandidate;
$("page-replace-component").onclick = () => {
  const { record, draft, selectedId, busy } = review.getState(); const candidate = record.candidates.find(item => item.ref.componentId === $("page-component-choice").value); const node = findNode(draft.root, selectedId).node;
  if (busy || !candidate || node === draft.root || (node.kind === "container" && node.children.length)) return;
  const replacement = { id: node.id, name: node.name, kind: "instance", rect: { ...node.rect, ...candidate.ref.originalSize }, componentRef: structuredClone(candidate.ref), evidence: node.evidence,
    purpose: node.purpose, requiredCapabilities: node.requiredCapabilities,
    match: { status: "match", candidateIds: [candidate.ref.componentId], confidence: 1, rationale: "人工选择组件" } };
  review.edit(next => { next.root = replaceNode(next.root, node.id, replacement); next.issues = next.issues.map(issue => issue.nodeId === node.id ? { ...issue, decision: "resolved", resolution: "人工替换节点后已解决" } : issue); }); changed(); render();
};
$("page-gap-component").onclick = () => {
  const { draft, selectedId, busy } = review.getState(); const node = findNode(draft.root, selectedId).node; if (busy || node === draft.root || (node.kind === "container" && node.children.length)) return;
  const issueId = crypto.randomUUID();
  review.edit(next => {
    next.issues = next.issues.filter(issue => issue.nodeId !== node.id);
    next.issues.push({ id: issueId, nodeId: node.id, category: "component", message: "缺少兼容组件", blocking: false, candidateIds: [], decision: "pending" });
    next.root = replaceNode(next.root, node.id, { id: node.id, name: node.name, kind: "placeholder", rect: node.rect, evidence: node.evidence, placeholder: { issueId, category: "component", reason: "缺少兼容组件" } });
  }); changed(); render();
};
$("page-asset-file").onchange = () => perform(async () => { const { record } = review.getState(); if (!record) return; const asset = await request(`/api/pages/${record.pageId}/assets`, await imageFile($("page-asset-file").files[0])); if (!record.assets.some(item => item.id === asset.id)) record.assets.push(asset); render(); $("page-asset-choice").value = asset.id; });
$("page-use-asset").onclick = () => {
  const { draft, selectedId, busy } = review.getState(); const assetId = $("page-asset-choice").value; const node = findNode(draft.root, selectedId).node;
  if (busy || !assetId || node === draft.root || (node.kind === "container" && node.children.length)) return;
  review.edit(next => { next.root = replaceNode(next.root, node.id, { id: node.id, name: node.name, kind: "image", rect: node.rect, assetId, evidence: node.evidence }); next.issues = next.issues.map(issue => issue.nodeId === node.id ? { ...issue, decision: "resolved", resolution: "人工替换节点后已解决" } : issue); }); changed(); render();
};
$("page-save").onclick = () => perform(() => save("in_review"));
$("page-approve").onclick = async () => {
  let issueControl;
  await perform(async () => {
    const { record, draft, dirty } = review.getState();
    const problem = review.approvalProblem();
    if (problem) {
      const unresolved = draft.issues.find(issue => issue.decision === "pending") ?? draft.issues.find(issue => !issue.resolution?.trim());
      const row = unresolved && $("page-issues").children[draft.issues.indexOf(unresolved)];
      (row || $("page-issues")).scrollIntoView({ behavior: "smooth", block: "center" });
      if (row) issueControl = unresolved.decision === "pending" ? row.children[1] : row.children[2];
      throw new Error(problem);
    }
    const reviewer = $("page-reviewer").value.trim();
    if (!reviewer) throw new Error("请填写审核人后再批准。");
    if (dirty) await save("in_review");
    const latest = review.getState();
    await request(`/api/pages/${latest.record.pageId}/approve-structure`, { expectedRevision: latest.draft.revision, reviewer });
    await openPage(latest.record.pageId); message("结构审核已通过。");
  });
  issueControl?.focus({ preventScroll: true });
};
$("page-download").onclick = () => perform(async () => { const { record } = review.getState(); const plan = await request(`/api/pages/${record.pageId}/plan`); const link = element("a"); link.href = URL.createObjectURL(new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" })); link.download = `${record.pageId}-r${plan.revision}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); message("计划 JSON 已下载。"); });
$("page-cancel").onclick = () => review.getState().controller?.abort();
$("page-analyze").onclick = () => perform(async () => { const { record, draft } = review.getState(); const controller = new AbortController(); review.setController(controller); $("page-cancel").hidden = false; message("正在分析参考图。"); await request(`/api/pages/${record.pageId}/analyze`, { expectedRevision: draft.revision }, controller.signal); await openPage(record.pageId); });
$("page-revise").onclick = () => perform(async () => {
  const { record, draft, selectedId } = review.getState(); const controller = new AbortController(); review.setController(controller); $("page-cancel").hidden = false; message("正在提出局部修改。");
  const proposal = await request(`/api/pages/${record.pageId}/revise`, { expectedRevision: draft.revision, nodeId: selectedId, instructions: $("page-revise-instructions").value }, controller.signal);
  review.setProposal(proposal);
  const view = $("page-proposal"); view.hidden = false; view.replaceChildren(element("p", `修改提案 · r${proposal.expectedRevision}`), ...proposal.diff.map(item => element("p", `${item.change} · ${item.name} · ${item.id}`, "page-wrapping")));
  const preview = element("pre", JSON.stringify(proposal.root, null, 2)); view.append(preview);
  const accept = element("button", "接受修改", "button primary"); accept.type = "button"; accept.onclick = () => perform(async () => { await request(`/api/pages/${record.pageId}/edit`, { expectedRevision: proposal.expectedRevision, proposalId: proposal.id }); await openPage(record.pageId); });
  const reject = element("button", "放弃提案", "button secondary"); reject.type = "button"; reject.onclick = () => { review.clearProposal(); view.hidden = true; };
  view.append(accept, reject); message("局部修改提案待确认。");
});
$("page-apply-json").onclick = () => perform(async () => {
  const { record, draft } = review.getState(); if (!draft) return;
  const value = JSON.parse($("page-json-editor").value);
  if (!value.root || !Array.isArray(value.issues)) throw new Error("缺少 root 或 issues。");
  await request(`/api/pages/${record.pageId}/edit`, { expectedRevision: draft.revision, root: value.root, issues: value.issues, status: "in_review" });
  await openPage(record.pageId); message("JSON 修订已保存。");
});
window.addEventListener("beforeunload", event => { if (review.getState().dirty) { event.preventDefault(); event.returnValue = ""; } });
icons();
