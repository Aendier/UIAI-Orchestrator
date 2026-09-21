const elements = {
  modelStatus: document.querySelector("#model-status"),
  componentCount: document.querySelector("#component-count"),
  componentFilter: document.querySelector("#component-filter"),
  componentList: document.querySelector("#component-list"),
  importFile: document.querySelector("#import-file"),
  emptyState: document.querySelector("#empty-state"),
  detail: document.querySelector("#component-detail"),
  detailName: document.querySelector("#detail-name"),
  detailState: document.querySelector("#detail-state"),
  factsList: document.querySelector("#facts-list"),
  analyzeButton: document.querySelector("#analyze-button"),
  analysisNote: document.querySelector("#analysis-note"),
  draftEmpty: document.querySelector("#draft-empty"),
  draftContent: document.querySelector("#draft-content"),
  decisionSummary: document.querySelector("#decision-summary"),
  confidenceBars: document.querySelector("#confidence-bars"),
  evidenceList: document.querySelector("#evidence-list"),
  approveForm: document.querySelector("#approve-form"),
  registryId: document.querySelector("#registry-id"),
  reviewer: document.querySelector("#reviewer"),
  useCases: document.querySelector("#use-cases"),
  visualTraits: document.querySelector("#visual-traits"),
  searchForm: document.querySelector("#search-form"),
  searchQuery: document.querySelector("#search-query"),
  searchResult: document.querySelector("#search-result"),
  toast: document.querySelector("#toast")
};
elements.modelDialog = document.querySelector("#model-dialog");
elements.modelForm = document.querySelector("#model-form");
elements.modelBaseUrl = document.querySelector("#model-base-url");
elements.modelName = document.querySelector("#model-name");
elements.modelApiKey = document.querySelector("#model-api-key");
elements.closeModelDialog = document.querySelector("#close-model-dialog");

let state;
let selectedSourceId;

await refreshState();

elements.componentFilter.addEventListener("input", renderComponentList);
elements.modelStatus.addEventListener("click", () => {
  elements.modelBaseUrl.value = state.model.baseUrl;
  elements.modelName.value = state.model.name;
  elements.modelApiKey.value = "";
  elements.modelDialog.showModal();
});
elements.closeModelDialog.addEventListener("click", () => elements.modelDialog.close());
elements.modelForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = event.submitter;
  await withBusy(submit, "应用中…", async () => {
    await api("/api/model", {
      baseUrl: elements.modelBaseUrl.value.trim(),
      model: elements.modelName.value.trim(),
      apiKey: elements.modelApiKey.value
    });
    elements.modelDialog.close();
    await refreshState(false);
    showToast("模型设置已应用到当前会话。", false);
  });
});
elements.componentList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-source-id]");
  if (!button) return;
  selectedSourceId = button.dataset.sourceId;
  renderComponentList();
  renderDetail();
});

elements.analyzeButton.addEventListener("click", async () => {
  if (!selectedSourceId) return;
  await withBusy(elements.analyzeButton, "分析中…", async () => {
    await api("/api/analyze", { sourceId: selectedSourceId });
    await refreshState(false);
    showToast("多 Agent 分析完成，等待人工审核。", false);
  });
});

elements.approveForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedSourceId) return;
  const submit = event.submitter;
  await withBusy(submit, "写入中…", async () => {
    await api("/api/approve", {
      sourceId: selectedSourceId,
      id: elements.registryId.value.trim(),
      reviewer: elements.reviewer.value.trim(),
      useCases: splitList(elements.useCases.value),
      visualTraits: splitList(elements.visualTraits.value)
    });
    await refreshState(false);
    showToast("已人工批准并加入 Registry。", false);
  });
});

elements.searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = elements.searchQuery.value.trim();
  if (!query) return;
  elements.searchResult.textContent = "搜索中…";
  try {
    const result = await api("/api/search", { query });
    renderSearchResult(result);
  } catch (error) {
    elements.searchResult.textContent = "搜索失败";
    showToast(error.message, true);
  }
});

elements.importFile.addEventListener("change", async () => {
  const [file] = elements.importFile.files;
  if (!file) return;
  try {
    const document = JSON.parse(await file.text());
    const result = await api("/api/import", document);
    selectedSourceId = undefined;
    await refreshState();
    showToast(`已导入 ${result.imported} 个组件。`, false);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    elements.importFile.value = "";
  }
});

async function refreshState(selectFirst = true) {
  try {
    state = await api("/api/state");
    renderModelStatus();
    if (selectFirst && !selectedSourceId) {
      selectedSourceId = state.observations.items[0]?.sourceId;
    }
    renderComponentList();
    renderDetail();
  } catch (error) {
    showToast(error.message, true);
  }
}

function renderModelStatus() {
  elements.modelStatus.textContent = state.model.ready
    ? `模型已配置 · ${state.model.name}`
    : "模型未连接";
  elements.modelStatus.classList.toggle("offline", !state.model.ready);
  elements.analyzeButton.disabled = !state.model.ready;
}

