import {
  PAGE_SIZE,
  UNCLASSIFIED_TYPE,
  availableTypes,
  enginePresence,
  paginate,
  reviewStatus,
  selectLibraryItems,
  semanticType
} from "./library-view.js";
import { filterUsageOperations, operationHtml, componentUsageHtml, analysisFailureHtml } from "./usage-view.js";
import { buildUsageDashboard, operationsOnDate, dashboardTotalsHtml, trendHtml, compositionHtml, distributionHtml, dailyTableHtml } from "./usage-dashboard.js";

const THEME_STORAGE_KEY = "uiai-workbench-theme";
const UNITY_PORT_STORAGE_KEY = "uiai-unity-port";
const DEFAULT_THEME = Object.freeze({
  bg: "#0f1724",
  surface: "#111827",
  surfaceRaised: "#1b2334",
  surfaceActive: "#253149",
  ink: "#f0f5ff",
  muted: "#91a6c5",
  line: "#35445b",
  accent: "#739eff",
  accentStrong: "#98b8ff"
});
const LEGACY_DEFAULT_THEME = Object.freeze({
  bg: "#0b0d0c",
  surface: "#121514",
  surfaceRaised: "#181c1a",
  surfaceActive: "#202622",
  ink: "#edf0ea",
  muted: "#c1c9c2",
  line: "#536057",
  accent: "#f0443e",
  accentStrong: "#ff6259"
});
const THEME_FIELDS = [
  ["bg", "--bg"],
  ["surface", "--surface"],
  ["surfaceRaised", "--surface-raised"],
  ["surfaceActive", "--surface-active"],
  ["ink", "--ink"],
  ["muted", "--muted"],
  ["line", "--line"],
  ["accent", "--accent"],
  ["accentStrong", "--accent-strong"]
];

