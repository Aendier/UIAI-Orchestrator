import { describe, expect, it } from "vitest";
import { buildUsageDashboard, compactTokens, compositionHtml, dailyTableHtml, dashboardTotalsHtml,
  distributionHtml, localDateKey, operationsOnDate, trendHtml } from "../public/usage-dashboard.js";

const now = new Date(2026, 9, 12, 16);
const at = (day, hour = 12) => new Date(2026, 9, day, hour).toISOString();
const call = (startedAt, tokens = {}, extra = {}) => ({ startedAt, model: "model-a", provider: "model.example",
  tokens: { inputTokens: 100, outputTokens: 20, totalTokens: 120, cachedInputTokens: 40, reasoningTokens: 5, ...tokens }, ...extra });
const operation = calls => ({ subjectName: "奖励按钮", subjectId: "source-1", kind: "component_analysis",
  status: "succeeded", startedAt: calls[0]?.startedAt ?? at(12), calls, totals: { totalTokens: 999, unreportedCalls: 0 } });

describe("token dashboard", () => {
  it("uses an inclusive local-calendar range and excludes older and future calls", () => {
    const operations = [operation([call(at(12)), call(at(-17)), call(at(-18)), call(at(13))])];
    const view = buildUsageDashboard(operations, { now });
    expect(view.range).toMatchObject({ start: "2026-09-13", end: "2026-10-12" });
    expect(view.days).toHaveLength(30);
    expect(view.calls).toBe(2);
    expect(view.metrics.totalTokens.value).toBe(240);
    expect(view.operations[0].totals.totalTokens).toBe(240);
    expect(view.operations[0].scopedCalls).toBe(true);
    expect(operations[0].calls).toHaveLength(4);
    expect(buildUsageDashboard(operations, { now, period: "7" }).calls).toBe(1);
    expect(buildUsageDashboard(operations, { now, period: "all" }).calls).toBe(3);
  });

  it("attributes individual calls crossing midnight to their own dates and drills into those calls", () => {
    const operations = [operation([call(at(11, 23)), call(at(12, 0), { totalTokens: 240, inputTokens: 200, outputTokens: 40 })])];
    const view = buildUsageDashboard(operations, { now });
    expect(view.days.at(-2).metrics.totalTokens.value).toBe(120);
    expect(view.days.at(-1).metrics.totalTokens.value).toBe(240);
    const selected = operationsOnDate(view.operations, localDateKey(at(12)));
    expect(selected[0].calls).toHaveLength(1);
    expect(selected[0].totals.totalTokens).toBe(240);
    expect(selected[0].scopedCalls).toBe(true);
    expect(dailyTableHtml(view).indexOf("10月12日")).toBeLessThan(dailyTableHtml(view).indexOf("10月11日"));
    expect(trendHtml(view, "2026-10-12")).toContain('aria-pressed="true"');
    expect(operationsOnDate(view.operations, "2026-10-10")).toEqual([]);
  });

  it("distinguishes absent measurements, partial totals, measured zeros and an empty ledger", () => {
    const missing = { inputTokens: null, outputTokens: null, totalTokens: null, cachedInputTokens: null, reasoningTokens: null };
    const view = buildUsageDashboard([operation([call(at(12)), call(at(12), missing), call(at(11), missing)])], { now });
    expect(view.metrics.totalTokens).toEqual({ value: 120, reported: 1, calls: 3 });
    expect(dashboardTotalsHtml(view)).toContain("1/3 次调用已报告");
    expect(dashboardTotalsHtml(view)).toContain("服务未返回此指标");
    expect(dailyTableHtml(view)).not.toContain("10月11日");
    expect(trendHtml(view)).toContain("unreported");
    expect(buildUsageDashboard([operation([call(at(12), missing)])], { now }).metrics.totalTokens.value).toBeNull();
    const zero = buildUsageDashboard([operation([call(at(12), { inputTokens: 0, outputTokens: 0, totalTokens: 0 })])], { now });
    expect(zero.metrics.totalTokens.value).toBe(0);
    expect(dailyTableHtml(zero)).toContain("10月12日");
    const empty = buildUsageDashboard([], { now });
    expect(empty.metrics.totalTokens.value).toBe(0);
    expect(empty.metrics.cacheWriteTokens.value).toBeNull();
    expect(dailyTableHtml(empty)).toContain("暂无每日用量");
    expect(compactTokens(null)).toBe("未提供");
    expect(compactTokens(0)).toBe("0");
    expect(compactTokens(1_615_355_430)).toBe("1615.4M");
  });

  it("partitions cache and reasoning subsets without double-counting and preserves unclassified measurements", () => {
    const view = buildUsageDashboard([operation([call(at(12))])], { now });
    expect(view.composition.segments.map(segment => [segment.id, segment.value])).toEqual([
      ["input", 60], ["output", 15], ["cache", 40], ["reasoning", 5]
    ]);
    expect(view.composition.total).toBe(120);
    expect(view.composition.segments.reduce((sum, segment) => sum + segment.percent, 0)).toBeCloseTo(100);
    const incomplete = buildUsageDashboard([operation([
      call(at(12), { cachedInputTokens: null, reasoningTokens: null }),
      call(at(12), { cachedInputTokens: 200, reasoningTokens: 100 }),
      call(at(12), { totalTokens: 150 }),
      call(at(12), { inputTokens: null, outputTokens: null })
    ])], { now });
    expect(incomplete.composition.total).toBe(incomplete.metrics.totalTokens.value);
    expect(incomplete.composition.segments.map(segment => [segment.id, segment.value])).toEqual([
      ["inputUnknown", 200], ["outputUnknown", 40], ["unknown", 270]
    ]);
    expect(compositionHtml(incomplete)).toContain("未拆分用量");
  });

  it("ranks measured consumption by backend and model, keeps legacy sources unknown and escapes names", () => {
    const view = buildUsageDashboard([operation([
      call(at(12), {}, { provider: undefined, model: "old-model" }),
      call(at(12), { totalTokens: 240 }, { provider: "other.example", model: "other-model" }),
      call(at(12), {}, { provider: "<img onerror='bad'>", model: "<script>bad</script>" })
    ])], { now });
    expect(view.backends[0]).toMatchObject({ name: "other.example", value: 240 });
    expect(view.backends.find(group => group.name === "未知来源").value).toBe(120);
    expect(distributionHtml(view.models)).not.toContain("<script>");
    expect(distributionHtml(view.backends)).not.toContain("<img ");
    expect(view.models.reduce((sum, group) => sum + group.value, 0)).toBe(view.metrics.totalTokens.value);
  });
});
