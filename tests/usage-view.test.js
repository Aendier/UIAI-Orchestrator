import { describe, expect, it } from "vitest";
import { formatTokens, filterUsageOperations, componentUsageHtml, analysisFailureHtml, operationHtml, usageTotalsHtml } from "../public/usage-view.js";

const call = { stage: "structural", model: "test-model", wireApi: "responses", startedAt: "2026-10-12T00:00:00Z", durationMs: 1000,
  status: "succeeded", httpStatus: 200, error: null,
  tokens: { inputTokens: 100, outputTokens: 20, totalTokens: 120, cachedInputTokens: 40, reasoningTokens: 5 } };
const operation = { kind: "component_analysis", subjectId: "source-1", subjectName: "奖励按钮", status: "succeeded",
  startedAt: call.startedAt, durationMs: 1000, calls: [call], error: null,
  totals: { totalTokens: 120, unreportedCalls: 0 } };

describe("usage presentation", () => {
  it("distinguishes absent measurements from zero and old results from new recorded analyses", () => {
    expect(formatTokens(null)).toBe("未提供");
    expect(formatTokens(0)).toBe("0");
    expect(componentUsageHtml(null, true)).toContain("历史消耗无法追溯");
    expect(componentUsageHtml({ result: operation, totals: { totalTokens: 240 } }, true)).toContain("此分析结果：120 tokens");
    expect(componentUsageHtml({ result: operation, totals: { totalTokens: 240 } }, true)).toContain("包含重试");
  });

  it("filters history by subject, model, task and outcome without changing it", () => {
    const failed = { ...operation, subjectId: "source-2", status: "failed", kind: "page_analysis" };
    const operations = [operation, failed];
    expect(filterUsageOperations(operations, { query: "test-model", status: "failed" })).toEqual([failed]);
    expect(filterUsageOperations(operations, { kind: "component_analysis", query: "source-1" })).toEqual([operation]);
    expect(operations).toHaveLength(2);
  });

  it("shows persistent failures and reported counts while escaping untrusted names and error text", () => {
    const failed = { ...operation, status: "failed", subjectName: "<script>alert(1)</script>", error: "HTTP 429 <img onerror='bad'>" };
    const html = analysisFailureHtml({ latestAttempt: failed }, true) + operationHtml(failed);
    expect(html).toContain("已有分析结果保留");
    expect(html).toContain("HTTP 429");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img ");
    const missing = { ...call, tokens: { inputTokens: null, outputTokens: null, totalTokens: null, cachedInputTokens: null, reasoningTokens: null } };
    expect(usageTotalsHtml([{ ...operation, calls: [missing] }])).toContain("未提供");
    expect(usageTotalsHtml([operation])).toContain(">120<");
  });
});