const elements = {
  modelStatus: document.querySelector("#model-status"),
  componentCount: document.querySelector("#component-count"),
  componentFilter: document.querySelector("#component-filter"),
  componentLists: document.querySelector(".library-lanes"),
  approvedList: document.querySelector("#approved-list"),
  unapprovedList: document.querySelector("#unapproved-list"),
  approvedCount: document.querySelector("#approved-count"),
  unapprovedCount: document.querySelector("#unapproved-count"),
  approvedPageStatus: document.querySelector("#approved-page-status"),
  unapprovedPageStatus: document.querySelector("#unapproved-page-status"),
  statusFilter: document.querySelector("#component-status-filter"),
  presenceFilter: document.querySelector("#component-presence-filter"),
  typeFilter: document.querySelector("#component-type-filter"),
  sort: document.querySelector("#component-sort"),
  analysisProgress: {
    approved: document.querySelector("#approved-analysis-progress"),
    unapproved: document.querySelector("#unapproved-analysis-progress")
  },
  analysisCancel: {
    approved: document.querySelector("#approved-analysis-cancel"),
    unapproved: document.querySelector("#unapproved-analysis-cancel")
  },
  selectionNotice: document.querySelector("#selection-notice"),
  unityAutoSyncButton: document.querySelector("#unity-auto-sync-button"),
  syncFileButton: document.querySelector("#sync-file-button"),
  syncFile: document.querySelector("#sync-file"),
  unityPort: document.querySelector("#unity-port"),
  unityTestButton: document.querySelector("#unity-test-button"),
  unityTestStatus: document.querySelector("#unity-test-status"),
  importFile: document.querySelector("#import-file"),
  importButton: document.querySelector("#import-json-button"),
  analysisError: document.querySelector("#analysis-error"),
  componentUsage: document.querySelector("#component-usage"),
  emptyState: document.querySelector("#empty-state"),
  detail: document.querySelector("#component-detail"),
  detailName: document.querySelector("#detail-name"),
  detailState: document.querySelector("#detail-state"),
  factsList: document.querySelector("#facts-list"),
  componentPreview: document.querySelector("#component-preview"),
  componentPreviewImage: document.querySelector("#component-preview-image"),
  analyzeButton: document.querySelector("#analyze-button"),
  refreshUnityButton: document.querySelector("#refresh-unity-button"),
  revokeApprovalButton: document.querySelector("#revoke-approval-button"),
  deleteComponentButton: document.querySelector("#delete-component-button"),
  analysisNote: document.querySelector("#analysis-note"),
  draftEmpty: document.querySelector("#draft-empty"),
  draftContent: document.querySelector("#draft-content"),
  decisionSummary: document.querySelector("#decision-summary"),
  decisionSummaryText: document.querySelector("#decision-summary-text"),
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
elements.modelForm = document.querySelector("#model-form");
elements.modelBaseUrl = document.querySelector("#model-base-url");
elements.modelName = document.querySelector("#model-name");
elements.modelRefresh = document.querySelector("#model-refresh");
elements.modelCatalogStatus = document.querySelector("#model-catalog-status");
elements.modelCustomLabel = document.querySelector("#model-custom-label");
elements.modelNameCustom = document.querySelector("#model-name-custom");
elements.modelWireApi = document.querySelector("#model-wire-api");
elements.modelApiKey = document.querySelector("#model-api-key");
elements.settingsButton = document.querySelector("#settings-button");
elements.settingsDialog = document.querySelector("#settings-dialog");
elements.closeSettingsDialog = document.querySelector("#close-settings-dialog");
elements.settingsTabs = [...document.querySelectorAll(".settings-tab")];
elements.settingsPanelUnity = document.querySelector("#settings-panel-unity");
elements.settingsPanelTheme = document.querySelector("#settings-panel-theme");
elements.settingsPanelModel = document.querySelector("#settings-panel-model");
elements.settingsPanelUsage = document.querySelector("#settings-panel-usage");
elements.usageRefresh = document.querySelector("#usage-refresh");
elements.usagePeriod = document.querySelector("#usage-period");
elements.usageTrend = document.querySelector("#usage-trend");
elements.usageComposition = document.querySelector("#usage-composition");
elements.usageBackends = document.querySelector("#usage-backends");
elements.usageModels = document.querySelector("#usage-models");
elements.usageDaily = document.querySelector("#usage-daily");
elements.usageRange = document.querySelector("#usage-range");
elements.usageClearDate = document.querySelector("#usage-clear-date");
elements.usageRecords = document.querySelector("#usage-records");
elements.usageSearch = document.querySelector("#usage-search");
elements.usageKind = document.querySelector("#usage-kind");
elements.usageStatus = document.querySelector("#usage-status");
elements.usageMessage = document.querySelector("#usage-message");
elements.usageTotals = document.querySelector("#usage-totals");
elements.usageCount = document.querySelector("#usage-count");
elements.usageOperations = document.querySelector("#usage-operations");
elements.usageMore = document.querySelector("#usage-more");
elements.resetTheme = document.querySelector("#reset-theme");
elements.themeInputs = THEME_FIELDS.map(([key]) => document.querySelector(`[data-theme-key="${key}"]`));

let state;
let selectedSourceId;
const libraryPages = { approved: 1, unapproved: 1 };
const batchMode = { approved: false, unapproved: false };
const batchSelections = {
  approved: new Set(),
  unapproved: new Set()
};
const analysisRun = {
  active: false,
  pageKey: null,
  controller: null,
  currentSourceId: null,
  completed: 0,
  failed: 0,
  total: 0,
  cancelled: false
};
const analysisProgress = new Map();
const analysisFailures = new Map();
const reviewFieldDrafts = new Map();
let usageReport = null;
let usageLimit = 25;
let usageLoading = false;
let usageSelectedDate = "";

applyStoredTheme();
applyStoredUnityPort();

elements.componentFilter.addEventListener("input", resetLibraryAndRender);
elements.statusFilter.addEventListener("change", resetLibraryAndRender);
elements.presenceFilter.addEventListener("change", resetLibraryAndRender);
elements.typeFilter.addEventListener("change", resetLibraryAndRender);
elements.sort.addEventListener("change", resetLibraryAndRender);
elements.unityPort.addEventListener("change", persistUnityPort);
elements.unityTestButton.addEventListener("click", async () => {
  persistUnityPort();
  elements.unityTestStatus.className = "settings-note";
  await withBusy(elements.unityTestButton, "测试中…", async () => {
    try {
      const result = await api("/api/unity/test", {
        port: Number(elements.unityPort.value)
      });
      elements.unityTestStatus.className = "settings-note success";
      elements.unityTestStatus.textContent = `连接成功 · 已导出 ${result.components} 个组件`;
    } catch (error) {
      elements.unityTestStatus.className = "settings-note error";
      elements.unityTestStatus.textContent = `连接失败：${error.message}`;
      throw error;
    }
  });
});
elements.selectionNotice.addEventListener("click", revealSelectedComponent);
elements.useCases.addEventListener("input", rememberReviewFieldEdits);
elements.visualTraits.addEventListener("input", rememberReviewFieldEdits);
elements.unityAutoSyncButton.addEventListener("click", async () => {
  await withBusy(elements.unityAutoSyncButton, "同步中…", async () => {
    const result = await api("/api/sync/unity", {
      port: Number(elements.unityPort.value)
    });
    await refreshState();
    showToast(`已重新导出并同步 ${result.updated} 个组件，新增 ${result.added} 个组件。`, false);
  });
});
elements.syncFileButton.addEventListener("click", () => elements.syncFile.click());
elements.importButton.addEventListener("click", () => elements.importFile.click());
elements.syncFile.addEventListener("change", async () => {
  const [file] = elements.syncFile.files;
  if (!file) return;
  await withBusy(elements.syncFileButton, "同步中…", async () => {
    let document;
    try {
      document = JSON.parse(await file.text());
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error("导出文件不是有效的 JSON。");
      throw error;
    }
    const result = await api("/api/sync", document);
    await refreshState();
    showToast(`已更新 ${result.updated} 个组件，新增 ${result.added} 个组件。`, false);
  });
  elements.syncFile.value = "";
});
elements.refreshUnityButton.addEventListener("click", async () => {
  const selected = state?.observations.items.find((item) => item.sourceId === selectedSourceId);
  if (!selected) return;
  await withBusy(elements.refreshUnityButton, "更新中…", async () => {
    try {
      const result = await api("/api/sync/unity", {
        port: Number(elements.unityPort.value),
        objectName: selected.name
      });
      await refreshState(false);
      showToast(`已更新 ${result.updated} 个组件，新增 ${result.added} 个组件。`, false);
    } catch (error) {
      await refreshState(false);
      throw error;
    }
  });
});
elements.settingsButton.addEventListener("click", () => {
  updateThemeControls();
  openSettingsDialog("theme");
});
elements.closeSettingsDialog.addEventListener("click", () => elements.settingsDialog.close());
elements.settingsTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const tabName = tab.id.replace("settings-tab-", "");
    setSettingsTab(tabName);
    if (tabName === "model") void loadAvailableModels(true);
  });
});
elements.modelRefresh.addEventListener("click", async () => {
  await withBusy(elements.modelRefresh, "读取中…", () => loadAvailableModels(false));
});
elements.modelName.addEventListener("change", updateModelChoice);
elements.usageRefresh.addEventListener("click", loadUsage);
[elements.usageSearch, elements.usageKind, elements.usageStatus, elements.usagePeriod].forEach(control => {
  control.addEventListener(control === elements.usageSearch ? "input" : "change", () => {
    usageLimit = 25;
    usageSelectedDate = "";
    renderUsage();
  });
});
elements.settingsPanelUsage.addEventListener("click", event => {
  const button = event.target.closest("[data-usage-date]");
  if (!button) return;
  usageSelectedDate = usageSelectedDate === button.dataset.usageDate ? "" : button.dataset.usageDate;
  usageLimit = 25;
  renderUsage();
  elements.usageRecords.scrollIntoView({ block: "nearest", behavior: "smooth" });
});
elements.usageClearDate.addEventListener("click", () => {
  usageSelectedDate = "";
  usageLimit = 25;
  renderUsage();
});
elements.usageMore.addEventListener("click", () => { usageLimit += 25; renderUsage(); });
[elements.componentUsage, elements.analysisError].forEach(container => container.addEventListener("click", event => {
  if (!event.target.closest("[data-open-usage]")) return;
  elements.usageSearch.value = selectedSourceId;
  elements.usageKind.value = "component_analysis";
  elements.usageStatus.value = "";
  elements.usagePeriod.value = "all";
  usageSelectedDate = "";
  usageLimit = 25;
  renderUsage();
  openSettingsDialog("usage");
}));
elements.themeInputs.forEach((input, index) => {
  input.addEventListener("input", () => {
    const [key, cssVariable] = THEME_FIELDS[index];
    applyThemeValue(key, cssVariable, input.value);
    persistTheme();
    updateThemeControls();
  });
});
elements.resetTheme.addEventListener("click", () => {
  applyTheme(DEFAULT_THEME);
  persistTheme();
  updateThemeControls();
  showToast("已恢复默认配色。", false);
});
elements.modelForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = event.submitter;
  const model = selectedModelName();
  if (!model) {
    showToast("请选择模型，或切换到手动输入。", true);
    return;
  }
  await withBusy(submit, "应用中…", async () => {
    await api("/api/model", {
      baseUrl: elements.modelBaseUrl.value.trim(),
      model,
      wireApi: elements.modelWireApi.value,
      apiKey: elements.modelApiKey.value
    });
    elements.modelApiKey.value = "";
    elements.settingsDialog.close();
    await refreshState(false);
    showToast("模型设置已应用到当前会话。", false);
  });
});

function openSettingsDialog(tabName = "theme") {
  elements.modelBaseUrl.value = state.model.baseUrl;
  setModelOptions([state.model.name], state.model.name);
  elements.modelNameCustom.value = "";
  elements.modelWireApi.value = state.model.wireApi;
  elements.modelApiKey.value = "";
  updateModelChoice();
  setSettingsTab(tabName);
  if (tabName === "model") void loadAvailableModels(true);
  elements.settingsDialog.showModal();
}

