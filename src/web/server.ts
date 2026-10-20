import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createObservationFingerprint, createDefinitionFingerprint, matchesComponentRevision } from "../shared/fingerprint.js";
import { PageStore, PageError, type PagePlanner } from "../pages/store.js";
import { createPagePlanner } from "../pages/model.js";
import { handlePageRequest } from "../pages/http.js";
import { UsageStore } from "../ai/usage.js";

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
  pagePlanner?: PagePlanner;
  modelFetch?: typeof fetch;
  unityFetch?: typeof fetch;
  model?: {
    baseUrl: string;
    apiKey: string;
    name: string;
    wireApi?: ModelWireApi;
  };
  modelConfig?: ModelConfigOptions;
  modelCatalogPath?: string;
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
const SourceIdRequestSchema = z.object({ sourceId: z.string().min(1) });
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
  apiKey: z.string().optional(),
  model: z.string().min(1),
  wireApi: z.enum(["chat_completions", "responses"]).optional()
});
const ModelCatalogRequestSchema = z.object({
  baseUrl: ModelBaseUrlSchema,
  apiKey: z.string().optional()
});
const UnitySyncRequestSchema = z.object({
  port: z.number().int().min(1024).max(65535).default(4380),
  objectName: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1).max(200))
    .optional()
});
export async function createWorkbenchServer(
  options: WorkbenchOptions = {}
): Promise<WorkbenchServer> {
  const dataDirectory = resolve(options.dataDirectory ?? ".local");
  const fixturePath = resolve(options.fixturePath ?? "fixtures/bridge-components.json");
  const publicDirectory = resolve(options.publicDirectory ?? "public");
  const usage = new UsageStore(dataDirectory);
  await usage.initialize();
  const loadedModel = options.model
    ? {
        baseUrl: options.model.baseUrl,
        apiKey: options.model.apiKey,
        model: options.model.name,
        wireApi: options.model.wireApi ?? ("chat_completions" as const),
        requiresAuth: true,
        source: "options" as const
      }
    : await loadModelConfig({
        ...options.modelConfig,
        credentialCachePath: options.modelConfig?.credentialCachePath ?? resolve(dataDirectory, "aioa-credential.dpapi")
      });
  const usesCodexProvider = loadedModel.source === "codex" || loadedModel.source === "aioa-cache";
  const modelCatalogPath = options.modelCatalogPath ?? process.env.CODEX_MODEL_CATALOG_JSON ??
    (usesCodexProvider ? await findLatestCodexModelCatalog() : undefined);
  const agents =
    options.agents ??
    (loadedModel.apiKey || !loadedModel.requiresAuth
      ? createOpenAICompatibleAgents({
          baseUrl: loadedModel.baseUrl,
          apiKey: loadedModel.apiKey,
          model: loadedModel.model,
          wireApi: loadedModel.wireApi
        }, options.modelFetch, usage.recordCall)
      : undefined);
  const runtime = {
    agents,
    pagePlanner: options.pagePlanner ?? (loadedModel.apiKey || !loadedModel.requiresAuth ? createPagePlanner({
      baseUrl: loadedModel.baseUrl, apiKey: loadedModel.apiKey, model: loadedModel.model, wireApi: loadedModel.wireApi
    }, options.modelFetch, usage.recordCall) : undefined),
    modelFetch: options.modelFetch,
    modelCredentials: {
      apiKey: loadedModel.apiKey,
      requiresAuth: loadedModel.requiresAuth,
      allowCatalogFallback: Boolean(modelCatalogPath) &&
        (usesCodexProvider || loadedModel.source === "options")
    },
    modelCatalogPath,
    unityFetch: options.unityFetch ?? fetch,
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
  const pages = new PageStore(dataDirectory, () => store.readSnapshot());
  await pages.initialize();

  const server = createServer(async (request, response) => {
    try {
      await routeRequest(request, response, {
        store,
        pages,
        usage,
        publicDirectory,
        runtime
      });
    } catch (error: unknown) {
      const authenticationFailure =
        error instanceof Error && error.message.includes("HTTP 401");
      const status =
        error instanceof HttpError || error instanceof PageError
          ? error.status
          : authenticationFailure
            ? 502
            : error instanceof z.ZodError
              ? 400
              : 500;
      const message = authenticationFailure
        ? "模型服务认证失败（HTTP 401）。凭据可能已失效，请从 AIOA 更新一次内置凭据后再双击启动，或在模型设置中填写有效的 API Key。"
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
    pages: PageStore;
    usage: UsageStore;
    publicDirectory: string;
      runtime: {
        agents: AgentSet | undefined;
        pagePlanner: PagePlanner | undefined;
        modelFetch: typeof fetch | undefined;
        modelCredentials: {
          apiKey: string;
          requiresAuth: boolean;
          allowCatalogFallback: boolean;
        };
        modelCatalogPath: string | undefined;
        unityFetch: typeof fetch;
        model: {
        ready: boolean;
        name: string;
        baseUrl: string;
        wireApi: ModelWireApi;
        source: "browser" | "codex" | "aioa-cache" | "default" | "environment" | "options";
      };
    };
  }
): Promise<void> {
  const method = request.method ?? "GET";
  const path = new URL(request.url ?? "/", "http://localhost").pathname;

  if (method === "POST") assertTrustedMutation(request);

  if (await handlePageRequest(request, response, {
    pages: context.pages, usage: context.usage, planner: context.runtime.pagePlanner,
    readBody: () => readJsonBody(request, 16 * 1024 * 1024), send: value => sendJson(response, 200, value)
  })) return;

  if (method === "GET" && path === "/api/usage") {
    sendJson(response, 200, context.usage.report());
    return;
  }

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
        items: observations.observations.map((observation) => {
          const approved = approvedBySource.get(observation.root.sourceId);
          return {
            sourceId: observation.root.sourceId,
            name: observation.root.name,
            nodeType: observation.root.nodeType,
            componentRef: observation.root.componentRef,
            bounds: observation.root.bounds,
            childCount: countDescendants(observation.root),
            hasText: hasObservedNode(observation.root, (node) => Boolean(node.text?.characters.trim())),
            hasImage: hasObservedNode(
              observation.root,
              (node) => /IMAGE|SPRITE/i.test(node.nodeType) ||
                Boolean(node.componentRef?.componentTypes.some((type) => /^(Image|RawImage|SpriteRenderer)$/i.test(type)))
            ),
            hasBackgroundFill: Boolean(
              observation.root.style?.backgroundColor || observation.root.style?.fillType
            ),
            opacity: observation.root.opacity,
            hasPreview: Boolean(observation.root.imageBase64),
            enginePresence: observation.enginePresence ?? "unknown",
            lastSeenAt: observation.lastSeenAt,
            missingSince: observation.missingSince,
            draft: draftBySource.get(observation.root.sourceId),
            analysis: context.usage.component(observation.root.sourceId, draftBySource.get(observation.root.sourceId)?.observationFingerprint),
            approved,
            approvedChanged: Boolean(
              approved && (approved.observationFingerprint || approved.definitionFingerprint) &&
              !matchesComponentRevision(observation, approved)
            )
          };
        })
      },
      registry: { total: registry.components.length, components: registry.components }
    });
    return;
  }

  const previewMatch = path.match(/^\/api\/observations\/([^/]+)\/preview$/);
  if (method === "GET" && previewMatch) {
    const sourceId = decodePathSegment(previewMatch[1]!);
    const { observations } = await context.store.readSnapshot();
    const image = observations.observations.find(
      (item) => item.root.sourceId === sourceId
    )?.root.imageBase64;
    if (!image) throw new HttpError(404, "这个组件没有预览。");
    const bytes = decodePng(image);
    response.writeHead(200, {
      "content-type": "image/png",
      "cache-control": "no-store"
    });
    response.end(bytes);
    return;
  }

  if (method === "POST" && path === "/api/analyze") {
    if (!context.runtime.agents) {
      throw new HttpError(409, "当前进程没有模型密钥，请从 AIOA 会话启动工作台。");
    }
    const input = AnalyzeRequestSchema.parse(await readJsonBody(request));
    const controller = new AbortController();
    const abort = () => controller.abort();
    const closed = () => { if (!response.writableEnded) abort(); };
    request.once("aborted", abort);
    response.once("close", closed);
    try {
      const { observations } = await context.store.readSnapshot();
      const observation = observations.observations.find(item => item.root.sourceId === input.sourceId);
      if (!observation) throw new HttpError(404, "未找到这个组件。");
      const agents = context.runtime.agents;
      const draft = await context.usage.track("component_analysis", input.sourceId, observation.root.name,
        () => context.store.analyze(input.sourceId, agents, controller.signal));
      if (controller.signal.aborted || response.destroyed) return;
      sendJson(response, 200, draft);
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) return;
      throw error;
    } finally {
      request.off("aborted", abort);
      response.off("close", closed);
    }
    return;
  }

  if (method === "POST" && path === "/api/approval/revoke") {
    const input = SourceIdRequestSchema.parse(await readJsonBody(request));
    await context.store.revokeApproval(input.sourceId);
    sendJson(response, 200, { revoked: true, sourceId: input.sourceId });
    return;
  }

  if (method === "POST" && path === "/api/approval/reset") {
    const input = SourceIdRequestSchema.parse(await readJsonBody(request));
    await context.store.resetReview(input.sourceId);
    sendJson(response, 200, { reset: true, sourceId: input.sourceId });
    return;
  }

  if (method === "POST" && path === "/api/observation/delete") {
    const input = SourceIdRequestSchema.parse(await readJsonBody(request));
    await context.store.deleteComponent(input.sourceId);
    sendJson(response, 200, { deleted: true, sourceId: input.sourceId });
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

  if (method === "POST" && path === "/api/models") {
    const input = ModelCatalogRequestSchema.parse(await readJsonBody(request));
    const sameBaseUrl = input.baseUrl === context.runtime.model.baseUrl;
    const apiKey = input.apiKey?.trim() || (sameBaseUrl ? context.runtime.modelCredentials.apiKey : "");
    if (!apiKey && context.runtime.modelCredentials.requiresAuth) {
      throw new HttpError(409, "读取模型列表需要 API Key。当前服务地址不变时可以直接复用已配置的密钥。");
    }
    let models: string[];
    let source: "provider" | "codex-cache" = "provider";
    try {
      models = await fetchModelCatalog(
        context.runtime.modelFetch ?? fetch,
        input.baseUrl,
        apiKey
      );
    } catch (error) {
      if (!context.runtime.modelCatalogPath || !sameBaseUrl || input.apiKey?.trim() ||
        !context.runtime.modelCredentials.allowCatalogFallback) throw error;
      models = await readCodexModelCatalog(context.runtime.modelCatalogPath);
      if (!models.length) throw error;
      source = "codex-cache";
    }
    sendJson(response, 200, { models, source });
    return;
  }

  if (method === "POST" && path === "/api/model") {
    const input = ModelRequestSchema.parse(await readJsonBody(request));
    const wireApi = input.wireApi ?? context.runtime.model.wireApi;
    const sameBaseUrl = input.baseUrl === context.runtime.model.baseUrl;
    const apiKey = input.apiKey?.trim() || (sameBaseUrl ? context.runtime.modelCredentials.apiKey : "");
    const canUseWithoutAuth = sameBaseUrl && !context.runtime.modelCredentials.requiresAuth;
    if (!apiKey && !canUseWithoutAuth) {
      throw new HttpError(409, "当前服务需要 API Key；如果只是切换模型，可以复用当前服务地址的已有密钥。");
    }
    context.runtime.agents = createOpenAICompatibleAgents({
      baseUrl: input.baseUrl,
      apiKey,
      model: input.model,
      wireApi
    }, context.runtime.modelFetch, context.usage.recordCall);
    context.runtime.modelCredentials = {
      apiKey,
      requiresAuth: !canUseWithoutAuth,
      allowCatalogFallback: sameBaseUrl && !input.apiKey?.trim() &&
        context.runtime.modelCredentials.allowCatalogFallback
    };
    context.runtime.model = {
      ready: true,
      name: input.model,
      baseUrl: input.baseUrl,
      wireApi,
      source: "browser"
    };
    context.runtime.pagePlanner = createPagePlanner({ baseUrl: input.baseUrl, apiKey, model: input.model, wireApi }, context.runtime.modelFetch, context.usage.recordCall);
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

  if (method === "POST" && path === "/api/sync") {
    const imported = adaptBridgeDocument(await readJsonBody(request, 100 * 1024 * 1024));
    const result = await context.store.syncLibrary(imported);
    sendJson(response, 200, {
      ...result,
      clearedDrafts: false,
      clearedRegistry: false
    });
    return;
  }

  if (method === "POST" && path === "/api/sync/unity") {
    const input = UnitySyncRequestSchema.parse(await readJsonBody(request));
    let exported: unknown;
    try {
      exported = await fetchUnityDocument(
        context.runtime.unityFetch,
        input.port,
        input.objectName
      );
    } catch (error: unknown) {
      if (error instanceof HttpError && error.status === 404 && input.objectName) {
        await context.store.markUnityObjectMissing(input.objectName);
      }
      throw error;
    }
    if (
      isRecord(exported) &&
      Object.prototype.hasOwnProperty.call(exported, "port") &&
      exported.port !== input.port
    ) {
      throw new HttpError(502, "Unity 导出的端口与请求端口不一致。");
    }

    let imported: ObservationDocument;
    try {
      imported = adaptBridgeDocument(exported);
    } catch (error: unknown) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, "Unity 导出不是带节点的 Bridge 0.1.0 文档。");
    }

    let result: { updated: number; added: number };
    try {
      result = await context.store.syncLibrary(imported);
    } catch (error: unknown) {
      if (error instanceof HttpError && error.status === 400) {
        throw new HttpError(502, "Unity 导出包含无效或重复的 prefabGuid。");
      }
      throw error;
    }
    sendJson(response, 200, {
      ...result,
      clearedDrafts: false,
      clearedRegistry: false
    });
    return;
  }

  if (method === "POST" && path === "/api/unity/test") {
    const input = UnitySyncRequestSchema.parse(await readJsonBody(request));
    const exported = await fetchUnityDocument(context.runtime.unityFetch, input.port);
    if (
      isRecord(exported) &&
      Object.prototype.hasOwnProperty.call(exported, "port") &&
      exported.port !== input.port
    ) {
      throw new HttpError(502, "Unity 瀵煎嚭鐨勭鍙ｄ笌璇锋眰绔彛涓嶄竴鑷淬€?");
    }
    let imported: ObservationDocument;
    try {
      imported = adaptBridgeDocument(exported);
    } catch (error: unknown) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, "Unity 瀵煎嚭涓嶆槸甯﹁妭鐐圭殑 Bridge 0.1.0 鏂囨。銆?");
    }
    sendJson(response, 200, {
      connected: true,
      port: input.port,
      components: imported.observations.length
    });
    return;
  }

  if (method === "GET") {
    const asset = staticAsset(path);
    if (asset) {
      let body: Buffer;
      try {
        body = await readFile(resolve(context.publicDirectory, asset.file));
      } catch (error: unknown) {
        if (isFileNotFound(error)) throw new HttpError(404, "Not found.");
        throw error;
      }
      response.writeHead(200, {
        "content-type": asset.contentType,
        "cache-control": "no-store"
      });
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

  public async analyze(
    sourceId: string,
    agents: AgentSet,
    signal?: AbortSignal
  ): Promise<SemanticDraft> {
    return this.serializeMutation(async () => {
      if (signal?.aborted) {
        const error = new Error("Analysis aborted");
        error.name = "AbortError";
        throw error;
      }
      const state = await this.readState();
      const observation = state.observations.observations.find(
        (item) => item.root.sourceId === sourceId
      );
      if (!observation) throw new HttpError(404, "未找到这个组件。");
      const draft = await analyzeComponent({ observation, ...agents, signal });
      if (signal?.aborted) {
        const error = new Error("Analysis aborted");
        error.name = "AbortError";
        throw error;
      }
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
      const observation = state.observations.observations.find(
        (item) => item.root.sourceId === sourceId
      );
      if (!observation) throw new HttpError(404, "未找到这个组件。");
      const currentFingerprint = createObservationFingerprint(observation);
      if ((draft.observationFingerprint || draft.definitionFingerprint) && !matchesComponentRevision(observation, draft)) {
        throw new HttpError(409, "组件内容已变化，请重新运行分析后再批准。");
      }
      const registry = approveDraft(draft, state.registry, {
        ...approval,
        observationFingerprint: currentFingerprint,
        ...(observation.root.componentRef?.assetDependencyHash
          ? { definitionFingerprint: createDefinitionFingerprint(observation) } : {})
      });
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

  public async revokeApproval(sourceId: string): Promise<void> {
    await this.serializeMutation(async () => {
      const state = await this.readState();
      const hasApproval = state.registry.components.some((entry) => entry.sourceId === sourceId);
      if (!hasApproval) throw new HttpError(404, "这个组件没有已批准结论。");
      await this.writeState({
        ...state,
        registry: {
          ...state.registry,
          components: state.registry.components.filter((entry) => entry.sourceId !== sourceId)
        }
      });
    });
  }

  public async resetReview(sourceId: string): Promise<void> {
    await this.serializeMutation(async () => {
      const state = await this.readState();
      const exists =
        state.observations.observations.some((item) => item.root.sourceId === sourceId) ||
        state.drafts.drafts.some((item) => item.sourceId === sourceId) ||
        state.registry.components.some((entry) => entry.sourceId === sourceId);
      if (!exists) throw new HttpError(404, "未找到这个组件。");
      await this.writeState({
        ...state,
        drafts: {
          ...state.drafts,
          drafts: state.drafts.drafts.filter((item) => item.sourceId !== sourceId)
        },
        registry: {
          ...state.registry,
          components: state.registry.components.filter((entry) => entry.sourceId !== sourceId)
        }
      });
    });
  }

  public async deleteComponent(sourceId: string): Promise<void> {
    await this.serializeMutation(async () => {
      const state = await this.readState();
      const exists = state.observations.observations.some((item) => item.root.sourceId === sourceId) ||
        state.drafts.drafts.some((item) => item.sourceId === sourceId) ||
        state.registry.components.some((entry) => entry.sourceId === sourceId);
      if (!exists) throw new HttpError(404, "未找到这个组件。");
      await this.writeState({
        ...state,
        observations: {
          ...state.observations,
          observations: state.observations.observations.filter(
            (item) => item.root.sourceId !== sourceId
          )
        },
        drafts: {
          ...state.drafts,
          drafts: state.drafts.drafts.filter((item) => item.sourceId !== sourceId)
        },
        registry: {
          ...state.registry,
          components: state.registry.components.filter((entry) => entry.sourceId !== sourceId)
        }
      });
    });
  }

  public async syncLibrary(
    incoming: ObservationDocument
  ): Promise<{ updated: number; added: number }> {
    return this.serializeMutation(async () => {
      const seen = new Set<string>();
      for (const observation of incoming.observations) {
        const prefabGuid = observation.root.componentRef?.prefabGuid;
        if (!prefabGuid || prefabGuid.includes("/") || seen.has(prefabGuid)) {
          throw new HttpError(400, "每个同步组件都需要唯一且不含 / 的 prefabGuid。");
        }
        seen.add(prefabGuid);
      }
      const state = await this.readState();
      const observedAt = new Date().toISOString();
      const replacements = new Map(
        incoming.observations.map((observation) => [
          observation.root.sourceId,
          {
            ...observation,
            enginePresence: "present" as const,
            lastSeenAt: observedAt,
            missingSince: undefined
          }
        ])
      );
      let updated = 0;
      const merged = state.observations.observations.map((observation) => {
        const replacement = replacements.get(observation.root.sourceId);
        if (!replacement) return observation;
        updated += 1;
        replacements.delete(observation.root.sourceId);
        return replacement;
      });
      const added = [...replacements.values()];
      await this.writeState({
        ...state,
        observations: {
          ...state.observations,
          observations: [...merged, ...added]
        }
      });
      return { updated, added: added.length };
    });
  }

  public async markUnityObjectMissing(objectName: string): Promise<number> {
    return this.serializeMutation(async () => {
      const state = await this.readState();
      const missingSince = new Date().toISOString();
      let changed = 0;
      const observations = state.observations.observations.map((observation) => {
        if (observation.root.name !== objectName) return observation;
        if (observation.enginePresence === "missing") return observation;
        changed += 1;
        return {
          ...observation,
          enginePresence: "missing" as const,
          missingSince: observation.missingSince ?? missingSince
        };
      });
      if (changed === 0) return 0;
      await this.writeState({
        ...state,
        observations: {
          ...state.observations,
          observations
        }
      });
      return changed;
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

async function fetchModelCatalog(
  fetchImpl: typeof fetch,
  baseUrl: string,
  apiKey: string
): Promise<string[]> {
  let response: Response;
  try {
    response = await withTimeout(
      Promise.resolve(fetchImpl(`${baseUrl.replace(/\/$/, "")}/models`, {
        method: "GET",
        ...(apiKey ? { headers: { authorization: `Bearer ${apiKey}` } } : {})
      })),
      15_000,
      () => new HttpError(504, "读取模型列表超时，请检查服务地址。")
    );
  } catch (error: unknown) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, "无法连接模型服务，请检查服务地址。 ");
  }

  if (response.status === 401) {
    throw new Error("模型列表请求失败 HTTP 401");
  }
  if (response.status === 404) {
    throw new HttpError(502, "当前模型服务没有提供 /models 模型列表接口。");
  }
  if (!response.ok) {
    throw new HttpError(502, `读取模型列表失败（HTTP ${response.status}）。`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new HttpError(502, "模型服务返回的模型列表不是有效 JSON。");
  }
  const entries = Array.isArray(body)
    ? body
    : isRecord(body) && Array.isArray(body.data)
      ? body.data
      : isRecord(body) && Array.isArray(body.models)
        ? body.models
        : undefined;
  if (!entries) throw new HttpError(502, "模型服务返回的模型列表格式无法识别。");

  return [...new Set(entries
    .map((entry) => typeof entry === "string" ? entry : isRecord(entry) && typeof entry.id === "string" ? entry.id : "")
    .map((id) => id.trim())
    .filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

async function findLatestCodexModelCatalog(): Promise<string | undefined> {
  const root = tmpdir();
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return undefined;
  }
  const candidates: Array<{ path: string; modified: number }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^aioa-codex-models-/i.test(entry.name)) continue;
    const path = resolve(root, entry.name, "models.json");
    try {
      const details = await stat(path);
      candidates.push({ path, modified: details.mtimeMs });
    } catch {
      // A catalog can disappear while the host is refreshing it.
    }
  }
  return candidates.sort((left, right) => right.modified - left.modified)[0]?.path;
}

async function readCodexModelCatalog(path: string): Promise<string[]> {
  let body: unknown;
  try {
    body = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    return [];
  }
  if (!isRecord(body) || !Array.isArray(body.models)) return [];
  return [...new Set(body.models
    .filter((model): model is Record<string, unknown> => isRecord(model))
    .filter((model) => model.visibility !== "hidden" && model.supported_in_api !== false)
    .map((model) => typeof model.slug === "string" ? model.slug : typeof model.id === "string" ? model.id : "")
    .map((id) => id.trim())
    .filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

async function fetchUnityDocument(
  unityFetch: typeof fetch,
  port: number,
  objectName?: string
): Promise<unknown> {
  const url = objectName
    ? `http://127.0.0.1:${port}/export?objectName=${encodeURIComponent(objectName)}`
    : `http://127.0.0.1:${port}/export`;
  let response: Response;
  try {
    response = await withTimeout(
      Promise.resolve(unityFetch(url)),
      objectName ? 30_000 : 120_000,
      () => new HttpError(504, objectName ? "导出超时，请核对端口。" : "批量导出超时，请检查 Unity 状态和端口。")
    );
  } catch (error: unknown) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, "请在 Unity 的 UIR/Figma Bridge 窗口点 Start。");
  }

  if (response.status === 404) {
    if (!objectName) throw new HttpError(404, "已加载场景中没有可同步的 Prefab 组件。");
    throw new HttpError(404, `找不到名为“${objectName}”的物体。`);
  }
  if (response.status === 409) {
    if (!objectName) throw new HttpError(409, "Unity 场景中有重复的 Prefab GUID，无法确定要同步哪个实例。");
    throw new HttpError(409, "有多个同名物体，要求名称唯一。");
  }
  if (response.status === 503) {
    throw new HttpError(503, "Unity 本机服务未就绪。");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(await response.text()) as unknown;
  } catch {
    throw new HttpError(502, "Unity 导出响应不是有效的 JSON。");
  }

  const errorCode = isRecord(payload) && typeof payload.error === "string"
    ? payload.error
    : undefined;
  if (errorCode === "target_not_found") {
    throw new HttpError(404, `找不到名为“${objectName}”的物体。`);
  }
  if (errorCode === "target_name_ambiguous") {
    throw new HttpError(409, "有多个同名物体，要求名称唯一。");
  }
  if (errorCode === "target_name_required") {
    throw new HttpError(502, "当前 Unity Bridge 不支持自动导出，请更新 Bridge 后重试。");
  }
  if (response.status >= 400) {
    throw new HttpError(502, `Unity 导出失败（HTTP ${response.status}）。`);
  }
  return payload;
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  createError: () => Error
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(createError()), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFileNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function staticAsset(path: string): { file: string; contentType: string } | undefined {
  const assets: Record<string, { file: string; contentType: string }> = {
    "/": { file: "index.html", contentType: "text/html; charset=utf-8" },
    "/app.js": { file: "app.js", contentType: "text/javascript; charset=utf-8" },
    "/library-view.js": { file: "library-view.js", contentType: "text/javascript; charset=utf-8" },
    "/page-planner.js": { file: "page-planner.js", contentType: "text/javascript; charset=utf-8" },
    "/page-editor.js": { file: "page-editor.js", contentType: "text/javascript; charset=utf-8" },
    "/lucide.js": { file: "../node_modules/lucide/dist/umd/lucide.js", contentType: "text/javascript; charset=utf-8" },
    "/styles.css": { file: "styles.css", contentType: "text/css; charset=utf-8" },
    "/usage-view.js": { file: "usage-view.js", contentType: "text/javascript; charset=utf-8" },
    "/usage-dashboard.js": { file: "usage-dashboard.js", contentType: "text/javascript; charset=utf-8" }
  };
  if (assets[path]) return assets[path];

  // Keep newly added browser modules available without another server route edit.
  // Only serve a single safe filename from the public directory; API/data files
  // and traversal paths must continue to fall through to the 404 handler.
  if (!/^\/[A-Za-z0-9][A-Za-z0-9._-]*\.(?:js|css|html)$/.test(path)) return undefined;
  const extension = extname(path).toLowerCase();
  const contentType = extension === ".js"
    ? "text/javascript; charset=utf-8"
    : extension === ".css"
      ? "text/css; charset=utf-8"
      : "text/html; charset=utf-8";
  return { file: path.slice(1), contentType };
}

async function readJsonBody(request: IncomingMessage, maxBytes = 20 * 1024 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new HttpError(413, "请求内容过大。");
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

function decodePng(imageBase64: string): Buffer {
  const bytes = Buffer.from(imageBase64, "base64");
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (
    bytes.length < signature.length ||
    !bytes.subarray(0, signature.length).equals(signature)
  ) {
    throw new HttpError(415, "预览必须是 PNG。");
  }
  return bytes;
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

function decodePathSegment(value: string): string {
  return decodeURIComponent(value);
}

function countDescendants(node: ObservedNode): number {
  // The package declaration widens children; stored Observations are schema-validated.
  return (node.children as ObservedNode[]).reduce(
    (total, child) => total + 1 + countDescendants(child),
    0
  );
}

function hasObservedNode(node: ObservedNode, predicate: (node: ObservedNode) => boolean): boolean {
  return predicate(node) || (node.children as ObservedNode[]).some((child) => hasObservedNode(child, predicate));
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
