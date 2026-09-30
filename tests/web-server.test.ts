import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { AnalysisAgent, SemanticAdjudicator } from "../src/semantic/index.js";
import { createWorkbenchServer } from "../src/web/server.js";

const execFileAsync = promisify(execFile);

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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

  it("does not expose the retired manager API", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "ui-ai-workbench-"));
    const app = await createWorkbenchServer({
      dataDirectory,
      fixturePath: resolve("fixtures/bridge-components.json")
    });
    const address = await app.listen(0);
    closeCallbacks.push(app.close);

    const response = await fetch(`${address}/api/manager/state`);
    expect(response.status).toBe(404);
  });

  it("accepts model settings in memory without exposing the API key", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "ui-ai-workbench-"));
    const modelFetch = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            output: [
              {
                content: [{ type: "output_text", text: JSON.stringify(proposal) }]
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    );
    const app = await createWorkbenchServer({
      dataDirectory,
      fixturePath: resolve("fixtures/bridge-components.json"),
      modelFetch,
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
      model: "ui-model",
      wireApi: "responses"
    });
    const state = await getJson(`${address}/api/state`);

    expect(state).toMatchObject({
      model: {
        ready: true,
        name: "ui-model",
        baseUrl: "https://models.example.test/v1",
        wireApi: "responses",
        source: "browser"
      }
    });
    expect(JSON.stringify(state)).not.toContain("session-secret");

    await postJson(`${address}/api/analyze`, { sourceId: "guid-reward-claim" });

    expect(modelFetch).toHaveBeenCalledTimes(2);
    for (const [url, init] of modelFetch.mock.calls) {
      expect(url).toBe("https://models.example.test/v1/responses");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer session-secret"
      );
      expect(JSON.parse(String(init?.body))).toMatchObject({ model: "ui-model" });
    }
  });

  it("starts ready from Codex model configuration without exposing its key", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "ui-ai-workbench-"));
    const homeDirectory = await mkdtemp(join(tmpdir(), "ui-ai-codex-home-"));
    const codexDirectory = join(homeDirectory, ".codex");
    await mkdir(codexDirectory);
    await writeFile(
      join(codexDirectory, "config.toml"),
      [
        'model_provider = "taishi"',
        'model = "gpt-5.6-sol"',
        "[model_providers.taishi]",
        'base_url = "https://models.example.test/v1"',
        'wire_api = "responses"'
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(codexDirectory, "auth.json"),
      JSON.stringify({ OPENAI_API_KEY: "codex-secret" }),
      "utf8"
    );
    const app = await createWorkbenchServer({
      dataDirectory,
      fixturePath: resolve("fixtures/bridge-components.json"),
      modelConfig: { homeDirectory, environment: {} }
    });
    const address = await app.listen(0);
    closeCallbacks.push(app.close);

    const state = await getJson(`${address}/api/state`);

    expect(state).toMatchObject({
      model: {
        ready: true,
        name: "gpt-5.6-sol",
        baseUrl: "https://models.example.test/v1",
        wireApi: "responses",
        source: "codex"
      }
    });
    expect(JSON.stringify(state)).not.toContain("codex-secret");
    expect(await readFile(join(dataDirectory, "workbench.json"), "utf8")).not.toContain(
      "codex-secret"
    );
  });

  it("supports a Codex provider that does not require authentication", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "ui-ai-workbench-"));
    const homeDirectory = await mkdtemp(join(tmpdir(), "ui-ai-codex-home-"));
    const codexDirectory = join(homeDirectory, ".codex");
    await mkdir(codexDirectory);
    await writeFile(
      join(codexDirectory, "config.toml"),
      [
        'model_provider = "local"',
        'model = "local-model"',
        "[model_providers.local]",
        'base_url = "http://127.0.0.1:9000/v1"',
        'wire_api = "responses"',
        "requires_openai_auth = false"
      ].join("\n"),
      "utf8"
    );
    const modelFetch = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ output_text: JSON.stringify(proposal) }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    );
    const app = await createWorkbenchServer({
      dataDirectory,
      fixturePath: resolve("fixtures/bridge-components.json"),
      modelFetch,
      modelConfig: { homeDirectory, environment: {} }
    });
    const address = await app.listen(0);
    closeCallbacks.push(app.close);

    expect(await getJson(`${address}/api/state`)).toMatchObject({
      model: { ready: true }
    });
    const analysisResponse = await fetch(`${address}/api/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceId: "guid-reward-claim" })
    });
    const analysisBody = await analysisResponse.text();
    expect(analysisResponse.status, analysisBody).toBe(200);

    expect(modelFetch).toHaveBeenCalledTimes(2);
    for (const [, init] of modelFetch.mock.calls) {
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
    }
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

    const unsupportedProtocol = await fetch(`${address}/api/model`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        baseUrl: "ftp://models.example.test/v1",
        apiKey: "session-secret",
        model: "ui-model"
      })
    });
    expect(unsupportedProtocol.status).toBe(400);
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

  it("reports a component preview without embedding the screenshot in state", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "ui-ai-workbench-"));
    const app = await createWorkbenchServer({
      dataDirectory,
      fixturePath: resolve("fixtures/bridge-components.json")
    });
    const address = await app.listen(0);
    closeCallbacks.push(app.close);
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    await postJson(`${address}/api/import`, {
      version: "0.1.0",
      sourceCanvas: "Component Definition",
      nodes: [
        {
          name: "RewardClaimButton",
          type: "COMPONENT",
          u2f: { prefabGuid: "guid-with-preview" },
          screenshot: png
        },
        {
          name: "PlainButton",
          type: "COMPONENT",
          u2f: { prefabGuid: "guid-without-preview" }
        }
      ]
    });

    const state = (await getJson(`${address}/api/state`)) as {
      observations: { items: Array<{ sourceId: string; hasPreview?: boolean }> };
    };
    expect(JSON.stringify(state)).not.toContain(png);
    expect(state.observations.items).toEqual([
      expect.objectContaining({ sourceId: "guid-with-preview", hasPreview: true }),
      expect.objectContaining({ sourceId: "guid-without-preview", hasPreview: false })
    ]);
  });

  it("serves a component screenshot as PNG", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "ui-ai-workbench-"));
    const app = await createWorkbenchServer({
      dataDirectory,
      fixturePath: resolve("fixtures/bridge-components.json")
    });
    const address = await app.listen(0);
    closeCallbacks.push(app.close);
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    await postJson(`${address}/api/import`, {
      version: "0.1.0",
      sourceCanvas: "Component Definition",
      nodes: [
        {
          name: "RewardClaimButton",
          type: "COMPONENT",
          u2f: { prefabGuid: "guid-with-preview" },
          screenshot: png
        },
        {
          name: "PlainButton",
          type: "COMPONENT",
          u2f: { prefabGuid: "guid-without-preview" }
        }
      ]
    });

    const response = await fetch(`${address}/api/observations/guid-with-preview/preview`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(png, "base64"));

    const missing = await fetch(`${address}/api/observations/guid-without-preview/preview`);
    expect(missing.status).toBe(404);
  });

  it("rejects a component preview that is not a PNG", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "ui-ai-workbench-"));
    const app = await createWorkbenchServer({
      dataDirectory,
      fixturePath: resolve("fixtures/bridge-components.json")
    });
    const address = await app.listen(0);
    closeCallbacks.push(app.close);

    await postJson(`${address}/api/import`, {
      version: "0.1.0",
      sourceCanvas: "Component Definition",
      nodes: [
        {
          name: "RewardClaimButton",
          type: "COMPONENT",
          u2f: { prefabGuid: "guid-bad-preview" },
          screenshot: "aGVsbG8="
        }
      ]
    });

    const response = await fetch(`${address}/api/observations/guid-bad-preview/preview`);
    expect(response.status).toBe(415);
  });

  it("updates one component by prefabGuid and keeps review results", async () => {
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

    await postJson(`${address}/api/analyze`, { sourceId: "guid-reward-claim" });
    await postJson(`${address}/api/approve`, {
      sourceId: "guid-reward-claim",
      id: "button.reward.claim",
      reviewer: "本地审核员",
      useCases: ["领取奖励"],
      visualTraits: ["宽按钮"]
    });

    const synced = await postJson(`${address}/api/sync`, {
      version: "0.1.0",
      sourceCanvas: "Component Definition",
      nodes: [
        {
          name: "RewardClaimButtonV2",
          type: "COMPONENT",
          u2f: { prefabGuid: "guid-reward-claim" },
          screenshot: PNG_BASE64
        },
        {
          name: "NewBadge",
          type: "COMPONENT",
          u2f: { prefabGuid: "guid-new-badge" }
        }
      ]
    });
    expect(synced).toEqual({
      updated: 1,
      added: 1,
      clearedDrafts: false,
      clearedRegistry: false
    });

    const state = (await getJson(`${address}/api/state`)) as {
      observations: {
        total: number;
        items: Array<{
          sourceId: string;
          name: string;
          hasPreview: boolean;
          draft?: { name: string };
          approved?: { id: string; status: string };
        }>;
      };
      registry: { total: number };
    };
    const reward = state.observations.items.find((item) => item.sourceId === "guid-reward-claim");
    expect(state.observations.total).toBe(13);
    expect(state.observations.items.some((item) => item.sourceId === "guid-close")).toBe(true);
    expect(state.observations.items.some((item) => item.sourceId === "guid-new-badge")).toBe(true);
    expect(reward).toMatchObject({
      name: "RewardClaimButtonV2",
      hasPreview: true,
      draft: { name: "RewardClaimButton" },
      approved: { id: "button.reward.claim", status: "approved" }
    });
    expect(state.registry.total).toBe(1);
  });

  it("pulls one Unity component through the local sync endpoint", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "ui-ai-workbench-"));
    const agent: AnalysisAgent = { analyze: vi.fn().mockResolvedValue(proposal) };
    const adjudicator: SemanticAdjudicator = { adjudicate: vi.fn() };
    const unityFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          version: "0.1.0",
          port: 4380,
          sourceCanvas: "Component Definition",
          nodes: [
            {
              name: "RewardClaimButtonV2",
              type: "COMPONENT",
              u2f: { prefabGuid: "guid-reward-claim" },
              screenshot: PNG_BASE64
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const app = await createWorkbenchServer({
      dataDirectory,
      fixturePath: resolve("fixtures/bridge-components.json"),
      agents: { structuralAgent: agent, visualAgent: agent, adjudicator },
      unityFetch
    });
    const address = await app.listen(0);
    closeCallbacks.push(app.close);

    await postJson(`${address}/api/analyze`, { sourceId: "guid-reward-claim" });
    await postJson(`${address}/api/approve`, {
      sourceId: "guid-reward-claim",
      id: "button.reward.claim",
      reviewer: "本地审核员",
      useCases: ["领取奖励"],
      visualTraits: ["宽按钮"]
    });

    const synced = await postJson(`${address}/api/sync/unity`, {
      port: 4380,
      objectName: "RewardClaimButton"
    });
    expect(synced).toEqual({
      updated: 1,
      added: 0,
      clearedDrafts: false,
      clearedRegistry: false
    });
    expect(unityFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:4380/export?objectName=RewardClaimButton"
    );

    const state = (await getJson(`${address}/api/state`)) as {
      observations: {
        total: number;
        items: Array<{
          sourceId: string;
          name: string;
          hasPreview: boolean;
          draft?: { name: string };
          approved?: { id: string; status: string };
        }>;
      };
      registry: { total: number };
    };
    const reward = state.observations.items.find((item) => item.sourceId === "guid-reward-claim");
    expect(state.observations.total).toBe(12);
    expect(reward).toMatchObject({
      name: "RewardClaimButtonV2",
      hasPreview: true,
      draft: { name: "RewardClaimButton" },
      approved: { id: "button.reward.claim", status: "approved" }
    });
    expect(state.registry.total).toBe(1);
  });

  it("does not change the library when Unity cannot find the target", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "ui-ai-workbench-"));
    const unityFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "target_not_found" }), {
        status: 404,
        headers: { "content-type": "application/json" }
      })
    );
    const app = await createWorkbenchServer({
      dataDirectory,
      fixturePath: resolve("fixtures/bridge-components.json"),
      unityFetch
    });
    const address = await app.listen(0);
    closeCallbacks.push(app.close);
    const before = await getJson(`${address}/api/state`);

    const response = await fetch(`${address}/api/sync/unity`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ objectName: "MissingObject" })
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "找不到名为“MissingObject”的物体。" });
    expect(unityFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:4380/export?objectName=MissingObject"
    );
    expect(await getJson(`${address}/api/state`)).toEqual(before);
  });

  it("rejects a sync component without a stable prefabGuid", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "ui-ai-workbench-"));
    const app = await createWorkbenchServer({
      dataDirectory,
      fixturePath: resolve("fixtures/bridge-components.json")
    });
    const address = await app.listen(0);
    closeCallbacks.push(app.close);
    const before = await getJson(`${address}/api/state`);

    for (const node of [
      { name: "LooseNode", type: "FRAME" },
      { name: "BadGuid", type: "COMPONENT", u2f: { prefabGuid: "guid/with/slash" } }
    ]) {
      const response = await fetch(`${address}/api/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: "0.1.0",
          sourceCanvas: "Component Definition",
          nodes: [node]
        })
      });
      expect(response.status).toBe(400);
    }

    expect(await getJson(`${address}/api/state`)).toEqual(before);
  });

  it("rejects a sync document that repeats a prefabGuid", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "ui-ai-workbench-"));
    const app = await createWorkbenchServer({
      dataDirectory,
      fixturePath: resolve("fixtures/bridge-components.json")
    });
    const address = await app.listen(0);
    closeCallbacks.push(app.close);
    const before = await getJson(`${address}/api/state`);

    const response = await fetch(`${address}/api/sync`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version: "0.1.0",
        sourceCanvas: "Component Definition",
        nodes: [
          { name: "First", type: "COMPONENT", u2f: { prefabGuid: "guid-repeat" } },
          { name: "Second", type: "COMPONENT", u2f: { prefabGuid: "guid-repeat" } }
        ]
      })
    });
    expect(response.status).toBe(400);
    expect(await getJson(`${address}/api/state`)).toEqual(before);
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
