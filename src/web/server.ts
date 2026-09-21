import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import { z } from "zod";

import { createOpenAICompatibleAgents } from "../ai/openai-compatible.js";
import { adaptBridgeDocument } from "../bridge/index.js";
import {
  ObservationDocumentSchema,
  type ObservationDocument,
  type ObservedNode
} from "../observation/index.js";
import {
  approveDraft,
  ComponentRegistrySchema,
  interpretQuery,
  searchRegistry,
  type ApprovalInput,
  type ComponentRegistry
} from "../registry/index.js";
import { SCHEMA_VERSION } from "../schema-version.js";
import {
  analyzeComponent,
  SemanticDraftSchema,
  type AnalysisAgent,
  type SemanticAdjudicator,
  type SemanticDraft
} from "../semantic/index.js";

interface AgentSet {
  structuralAgent: AnalysisAgent;
  visualAgent: AnalysisAgent;
  adjudicator: SemanticAdjudicator;
}

interface WorkbenchOptions {
  dataDirectory?: string;
  fixturePath?: string;
  publicDirectory?: string;
  agents?: AgentSet;
  model?: { baseUrl: string; apiKey: string; name: string };
}

export interface WorkbenchServer {
  listen(port?: number): Promise<string>;
  close(): Promise<void>;
}

const DraftDocumentSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  drafts: z.array(SemanticDraftSchema)
});

const AnalyzeRequestSchema = z.object({ sourceId: z.string().min(1) });
const ApproveRequestSchema = z.object({
  sourceId: z.string().min(1),
  id: z.string().min(1),
  reviewer: z.string().min(1),
  useCases: z.array(z.string().min(1)).default([]),
  visualTraits: z.array(z.string().min(1)).default([])
});
const SearchRequestSchema = z.object({ query: z.string().min(1) });
const ModelRequestSchema = z.object({
  baseUrl: z.url(),
  apiKey: z.string().min(1),
  model: z.string().min(1)
});

