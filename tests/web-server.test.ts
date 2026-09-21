import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { AnalysisAgent, SemanticAdjudicator } from "../src/semantic/index.js";
import { createWorkbenchServer } from "../src/web/server.js";

const proposal = {
  semanticType: "button" as const,
  role: "reward.claim" as const,
  capabilities: ["click" as const, "text" as const, "disabled.state" as const],
  confidence: { semanticType: 0.97, role: 0.95, capabilities: 0.91 },
  evidence: [
    {
      sourcePath: "root.componentRef.componentTypes",
      value: ["Button"],
      rationale: "The observed component contains a Button."
    }
  ],
  summary: "A reward claim button."
};

describe("local workbench HTTP API", () => {
  const closeCallbacks: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(closeCallbacks.splice(0).map((close) => close()));
  });

  it("lets a user analyze, approve and search without CLI commands", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "ui-ai-workbench-"));
    const agent: AnalysisAgent = { analyze: vi.fn().mockResolvedValue(proposal) };
    const adjudicator: SemanticAdjudicator = { adjudicate: vi.fn() };
    const app = await createWorkbenchServer({
      dataDirectory,
      fixturePath: resolve("fixtures/bridge-components.json"),
      agents: { structuralAgent: agent, visualAgent: agent, adjudicator }
    });
    const address = await app.listen(0);
    closeCallbacks.push(app.close);

    const initial = await getJson(`${address}/api/state`);
    expect(initial).toMatchObject({
      model: { ready: true },
      observations: { total: 12 },
      registry: { total: 0 }
    });

    const draft = await postJson(`${address}/api/analyze`, {
      sourceId: "guid-reward-claim"
    });
    expect(draft).toMatchObject({ sourceId: "guid-reward-claim", name: "RewardClaimButton" });

    const registry = await postJson(`${address}/api/approve`, {
      sourceId: "guid-reward-claim",
      id: "button.reward.claim",
      reviewer: "本地审核员",
      useCases: ["领取奖励"],
      visualTraits: ["宽按钮"]
    });
    expect(registry).toMatchObject({
      components: [{ id: "button.reward.claim", status: "approved" }]
    });

    const result = await postJson(`${address}/api/search`, {
      query: "用于领取奖励的按钮"
    });
    expect(result).toMatchObject({
      status: "match",
      matches: [{ componentId: "button.reward.claim" }]
    });
  });

  it("accepts model settings in memory without exposing the API key", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "ui-ai-workbench-"));
    const app = await createWorkbenchServer({
      dataDirectory,
      fixturePath: resolve("fixtures/bridge-components.json"),
      model: {
        baseUrl: "https://models.example.test/v1",
        apiKey: "",
        name: "ui-model"
      }
    });
    const address = await app.listen(0);
    closeCallbacks.push(app.close);

    expect(await getJson(`${address}/api/state`)).toMatchObject({
      model: { ready: false }
    });
    await postJson(`${address}/api/model`, {
      baseUrl: "https://models.example.test/v1",
      apiKey: "session-secret",
      model: "ui-model"
    });
    const state = await getJson(`${address}/api/state`);

    expect(state).toMatchObject({
      model: {
        ready: true,
        name: "ui-model",
        baseUrl: "https://models.example.test/v1"
      }
    });
    expect(JSON.stringify(state)).not.toContain("session-secret");
  });
});

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  expect(response.status).toBe(200);
  return response.json();
}

async function postJson(url: string, body: unknown): Promise<any> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  expect(response.status).toBe(200);
  return response.json();
}
