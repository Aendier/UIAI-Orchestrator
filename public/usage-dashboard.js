import { formatTokens } from "./usage-view.js";

const escape = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const keys = ["totalTokens", "inputTokens", "outputTokens", "cachedInputTokens", "cacheWriteTokens", "reasoningTokens"];
const labels = ["总量", "输入", "输出", "缓存读", "缓存写", "推理输出"];
const validCount = value => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export function localDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
const fromKey = key => new Date(`${key}T12:00:00`);
const dateLabel = key => `${Number(key.slice(5, 7))}月${Number(key.slice(8))}日`;

export function compactTokens(value) {
  if (!validCount(value)) return "未提供";
  const unit = value >= 1e6 ? 1e6 : value >= 1e3 ? 1e3 : 1;
  if (unit === 1) return formatTokens(value);
  const number = value / unit;
  return `${Number(number.toFixed(number >= 100 ? 1 : 2))}${unit === 1e6 ? "M" : "K"}`;
}

function aggregate(calls) {
  return Object.fromEntries(keys.map(key => {
    const measured = calls.filter(call => validCount(call.tokens[key]));
    // Cache writes are not returned by the currently supported model APIs.
    const value = measured.length ? measured.reduce((sum, call) => sum + call.tokens[key], 0)
      : !calls.length && key !== "cacheWriteTokens" ? 0 : null;
    return [key, { value, reported: measured.length, calls: calls.length }];
  }));
}

function withCalls(operation, calls) {
  const total = aggregate(calls).totalTokens;
  return { ...operation, calls, scopedCalls: operation.scopedCalls || calls.length !== operation.calls.length,
    totals: { ...operation.totals, calls: calls.length, totalTokens: total.value ?? 0,
      unreportedCalls: calls.length - total.reported } };
}

export function operationsOnDate(operations, date) {
  if (!date) return operations;
  return operations.map(operation => withCalls(operation,
    operation.calls.filter(call => localDateKey(call.startedAt) === date))).filter(operation => operation.calls.length);
}

function distribution(calls, name) {
  const groups = new Map();
  for (const call of calls) {
    const label = name(call);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(call);
  }
  return [...groups].map(([name, calls]) => ({ name, ...aggregate(calls).totalTokens }))
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || a.name.localeCompare(b.name));
}

function consumption(calls) {
  const definitions = [
    ["input", "非缓存输入"], ["output", "常规输出"], ["cache", "缓存读取"], ["reasoning", "推理输出"],
    ["inputUnknown", "未拆分输入"], ["outputUnknown", "未拆分输出"], ["unknown", "未拆分用量"]
  ];
  const values = Object.fromEntries(definitions.map(([id]) => [id, 0]));
  for (const { tokens } of calls) {
    const { totalTokens: total, inputTokens: input, outputTokens: output,
      cachedInputTokens: cache, reasoningTokens: reasoning } = tokens;
    if (!validCount(total)) continue;
    if (!validCount(input) || !validCount(output) || input + output !== total) {
      values.unknown += total;
      continue;
    }
    if (validCount(cache) && cache <= input) { values.input += input - cache; values.cache += cache; }
    else values.inputUnknown += input;
    if (validCount(reasoning) && reasoning <= output) { values.output += output - reasoning; values.reasoning += reasoning; }
    else values.outputUnknown += output;
  }
  const total = Object.values(values).reduce((sum, value) => sum + value, 0);
  return { total, segments: definitions.map(([id, label]) => ({ id, label, value: values[id],
    percent: total ? values[id] / total * 100 : 0 })).filter(segment => segment.value > 0) };
}

export function buildUsageDashboard(operations, { period = "30", now = new Date() } = {}) {
  const end = localDateKey(now);
  const first = new Date(now);
  first.setHours(12, 0, 0, 0);
  first.setDate(first.getDate() - (period === "7" ? 6 : 29));
  let start = localDateKey(first);
  if (period === "all") {
    const dates = operations.flatMap(operation => operation.calls.length
      ? operation.calls.map(call => localDateKey(call.startedAt)) : [localDateKey(operation.startedAt)])
      .filter(date => date && date <= end).sort();
    start = dates[0] ?? start;
  }
  const inRange = value => { const key = localDateKey(value); return key && key >= start && key <= end; };
  const scoped = operations.map(operation => withCalls(operation, operation.calls.filter(call => inRange(call.startedAt))))
    .filter(operation => operation.calls.length || !operation.scopedCalls && inRange(operation.startedAt));
  const calls = scoped.flatMap(operation => operation.calls);
  const dayCalls = new Map();
  for (const call of calls) {
    const key = localDateKey(call.startedAt);
    if (!dayCalls.has(key)) dayCalls.set(key, []);
    dayCalls.get(key).push(call);
  }
  const days = [];
  for (const cursor = fromKey(start); localDateKey(cursor) <= end; cursor.setDate(cursor.getDate() + 1)) {
    const date = localDateKey(cursor);
    const day = dayCalls.get(date) ?? [];
    days.push({ date, calls: day.length, metrics: aggregate(day) });
  }
  return { operations: scoped, metrics: aggregate(calls), days, composition: consumption(calls),
    backends: distribution(calls, call => call.provider || "未知来源"),
    models: distribution(calls, call => call.model || "未知模型"),
    range: { start, end, label: period === "all" ? "全部记录" : `最近 ${period === "7" ? 7 : 30} 天` },
    calls: calls.length, unreportedCalls: calls.filter(call => !validCount(call.tokens.totalTokens)).length };
}

function coverage(metric) {
  return metric.calls && metric.reported < metric.calls ? `${metric.reported}/${metric.calls} 次调用已报告` : "";
}