export async function createWorkbenchServer(
  options: WorkbenchOptions = {}
): Promise<WorkbenchServer> {
  const dataDirectory = resolve(options.dataDirectory ?? ".local");
  const fixturePath = resolve(options.fixturePath ?? "fixtures/bridge-components.json");
  const publicDirectory = resolve(options.publicDirectory ?? "public");
  const model = options.model ?? {
    baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    apiKey: process.env.OPENAI_API_KEY ?? "",
    name: process.env.OPENAI_MODEL ?? "gpt-4.1-mini"
  };
  const agents =
    options.agents ??
    (model.apiKey
      ? createOpenAICompatibleAgents({
          baseUrl: model.baseUrl,
          apiKey: model.apiKey,
          model: model.name
        })
      : undefined);
  const runtime = {
    agents,
    model: { ready: agents !== undefined, name: model.name, baseUrl: model.baseUrl }
  };
  const store = new WorkbenchStore(dataDirectory, fixturePath);
  await store.initialize();

  const server = createServer(async (request, response) => {
    try {
      await routeRequest(request, response, {
        store,
        publicDirectory,
        runtime
      });
    } catch (error: unknown) {
      const authenticationFailure =
        error instanceof Error && error.message.includes("HTTP 401");
      const status =
        error instanceof HttpError ? error.status : authenticationFailure ? 502 : 500;
      const message = authenticationFailure
        ? "模型服务认证失败，请打开模型设置检查地址、模型和密钥。"
        : error instanceof Error
          ? error.message
          : "Unknown server error.";
      sendJson(response, status, { error: message });
    }
  });

  return {
    listen: (port = 4317) =>
      new Promise((resolveAddress, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          const address = server.address();
          if (address === null || typeof address === "string") {
            reject(new Error("Unable to resolve the local server address."));
            return;
          }
          resolveAddress(`http://127.0.0.1:${address.port}`);
        });
      }),
    close: () =>
      new Promise((resolveClose, reject) => {
        if (!server.listening) {
          resolveClose();
          return;
        }
        server.close((error) => (error ? reject(error) : resolveClose()));
      })
  };
}

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: {
    store: WorkbenchStore;
    publicDirectory: string;
    runtime: {
      agents: AgentSet | undefined;
      model: { ready: boolean; name: string; baseUrl: string };
    };
  }
): Promise<void> {
  const method = request.method ?? "GET";
  const path = new URL(request.url ?? "/", "http://localhost").pathname;

  if (method === "POST") assertTrustedMutation(request);

  if (method === "GET" && path === "/api/state") {
    const [observations, drafts, registry] = await Promise.all([
      context.store.readObservations(),
      context.store.readDrafts(),
      context.store.readRegistry()
    ]);
    const draftBySource = new Map(drafts.map((draft) => [draft.sourceId, draft]));
    const approvedBySource = new Map(
      registry.components.map((component) => [component.sourceId, component])
    );
    sendJson(response, 200, {
      model: context.runtime.model,
      observations: {
        total: observations.observations.length,
        items: observations.observations.map((observation) => ({
          sourceId: observation.root.sourceId,
          name: observation.root.name,
          nodeType: observation.root.nodeType,
          componentRef: observation.root.componentRef,
          bounds: observation.root.bounds,
          childCount: countDescendants(observation.root),
          draft: draftBySource.get(observation.root.sourceId),
          approved: approvedBySource.get(observation.root.sourceId)
        }))
      },
      registry: { total: registry.components.length, components: registry.components }
    });
    return;
  }

  if (method === "POST" && path === "/api/analyze") {
    if (!context.runtime.agents) {
      throw new HttpError(409, "当前进程没有模型密钥，请从 AIOA 会话启动工作台。");
    }
    const input = AnalyzeRequestSchema.parse(await readJsonBody(request));
    const observations = await context.store.readObservations();
    const observation = observations.observations.find(
      (item) => item.root.sourceId === input.sourceId
    );
    if (!observation) throw new HttpError(404, "未找到这个组件。");
    const draft = await analyzeComponent({ observation, ...context.runtime.agents });
    await context.store.upsertDraft(draft);
    sendJson(response, 200, draft);
    return;
  }

  if (method === "POST" && path === "/api/approve") {
    const input = ApproveRequestSchema.parse(await readJsonBody(request));
    const draft = (await context.store.readDrafts()).find(
      (item) => item.sourceId === input.sourceId
    );
    if (!draft) throw new HttpError(409, "请先完成 AI 分析，再进行人工批准。");
    const registry = await context.store.approve(draft, {
      id: input.id,
      approvedBy: input.reviewer,
      useCases: input.useCases,
      visualTraits: input.visualTraits
    });
    sendJson(response, 200, registry);
    return;
  }

  if (method === "POST" && path === "/api/search") {
    const input = SearchRequestSchema.parse(await readJsonBody(request));
    const result = searchRegistry(
      await context.store.readRegistry(),
      interpretQuery(input.query)
    );
    sendJson(response, 200, result);
    return;
  }

  if (method === "POST" && path === "/api/model") {
    const input = ModelRequestSchema.parse(await readJsonBody(request));
    context.runtime.agents = createOpenAICompatibleAgents({
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      model: input.model
    });
    context.runtime.model = {
      ready: true,
      name: input.model,
      baseUrl: input.baseUrl
    };
    sendJson(response, 200, context.runtime.model);
    return;
  }

  if (method === "POST" && path === "/api/import") {
    const imported = adaptBridgeDocument(await readJsonBody(request));
    await context.store.replaceLibrary(imported);
    sendJson(response, 200, {
      imported: imported.observations.length,
      clearedDrafts: true,
      clearedRegistry: true
    });
    return;
  }

  if (method === "GET") {
    const asset = staticAsset(path);
    if (asset) {
      const body = await readFile(resolve(context.publicDirectory, asset.file));
      response.writeHead(200, { "content-type": asset.contentType });
      response.end(body);
      return;
    }
  }

  throw new HttpError(404, "Not found.");
}

class WorkbenchStore {
  readonly #observationsPath: string;
  readonly #draftsPath: string;
  readonly #registryPath: string;
  #mutationQueue: Promise<void> = Promise.resolve();

  public constructor(
    private readonly dataDirectory: string,
    private readonly fixturePath: string
  ) {
    this.#observationsPath = resolve(dataDirectory, "observations.json");
    this.#draftsPath = resolve(dataDirectory, "drafts.json");
    this.#registryPath = resolve(dataDirectory, "registry.json");
  }

