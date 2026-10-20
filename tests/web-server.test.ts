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

  it("keeps approvals for distinct source components when their suggested registry id is shared", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "ui-ai-workbench-"));
    const agent: AnalysisAgent = { analyze: vi.fn().mockResolvedValue(proposal) };
    const app = await createWorkbenchServer({
      dataDirectory,
      fixturePath: resolve("fixtures/bridge-components.json"),
      agents: { structuralAgent: agent, visualAgent: agent, adjudicator: { adjudicate: vi.fn() } }
    });
    const address = await app.listen(0);
    closeCallbacks.push(app.close);

    for (const sourceId of ["guid-reward-claim", "guid-tab"]) {
      await postJson(address + "/api/analyze", { sourceId });
      await postJson(address + "/api/approve", {
        sourceId,
        id: "navigation.tab",
        reviewer: "tester"
      });
    }

    const state = await getJson(`${address}/api/state`) as any;
    expect(state.registry.components).toHaveLength(2);
    expect(state.registry.components.map((entry: any) => entry.sourceId)).toEqual([
      "guid-reward-claim",
      "guid-tab"
    ]);
    expect(state.registry.components.map((entry: any) => entry.id)).toEqual([
      "navigation.tab",
      "navigation.tab.guid-tab"
    ]);

    await postJson(address + "/api/approve", {
      sourceId: "guid-tab",
      id: "navigation.tab",
      reviewer: "tester"
    });
    const reapproved = await getJson(`${address}/api/state`) as any;
    expect(reapproved.registry.components).toHaveLength(2);
    expect(reapproved.registry.components.find((entry: any) => entry.sourceId === "guid-tab").id)
      .toBe("navigation.tab.guid-tab");
  });

  it("serves every browser module imported by the workbench entrypoint", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "ui-ai-static-assets-"));
    const agent: AnalysisAgent = { analyze: vi.fn().mockResolvedValue(proposal) };
    const adjudicator: SemanticAdjudicator = { adjudicate: vi.fn() };
    const app = await createWorkbenchServer({
      dataDirectory,
      fixturePath: resolve("fixtures/bridge-components.json"),
      agents: { structuralAgent: agent, visualAgent: agent, adjudicator }
    });
    const address = await app.listen(0);
    closeCallbacks.push(app.close);

    for (const asset of [
      "/app.js",
      "/library-view.js",
      "/usage-view.js",
      "/usage-dashboard.js",
      "/page-planner.js",
      "/page-editor.js"
    ]) {
      const response = await fetch(`${address}${asset}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/javascript");
    }
  });

  it("serves new top-level browser modules without restarting the server", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "ui-ai-new-assets-"));
    const publicDirectory = join(dataDirectory, "public");
    await mkdir(publicDirectory);
    const app = await createWorkbenchServer({
      dataDirectory,
      publicDirectory,
      fixturePath: resolve("fixtures/bridge-components.json")
    });
    const address = await app.listen(0);
    closeCallbacks.push(app.close);

    expect((await fetch(`${address}/new-view.js`)).status).toBe(404);
    await writeFile(join(publicDirectory, "new-view.js"), "export const ready = true;", "utf8");
    const response = await fetch(`${address}/new-view.js`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/javascript");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("export const ready = true;");

    await writeFile(join(publicDirectory, "private.json"), '{"private":true}', "utf8");
    expect((await fetch(`${address}/private.json`)).status).toBe(404);
    expect((await fetch(`${address}/../workbench.json`)).status).toBe(404);
  });

  it("marks approved conclusions stale after sync and can revoke them", async () => {
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
    await postJson(address + "/api/analyze", { sourceId: "guid-reward-claim" });
    await postJson(address + "/api/approve", {
      sourceId: "guid-reward-claim",
      id: "button.reward.claim",
      reviewer: "tester"
    });
    const document = JSON.parse(
      await readFile(resolve("fixtures/bridge-components.json"), "utf8")
    ) as { nodes: Array<Record<string, unknown>> };
    const rewardNode = document.nodes.find(
      (node) => (node.u2f as { prefabGuid?: string } | undefined)?.prefabGuid === "guid-reward-claim"
    );
    expect(rewardNode).toBeDefined();
    rewardNode!.name = "RewardClaimButtonRenamed";
    await postJson(address + "/api/sync", {
      version: "0.1.0",
      sourceCanvas: "Component Definition",
      nodes: document.nodes
    });
    let state = (await getJson(address + "/api/state")) as any;
    expect(state.observations.items.find((item: any) => item.sourceId === "guid-reward-claim"))
      .toMatchObject({ approved: { id: "button.reward.claim" }, approvedChanged: true });
    const outdatedApproval = await fetch(address + "/api/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourceId: "guid-reward-claim",
        id: "button.reward.claim",
        reviewer: "tester"
      })
    });
    expect(outdatedApproval.status).toBe(409);
    await postJson(address + "/api/approval/reset", { sourceId: "guid-reward-claim" });
    state = await getJson(address + "/api/state");
    const resetItem = state.observations.items.find((item: any) => item.sourceId === "guid-reward-claim");
    expect(resetItem).not.toHaveProperty("approved");
    expect(resetItem).not.toHaveProperty("draft");
    await postJson(address + "/api/analyze", { sourceId: "guid-reward-claim" });
    await postJson(address + "/api/approve", {
      sourceId: "guid-reward-claim",
      id: "button.reward.claim",
      reviewer: "tester"
    });
    await postJson(address + "/api/approval/revoke", { sourceId: "guid-reward-claim" });
    state = await getJson(address + "/api/state");
    const revokedItem = state.observations.items.find((item: any) => item.sourceId === "guid-reward-claim");
    expect(revokedItem).toMatchObject({ draft: { sourceId: "guid-reward-claim" } });
    expect(revokedItem).not.toHaveProperty("approved");
    expect(state.registry.total).toBe(0);
  });

  it("records versioned definitions on analysis and approval and tolerates later capture-only syncs", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'uiai-stable-http-'));
    const agent: AnalysisAgent = {analyze: vi.fn().mockResolvedValue(proposal)};
    const app = await createWorkbenchServer({dataDirectory, fixturePath: resolve('fixtures/bridge-components.json'),
      agents: {structuralAgent: agent, visualAgent: agent, adjudicator: {adjudicate: vi.fn()}}});
    const address = await app.listen(0); closeCallbacks.push(app.close);
    const bridge = JSON.parse(await readFile(resolve('fixtures/bridge-components.json'), 'utf8'));
    const component = bridge.nodes[0];
    component.u2f.assetDependencyHash = '123456789abcdef0123456789abcdef0';
    component.children = [{name: 'Content', type: 'FRAME', layout: {rect: {x: 10, y: 5, width: 200, height: 60}}}];
    const batch = {version: '0.1.0', sourceCanvas: 'Batch', nodes: [...bridge.nodes.slice(1), component]};
    await postJson(address + '/api/sync', batch);
    await postJson(address + '/api/analyze', {sourceId: component.u2f.prefabGuid});
    const analyzed = await getJson(address + '/api/state') as any;
    const draft = analyzed.observations.items.find((item: any) => item.sourceId === component.u2f.prefabGuid).draft;
    expect(draft.definitionFingerprint.version).toBe('uiai-definition/v1');
    component.name = 'Scene instance'; component.layout.rect.x += 100; delete component.screenshot;
    await postJson(address + '/api/sync', {version: '0.1.0', sourceCanvas: component.name, nodes: [component]});
    // The definition analyzed above still matches even though the snapshot differs.
    await postJson(address + '/api/approve', {sourceId: component.u2f.prefabGuid, id: 'button.reward.claim', reviewer: 'tester'});
    const state = await getJson(address + '/api/state') as any;
    const approved = structuredClone(state.registry.components[0]);
    expect(approved.definitionFingerprint).toEqual(draft.definitionFingerprint);
    expect(approved.observationFingerprint).not.toBe(draft.observationFingerprint);
    component.screenshot = PNG_BASE64;
    await postJson(address + '/api/sync', {version: '0.1.0', sourceCanvas: component.name, nodes: [component]});
    const after = await getJson(address + '/api/state') as any;
    expect(after.registry.components[0]).toEqual(approved);
    expect(after.observations.items.find((item: any) => item.sourceId === component.u2f.prefabGuid).approvedChanged).toBe(false);
    component.u2f.assetDependencyHash = 'abcdef0123456789abcdef0123456789';
    await postJson(address + '/api/sync', {version: '0.1.0', sourceCanvas: component.name, nodes: [component]});
    const changed = await getJson(address + '/api/state') as any;
    expect(changed.observations.items.find((item: any) => item.sourceId === component.u2f.prefabGuid).approvedChanged).toBe(true);
    const blocked = await fetch(address + '/api/approve', {method: 'POST', headers: {'content-type': 'application/json'},
      body: JSON.stringify({sourceId: component.u2f.prefabGuid, id: 'button.reward.claim', reviewer: 'tester'})});
    expect(blocked.status).toBe(409);
    expect((await getJson(address + '/api/state') as any).registry.components[0]).toEqual(approved);
  });

  it("deletes a component together with its draft and approved conclusion", async () => {
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
    await postJson(address + "/api/analyze", { sourceId: "guid-reward-claim" });
    await postJson(address + "/api/approve", {
      sourceId: "guid-reward-claim",
      id: "button.reward.claim",
      reviewer: "tester"
    });
    await postJson(address + "/api/observation/delete", { sourceId: "guid-reward-claim" });
    const state = (await getJson(address + "/api/state")) as any;
    expect(state.observations.items.some((item: any) => item.sourceId === "guid-reward-claim")).toBe(false);
    expect(state.registry.components.some((item: any) => item.id === "button.reward.claim")).toBe(false);
    const stored = JSON.parse(await readFile(join(dataDirectory, "workbench.json"), "utf8"));
    expect(stored.drafts.drafts.some((item: any) => item.sourceId === "guid-reward-claim")).toBe(false);
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

  it("loads provider models and reuses the current key when switching models", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "ui-ai-model-catalog-"));
    const modelFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/models")) {
        return new Response(JSON.stringify({ data: [{ id: "gpt-6-astra" }, { id: "gpt-5.6-sol" }] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      expect(url).toBe("https://models.example.test/v1/responses");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer session-secret");
      expect(JSON.parse(String(init?.body))).toMatchObject({ model: "gpt-6-astra" });
      return new Response(JSON.stringify({ output_text: JSON.stringify(proposal) }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });
    const app = await createWorkbenchServer({
      dataDirectory,
      fixturePath: resolve("fixtures/bridge-components.json"),
      modelFetch,
      model: {
        baseUrl: "https://models.example.test/v1",
        apiKey: "session-secret",
        name: "gpt-5.6-sol",
        wireApi: "responses"
      }
    });
    const address = await app.listen(0);
    closeCallbacks.push(app.close);

    expect(await postJson(`${address}/api/models`, {
      baseUrl: "https://models.example.test/v1"
    })).toEqual({ source: "provider", models: ["gpt-5.6-sol", "gpt-6-astra"] });

    await postJson(`${address}/api/model`, {
      baseUrl: "https://models.example.test/v1",
      model: "gpt-6-astra",
      wireApi: "responses"
    });
    await postJson(`${address}/api/analyze`, { sourceId: "guid-reward-claim" });

    expect(modelFetch).toHaveBeenCalledTimes(3);
  });

  it("keeps the local model catalog fallback after switching models without replacing the key", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "ui-ai-model-catalog-cache-"));
    const catalogPath = join(dataDirectory, "models.json");
    await writeFile(catalogPath, JSON.stringify({
      models: [
        { slug: "gpt-6-astra", visibility: "list", supported_in_api: true },
        { slug: "hidden-model", visibility: "hidden", supported_in_api: true },
        { slug: "unsupported-model", visibility: "list", supported_in_api: false }
      ]
    }), "utf8");
    const modelFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "invalid token" } }), {
        status: 401,
        headers: { "content-type": "application/json" }
      })
    );
    const app = await createWorkbenchServer({
      dataDirectory,
      fixturePath: resolve("fixtures/bridge-components.json"),
      modelFetch,
      modelCatalogPath: catalogPath,
      model: {
        baseUrl: "https://models.example.test/v1",
        apiKey: "session-secret",
        name: "gpt-6-astra"
      }
    });
    const address = await app.listen(0);
    closeCallbacks.push(app.close);

    expect(await postJson(`${address}/api/models`, {
      baseUrl: "https://models.example.test/v1"
    })).toEqual({ source: "codex-cache", models: ["gpt-6-astra"] });

    await postJson(`${address}/api/model`, {
      baseUrl: "https://models.example.test/v1",
      model: "gpt-5.6-sol"
    });
    expect(await postJson(`${address}/api/models`, {
      baseUrl: "https://models.example.test/v1"
    })).toEqual({ source: "codex-cache", models: ["gpt-6-astra"] });

    // A newly supplied key must be checked against the provider, not hidden by a cache hit.
    const explicitKeyResponse = await fetch(`${address}/api/models`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl: "https://models.example.test/v1", apiKey: "replacement-secret" })
    });
    expect(explicitKeyResponse.status).toBe(502);
    expect(await explicitKeyResponse.json()).toMatchObject({ error: expect.stringContaining("认证失败") });

    await postJson(`${address}/api/model`, {
      baseUrl: "https://models.example.test/v1",
      apiKey: "replacement-secret",
      model: "gpt-5.6-sol"
    });
    const replacedKeyResponse = await fetch(`${address}/api/models`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl: "https://models.example.test/v1" })
    });
    expect(replacedKeyResponse.status).toBe(502);

    await postJson(`${address}/api/model`, {
      baseUrl: "https://another.example.test/v1",
      apiKey: "another-provider-secret",
      model: "other-model"
    });
    const otherProviderResponse = await fetch(`${address}/api/models`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl: "https://another.example.test/v1" })
    });
    expect(otherProviderResponse.status).toBe(502);
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
          opacity: 0.5,
          u2f: { prefabGuid: "guid-without-preview" },
          layout: {
            text: { characters: "购买" },
            style: { backgroundColor: "#ff0000" }
          },
          children: [{ name: "Icon", type: "RECTANGLE", u2f: { componentTypes: ["Image"] } }]
        }
      ]
    });

    const state = (await getJson(`${address}/api/state`)) as {
      observations: { items: Array<{ sourceId: string; hasPreview?: boolean }> };
    };
    expect(JSON.stringify(state)).not.toContain(png);
    expect(state.observations.items).toEqual([
      expect.objectContaining({
        sourceId: "guid-with-preview", hasPreview: true,
        hasImage: false, hasText: false, hasBackgroundFill: false
      }),
      expect.objectContaining({
        sourceId: "guid-without-preview", hasPreview: false,
        hasImage: true, hasText: true, hasBackgroundFill: true, opacity: 0.5
      })
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

  it.runIf(process.platform === "win32")("uses encrypted AIOA credentials for model requests after a standalone restart", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "ui-ai-standalone-"));
    const homeDirectory = join(dataDirectory, "home");
    const codexDirectory = join(homeDirectory, ".codex");
    await mkdir(codexDirectory, { recursive: true });
    await writeFile(join(codexDirectory, "config.toml"), [
      'model_provider = "test"', 'model = "gpt-6-astra"',
      '[model_providers.test]', 'base_url = "https://models.example.test/v1"',
      'wire_api = "responses"'
    ].join("\n"), "utf8");
    const session = await createWorkbenchServer({
      dataDirectory, modelConfig: { homeDirectory, environment: { CODEX_API_KEY: "aioa-session-secret" } }
    });
    await session.close();

    const modelFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: "gpt-6-astra" }]
    }), { headers: { "content-type": "application/json" } }));
    const standalone = await createWorkbenchServer({
      dataDirectory, modelConfig: { homeDirectory, environment: {} }, modelFetch
    });
    closeCallbacks.push(standalone.close);
    const address = await standalone.listen(0);
    expect(await postJson(`${address}/api/models`, { baseUrl: "https://models.example.test/v1" }))
      .toEqual({ source: "provider", models: ["gpt-6-astra"] });
    expect(modelFetch.mock.calls[0]?.[1].headers.authorization).toBe("Bearer aioa-session-secret");
    const state = await getJson(`${address}/api/state`);
    expect(state).toMatchObject({ model: { source: "aioa-cache", ready: true } });
    expect(JSON.stringify(state)).not.toContain("aioa-session-secret");
    expect(await readFile(join(dataDirectory, "aioa-credential.dpapi"), "utf8"))
      .not.toContain("aioa-session-secret");
    expect(await readFile(join(dataDirectory, "workbench.json"), "utf8"))
      .not.toContain("aioa-session-secret");
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

  it("marks a known component missing without deleting its review", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "ui-ai-workbench-"));
    const agent: AnalysisAgent = { analyze: vi.fn().mockResolvedValue(proposal) };
    const adjudicator: SemanticAdjudicator = { adjudicate: vi.fn() };
    const unityFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "target_not_found" }), {
        status: 404,
        headers: { "content-type": "application/json" }
      })
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

    const response = await fetch(`${address}/api/sync/unity`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ objectName: "RewardClaimButton" })
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "找不到名为“RewardClaimButton”的物体。" });

    const state = (await getJson(`${address}/api/state`)) as {
      observations: {
        items: Array<{
          sourceId: string;
          enginePresence?: string;
          missingSince?: string;
          draft?: { name: string };
          approved?: { id: string; status: string };
        }>;
      };
      registry: { total: number };
    };
    const reward = state.observations.items.find((item) => item.sourceId === "guid-reward-claim");
    expect(reward).toMatchObject({
      enginePresence: "missing",
      draft: { name: "RewardClaimButton" },
      approved: { id: "button.reward.claim", status: "approved" }
    });
    expect(reward?.missingSince).toEqual(expect.any(String));
    expect(state.registry.total).toBe(1);
  });

  it("tests the Unity Bridge connection without changing the library", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "ui-ai-workbench-"));
    const bridgeDocument = await readFile(resolve("fixtures/bridge-components.json"), "utf8");
    const unityFetch = vi.fn().mockResolvedValue(new Response(bridgeDocument, {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
    const app = await createWorkbenchServer({
      dataDirectory,
      fixturePath: resolve("fixtures/bridge-components.json"),
      unityFetch
    });
    const address = await app.listen(0);
    closeCallbacks.push(app.close);
    const before = await getJson(`${address}/api/state`);

    const result = await postJson(`${address}/api/unity/test`, { port: 4380 });

    expect(result).toEqual({ connected: true, port: 4380, components: 12 });
    expect(unityFetch).toHaveBeenCalledWith("http://127.0.0.1:4380/export");
    expect(await getJson(`${address}/api/state`)).toEqual(before);
  });

  it("automatically syncs all exported scene components without clearing review", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "ui-ai-workbench-"));
    const agent: AnalysisAgent = { analyze: vi.fn().mockResolvedValue(proposal) };
    const adjudicator: SemanticAdjudicator = { adjudicate: vi.fn() };
    const unityFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      version: "0.1.0",
      sourceCanvas: "Loaded Scenes",
      exportTime: "2026-10-08T19:45:06.0835662+08:00",
      nodes: [
        { name: "RewardClaimButtonV2", type: "COMPONENT", u2f: { prefabGuid: "guid-reward-claim" }, screenshot: PNG_BASE64 },
        { name: "NewBadge", type: "COMPONENT", u2f: { prefabGuid: "guid-new-badge" } }
      ]
    }), { status: 200, headers: { "content-type": "application/json" } }));
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

    const synced = await postJson(`${address}/api/sync/unity`, { port: 4380 });
    expect(synced).toEqual({ updated: 1, added: 1, clearedDrafts: false, clearedRegistry: false });
    expect(unityFetch).toHaveBeenCalledWith("http://127.0.0.1:4380/export");
    const state = (await getJson(`${address}/api/state`)) as {
      observations: { items: Array<{ sourceId: string; name: string; draft?: unknown; approved?: unknown }> };
      registry: { total: number };
    };
    expect(state.observations.items.find((item) => item.sourceId === "guid-reward-claim")).toMatchObject({
      name: "RewardClaimButtonV2",
      draft: expect.any(Object),
      approved: expect.any(Object)
    });
    expect(state.observations.items.some((item) => item.sourceId === "guid-new-badge")).toBe(true);
    expect(state.registry.total).toBe(1);
    const stored = JSON.parse(await readFile(join(dataDirectory, "workbench.json"), "utf8"));
    expect(stored.observations.observations.find(
      (item: { root: { sourceId: string } }) => item.root.sourceId === "guid-new-badge"
    ).source.observedAt).toBe("2026-10-08T11:45:06.083Z");
  });

  it("does not change the library when Unity lacks automatic export", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "ui-ai-workbench-"));
    const unityFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "target_name_required" }), {
      status: 400,
      headers: { "content-type": "application/json" }
    }));
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
      body: JSON.stringify({})
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "当前 Unity Bridge 不支持自动导出，请更新 Bridge 后重试。" });
    expect(unityFetch).toHaveBeenCalledWith("http://127.0.0.1:4380/export");
    expect(await getJson(`${address}/api/state`)).toEqual(before);
  });

  it.each([
    { status: 404, code: "export_not_found", message: "已加载场景中没有可同步的 Prefab 组件。" },
    { status: 409, code: "duplicate_prefab_guid", message: "Unity 场景中有重复的 Prefab GUID，无法确定要同步哪个实例。" }
  ])("keeps the library unchanged on automatic export error $code", async ({ status, code, message }) => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "ui-ai-workbench-"));
    const unityFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: code }), {
      status,
      headers: { "content-type": "application/json" }
    }));
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
      body: JSON.stringify({ port: 4380 })
    });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: message });
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