function selectedModelName() {
  if (elements.modelName.value === "__manual__") return elements.modelNameCustom.value.trim();
  return elements.modelName.value.trim();
}

function updateModelChoice() {
  const manual = elements.modelName.value === "__manual__";
  elements.modelCustomLabel.hidden = !manual;
  elements.modelNameCustom.required = manual;
}

function setModelOptions(models, selected) {
  const values = [...new Set(models.filter(Boolean))];
  if (selected && !values.includes(selected)) values.unshift(selected);
  elements.modelName.replaceChildren(
    ...values.map((model) => new Option(model, model)),
    new Option("手动输入模型名…", "__manual__")
  );
  elements.modelName.value = selected && values.includes(selected) ? selected : values[0] ?? "__manual__";
  updateModelChoice();
}

async function loadAvailableModels(silent) {
  const baseUrl = elements.modelBaseUrl.value.trim();
  if (!baseUrl) return;
  if (!silent) elements.modelCatalogStatus.textContent = "正在读取模型列表…";
  try {
    const result = await api("/api/models", {
      baseUrl,
      apiKey: elements.modelApiKey.value
    });
    const selected = selectedModelName() || state?.model.name || "";
    setModelOptions(result.models ?? [], selected);
    elements.modelCatalogStatus.textContent = result.models?.length
      ? result.source === "codex-cache"
        ? `已读取 AIOA 本地目录中的 ${result.models.length} 个模型；在线读取失败，目录不代表认证成功，分析仍需要有效凭据。`
        : `已读取 ${result.models.length} 个可用模型。`
      : "服务返回了空模型列表，请使用手动输入。";
  } catch (error) {
    elements.modelCatalogStatus.textContent = error.message;
    if (!silent) throw error;
  }
}

function applyStoredTheme() {
  let storedTheme = {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(THEME_STORAGE_KEY) ?? "{}");
    storedTheme = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    storedTheme = {};
  }
  const isLegacyDefault = THEME_FIELDS.every(([key]) => storedTheme[key]?.toLowerCase() === LEGACY_DEFAULT_THEME[key]);
  if (isLegacyDefault) storedTheme = {};
  const theme = Object.fromEntries(
    THEME_FIELDS.map(([key]) => [key, isHexColor(storedTheme[key]) ? storedTheme[key] : DEFAULT_THEME[key]])
  );
  applyTheme(theme);
}

function applyStoredUnityPort() {
  try {
    const storedPort = window.localStorage.getItem(UNITY_PORT_STORAGE_KEY);
    const port = Number(storedPort);
    if (Number.isInteger(port) && port >= 1024 && port <= 65535) {
      elements.unityPort.value = String(port);
    }
  } catch {
    // Private browsing may disable local storage; the default port still works.
  }
}

function persistUnityPort() {
  const port = Number(elements.unityPort.value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return;
  try {
    window.localStorage.setItem(UNITY_PORT_STORAGE_KEY, String(port));
  } catch {
    // Private browsing may disable local storage; the current value still works.
  }
}

function applyTheme(theme) {
  THEME_FIELDS.forEach(([key, cssVariable]) => {
    applyThemeValue(key, cssVariable, theme[key]);
  });
  document.documentElement.style.colorScheme = colorLuminance(theme.bg) > 0.55 ? "light" : "dark";
}

function applyThemeValue(key, cssVariable, value) {
  if (!isHexColor(value)) return;
  document.documentElement.style.setProperty(cssVariable, value);
  if (key === "bg") {
    document.documentElement.style.colorScheme = colorLuminance(value) > 0.55 ? "light" : "dark";
  }
  const input = document.querySelector(`[data-theme-key="${key}"]`);
  if (input) input.value = value;
}

function persistTheme() {
  const theme = Object.fromEntries(
    THEME_FIELDS.map(([key]) => [key, document.querySelector(`[data-theme-key="${key}"]`).value])
  );
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(theme));
  } catch {
    // Private browsing may disable local storage; the current preview still works.
  }
}

function updateThemeControls() {
  elements.themeInputs.forEach((input) => {
    const valueLabel = document.querySelector(`#${input.id}-value`);
    if (valueLabel) valueLabel.textContent = input.value.toUpperCase();
  });
}

