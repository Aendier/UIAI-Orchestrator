import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  createOpenAICompatibleAgents,
  type ModelWireApi
} from "../ai/openai-compatible.js";
import {
  loadModelConfig,
  ModelBaseUrlSchema,
  type ModelConfigOptions
} from "../ai/model-config.js";
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
  modelFetch?: typeof fetch;
  model?: {
    baseUrl: string;
    apiKey: string;
    name: string;
    wireApi?: ModelWireApi;
  };
  modelConfig?: ModelConfigOptions;
}

export interface WorkbenchServer {
  listen(port?: number): Promise<string>;
  close(): Promise<void>;
}

const DraftDocumentSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  drafts: z.array(SemanticDraftSchema)
});

const WorkbenchStateSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  observations: ObservationDocumentSchema,
  drafts: DraftDocumentSchema,
  registry: ComponentRegistrySchema
});

type WorkbenchState = z.infer<typeof WorkbenchStateSchema>;

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
  baseUrl: ModelBaseUrlSchema,
  apiKey: z.string().min(1),
  model: z.string().min(1),
  wireApi: z.enum(["chat_completions", "responses"]).optional()
});

export async function createWorkbenchServer(
  options: WorkbenchOptions = {}
): Promise<WorkbenchServer> {
  const dataDirectory = resolve(options.dataDirectory ?? ".local");
  const fixturePath = resolve(options.fixturePath ?? "fixtures/bridge-components.json");
  const publicDirectory = resolve(options.publicDirectory ?? "public");
  const loadedModel = options.model
    ? {
        baseUrl: options.model.baseUrl,
        apiKey: options.model.apiKey,
        model: options.model.name,
        wireApi: options.model.wireApi ?? ("chat_completions" as const),
        requiresAuth: true,
        source: "options" as const
      }
    : await loadModelConfig(options.modelConfig);
  const agents =
    options.agents ??
    (loadedModel.apiKey || !loadedModel.requiresAuth
      ? createOpenAICompatibleAgents({
          baseUrl: loadedModel.baseUrl,
          apiKey: loadedModel.apiKey,
          model: loadedModel.model,
          wireApi: loadedModel.wireApi
        }, options.modelFetch)
      : undefined);
  const runtime = {
    agents,
    modelFetch: options.modelFetch,
    model: {
      ready: agents !== undefined,
      name: loadedModel.model,
      baseUrl: loadedModel.baseUrl,
      wireApi: loadedModel.wireApi,
      source: loadedModel.source
    }
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
        error instanceof HttpError
          ? error.status
          : authenticationFailure
            ? 502
            : error instanceof z.ZodError
              ? 400
              : 500;
      const message = authenticationFailure
        ? "模型服务认证失败，请打开模型设置检查地址、模型和密钥。"
        : error instanceof z.ZodError
          ? "Invalid request parameters."
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
      modelFetch: typeof fetch | undefined;
      model: {
        ready: boolean;
        name: string;
        baseUrl: string;
        wireApi: ModelWireApi;
        source: "browser" | "codex" | "default" | "environment" | "options";
      };
    };
  }
): Promise<void> {
  const method = request.method ?? "GET";
  const path = new URL(request.url ?? "/", "http://localhost").pathname;

  if (method === "POST") assertTrustedMutation(request);

  if (method === "GET" && path === "/api/state") {
    const { observations, drafts, registry } = await context.store.readSnapshot();
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
    const draft = await context.store.analyze(input.sourceId, context.runtime.agents);
    sendJson(response, 200, draft);
    return;
  }

  if (method === "POST" && path === "/api/approve") {
    const input = ApproveRequestSchema.parse(await readJsonBody(request));
    const registry = await context.store.approveBySource(input.sourceId, {
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
    const wireApi = input.wireApi ?? context.runtime.model.wireApi;
    context.runtime.agents = createOpenAICompatibleAgents({
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      model: input.model,
      wireApi
    }, context.runtime.modelFetch);
    context.runtime.model = {
      ready: true,
      name: input.model,
      baseUrl: input.baseUrl,
      wireApi,
      source: "browser"
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
  readonly #statePath: string;
  readonly #legacyObservationsPath: string;
  readonly #legacyDraftsPath: string;
  readonly #legacyRegistryPath: string;
  #mutationQueue: Promise<void> = Promise.resolve();

  public constructor(
    private readonly dataDirectory: string,
    private readonly fixturePath: string
  ) {
    this.#statePath = resolve(dataDirectory, "workbench.json");
    this.#legacyObservationsPath = resolve(dataDirectory, "observations.json");
    this.#legacyDraftsPath = resolve(dataDirectory, "drafts.json");
    this.#legacyRegistryPath = resolve(dataDirectory, "registry.json");
  }

  public async initialize(): Promise<void> {
    await mkdir(this.dataDirectory, { recursive: true });
    try {
      WorkbenchStateSchema.parse(await readJsonFile(this.#statePath));
    } catch (error: unknown) {
      if (!isMissingFile(error)) throw error;
      await writeJsonFile(this.#statePath, await this.createInitialState());
    }
  }

  public async readSnapshot(): Promise<{
    observations: ObservationDocument;
    drafts: SemanticDraft[];
    registry: ComponentRegistry;
  }> {
    const state = await this.readState();
    return {
      observations: state.observations,
      drafts: state.drafts.drafts,
      registry: state.registry
    };
  }

  public async readRegistry(): Promise<ComponentRegistry> {
    return (await this.readState()).registry;
  }

  public async analyze(sourceId: string, agents: AgentSet): Promise<SemanticDraft> {
    return this.serializeMutation(async () => {
      const state = await this.readState();
      const observation = state.observations.observations.find(
        (item) => item.root.sourceId === sourceId
      );
      if (!observation) throw new HttpError(404, "未找到这个组件。");
      const draft = await analyzeComponent({ observation, ...agents });
      const drafts = state.drafts.drafts.filter((item) => item.sourceId !== sourceId);
      drafts.push(draft);
      await this.writeState({
        ...state,
        drafts: { schemaVersion: SCHEMA_VERSION, drafts }
      });
      return draft;
    });
  }

  public async approveBySource(
    sourceId: string,
    approval: ApprovalInput
  ): Promise<ComponentRegistry> {
    return this.serializeMutation(async () => {
      const state = await this.readState();
      const draft = state.drafts.drafts.find((item) => item.sourceId === sourceId);
      if (!draft) {
        throw new HttpError(409, "请先完成 AI 分析，再进行人工批准。");
      }
      const registry = approveDraft(draft, state.registry, approval);
      await this.writeState({ ...state, registry });
      return registry;
    });
  }

  public async replaceLibrary(observations: ObservationDocument): Promise<void> {
    await this.serializeMutation(async () => {
      await this.writeState({
        schemaVersion: SCHEMA_VERSION,
        observations,
        drafts: { schemaVersion: SCHEMA_VERSION, drafts: [] },
        registry: { schemaVersion: SCHEMA_VERSION, components: [] }
      });
    });
  }

  private async readState(): Promise<WorkbenchState> {
    return WorkbenchStateSchema.parse(await readJsonFile(this.#statePath));
  }

  private async writeState(state: WorkbenchState): Promise<void> {
    await writeJsonFile(this.#statePath, WorkbenchStateSchema.parse(state));
  }

  private async createInitialState(): Promise<WorkbenchState> {
    const [legacyObservations, legacyDrafts, legacyRegistry] = await Promise.all([
      readOptionalJson(this.#legacyObservationsPath, ObservationDocumentSchema),
      readOptionalJson(this.#legacyDraftsPath, DraftDocumentSchema),
      readOptionalJson(this.#legacyRegistryPath, ComponentRegistrySchema)
    ]);
    return WorkbenchStateSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      observations:
        legacyObservations ??
        adaptBridgeDocument(await readJsonFile(this.fixturePath)),
      drafts: legacyDrafts ?? { schemaVersion: SCHEMA_VERSION, drafts: [] },
      registry: legacyRegistry ?? { schemaVersion: SCHEMA_VERSION, components: [] }
    });
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

async function readOptionalJson<T>(
  path: string,
  schema: z.ZodType<T>
): Promise<T | undefined> {
  try {
    return schema.parse(await readJsonFile(path));
  } catch (error: unknown) {
    if (isMissingFile(error)) return undefined;
    throw error;
  }
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
    console.log(`UIAI Orchestrator - Component Registry: ${address}`);
    if (process.argv.includes("--check")) {
      await app.close();
      console.log("Workbench launcher check passed.");
      return;
    }
    if (process.env.UI_AI_NO_OPEN !== "1") openBrowser(address);
  } catch (error: unknown) {
    if (isAddressInUse(error) && requestedPort === 4317) {
      const address = "http://127.0.0.1:4317";
      console.log(`UIAI Orchestrator - Component Registry already running: ${address}`);
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