export function dashboardTotalsHtml(dashboard) {
  return keys.map((key, index) => {
    const metric = dashboard.metrics[key];
    const value = compactTokens(metric.value);
    return `<div class="usage-stat${index === 0 ? " usage-stat-total" : ""}" data-metric="${key}" title="${escape(`${labels[index]}：${formatTokens(metric.value)} tokens`)}">
      <span class="usage-stat-label">${index === 0 ? `${dashboard.range.label}总量` : labels[index]}</span>
      <div><strong>${value}</strong>${metric.value !== null ? '<span class="usage-stat-unit">tokens</span>' : ""}</div>
      ${index === 0 ? `<small>${formatTokens(metric.value)}${metric.value !== null ? " tokens" : ""}</small>` : ""}
      ${coverage(metric) ? `<small class="usage-coverage">${coverage(metric)}</small>` : ""}
      ${key === "cacheWriteTokens" ? '<small>服务未返回此指标</small>' : ""}</div>`;
  }).join("");
}

export function trendHtml(dashboard, selectedDate = "") {
  const maximum = Math.max(1, ...dashboard.days.map(day => day.metrics.totalTokens.value ?? 0));
  return `<div class="usage-chart-scroll"><div class="usage-bars">${dashboard.days.map(day => {
    const total = day.metrics.totalTokens;
    const unknown = day.calls > 0 && !total.reported;
    const height = total.value ? Math.max(3, total.value / maximum * 100) : day.calls && total.reported ? 2 : 0;
    const title = `${day.date} · ${day.calls} 次调用 · ${day.calls ? `${formatTokens(total.value)} tokens${coverage(total) ? "（部分已报告）" : ""}` : "没有调用"}`;
    return `<button class="usage-day-bar${unknown ? " unreported" : ""}" type="button" data-usage-date="${day.date}" aria-label="${escape(title)}" title="${escape(title)}" aria-pressed="${selectedDate === day.date}" ${!day.calls ? "disabled" : ""}>
      <span class="usage-bar-fill" style="height:${height}%"></span></button>`;
  }).join("")}</div></div><div class="usage-chart-axis"><span>${dateLabel(dashboard.range.start)}</span><span>${dateLabel(dashboard.range.end)}</span></div>
    <p class="usage-note usage-chart-note">${dashboard.calls ? `点击柱子查看当天调用${dashboard.unreportedCalls ? ` · ${dashboard.unreportedCalls} 次调用用量未提供` : ""}` : "暂无调用记录，完成一次分析后显示每日趋势"}</p>`;
}

export function compositionHtml(dashboard) {
  const { segments, total } = dashboard.composition;
  if (!total) return `<p class="usage-empty">${!dashboard.calls ? "暂无调用记录" : dashboard.metrics.totalTokens.value === 0 ? "已报告总量为 0 tokens" : "暂无可绘制的已报告消耗"}</p>`;
  return `<div class="usage-composition-bar" role="img" aria-label="${escape(segments.map(segment => `${segment.label} ${segment.percent.toFixed(1)}%`).join("，"))}">
    ${segments.map(segment => `<span class="usage-color-${segment.id}" style="width:${segment.percent}%" title="${escape(`${segment.label}：${formatTokens(segment.value)} tokens`)}"></span>`).join("")}</div>
    <div class="usage-legend">${segments.map(segment => `<span><i class="usage-color-${segment.id}"></i>${segment.label} <strong>${Number(segment.percent.toFixed(2))}%</strong></span>`).join("")}</div>
    <p class="usage-note usage-chart-note">缓存读包含在输入中，推理包含在输出中；各色区段互不重复。</p>`;
}

export function distributionHtml(groups) {
  if (!groups.length) return '<p class="usage-empty">暂无调用记录</p>';
  const row = group => `<div class="usage-rank-row"><span title="${escape(group.name)}">${escape(group.name)}</span><strong title="${escape(`${formatTokens(group.value)} tokens`)}">${compactTokens(group.value)}${group.value !== null ? ' <small>tokens</small>' : ""}</strong>${coverage(group) ? `<small class="usage-rank-coverage">${coverage(group)}</small>` : ""}</div>`;
  return groups.slice(0, 5).map(row).join("") + (groups.length > 5 ? `<details class="usage-rank-more"><summary>展开其余 ${groups.length - 5} 项</summary>${groups.slice(5).map(row).join("")}</details>` : "");
}

export function dailyTableHtml(dashboard, selectedDate = "") {
  const days = dashboard.days.filter(day => day.metrics.totalTokens.reported > 0).toReversed();
  if (!days.length) return '<p class="usage-empty">暂无每日用量。之后运行组件或页面分析，会在这里显示已报告消耗。</p>';
  return `<div class="usage-table-scroll"><table class="usage-daily-table"><thead><tr><th>日期</th><th>总量 tokens</th><th>输入 tokens</th><th>输出 tokens</th><th>缓存读 tokens</th></tr></thead><tbody>${days.map(day => `<tr${selectedDate === day.date ? ' class="selected"' : ""}>
    <td><button type="button" data-usage-date="${day.date}" aria-pressed="${selectedDate === day.date}" title="查看 ${day.date} 的调用记录">${dateLabel(day.date)}</button></td>
    ${["totalTokens", "inputTokens", "outputTokens", "cachedInputTokens"].map(key => `<td title="${escape(`${formatTokens(day.metrics[key].value)} tokens${coverage(day.metrics[key]) ? ` · ${coverage(day.metrics[key])}` : ""}`)}">${compactTokens(day.metrics[key].value)}${coverage(day.metrics[key]) ? '<span class="usage-partial-mark" title="部分调用未提供此项">*</span>' : ""}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