function setSettingsTab(tabName) {
  const isTheme = tabName === "theme";
  const isUnity = tabName === "unity";
  elements.settingsTabs.forEach((tab) => {
    const active = tab.id === `settings-tab-${tabName}`;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  elements.settingsPanelUnity.hidden = !isUnity;
  elements.settingsPanelTheme.hidden = !isTheme;
  elements.settingsPanelModel.hidden = tabName !== "model";
  elements.settingsPanelUsage.hidden = tabName !== "usage";
  elements.settingsDialog.classList.toggle("usage-active", tabName === "usage");
  elements.settingsDialog.scrollTop = 0;
  if (tabName === "usage") loadUsage();
}

async function loadUsage() {
  if (usageLoading) return;
  usageLoading = true;
  elements.usageRefresh.disabled = true;
  elements.usageMessage.textContent = "正在读取消耗记录…";
  try {
    usageReport = await api("/api/usage");
    elements.usageMessage.textContent = `读取于 ${new Date().toLocaleString("zh-CN", { hour12: false })}${usageReport.recordedSince ? ` · 记录开始于 ${new Date(usageReport.recordedSince).toLocaleString("zh-CN", { hour12: false })}` : " · 尚未记录模型调用"}`;
    renderUsage();
  } catch (error) {
    elements.usageMessage.textContent = `读取失败：${error.message}。可点击刷新重试。`;
  } finally {
    usageLoading = false;
    elements.usageRefresh.disabled = false;
  }
}

function renderUsage() {
  if (!usageReport) return;
  const filtered = filterUsageOperations(usageReport.operations, {
    query: elements.usageSearch.value, kind: elements.usageKind.value, status: elements.usageStatus.value
  });
  const dashboard = buildUsageDashboard(filtered, { period: elements.usagePeriod.value });
  elements.usageTotals.innerHTML = dashboardTotalsHtml(dashboard);
  elements.usageTrend.innerHTML = trendHtml(dashboard, usageSelectedDate);
  elements.usageComposition.innerHTML = compositionHtml(dashboard);
  elements.usageBackends.innerHTML = distributionHtml(dashboard.backends);
  elements.usageModels.innerHTML = distributionHtml(dashboard.models);
  elements.usageDaily.innerHTML = dailyTableHtml(dashboard, usageSelectedDate);
  elements.usageRange.textContent = `${dashboard.range.start} — ${dashboard.range.end} · 本地时间 · ${dashboard.calls} 次调用${dashboard.unreportedCalls ? ` · ${dashboard.unreportedCalls} 次用量未提供` : ""}`;
  const operations = operationsOnDate(dashboard.operations, usageSelectedDate);
  elements.usageClearDate.hidden = !usageSelectedDate;
  elements.usageClearDate.textContent = usageSelectedDate ? `${usageSelectedDate} × 清除日期` : "清除日期";
  elements.usageCount.textContent = `当前筛选：${operations.length} 次任务（全部 ${usageReport.operationCount} 次），显示前 ${Math.min(usageLimit, operations.length)} 条。${usageSelectedDate ? "仅显示所选日期的调用。" : "包含成功、失败和停止的调用。"}`;
  elements.usageOperations.innerHTML = operations.length ? operations.slice(0, usageLimit).map(operationHtml).join("")
    : '<p class="usage-note">暂无符合条件的记录。之后运行组件或页面分析，会在这里记录消耗。</p>';
  elements.usageMore.hidden = operations.length <= usageLimit;
}

function isHexColor(value) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function colorLuminance(hex) {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  const linear = channels.map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
}

elements.componentLists.addEventListener("click", (event) => {
  const batchCheck = event.target.closest(".batch-check");
  if (batchCheck) {
    event.preventDefault();
    event.stopPropagation();
    const item = batchCheck.closest("[data-source-id]");
    if (item) toggleBatchSelection(item.dataset.libraryLane, item.dataset.sourceId);
    return;
  }
  const batchToggle = event.target.closest("[data-batch-toggle]");
  if (batchToggle) {
    toggleBatchMode(batchToggle.dataset.batchToggle);
    return;
  }
  const batchAction = event.target.closest("[data-batch-action]");
  if (batchAction) {
    runBatchAction(batchAction.dataset.batchTarget, batchAction.dataset.batchAction, batchAction);
    return;
  }
  const quickReview = event.target.closest("[data-quick-review]");
  if (quickReview) {
    quickAnalyzePage(quickReview.dataset.quickReview);
    return;
  }
  const analysisCancel = event.target.closest("[data-analysis-cancel]");
  if (analysisCancel) {
    cancelQuickAnalysis();
    return;
  }
  const pageButton = event.target.closest("[data-page-target]");
  if (pageButton) {
    changeLibraryPage(pageButton.dataset.pageTarget, pageButton.dataset.pageAction);
    return;
  }
  const button = event.target.closest("[data-source-id]");
  if (!button) return;
  if (batchMode[button.dataset.libraryLane]) {
    toggleBatchSelection(button.dataset.libraryLane, button.dataset.sourceId);
    return;
  }
  selectedSourceId = button.dataset.sourceId;
  elements.componentLists.querySelector(".component-item.selected")?.classList.remove("selected");
  elements.componentLists.querySelector('[aria-current="true"]')?.removeAttribute("aria-current");
  button.classList.add("selected");
  button.setAttribute("aria-current", "true");
  elements.selectionNotice.hidden = true;
  renderDetail();
});
elements.componentLists.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const batchCheck = event.target.closest(".batch-check");
  if (!batchCheck) return;
  event.preventDefault();
  const item = batchCheck.closest("[data-source-id]");
  if (item) toggleBatchSelection(item.dataset.libraryLane, item.dataset.sourceId);
});

elements.analyzeButton.addEventListener("click", async () => {
  if (!selectedSourceId || analysisRun.active) return;
  await withBusy(elements.analyzeButton, "分析中…", async () => {
    const sourceId = selectedSourceId;
    analysisFailures.delete(sourceId);
    analysisProgress.set(sourceId, "running");
    renderComponentList();
    try { await api("/api/analyze", { sourceId }); analysisProgress.set(sourceId, "completed"); }
    catch (error) { analysisProgress.set(sourceId, "failed"); analysisFailures.set(sourceId, error.message); throw error; }
    finally { await refreshState(false); }
    showToast("多 Agent 分析完成，等待人工审核。", false);
  });
});

elements.revokeApprovalButton.addEventListener("click", async () => {
  if (!selectedSourceId) return;
  if (!window.confirm("撤销后只会移除已批准结论，组件和 Draft 会保留。继续吗？")) return;
  await withBusy(elements.revokeApprovalButton, "撤销中…", async () => {
    await api("/api/approval/revoke", { sourceId: selectedSourceId });
    await refreshState(false);
    showToast("已撤销审核，组件回到未审核状态。", false);
  });
});

elements.deleteComponentButton.addEventListener("click", async () => {
  if (!selectedSourceId) return;
  if (!window.confirm("删除后会移除组件、Draft 和 Registry 结论，且无法从当前工作台恢复。继续吗？")) return;
  const sourceId = selectedSourceId;
  await withBusy(elements.deleteComponentButton, "删除中…", async () => {
    await api("/api/observation/delete", { sourceId });
    selectedSourceId = undefined;
    await refreshState();
    showToast("组件及其审核数据已删除。", false);
  });
});

