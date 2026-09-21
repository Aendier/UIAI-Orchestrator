import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { AnalysisAgent, SemanticAdjudicator } from "../src/semantic/index.js";
import { createWorkbenchServer } from "../src/web/server.js";

const execFileAsync = promisify(execFile);

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

    const bridgeDocument = JSON.parse(
      await readFile(resolve("fixtures/bridge-components.json"), "utf8")
    ) as unknown;
    await postJson(`${address}/api/import`, bridgeDocument);
    expect(await getJson(`${address}/api/state`)).toMatchObject({
      observations: { total: 12 },
      registry: { total: 0 }
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

  it("rejects cross-site and non-JSON mutations", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "ui-ai-workbench-"));
    const app = await createWorkbenchServer({
      dataDirectory,
      fixturePath: resolve("fixtures/bridge-components.json")
    });
    const address = await app.listen(0);
    closeCallbacks.push(app.close);

    const plainText = await fetch(`${address}/api/import`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}"
    });
    expect(plainText.status).toBe(415);

    const crossSite = await fetch(`${address}/api/model`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://attacker.example"
      },
      body: JSON.stringify({
        baseUrl: "https://attacker.example/v1",
        apiKey: "stolen",
        model: "attacker-model"
      })
    });
    expect(crossSite.status).toBe(403);
  });

  it("does not let an in-flight analysis write a stale Draft after import", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "ui-ai-workbench-"));
    let resolveAnalysis!: (value: typeof proposal) => void;
    const delayedProposal = new Promise<typeof proposal>((resolveProposal) => {
      resolveAnalysis = resolveProposal;
    });
    const delayedAgent: AnalysisAgent = {
      analyze: vi.fn().mockReturnValue(delayedProposal)
    };
    const app = await createWorkbenchServer({
      dataDirectory,
      fixturePath: resolve("fixtures/bridge-components.json"),
      agents: {
        structuralAgent: delayedAgent,
        visualAgent: delayedAgent,
        adjudicator: { adjudicate: vi.fn() }
      }
    });
    const address = await app.listen(0);
    closeCallbacks.push(app.close);

    const analysis = postJson(`${address}/api/analyze`, {
      sourceId: "guid-reward-claim"
    });
    await vi.waitFor(() => expect(delayedAgent.analyze).toHaveBeenCalledTimes(2));
    const bridgeDocument = JSON.parse(
      await readFile(resolve("fixtures/bridge-components.json"), "utf8")
    ) as unknown;
    let importFinished = false;
    const importRequest = postJson(`${address}/api/import`, bridgeDocument).then(
      (value) => {
        importFinished = true;
        return value;
      }
    );

    await new Promise((resolveTick) => setTimeout(resolveTick, 20));
    expect(importFinished).toBe(false);
    resolveAnalysis(proposal);
    await Promise.all([analysis, importRequest]);

    const state = (await getJson(`${address}/api/state`)) as {
      observations: { items: Array<{ draft?: unknown }> };
      registry: { total: number };
    };
    expect(state.observations.items.every((item) => item.draft === undefined)).toBe(true);
    expect(state.registry.total).toBe(0);
  });

  it.runIf(process.platform === "win32")(
    "passes the real double-click launcher check without pnpm",
    async () => {
      const { stdout } = await execFileAsync(
        "cmd.exe",
        ["/d", "/c", resolve("启动组件注册表.cmd"), "--check"],
        { cwd: resolve(".") }
      );

      expect(stdout).toContain("Workbench launcher check passed.");
    }
  );
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