function renderComponentList() {
  if (!state) return;
  const filter = elements.componentFilter.value.trim().toLocaleLowerCase();
  const items = state.observations.items.filter((item) =>
    `${item.name} ${item.sourceId}`.toLocaleLowerCase().includes(filter)
  );
  elements.componentCount.textContent = `${state.observations.total} 个组件 · ${state.registry.total} 个已批准`;
  elements.componentList.replaceChildren(
    ...items.map((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `component-item${item.sourceId === selectedSourceId ? " selected" : ""}`;
      button.dataset.sourceId = item.sourceId;
      const status = item.approved ? "已批准" : item.draft ? "待审核" : "未分析";
      const statusClass = item.approved ? "approved" : item.draft ? "draft" : "";
      button.innerHTML = `
        <span class="component-name">${escapeHtml(item.name)}</span>
        <span class="component-meta">
          <span>${escapeHtml(item.nodeType)}</span>
          <span class="${statusClass}">${status}</span>
        </span>`;
      return button;
    })
  );
}

function renderDetail() {
  if (!state) return;
  const item = state.observations.items.find((entry) => entry.sourceId === selectedSourceId);
  elements.emptyState.hidden = Boolean(item);
  elements.detail.hidden = !item;
  if (!item) return;

  elements.detailName.textContent = item.name;
  const status = item.approved ? "Approved" : item.draft ? "Draft" : "Observed";
  elements.detailState.textContent = status;
  elements.detailState.className = `state-badge ${status.toLocaleLowerCase()}`;
  elements.factsList.replaceChildren(
    fact("Source ID", item.sourceId),
    fact("Node Type", item.nodeType),
    fact("Prefab", item.componentRef?.prefabPath ?? "—"),
    fact("Components", item.componentRef?.componentTypes?.join(", ") ?? "—"),
    fact("Bounds", formatBounds(item.bounds)),
    fact("Children", String(item.childCount))
  );
  elements.analysisNote.textContent = state.model.ready
    ? item.draft
      ? "可重新分析并覆盖当前 Draft"
      : "结构与视觉角色将并行分析"
    : "请从当前 AIOA 会话启动工作台";
  elements.analyzeButton.disabled = !state.model.ready;
  renderDraft(item);
}

function renderDraft(item) {
  const draft = item.draft;
  elements.draftEmpty.hidden = Boolean(draft);
  elements.draftContent.hidden = !draft;
  if (!draft) return;
  const decision = draft.decision;
  elements.decisionSummary.innerHTML = [
    decisionCell("Semantic Type", decision.semanticType),
    decisionCell("Role", decision.role),
    decisionCell("Capabilities", decision.capabilities.join(", "))
  ].join("");
  elements.confidenceBars.innerHTML = Object.entries(decision.confidence)
    .map(([name, value]) => confidenceBar(name, value))
    .join("");
  elements.evidenceList.replaceChildren(
    ...decision.evidence.map((evidence) => {
      const row = document.createElement("div");
      row.className = "evidence-item";
      row.innerHTML = `<span class="evidence-path">${escapeHtml(evidence.sourcePath)}</span><br>${escapeHtml(evidence.rationale)}`;
      return row;
    })
  );
  elements.registryId.value = item.approved?.id ?? suggestedId(decision.role, item.sourceId);
  elements.useCases.value = item.approved?.useCases?.join(", ") ?? suggestedUseCase(decision.role);
  elements.visualTraits.value = item.approved?.visualTraits?.join(", ") ?? "";
}

function renderSearchResult(result) {
  if (result.status === "no_match") {
    elements.searchResult.textContent = "没有达到可信阈值的已批准组件。";
    return;
  }
  const [match] = result.matches;
  elements.searchResult.innerHTML = `<span class="search-match">${escapeHtml(match.name)}</span><span class="search-score">${Math.round(match.score * 100)}%</span><br>${escapeHtml(match.reasons.join(" · "))}`;
}

function fact(label, value) {
  const row = document.createElement("div");
  const term = document.createElement("dt");
  const detail = document.createElement("dd");
  term.textContent = label;
  detail.textContent = value;
  row.append(term, detail);
  return row;
}

function decisionCell(label, value) {
  return `<div class="decision-cell"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function confidenceBar(label, value) {
  const percent = Math.round(value * 100);
  return `<div><div class="confidence-label"><span>${escapeHtml(label)}</span><span>${percent}%</span></div><div class="bar-track"><div class="bar-fill" style="width:${percent}%"></div></div></div>`;
}

function suggestedId(role, sourceId) {
  const ids = {
    "reward.claim": "button.reward.claim",
    "reward.display": "reward.item",
    "common.close": "button.common.close",
    "navigation.tab": "navigation.tab"
  };
  return ids[role] ?? sourceId;
}

function suggestedUseCase(role) {
  const cases = {
    "reward.claim": "领取奖励",
    "reward.display": "显示奖励",
    "common.close": "关闭页面",
    "navigation.tab": "切换页面"
  };
  return cases[role] ?? "";
}

function formatBounds(bounds) {
  return bounds ? `${bounds.width} × ${bounds.height} @ ${bounds.x}, ${bounds.y}` : "—";
}

function splitList(value) {
  return value
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function withBusy(button, busyLabel, task) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = busyLabel;
  try {
    await task();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

async function api(path, body) {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? `请求失败 (${response.status})`);
  return payload;
}

function showToast(message, error) {
  elements.toast.textContent = message;
  elements.toast.className = `toast visible${error ? " error" : ""}`;
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => {
    elements.toast.className = "toast";
  }, 4200);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