elements.approveForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedSourceId) return;
  const submit = event.submitter;
  await withBusy(submit, "写入中…", async () => {
    await api("/api/approve", {
      sourceId: selectedSourceId,
      id: elements.registryId.textContent.trim(),
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
    if (state.observations.total && !window.confirm("导入 JSON 会替换整个组件库，并清空现有分析草稿和人工审核记录。日常更新请使用同步操作。仍要导入吗？")) return;
    const result = await api("/api/import", document);
    selectedSourceId = undefined;
    await refreshState();
    showToast(`已导入 ${result.imported} 个组件，旧草稿和 Registry 已清空。`, false);
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
    renderTypeOptions();
    if (selectFirst && !selectedSourceId) {
      const ordered = selectLibraryItems(state.observations.items, { sort: elements.sort.value });
      selectedSourceId = (ordered.find((item) => item.approved) ?? ordered[0])?.sourceId;
    }
    renderComponentList();
    renderDetail();
  } catch (error) {
    showToast(error.message, true);
  }
}

function renderModelStatus() {
  elements.modelStatus.textContent = state.model.ready
    ? `${state.model.source === "aioa-cache" ? "AIOA 凭据已自动加载" : "模型已配置"} · ${state.model.name}`
    : "模型未连接";
  elements.modelStatus.classList.toggle("offline", !state.model.ready);
  elements.analyzeButton.disabled = !state.model.ready || analysisRun.active;
}

function renderComponentList() {
  if (!state) return;
  const items = selectLibraryItems(state.observations.items, {
    query: elements.componentFilter.value,
    status: elements.statusFilter.value,
    presence: elements.presenceFilter.value,
    type: elements.typeFilter.value,
    sort: elements.sort.value
  });
  const approvedItems = items.filter((item) => item.approved);
  const unapprovedItems = items.filter((item) => !item.approved);
  elements.componentCount.textContent = `${state.observations.total} 个组件 · ${state.registry.total} 个已批准`;
  renderComponentGroup(elements.approvedList, approvedItems, "暂无符合条件的已审核组件", "approved");
  renderComponentGroup(elements.unapprovedList, unapprovedItems, "暂无符合条件的未审核组件", "unapproved");
  updateSelectionNotice(items, approvedItems, unapprovedItems);
}

function renderComponentGroup(container, items, emptyMessage, pageKey) {
  const page = paginate(items, libraryPages[pageKey], PAGE_SIZE);
  libraryPages[pageKey] = page.page;
  container.replaceChildren();
  if (page.items.length === 0) {
    const empty = document.createElement("p");
    empty.className = "list-empty";
    empty.textContent = emptyMessage;
    container.append(empty);
  } else {
    container.append(...page.items.map((item) => componentButton(item, pageKey)));
  }
  const status = pageKey === "approved" ? elements.approvedPageStatus : elements.unapprovedPageStatus;
  status.textContent = `${page.totalPages ? page.page : 0} / ${page.totalPages}`;
  document.querySelectorAll(`[data-page-target="${pageKey}"]`).forEach((button) => {
    button.disabled = !page.totalPages || (button.dataset.pageAction === "previous"
      ? page.page <= 1
      : page.page >= page.totalPages);
  });
  const count = pageKey === "approved" ? elements.approvedCount : elements.unapprovedCount;
  count.textContent = String(items.length);
  const toolbar = document.querySelector("#" + pageKey + "-batch-toolbar");
  const toggle = document.querySelector('[data-batch-toggle="' + pageKey + '"]');
  const quickReview = document.querySelector('[data-quick-review="' + pageKey + '"]');
  const selectedCount = batchSelections[pageKey].size;
  if (toolbar) {
    toolbar.hidden = !batchMode[pageKey];
    toolbar.querySelector("[data-selected-count]").textContent = String(selectedCount);
    toolbar.querySelectorAll("[data-batch-action]").forEach((button) => {
      button.disabled = selectedCount === 0 || analysisRun.active ||
        (button.dataset.batchAction === "analyze" && !state.model.ready);
    });
  }
  if (toggle) {
    toggle.setAttribute("aria-pressed", String(batchMode[pageKey]));
    toggle.textContent = batchMode[pageKey] ? "退出批处理" : "批处理";
  }
  if (quickReview) {
    quickReview.disabled = pageKey !== "unapproved" || page.items.length === 0 || !state.model.ready || analysisRun.active;
  }
  if (toggle) toggle.disabled = analysisRun.active;
  renderAnalysisControls();
}

function resetLibraryAndRender() {
  libraryPages.approved = 1;
  libraryPages.unapproved = 1;
  batchSelections.approved.clear();
  batchSelections.unapproved.clear();
  renderComponentList();
  elements.approvedList.scrollTop = 0;
  elements.unapprovedList.scrollTop = 0;
}

function changeLibraryPage(pageKey, action) {
  const nextPage = libraryPages[pageKey] + (action === "next" ? 1 : -1);
  libraryPages[pageKey] = Math.max(1, nextPage);
  renderComponentList();
  (pageKey === "approved" ? elements.approvedList : elements.unapprovedList).scrollTop = 0;
}

function renderTypeOptions() {
  const selected = elements.typeFilter.value;
  const types = availableTypes(state.observations.items);
  if (state.observations.items.some((item) => !semanticType(item))) {
    types.push(UNCLASSIFIED_TYPE);
  }
  elements.typeFilter.replaceChildren(new Option("全部类型", ""));
  for (const type of types) {
    elements.typeFilter.append(new Option(type === UNCLASSIFIED_TYPE ? "未分类" : type, type));
  }
  elements.typeFilter.value = types.includes(selected) ? selected : "";
}

function updateSelectionNotice(filteredItems, approvedItems, unapprovedItems) {
  const selected = state.observations.items.find((item) => item.sourceId === selectedSourceId);
  if (!selected) {
    elements.selectionNotice.hidden = true;
    return;
  }
  const matchesFilters = filteredItems.some((item) => item.sourceId === selectedSourceId);
  if (!matchesFilters) {
    elements.selectionNotice.hidden = false;
    elements.selectionNotice.textContent = "当前组件被筛选隐藏 · 清除筛选并定位";
    return;
  }
  const collection = selected.approved ? approvedItems : unapprovedItems;
  const page = libraryPages[selected.approved ? "approved" : "unapproved"];
  const index = collection.findIndex((item) => item.sourceId === selectedSourceId);
  const visible = index >= (page - 1) * PAGE_SIZE && index < page * PAGE_SIZE;
  elements.selectionNotice.hidden = visible;
  elements.selectionNotice.textContent = "当前组件不在本页 · 定位";
}

function revealSelectedComponent() {
  const selected = state?.observations.items.find((item) => item.sourceId === selectedSourceId);
  if (!selected) return;
  const isFiltered = elements.componentFilter.value || elements.statusFilter.value ||
    elements.presenceFilter.value || elements.typeFilter.value;
  if (isFiltered) {
    elements.componentFilter.value = "";
    elements.statusFilter.value = "";
    elements.presenceFilter.value = "";
    elements.typeFilter.value = "";
  }
  const items = selectLibraryItems(state.observations.items, { sort: elements.sort.value });
  const collection = items.filter((item) => item.approved === Boolean(selected.approved));
  libraryPages[selected.approved ? "approved" : "unapproved"] =
    Math.floor(collection.findIndex((item) => item.sourceId === selectedSourceId) / PAGE_SIZE) + 1;
  renderComponentList();
  elements.componentLists.querySelector(".component-item.selected")?.scrollIntoView({ block: "center" });
}

function toggleBatchMode(pageKey) {
  batchMode[pageKey] = !batchMode[pageKey];
  batchSelections[pageKey].clear();
  renderComponentList();
}

function toggleBatchSelection(pageKey, sourceId) {
  if (!pageKey || !sourceId) return;
  const selection = batchSelections[pageKey];
  if (selection.has(sourceId)) selection.delete(sourceId);
  else selection.add(sourceId);
  renderComponentList();
}

async function runBatchAction(pageKey, action, button) {
  if (analysisRun.active) return;
  const sourceIds = [...batchSelections[pageKey]];
  if (!sourceIds.length) return;
  if (action === "analyze") {
    if (!state.model.ready || analysisRun.active) return;
    if (!window.confirm("将分析选中的 " + sourceIds.length + " 个组件，并生成待审核结论。继续吗？")) return;
    await startAnalysis(sourceIds, pageKey);
    return;
  }
  const isDelete = action === "delete";
  const message = isDelete
    ? "删除会移除所选组件、Draft 和 Registry 结论，且无法从当前工作台恢复。继续吗？"
    : "重置会清除所选组件的审核结论和 Draft，只保留来源组件。原审核信息会丢失。继续吗？";
  if (!window.confirm(message)) return;
  await withBusy(button, isDelete ? "删除中…" : "重置中…", async () => {
    for (const sourceId of sourceIds) {
      await api(isDelete ? "/api/observation/delete" : "/api/approval/reset", { sourceId });
    }
    if (isDelete && sourceIds.includes(selectedSourceId)) selectedSourceId = undefined;
    batchSelections[pageKey].clear();
    await refreshState(selectedSourceId === undefined);
    showToast(isDelete ? "已删除 " + sourceIds.length + " 个组件。" : "已重置 " + sourceIds.length + " 个组件，审核信息已清除。", false);
  });
}

async function quickAnalyzePage(pageKey) {
  if (pageKey !== "unapproved" || !state.model.ready || analysisRun.active) return;
  const items = selectLibraryItems(state.observations.items, {
    query: elements.componentFilter.value,
    status: elements.statusFilter.value,
    presence: elements.presenceFilter.value,
    type: elements.typeFilter.value,
    sort: elements.sort.value
  }).filter((item) => !item.approved);
  const page = paginate(items, libraryPages.unapproved, PAGE_SIZE);
  if (!page.items.length) return;
  if (!window.confirm("将分析未审核列表当前页的 " + page.items.length + " 个组件，并生成待审核结论。继续吗？")) return;
  await startAnalysis(page.items.map((item) => item.sourceId), pageKey);
}

async function startAnalysis(sourceIds, pageKey) {
  if (analysisRun.active || !state.model.ready || sourceIds.length === 0) return;
  analysisRun.active = true;
  analysisRun.pageKey = pageKey;
  analysisRun.controller = new AbortController();
  analysisRun.currentSourceId = null;
  analysisRun.completed = 0;
  analysisRun.failed = 0;
  analysisRun.total = sourceIds.length;
  analysisRun.cancelled = false;
  analysisProgress.clear();
  sourceIds.forEach((sourceId) => analysisProgress.set(sourceId, "queued"));
  sourceIds.forEach((sourceId) => analysisFailures.delete(sourceId));
  renderComponentList();
  renderDetail();
  renderAnalysisControls();

  try {
    for (const sourceId of sourceIds) {
      if (analysisRun.controller.signal.aborted) break;
      analysisRun.currentSourceId = sourceId;
      analysisProgress.set(sourceId, "running");
      renderComponentList();
      renderAnalysisControls();
      try {
        await api("/api/analyze", { sourceId }, { signal: analysisRun.controller.signal });
        analysisProgress.set(sourceId, "completed");
        analysisRun.completed += 1;
        await refreshState(false);
      } catch (error) {
        if (analysisRun.controller.signal.aborted) {
          analysisProgress.set(sourceId, "cancelled");
          break;
        }
        analysisProgress.set(sourceId, "failed");
        analysisRun.failed += 1;
        analysisFailures.set(sourceId, error.message);
        await refreshState(false);
      } finally {
        analysisRun.currentSourceId = null;
        renderComponentList();
        renderAnalysisControls();
      }
    }
  } finally {
    if (analysisRun.controller?.signal.aborted) {
      analysisRun.cancelled = true;
      sourceIds.forEach((sourceId) => {
        if (["queued", "running"].includes(analysisProgress.get(sourceId))) {
          analysisProgress.set(sourceId, "cancelled");
        }
      });
    }
    analysisRun.active = false;
    analysisRun.pageKey = null;
    analysisRun.controller = null;
    analysisRun.currentSourceId = null;
    await refreshState(false);
    renderComponentList();
    renderDetail();
    renderAnalysisControls();
    if (analysisRun.cancelled) {
      showToast(`已停止分析，完成 ${analysisRun.completed} / ${analysisRun.total} 个组件。`, false);
    } else if (analysisRun.failed) {
      showToast(`分析完成：成功 ${analysisRun.completed} 个，失败 ${analysisRun.failed} 个。`, true);
    } else {
      showToast(`已完成分析 ${analysisRun.completed} 个组件，等待人工审核。`, false);
    }
  }
}

function cancelQuickAnalysis() {
  if (!analysisRun.active || !analysisRun.controller) return;
  analysisRun.controller.abort();
  renderAnalysisControls();
}

function renderAnalysisControls() {
  const quickReview = document.querySelector('[data-quick-review="unapproved"]');
  if (!quickReview) return;
  for (const pageKey of ["approved", "unapproved"]) {
    const progress = elements.analysisProgress[pageKey];
    const cancel = elements.analysisCancel[pageKey];
    const visible = analysisRun.active && analysisRun.pageKey === pageKey;
    progress.hidden = !visible;
    progress.textContent = visible
      ? `分析 ${Math.min(analysisRun.completed + analysisRun.failed + (analysisRun.currentSourceId ? 1 : 0), analysisRun.total)} / ${analysisRun.total}`
      : "";
    cancel.hidden = !visible;
    cancel.disabled = !visible || analysisRun.controller?.signal.aborted;
  }
  quickReview.textContent = analysisRun.active ? "分析进行中" : "一键分析本页";
  const unapprovedItems = state
    ? selectLibraryItems(state.observations.items, {
      query: elements.componentFilter.value,
      status: elements.statusFilter.value,
      presence: elements.presenceFilter.value,
      type: elements.typeFilter.value,
      sort: elements.sort.value
    }).filter((item) => !item.approved)
    : [];
  quickReview.disabled = analysisRun.active || !state?.model.ready ||
    paginate(unapprovedItems, libraryPages.unapproved, PAGE_SIZE).items.length === 0;
  elements.analyzeButton.disabled = analysisRun.active || !state?.model.ready;
}

function componentButton(item, pageKey) {
  const button = document.createElement("button");
  button.type = "button";
 button.className = `component-item${item.sourceId === selectedSourceId ? " selected" : ""}`;
 button.dataset.sourceId = item.sourceId;
  button.dataset.libraryLane = pageKey;
  if (item.sourceId === selectedSourceId) button.setAttribute("aria-current", "true");
  const statusKey = reviewStatus(item);
  const statusLabel = reviewStatusLabel(statusKey);
  const statusClass = statusKey;
  const presence = enginePresence(item);
  if (presence === "missing") button.classList.add("engine-missing");
  if (item.approvedChanged) button.classList.add("approved-changed");
 const type = semanticTypeLabel(semanticType(item) || item.nodeType);
  const savedAnalysisStatus = item.analysis?.latestAttempt?.status;
  const analysisState = analysisProgress.get(item.sourceId) ?? ({ succeeded: "completed", failed: "failed", cancelled: "cancelled", running: "running" }[savedAnalysisStatus]);
  const analysisLabel = analysisProgressLabel(analysisState);
  if (analysisState === "running") button.classList.add("analysis-running");
  const batchCheck = batchMode[pageKey]
    ? `<span class="batch-check${batchSelections[pageKey].has(item.sourceId) ? " checked" : ""}" role="checkbox" aria-checked="${batchSelections[pageKey].has(item.sourceId)}" tabindex="0" aria-label="选择组件">□</span>`
    : "";
 button.innerHTML = `
    ${batchCheck}
    <span class="component-name">${escapeHtml(item.name)}</span>
    <span class="component-meta">
      <span>${escapeHtml(type)}</span>
      <span class="${statusClass}">审核：${statusLabel}</span>
      ${analysisLabel ? `<span class="analysis-progress ${analysisState}" title="${escapeHtml(analysisFailures.get(item.sourceId) ?? item.analysis?.latestAttempt?.error ?? "")}">分析：${analysisLabel}${analysisState === "failed" ? "（查看原因）" : ""}</span>` : ""}
    </span>
    <span class="component-presence ${presence}">引擎：${enginePresenceLabel(presence)}</span>`;
  return button;
}

function renderDetail() {
  if (!state) return;
  const item = state.observations.items.find((entry) => entry.sourceId === selectedSourceId);
  elements.emptyState.hidden = Boolean(item);
  elements.detail.hidden = !item;
  if (!item) return;

  elements.detailName.textContent = item.name;
  const statusKey = reviewStatus(item);
  const statusLabel = reviewStatusLabel(statusKey);
  const presence = enginePresence(item);
  elements.detailState.textContent = `${statusLabel} · 引擎${enginePresenceLabel(presence)}`;
  elements.detailState.className = `state-badge ${statusKey} ${presence}`;
  elements.revokeApprovalButton.hidden = !item.approved;
  elements.componentPreview.hidden = !item.hasPreview;
  if (item.hasPreview) {
    elements.componentPreviewImage.alt = item.name;
    elements.componentPreviewImage.src =
      `/api/observations/${encodeURIComponent(item.sourceId)}/preview`;
  } else {
    elements.componentPreviewImage.alt = "";
    elements.componentPreviewImage.removeAttribute("src");
  }
  elements.factsList.replaceChildren(
    fact("来源 ID", item.sourceId),
    fact("节点类型", item.nodeType),
    fact("Prefab 路径", item.componentRef?.prefabPath ?? "—"),
    fact("组件类型", item.componentRef?.componentTypes?.join(", ") ?? "—"),
    fact("尺寸与位置", formatBounds(item.bounds)),
    fact("子节点数", String(item.childCount)),
    fact("引擎状态", enginePresenceDetail(item))
  );
  elements.analysisNote.textContent = item.approvedChanged
    ? "检测到来源结构或截图已变化，请重新分析并再次审核。"
    : state.model.ready
      ? item.draft
        ? "可重新分析并覆盖当前 Draft"
        : "结构与视觉角色将并行分析"
      : "请从当前 AIOA 会话启动工作台";
  elements.analyzeButton.disabled = !state.model.ready || analysisRun.active;
  const persistedFailure = analysisFailureHtml(item.analysis, Boolean(item.draft));
  const localFailure = analysisFailures.get(item.sourceId);
  elements.analysisError.innerHTML = persistedFailure || (localFailure ? `<strong>分析失败</strong><p>${escapeHtml(localFailure)}</p>` : "");
  elements.analysisError.hidden = !elements.analysisError.innerHTML;
  elements.componentUsage.innerHTML = componentUsageHtml(item.analysis, Boolean(item.draft));
  renderDraft(item);
}

function renderDraft(item) {
  const draft = item.draft;
  elements.draftEmpty.hidden = Boolean(draft);
  elements.draftContent.hidden = !draft;
  if (!draft) {
    elements.registryId.textContent = "";
    elements.useCases.value = "";
    elements.visualTraits.value = "";
    return;
  }
  const decision = draft.decision;
  elements.decisionSummary.innerHTML = [
    decisionCell("语义类型", semanticTypeLabel(decision.semanticType), "组件属于哪一种基础 UI 类型。"),
    decisionCell("角色", roleLabel(decision.role), "组件在产品流程中承担的业务角色。"),
    decisionCell("能力", decision.capabilities.map(capabilityLabel).join("、"), "组件可以支持的交互、状态或内容能力。")
  ].join("");
  elements.decisionSummaryText.textContent = localizeAiText(decision.summary, "模型没有提供中文总结。");
  elements.confidenceBars.innerHTML = Object.entries(decision.confidence)
    .map(([name, value]) => confidenceBar(name, value))
    .join("");
  elements.evidenceList.replaceChildren(
    ...decision.evidence.map((evidence) => {
      const row = document.createElement("div");
      row.className = "evidence-item";
      row.innerHTML = `<span class="evidence-path">${escapeHtml(localizeEvidencePath(evidence.sourcePath))}</span><span class="evidence-value">观测值：${escapeHtml(formatEvidenceValue(evidence.value))}</span><span class="evidence-rationale">${escapeHtml(localizeAiText(evidence.rationale, "模型没有提供中文证据说明。"))}</span>`;
      return row;
    })
  );
  elements.registryId.textContent = item.approved?.id ?? suggestedId(decision.role, item.sourceId, item.name);
  if (item.approved) {
    elements.useCases.value = item.approved.useCases.join(", ");
    elements.visualTraits.value = item.approved.visualTraits.join(", ");
    return;
  }
  const draftKey = [draft.observationFingerprint ?? draft.name, decision.semanticType, decision.role].join("|");
  const remembered = reviewFieldDrafts.get(item.sourceId);
  if (!remembered || remembered.draftKey !== draftKey) {
    reviewFieldDrafts.set(item.sourceId, {
      draftKey,
      useCases: suggestedUseCases(item, decision),
      visualTraits: suggestedVisualTraits(item)
    });
  }
  const suggestions = reviewFieldDrafts.get(item.sourceId);
  elements.useCases.value = suggestions?.useCases ?? "";
  elements.visualTraits.value = suggestions?.visualTraits ?? "";
}

function rememberReviewFieldEdits() {
  const item = state?.observations.items.find((entry) => entry.sourceId === selectedSourceId);
  if (!item?.draft || item.approved) return;
  const current = reviewFieldDrafts.get(item.sourceId);
  if (!current) return;
  reviewFieldDrafts.set(item.sourceId, {
    ...current,
    useCases: elements.useCases.value,
    visualTraits: elements.visualTraits.value
  });
}

function renderSearchResult(result) {
  if (result.status === "no_match") {
    elements.searchResult.textContent = "没有达到可信阈值的已批准组件。";
    return;
  }
  if (result.matches.length > 1) {
    elements.searchResult.innerHTML = result.matches
      .map(
        (match) =>
          `<div class="search-match-row"><span class="search-match">${escapeHtml(match.name)}</span><span class="search-score">${Math.round(match.score * 100)}%</span><br>${escapeHtml(match.reasons.join(" 路 "))}</div>`
      )
      .join("");
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

function decisionCell(label, value, tip) {
  return `<div class="decision-cell"><span>${escapeHtml(label)} <span class="help-tip" tabindex="0" title="${escapeHtml(tip)}" aria-label="${escapeHtml(label)}说明">?</span></span><strong>${escapeHtml(value)}</strong></div>`;
}

function confidenceBar(label, value) {
  const percent = Math.round(value * 100);
  return `<div><div class="confidence-label"><span>${escapeHtml(confidenceLabel(label))}</span><span>${percent}%</span></div><div class="bar-track"><div class="bar-fill" style="width:${percent}%"></div></div></div>`;
}

const SEMANTIC_TYPE_LABELS = {
  button: "按钮",
  item: "条目",
  navigation: "导航",
  container: "容器",
  text: "文本",
  image: "图片",
  progress: "进度",
  unknown: "未知"
};

const ROLE_LABELS = {
  "reward.claim": "领取奖励",
  "reward.display": "展示奖励",
  "common.close": "关闭操作",
  "navigation.tab": "页签导航",
  "primary.action": "主要操作",
  "shop.purchase": "购买商品",
  "content.header": "内容标题",
  "progress.display": "展示进度",
  generic: "通用组件",
  unknown: "未知角色"
};

const CAPABILITY_LABELS = {
  click: "可点击",
  text: "包含文本",
  image: "包含图片",
  "disabled.state": "支持禁用状态",
  "selected.state": "支持选中状态",
  "display.icon": "展示图标",
  "display.quantity": "展示数量",
  "display.rarity": "展示稀有度",
  "display.progress": "展示进度",
  "navigation.select": "支持选择导航",
  "container.children": "包含子节点"
};

const EVIDENCE_PATH_LABELS = {
  root: "根节点",
  nodes: "节点",
  componentRef: "组件引用",
  componentTypes: "组件类型",
  prefabGuid: "Prefab 标识",
  prefabPath: "Prefab 路径",
  scriptType: "脚本类型",
  layout: "布局",
  rect: "边界尺寸",
  text: "文本",
  characters: "文本内容",
  style: "样式",
  backgroundColor: "背景颜色",
  backgroundOpacity: "背景透明度",
  fillType: "填充类型",
  visible: "可见性",
  opacity: "透明度",
  children: "子节点",
  screenshot: "截图"
};

function semanticTypeLabel(value) {
  return SEMANTIC_TYPE_LABELS[value] ?? value;
}

function roleLabel(value) {
  return ROLE_LABELS[value] ?? value;
}

function capabilityLabel(value) {
  return CAPABILITY_LABELS[value] ?? value;
}

function confidenceLabel(value) {
  return {
    semanticType: "语义类型",
    role: "角色",
    capabilities: "能力"
  }[value] ?? value;
}

function localizeEvidencePath(path) {
  return String(path)
    .split(".")
    .map((segment) => {
      const match = /^(.*?)(\[\d+\])$/.exec(segment);
      const key = match?.[1] ?? segment;
      return `${EVIDENCE_PATH_LABELS[key] ?? key}${match?.[2] ?? ""}`;
    })
    .join(" / ");
}

function formatEvidenceValue(value) {
  if (typeof value === "string") return localizeEvidenceToken(value);
  if (Array.isArray(value)) return value.map((item) => localizeEvidenceToken(String(item))).join("、");
  if (value === undefined) return "—";
  try {
    return localizeEvidenceToken(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function localizeEvidenceToken(value) {
  return {
    Button: "按钮",
    Image: "图片",
    Text: "文本",
    RectTransform: "矩形变换",
    "reward.claim": "领取奖励",
    "reward.display": "展示奖励",
    click: "可点击"
  }[value] ?? value;
}

function localizeAiText(value, fallback) {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  if (/[\u3400-\u9fff]/.test(text)) return text;
  const knownTranslations = {
    "The observed component contains a Button.": "观察到的组件包含按钮。",
    "A reward claim button.": "这是一个领取奖励按钮。"
  };
  return knownTranslations[text] ?? "模型返回了未翻译的说明，请重新运行分析生成中文结果。";
}

function suggestedId(role, sourceId, componentName = "") {
  const ids = {
    "reward.claim": "button.reward.claim",
    "reward.display": "reward.item",
    "common.close": "button.common.close",
    "navigation.tab": "navigation.tab"
  };
  const familyId = ids[role] ?? sourceId;
  const variant = inferVariantKey(componentName);
  return variant ? `${familyId}.${variant}` : familyId;
}

function inferVariantKey(value) {
  const normalized = value.toLocaleLowerCase().replace(/[\s_-]+/g, "-");
  const suffix = normalized.match(/(?:^|-)((?:extra-)?(?:small|medium|large)|xs|s|m|l|xl)$/)?.[1];
  if (!suffix) return "";
  return {
    "extra-small": "xs", extrasmall: "xs", xs: "xs",
    small: "s", s: "s", medium: "m", m: "m",
    large: "l", l: "l", "extra-large": "xl", extralarge: "xl", xl: "xl"
  }[suffix] ?? "";
}

function suggestedUseCase(role) {
  const cases = {
    "reward.claim": "领取奖励",
    "reward.display": "显示奖励",
    "common.close": "关闭页面",
    "navigation.tab": "切换页面",
    "primary.action": "执行主要操作",
    "shop.purchase": "购买商品",
    "content.header": "展示内容标题",
    "progress.display": "展示进度"
  };
  return cases[role] ?? "";
}

function suggestedUseCases(item, decision) {
  const roleSuggestion = suggestedUseCase(decision.role);
  if (roleSuggestion) return roleSuggestion;
  if (decision.semanticType === "text") return "展示文本";
  if (decision.semanticType === "image") return "展示图像";
  if (decision.semanticType === "container") return "承载界面内容";
  if (decision.semanticType === "navigation") return "导航切换";
  if (decision.capabilities.includes("container.children") && item.childCount > 0) {
    return "组织子组件";
  }
  return "";
}

function suggestedVisualTraits(item) {
  const traits = [];
  const bounds = item.bounds;
  if (bounds?.width && bounds.height) {
    const ratio = bounds.width / bounds.height;
    if (ratio >= 2.5) traits.push("横向宽布局");
    else if (ratio <= 0.65) traits.push("纵向窄布局");
    else if (ratio >= 0.85 && ratio <= 1.15) traits.push("近似方形布局");
    else traits.push("矩形布局");
  }
  if (item.hasText) traits.push("包含文本");
  if (item.hasImage) traits.push("包含图像");
  if (item.hasBackgroundFill) traits.push("有背景填充");
  if (item.childCount > 0) traits.push("包含子节点");
  if (typeof item.opacity === "number" && item.opacity < 1) traits.push("半透明");
  return traits.join(", ");
}

function formatBounds(bounds) {
  return bounds ? `${bounds.width} × ${bounds.height} @ ${bounds.x}, ${bounds.y}` : "—";
}

function reviewStatusLabel(status) {
  return {
    approved: "已批准",
    changed: "已批准但内容已变化",
    draft: "待审核",
    observed: "未分析"
  }[status] ?? status;
}

function analysisProgressLabel(status) {
  return {
    queued: "等待分析",
    running: "分析中",
    completed: "分析完成",
    failed: "分析失败",
    cancelled: "已停止"
  }[status] ?? "";
}

function enginePresenceLabel(presence) {
  if (presence === "present") return "存在";
  if (presence === "missing") return "已删除";
  return "未检查";
}

function enginePresenceDetail(item) {
  const presence = enginePresence(item);
  const timestamp = presence === "missing" ? item.missingSince : item.lastSeenAt;
  if (!timestamp) return enginePresenceLabel(presence);
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return enginePresenceLabel(presence);
  return `${enginePresenceLabel(presence)} · ${date.toLocaleString("zh-CN")}`;
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

async function api(path, body, options = {}) {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: options.signal
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

await refreshState();