  public async initialize(): Promise<void> {
    await mkdir(this.dataDirectory, { recursive: true });
    await this.ensureFile(this.#observationsPath, async () =>
      adaptBridgeDocument(await readJsonFile(this.fixturePath))
    );
    await this.ensureFile(this.#draftsPath, async () => ({
      schemaVersion: SCHEMA_VERSION,
      drafts: []
    }));
    await this.ensureFile(this.#registryPath, async () => ({
      schemaVersion: SCHEMA_VERSION,
      components: []
    }));
  }

  public async readObservations(): Promise<ObservationDocument> {
    return ObservationDocumentSchema.parse(await readJsonFile(this.#observationsPath));
  }

  public async writeObservations(value: ObservationDocument): Promise<void> {
    await writeJsonFile(this.#observationsPath, ObservationDocumentSchema.parse(value));
  }

  public async readDrafts(): Promise<SemanticDraft[]> {
    return DraftDocumentSchema.parse(await readJsonFile(this.#draftsPath)).drafts;
  }

  public async writeDrafts(drafts: SemanticDraft[]): Promise<void> {
    await writeJsonFile(
      this.#draftsPath,
      DraftDocumentSchema.parse({ schemaVersion: SCHEMA_VERSION, drafts })
    );
  }

  public async upsertDraft(draft: SemanticDraft): Promise<void> {
    await this.serializeMutation(async () => {
      const drafts = (await this.readDrafts()).filter(
        (item) => item.sourceId !== draft.sourceId
      );
      drafts.push(draft);
      await this.writeDrafts(drafts);
    });
  }

  public async readRegistry(): Promise<ComponentRegistry> {
    return ComponentRegistrySchema.parse(await readJsonFile(this.#registryPath));
  }

  public async writeRegistry(value: ComponentRegistry): Promise<void> {
    await writeJsonFile(this.#registryPath, ComponentRegistrySchema.parse(value));
  }

  public async approve(
    draft: SemanticDraft,
    approval: ApprovalInput
  ): Promise<ComponentRegistry> {
    return this.serializeMutation(async () => {
      const registry = approveDraft(draft, await this.readRegistry(), approval);
      await this.writeRegistry(registry);
      return registry;
    });
  }

  public async replaceLibrary(observations: ObservationDocument): Promise<void> {
    await this.serializeMutation(async () => {
      await this.writeObservations(observations);
      await this.writeDrafts([]);
      await this.writeRegistry({ schemaVersion: SCHEMA_VERSION, components: [] });
    });
  }

  private async ensureFile(path: string, create: () => Promise<unknown>): Promise<void> {
    try {
      await readFile(path);
    } catch (error: unknown) {
      if (!isMissingFile(error)) throw error;
      await writeJsonFile(path, await create());
    }
  }

  private async serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#mutationQueue.then(operation, operation);
    this.#mutationQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}

class HttpError extends Error {
  public constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}

function staticAsset(path: string): { file: string; contentType: string } | undefined {
  const assets: Record<string, { file: string; contentType: string }> = {
    "/": { file: "index.html", contentType: "text/html; charset=utf-8" },
    "/app.js": { file: "app.js", contentType: "text/javascript; charset=utf-8" },
    "/styles.css": { file: "styles.css", contentType: "text/css; charset=utf-8" }
  };
  return assets[path];
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 20 * 1024 * 1024) throw new HttpError(413, "请求内容过大。");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, "JSON 格式不正确。");
  }
}

async function readJsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporaryPath, path);
  } catch (error: unknown) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function countDescendants(node: ObservedNode): number {
  return node.children.reduce(
    (total, child) => total + 1 + countDescendants(child),
    0
  );
}

function assertTrustedMutation(request: IncomingMessage): void {
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.toLocaleLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "写操作只接受 application/json。");
  }
  const host = request.headers.host ?? "";
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host)) {
    throw new HttpError(403, "拒绝非本机请求。");
  }
  const origin = request.headers.origin;
  if (origin && origin !== `http://${host}`) {
    throw new HttpError(403, "拒绝跨站写操作。");
  }
}

function openBrowser(address: string): void {
  if (process.platform !== "win32") return;
  const child = spawn("cmd", ["/c", "start", "", address], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
}

async function run(): Promise<void> {
  const app = await createWorkbenchServer();
  const requestedPort = process.argv.includes("--check")
    ? 0
    : Number(process.env.PORT ?? 4317);
  try {
    const address = await app.listen(requestedPort);
    console.log(`UI AI Component Registry: ${address}`);
    if (process.argv.includes("--check")) {
      await app.close();
      console.log("Workbench launcher check passed.");
      return;
    }
    if (process.env.UI_AI_NO_OPEN !== "1") openBrowser(address);
  } catch (error: unknown) {
    if (isAddressInUse(error) && requestedPort === 4317) {
      const address = "http://127.0.0.1:4317";
      console.log(`UI AI Component Registry already running: ${address}`);
      if (process.env.UI_AI_NO_OPEN !== "1") openBrowser(address);
      return;
    }
    throw error;
  }
}

function isAddressInUse(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EADDRINUSE"
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
