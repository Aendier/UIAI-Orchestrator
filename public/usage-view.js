const stages = { structural: "结构分析", visual: "视觉分析", adjudication: "冲突裁决", page_analysis: "页面分析", page_revision: "局部修改", model: "模型调用" };
const kinds = { component_analysis: "组件分析", page_analysis: "页面分析", page_revision: "局部修改" };
const statuses = { running: "进行中", succeeded: "成功", failed: "失败", cancelled: "已停止" };
const escape = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
export const formatTokens = value => value === null || value === undefined ? "未提供" : Number(value).toLocaleString("zh-CN");
const time = value => value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "进行中";
const duration = value => `${(value / 1000).toFixed(1)} 秒`;

export function filterUsageOperations(operations, { query = "", kind = "", status = "" } = {}) {
  const needle = query.trim().toLocaleLowerCase();
  return operations.filter(operation => (!kind || operation.kind === kind) && (!status || operation.status === status) &&
    `${operation.subjectName} ${operation.subjectId} ${operation.calls.map(call => call.model).join(" ")}`.toLocaleLowerCase().includes(needle));
}

function callTable(calls) {
  if (!calls.length) return '<p class="usage-note">没有模型调用用量记录。</p>';
  return `<div class="usage-table-scroll"><table class="usage-table"><thead><tr><th>步骤 / 模型</th><th>输入</th><th>输出</th><th>总量</th><th>缓存输入</th><th>推理输出</th><th>结果</th></tr></thead><tbody>${calls.map(call => `<tr>
    <td>${escape(stages[call.stage] ?? call.stage)}<small>${escape(call.model)} · ${escape(call.wireApi)}<br>${escape(call.provider || "未知来源")}<br>${escape(time(call.startedAt))} · ${call.status === "running" ? "正在请求" : duration(call.durationMs)}</small></td>
    ${["inputTokens", "outputTokens", "totalTokens", "cachedInputTokens", "reasoningTokens"].map(key => `<td>${formatTokens(call.tokens[key])}</td>`).join("")}
    <td>${statuses[call.status]}${call.httpStatus ? `<small>HTTP ${call.httpStatus}</small>` : ""}${call.error ? `<small class="usage-error">${escape(call.error)}</small>` : ""}</td>
    </tr>`).join("")}</tbody></table></div>`;
}

function reportedTotal(operation) {
  if (!operation.calls.length || operation.totals.unreportedCalls === operation.calls.length) return "总量未提供";
  return `${formatTokens(operation.totals.totalTokens)} tokens${operation.totals.unreportedCalls ? "（部分已报告）" : ""}`;
}

export function operationHtml(operation) {
  return `<details class="usage-operation"><summary>
    <span class="usage-status ${operation.status}">${statuses[operation.status]}</span>
    <span class="usage-subject"><strong>${escape(operation.subjectName)}</strong><small>${kinds[operation.kind]} · ${escape(time(operation.startedAt))}</small></span>
    <span class="usage-operation-total">${reportedTotal(operation)}</span></summary>
    <div class="usage-operation-detail"><p class="usage-note">${escape(operation.subjectId)} · ${duration(operation.durationMs)}${operation.scopedCalls ? " · 下表仅显示所选时段内的调用" : ""}</p>
    ${operation.error ? `<p class="usage-error">${escape(operation.error)}</p>` : ""}${callTable(operation.calls)}</div></details>`;
}

export function usageTotalsHtml(operations) {
  const calls = operations.flatMap(operation => operation.calls);
  const metric = (key, label) => {
    const known = calls.filter(call => call.tokens[key] !== null);
    const value = known.length || !calls.length ? known.reduce((sum, call) => sum + call.tokens[key], 0) : null;
    return `<div class="usage-metric"><span>${label}</span><strong>${formatTokens(value)}</strong><small>${known.length} / ${calls.length} 次调用已报告</small></div>`;
  };
  return `${metric("totalTokens", "已报告总量")}${metric("inputTokens", "输入 token")}${metric("outputTokens", "输出 token")}${metric("cachedInputTokens", "其中缓存输入")}${metric("reasoningTokens", "其中推理输出")}
    <div class="usage-metric"><span>调用 / 失败任务</span><strong>${calls.length} / ${operations.filter(operation => operation.status === "failed").length}</strong><small>${operations.length} 次任务</small></div>`;
}

export function componentUsageHtml(analysis, hasDraft) {
  const result = analysis?.result;
  if (!result) return `<p class="usage-note">${hasDraft ? "此分析结果没有用量记录，启用记录前的历史消耗无法追溯。" : "完成分析后，这里会显示此结果的 token 消耗。"}</p>`;
  return `<div class="usage-heading"><strong>此分析结果：${reportedTotal(result)}</strong><button class="usage-link" type="button" data-open-usage>查看消耗记录</button></div>
    <p class="usage-note">${escape(time(result.startedAt))} · ${duration(result.durationMs)} · 累计已报告 ${formatTokens(analysis.totals.totalTokens)} tokens（包含重试）</p>
    <details class="component-usage-details"><summary>各分析步骤的消耗</summary>${callTable(result.calls)}</details>`;
}

export function analysisFailureHtml(analysis, hasDraft) {
  const attempt = analysis?.latestAttempt;
  if (!attempt || !["failed", "cancelled"].includes(attempt.status)) return "";
  return `<strong>${attempt.status === "cancelled" ? "最近一次分析已停止" : "最近一次分析失败"}</strong>
    <p>${escape(attempt.error)}</p><p class="usage-note">${escape(time(attempt.startedAt))} · ${reportedTotal(attempt)}${hasDraft ? "。已有分析结果保留。" : ""}</p>
    <button class="usage-link" type="button" data-open-usage>查看失败步骤与消耗</button>`;
}
