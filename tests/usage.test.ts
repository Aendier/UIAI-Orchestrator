import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkbenchServer } from "../src/web/server.js";
import { OpenAICompatibleClient } from "../src/ai/openai-compatible.js";
import type { ModelCall } from "../src/ai/usage.js";

const proposal = {
  semanticType: "button", role: "reward.claim", capabilities: ["click"],
  confidence: { semanticType: 0.95, role: 0.95, capabilities: 0.95 },
  evidence: [{ sourcePath: "root.name", value: "RewardClaimButton", rationale: "领取奖励按钮" }],
  summary: "领取奖励按钮"
};
const closes: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(closes.splice(0).map(close => close())); });

async function start(modelFetch: typeof fetch, dataDirectory?: string) {
  await mkdir(resolve(".local/tests"), { recursive: true });
  const directory = dataDirectory ?? await mkdtemp(resolve(".local/tests/usage-"));
  const app = await createWorkbenchServer({ dataDirectory: directory,
    fixturePath: resolve("fixtures/bridge-components.json"), modelFetch,
    model: { name: "usage-test", baseUrl: "https://model.example/v1", apiKey: "usage-test-secret" } });
  const address = await app.listen(0);
  closes.push(app.close);
  return { app, address, directory };
}
async function post(address: string, path: string, body: unknown) {
  const response = await fetch(address + path, { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
const successFetch: typeof fetch = async (_url, init) => {
  const request = JSON.parse(String(init?.body));
  const visual = request.messages[0].content.includes("视觉分析");
  return Response.json({ model: "actual-model", choices: [{ message: { content: JSON.stringify(proposal) } }],
    usage: { prompt_tokens: visual ? 2000 : 1000, completion_tokens: visual ? 200 : 100,
      total_tokens: visual ? 2200 : 1100, prompt_tokens_details: { cached_tokens: visual ? 800 : 400 },
      completion_tokens_details: { reasoning_tokens: visual ? 30 : 20 } } });
};

describe("workbench usage and analysis diagnostics", () => {
  it("reports actual per-role usage, associates it with the result and preserves it across restarts", async () => {
    const { address, directory, app } = await start(successFetch);
    expect((await post(address, "/api/analyze", { sourceId: "guid-reward-claim" })).status).toBe(200);
    const report = await (await fetch(address + "/api/usage")).json();
    expect(report.totals).toMatchObject({ inputTokens: 3000, outputTokens: 300, totalTokens: 3300,
      cachedInputTokens: 1200, reasoningTokens: 50, calls: 2, unreportedCalls: 0 });
    expect(report.operations[0]).toMatchObject({ kind: "component_analysis", subjectId: "guid-reward-claim", status: "succeeded" });
    expect(report.operations[0].calls.map((call: { stage: string }) => call.stage).sort()).toEqual(["structural", "visual"]);
    expect(report.operations[0].calls.every((call: ModelCall) => call.provider === "model.example")).toBe(true);
    const state = await (await fetch(address + "/api/state")).json();
    const component = state.observations.items.find((item: { sourceId: string }) => item.sourceId === "guid-reward-claim");
    expect(component.analysis.result.totals.totalTokens).toBe(3300);
    expect(await readFile(resolve(directory, "usage.json"), "utf8")).not.toContain("usage-test-secret");
    await app.close();
    // Existing version-1 ledgers do not have provider metadata; they must still load.
    const legacy = JSON.parse(await readFile(resolve(directory, "usage.json"), "utf8"));
    for (const operation of legacy.operations) for (const call of operation.calls) delete call.provider;
    await writeFile(resolve(directory, "usage.json"), JSON.stringify(legacy));
    const restarted = await start(successFetch, directory);
    const restored = await (await fetch(restarted.address + "/api/usage")).json();
    expect(restored.totals.totalTokens).toBe(3300);
    expect(restored.operations[0].calls[0].provider).toBeUndefined();
  });

  it("records only the service host without URL credentials, paths or query tokens", async () => {
    const calls: ModelCall[] = [];
    const client = new OpenAICompatibleClient({ baseUrl: "https://user:private-password@model.example:8443/private/path?token=private-query",
      apiKey: "private-key", model: "usage-test" }, successFetch, call => { calls.push({ ...call }); });
    await client.complete("结构分析", "test");
    expect(calls.at(-1)?.provider).toBe("model.example:8443");
    const serialized = JSON.stringify(calls);
    for (const secret of ["private-password", "private/path", "private-query", "private-key"]) expect(serialized).not.toContain(secret);
  });

  it("persists provider errors without credentials and keeps the successful result when a retry fails", async () => {
    let failed = false;
    const modelFetch: typeof fetch = async (...args) => failed
      ? Response.json({ error: { code: "rate_limit_exceeded", message: "Too many requests: usage-test-secret" } }, { status: 429 })
      : successFetch(...args);
    const { address, directory } = await start(modelFetch);
    await post(address, "/api/analyze", { sourceId: "guid-reward-claim" });
    failed = true;
    const failure = await post(address, "/api/analyze", { sourceId: "guid-reward-claim" });
    expect(failure.status).not.toBe(200);
    expect(failure.body.error).toContain("HTTP 429");
    const state = await (await fetch(address + "/api/state")).json();
    const component = state.observations.items.find((item: { sourceId: string }) => item.sourceId === "guid-reward-claim");
    expect(component.draft.decision.summary).toBe("领取奖励按钮");
    expect(component.analysis.result.totals.totalTokens).toBe(3300);
    expect(component.analysis.latestAttempt).toMatchObject({ status: "failed", totals: { unreportedCalls: 2 } });
    expect(component.analysis.latestAttempt.error).toContain("rate_limit_exceeded");
    const persisted = await readFile(resolve(directory, "usage.json"), "utf8");
    expect(persisted).not.toContain("usage-test-secret");
    expect(persisted).toContain("已隐藏密钥");
  });

  it("records consumption even when model output is invalid and identifies the failing semantic field", async () => {
    const modelFetch: typeof fetch = async () => Response.json({ choices: [{ message: {
      content: JSON.stringify({ ...proposal, confidence: 0.95 }) } }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } });
    const { address } = await start(modelFetch);
    const failure = await post(address, "/api/analyze", { sourceId: "guid-reward-claim" });
    expect(failure.status).not.toBe(200);
    expect(failure.body.error).toContain("结构分析结果");
    expect(failure.body.error).toContain("confidence");
    const report = await (await fetch(address + "/api/usage")).json();
    expect(report.operations[0].status).toBe("failed");
    expect(report.totals.totalTokens).toBe(240);
  });

  it("understands Responses usage including valid zero counts after model settings change", async () => {
    const modelFetch: typeof fetch = async () => Response.json({ output_text: JSON.stringify(proposal),
      usage: { input_tokens: 80, output_tokens: 20, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 5 } } });
    const { address } = await start(modelFetch);
    expect((await post(address, "/api/model", { baseUrl: "https://responses.example/v1", model: "responses-test",
      apiKey: "new-secret", wireApi: "responses" })).status).toBe(200);
    expect((await post(address, "/api/analyze", { sourceId: "guid-reward-claim" })).status).toBe(200);
    const report = await (await fetch(address + "/api/usage")).json();
    expect(report.totals).toMatchObject({ inputTokens: 160, outputTokens: 40, totalTokens: 200, cachedInputTokens: 0, reasoningTokens: 10 });
    expect(report.operations[0].calls[0]).toMatchObject({ model: "responses-test", wireApi: "responses", provider: "responses.example" });
  });

  it("keeps unavailable usage distinct from a measured zero instead of estimating it", async () => {
    const modelFetch: typeof fetch = async () => Response.json({ choices: [{ message: { content: JSON.stringify(proposal) } }] });
    const { address } = await start(modelFetch);
    await post(address, "/api/analyze", { sourceId: "guid-reward-claim" });
    const report = await (await fetch(address + "/api/usage")).json();
    expect(report.totals.unreportedCalls).toBe(2);
    expect(report.operations[0].calls[0].tokens).toEqual({ inputTokens: null, outputTokens: null,
      totalTokens: null, cachedInputTokens: null, reasoningTokens: null });
  });

  it("counts both failed JSON parsing and conflict adjudication requests", async () => {
    let invalidJson = false;
    const modelFetch: typeof fetch = async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      const visual = request.messages[0].content.includes("视觉分析");
      return Response.json({ choices: [{ message: { content: invalidJson ? "{invalid"
        : JSON.stringify({ ...proposal, role: visual ? "primary.action" : "reward.claim" }) } }],
        usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } });
    };
    const { address } = await start(modelFetch);
    expect((await post(address, "/api/analyze", { sourceId: "guid-reward-claim" })).status).toBe(200);
    let report = await (await fetch(address + "/api/usage")).json();
    expect(report.operations[0].calls.map((call: { stage: string }) => call.stage).sort()).toEqual(["adjudication", "structural", "visual"]);
    expect(report.totals.totalTokens).toBe(330);
    invalidJson = true;
    expect((await post(address, "/api/analyze", { sourceId: "guid-reward-claim" })).body.error).toContain("JSON");
    report = await (await fetch(address + "/api/usage")).json();
    expect(report.operations[0].totals.totalTokens).toBe(220);
    expect(report.operations[0].calls.every((call: { status: string }) => call.status === "failed")).toBe(true);
  });

  it("records cancellation when the user closes an in-flight HTTP request", async () => {
    let starts = 0;
    let markStarted!: () => void;
    const started = new Promise<void>(done => { markStarted = done; });
    const modelFetch: typeof fetch = async (_url, init) => new Promise<Response>((_done, reject) => {
      if (++starts === 2) markStarted();
      init?.signal?.addEventListener("abort", () => {
        const error = new Error("cancelled"); error.name = "AbortError"; reject(error);
      }, { once: true });
    });
    const { address, app, directory } = await start(modelFetch);
    const controller = new AbortController();
    const pending = fetch(address + "/api/analyze", { method: "POST", signal: controller.signal,
      headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceId: "guid-reward-claim" }) }).catch(() => {});
    await started;
    const active = (await (await fetch(address + "/api/usage")).json()).operations[0];
    expect(active.calls).toHaveLength(2);
    expect(active.totals.unreportedCalls).toBe(2);
    const interruptedSnapshot = await readFile(resolve(directory, "usage.json"), "utf8");
    controller.abort();
    await pending;
    let operation;
    for (let attempt = 0; attempt < 20; attempt++) {
      operation = (await (await fetch(address + "/api/usage")).json()).operations[0];
      if (operation.status !== "running") break;
      await new Promise(done => setTimeout(done, 10));
    }
    expect(operation.status).toBe("cancelled");
    expect(operation.calls).toHaveLength(2);
    expect(operation.calls.every((call: { status: string }) => call.status === "cancelled")).toBe(true);
    await app.close();
    // Restore the last persisted in-flight snapshot to model a crash before final usage arrives.
    await writeFile(resolve(directory, "usage.json"), interruptedSnapshot);
    const restarted = await start(successFetch, directory);
    const recovered = (await (await fetch(restarted.address + "/api/usage")).json()).operations[0];
    expect(recovered.status).toBe("cancelled");
    expect(recovered.error).toContain("服务重启");
    expect(recovered.totals.unreportedCalls).toBe(2);
    expect(recovered.calls.every((call: { status: string }) => call.status === "cancelled")).toBe(true);
  });

  it("includes page analysis and subtree revisions in the same usage report", async () => {
    const modelFetch: typeof fetch = async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      const input = JSON.parse(request.messages[1].content[0].text);
      return Response.json({ choices: [{ message: { content: JSON.stringify({
        root: input.selectedNode ?? input.currentRoot, issues: [], coordinateSpace: "local" }) } }],
        usage: { prompt_tokens: 500, completion_tokens: 100, total_tokens: 600 } });
    };
    const { address } = await start(modelFetch);
    const created = await post(address, "/api/pages", { name: "Token page", width: 640, height: 480,
      reference: { mime: "image/png", base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==" } });
    expect(created.status).toBe(200);
    const pageId = created.body.pageId;
    const analyzed = await post(address, `/api/pages/${pageId}/analyze`, { expectedRevision: 1 });
    expect(analyzed.status).toBe(200);
    const revised = await post(address, `/api/pages/${pageId}/revise`, { expectedRevision: 2,
      nodeId: analyzed.body.root.id, instructions: "保持原结构" });
    expect(revised.status).toBe(200);
    const report = await (await fetch(address + "/api/usage")).json();
    expect(report.operations.map((operation: { kind: string }) => operation.kind)).toEqual(["page_revision", "page_analysis"]);
    expect(report.totals.totalTokens).toBe(1200);
    expect(report.operations[0].subjectName).toBe("Token page");
  });
});
