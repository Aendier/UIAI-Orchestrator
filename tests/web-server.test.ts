import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { AnalysisAgent, SemanticAdjudicator } from "../src/semantic/index.js";
import type { GitHubRepositoryAdapter } from "../src/github/repository.js";
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

  it("lets the manager register GitHub repositories and gate cross-repository work", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "ui-ai-workbench-"));
    const github: GitHubRepositoryAdapter = {
      describe: vi.fn().mockResolvedValue({
        id: "acme/client",
        provider: "github",
        url: "https://github.com/acme/client",
        defaultBranch: "main"
      }),
      scan: vi.fn().mockResolvedValue({
        protocolVersion: "uiai-manager/v2",
        repositoryId: "acme/client",
        defaultBranch: "main",
        scannedAt: "2026-09-23T00:03:00.000Z",
        treeTruncated: false,
        filesTruncated: false,
        issuesTruncated: false,
        files: [{
          path: "CONTEXT.md",
          category: "context",
          sha: "sha-context",
          content: "# Context\\nManager protocol",
          truncated: false
        }],
        issues: [{
          number: 12,
          title: "Align protocol",
          state: "open",
          url: "https://github.com/acme/client/issues/12",
          labels: ["ready-for-agent"],
          isPullRequest: false
        }]
      })
    };
    const app = await createWorkbenchServer({
      dataDirectory,
      fixturePath: resolve("fixtures/bridge-components.json"),
      github
    });
    const address = await app.listen(0);
    closeCallbacks.push(app.close);

    await postJson(`${address}/api/manager/repositories`, { reference: "acme/client" });
    const plan = (await postJson(`${address}/api/manager/plans`, {
      request: "统一客户端登录协议",
      repositoryIds: ["acme/client"]
    })) as {
      id: string;
      status: string;
      workItems: Array<{ id: string; kind: string; status: string }>;
    };
    expect(plan.status).toBe("awaiting_confirmation");

    const worker = (await postJson(`${address}/api/manager/workers`, {
      id: "worker-1",
      protocolVersion: "uiai-manager/v2",
      capabilities: ["*"]
    })) as { generation: string };

    const approved = (await postJson(
      `${address}/api/manager/plans/${encodeURIComponent(plan.id)}/confirm`,
      { confirmedBy: "manager" }
    )) as typeof plan;
    const inspection = approved.workItems.find((task) => task.kind === "inspect_repository")!;
    expect(inspection.status).toBe("ready");

    const claimed = await postJson(
      `${address}/api/manager/workers/worker-1/claim?planId=${encodeURIComponent(plan.id)}&workerGeneration=${encodeURIComponent(worker.generation)}`,
      {}
    );
    expect(claimed.taskId).toBe(inspection.id);
    await postJson(
      `${address}/api/manager/plans/${encodeURIComponent(plan.id)}/work-items/${encodeURIComponent(inspection.id)}/start`,
      { workerId: "worker-1", workerGeneration: worker.generation }
    );
    const reported = await postJson(
      `${address}/api/manager/plans/${encodeURIComponent(plan.id)}/work-items/${encodeURIComponent(inspection.id)}/scan`,
      { workerId: "worker-1", workerGeneration: worker.generation }
    );
    expect(reported.status).toBe("in_progress");
    expect(github.describe).toHaveBeenCalledWith("acme/client");
    expect(github.scan).toHaveBeenCalledWith(expect.objectContaining({ id: "acme/client" }));
    expect(reported.workItems.find((task: { id: string }) => task.id === inspection.id).report.repositoryScan.repositoryId).toBe("acme/client");
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
