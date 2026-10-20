import { findNode } from "./page-editor.js";

export const statusLabels = { draft: "草稿", in_review: "审核中", structure_approved: "结构已批准", needs_review: "需要重新审核" };

export function approvalProblem(draft) {
  if (!draft) return "";
  const pending = draft.issues.filter(issue => issue.decision === "pending");
  if (pending.length) {
    const explained = pending.filter(issue => issue.resolution?.trim()).length;
    return `${explained ? `${explained} 项已填写依据，但尚未选择审核决定。` : ""}还有 ${pending.length} 项待确认，请在每项的下拉框中选择审核决定，再填写依据并批准。`;
  }
  const unexplained = draft.issues.filter(issue => !issue.resolution?.trim());
  if (unexplained.length) return `还有 ${unexplained.length} 项审核决定缺少依据，请在“待确认项”中填写。`;
  if (draft.issues.some(issue => issue.blocking && ["conflict", "ambiguity"].includes(issue.category) && issue.decision !== "resolved")) {
    return "仍有结构冲突或歧义未解决，请处理后重新批准。";
  }
  return "";
}

export function deriveReviewActions({ record, draft, selectedId, dirty, busy }) {
  const active = Boolean(record && draft);
  const dependencyErrors = record?.dependencyErrors ?? [];
  const problem = active ? approvalProblem(draft) : "";
  const selected = active ? findNode(draft.root, selectedId)?.node : undefined;
  const approved = active && draft.review.status === "structure_approved";
  const hint = !active ? "" : busy ? "正在处理，请稍候。" : dependencyErrors.length ? "组件依赖已失效，请更新组件或调整页面并保存后再批准。"
    : !dirty && approved ? "当前修订已批准，可以下载计划 JSON。"
    : problem || (dirty ? "有未保存修改，点击“保存并批准”将先保存新修订，再批准。" : "审核完成后，点击“批准结构”。");
  return {
    issueCount: active ? `${draft.issues.filter(issue => issue.decision === "pending").length} 待确认 / ${draft.issues.length} 项` : "",
    saveDisabled: !active || !dirty || busy,
    analyzeDisabled: !active || dirty || busy,
    approveDisabled: !active || busy || (!dirty && approved) || dependencyErrors.length > 0,
    approveLabel: dirty ? "保存并批准" : "批准结构",
    approvalHint: hint,
    downloadDisabled: !active || dirty || busy || !approved,
    reviseDisabled: !active || dirty || busy || selected?.kind === "instance",
    stateText: active ? `r${draft.revision} · ${statusLabels[draft.review.status]}${dirty ? " · 未保存" : ""}` : ""
  };
}

export function createPageReviewSession() {
  let state = { record: null, draft: null, selectedId: null, dirty: false, busy: false, controller: null, proposal: null };
  const getState = () => state;
  const set = patch => { state = { ...state, ...patch }; return state; };
  return {
    getState,
    open(record) {
      const draft = structuredClone(record.draft);
      const selectedId = findNode(draft.root, state.selectedId)?.node.id ?? draft.root.id;
      return set({ record, draft, selectedId, dirty: false, busy: false, controller: null, proposal: null });
    },
    selectNode(selectedId) {
      if (!state.draft || !findNode(state.draft.root, selectedId)) return state;
      return set({ selectedId });
    },
    edit(mutator) {
      if (!state.draft) return state;
      mutator(state.draft);
      return set({ dirty: true, proposal: null });
    },
    markChanged() { return set({ dirty: true, proposal: null }); },
    setBusy(busy) { return set({ busy }); },
    setController(controller) { return set({ controller }); },
    setProposal(proposal) { return set({ proposal }); },
    clearProposal() { return set({ proposal: null }); },
    actions() { return deriveReviewActions(state); },
    approvalProblem() { return approvalProblem(state.draft); }
  };
}
