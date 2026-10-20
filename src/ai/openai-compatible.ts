import { z } from "zod";
import { randomUUID } from "node:crypto";
import { describeAnalysisError, redactModelError } from "./diagnostics.js";
import { readTokenUsage, type ModelCall, type ModelCallObserver } from "./usage.js";

import type { ComponentObservation, ObservedNode } from "../observation/index.js";
import {
  CapabilitySchema,
  SemanticRoleSchema,
  SemanticTypeSchema,
  type AnalysisAgent,
  type SemanticAdjudicator,
  type SemanticProposal
} from "../semantic/index.js";

export type ModelWireApi = "chat_completions" | "responses";

export interface OpenAICompatibleConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  wireApi?: ModelWireApi;
}

export function createOpenAICompatibleAgents(
  config: OpenAICompatibleConfig,
  fetchImpl: typeof fetch = fetch,
  observe?: ModelCallObserver
): {
  structuralAgent: AnalysisAgent;
  visualAgent: AnalysisAgent;
  adjudicator: SemanticAdjudicator;
} {
  const client = new OpenAICompatibleClient(config, fetchImpl, observe);
  return {
    structuralAgent: {
      analyze: (observation, signal) =>
        client.complete(
          analysisPrompt("结构分析", "只根据节点树、组件类型、命名、布局和层级推断。"),
          observationMessage(observation, false),
          signal,
          "structural"
        )
    },
    visualAgent: {
      analyze: (observation, signal) =>
        client.complete(
          analysisPrompt("视觉分析", "优先根据截图、尺寸、文本和视觉样式推断，不得臆造不可见结构。"),
          observationMessage(observation, true),
          signal,
          "visual"
        )
    },
    adjudicator: {
      adjudicate: ({ observation, structural, visual }, signal) =>
        client.complete(
          analysisPrompt(
            "冲突裁决",
            "比较两个独立提案，只能根据引用证据裁决；证据不足时降低置信度。"
          ),
          JSON.stringify({
            observation: sanitizeObservation(observation),
            proposals: { structural, visual }
          }),
          signal,
          "adjudication"
        )
    }
  };
}

export class OpenAICompatibleClient {
  readonly #endpoint: string;
  readonly #provider: string | null;

  public constructor(
    private readonly config: OpenAICompatibleConfig,
    private readonly fetchImpl: typeof fetch,
    private readonly observe?: ModelCallObserver
  ) {
    const resource = config.wireApi === "responses" ? "responses" : "chat/completions";
    this.#endpoint = `${config.baseUrl.replace(/\/$/, "")}/${resource}`;
    // Persist only the service host, never URL credentials, paths or query strings.
    try { this.#provider = new URL(config.baseUrl).host; }
    catch { this.#provider = null; }
  }

  public async complete(
    systemPrompt: string,
    userContent: unknown,
    signal?: AbortSignal,
    stage = "model"
  ): Promise<unknown> {
    const started = Date.now();
    const call: ModelCall = { id: randomUUID(), stage, model: this.config.model,
      provider: this.#provider,
      wireApi: this.config.wireApi ?? "chat_completions", startedAt: new Date(started).toISOString(),
      finishedAt: null, durationMs: 0, status: "running", httpStatus: null,
      tokens: readTokenUsage(null), error: null };
    try {
      await this.observe?.(call);
      const usingResponsesApi = this.config.wireApi === "responses";
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (this.config.apiKey) headers.authorization = `Bearer ${this.config.apiKey}`;
      const response = await this.fetchImpl(this.#endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(
          usingResponsesApi
            ? {
                model: this.config.model,
                instructions: systemPrompt,
                input: [
                  {
                    role: "user",
                    content: [
                      { type: "input_text", text: "Return only one JSON object." },
                      ...toResponsesContent(userContent)
                    ]
                  }
                ],
                text: { format: { type: "json_object" } }
              }
            : {
                model: this.config.model,
                temperature: 0,
                response_format: { type: "json_object" },
                messages: [
                  { role: "system", content: systemPrompt },
                  { role: "user", content: userContent }
                ]
              }
        ),
        ...(signal ? { signal } : {})
      });

      call.httpStatus = response.status;
      const responseBody: unknown = await response.json().catch(() => {
        if (response.ok) throw new Error("模型服务返回的响应不是有效的 JSON。");
        return null;
      });
      call.tokens = readTokenUsage(responseBody);
      const body = responseBody && typeof responseBody === "object" ? responseBody as Record<string, unknown> : {};
      if (typeof body.model === "string") call.model = body.model;
      const providerError = body.error && typeof body.error === "object" ? body.error as Record<string, unknown> : {};
      const providerReason = [providerError.code, providerError.message].filter(value => typeof value === "string").join(": ");
      if (!response.ok) {
        const hint = response.status === 401 ? "请检查模型地址和密钥。"
          : response.status === 429 ? "请求过于频繁或额度不足，请检查模型服务。"
          : response.status >= 500 ? "模型服务暂时不可用，可稍后重试。" : "请检查模型服务的错误说明。";
        throw new Error(`模型请求失败 HTTP ${response.status}：${providerReason || hint}`);
      }
      if (body.status === "failed" || body.status === "incomplete" || body.error) {
        const incomplete = body.incomplete_details as { reason?: unknown } | undefined;
        throw new Error(`模型未完成输出：${providerReason || incomplete?.reason || String(body.status)}。`);
      }
      if (usingResponsesApi) {
        const payload = ResponsesApiResponseSchema.parse(responseBody);
        const outputText =
          payload.output_text?.trim() ||
          payload.output
            .flatMap((item) => item.content ?? [])
            .find((item) => item.type === "output_text")?.text;
        if (!outputText) {
          throw new Error("Model response did not contain output text.");
        }
        return JSON.parse(outputText) as unknown;
      }

      const payload = CompletionResponseSchema.parse(responseBody);
      const firstChoice = payload.choices[0];
      if (firstChoice === undefined) {
        throw new Error("Model response did not contain a completion choice.");
      }
      return JSON.parse(firstChoice.message.content) as unknown;
    } catch (error) {
      call.status = signal?.aborted || (error instanceof Error && error.name === "AbortError") ? "cancelled" : "failed";
      call.error = redactModelError(describeAnalysisError(error, "模型服务响应"), this.config.apiKey);
      const failure = new Error(call.error);
      if (call.status === "cancelled") failure.name = "AbortError";
      throw failure;
    } finally {
      if (call.status === "running") call.status = "succeeded";
      call.finishedAt = new Date().toISOString();
      call.durationMs = Math.max(0, Date.now() - started);
      await this.observe?.(call);
    }
  }
}

const CompletionResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().min(1) })
      })
    )
    .min(1)
});

const ResponsesApiResponseSchema = z.object({
  output_text: z.string().optional(),
  output: z
    .array(
      z.object({
        content: z.array(
          z.object({
            type: z.string(),
            text: z.string().optional()
          })
        ).optional()
      })
    )
    .default([])
});

type ResponsesInputContent =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string };

function toResponsesContent(content: unknown): ResponsesInputContent[] {
  if (!Array.isArray(content)) {
    return [{ type: "input_text", text: String(content) }];
  }
  const converted: ResponsesInputContent[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object" || !("type" in part)) continue;
    if (part.type === "text" && "text" in part && typeof part.text === "string") {
      converted.push({ type: "input_text", text: part.text });
      continue;
    }
    if (
      part.type === "image_url" &&
      "image_url" in part &&
      part.image_url &&
      typeof part.image_url === "object" &&
      "url" in part.image_url &&
      typeof part.image_url.url === "string"
    ) {
      converted.push({ type: "input_image", image_url: part.image_url.url });
    }
  }
  return converted;
}

function analysisPrompt(role: string, focus: string): string {
  return [
    `你是 UI 组件${role}角色。${focus}`,
    "只输出一个 JSON 对象，不要输出 Markdown。",
    `semanticType 只能取: ${SemanticTypeSchema.options.join(", ")}`,
    `role 只能取: ${SemanticRoleSchema.options.join(", ")}`,
    `capabilities 只能取: ${CapabilitySchema.options.join(", ")}`,
    "必须返回 semanticType、role、capabilities、confidence、evidence、summary。",
    "confidence 必须是对象，且必须同时包含 semanticType、role、capabilities 三个 0 到 1 的数值；不能返回单个数字。",
    "capabilities 必须是字符串数组；evidence 必须是对象数组；summary 必须是非空字符串。",
    "每条 evidence 必须包含 sourcePath、value、rationale；禁止把模型猜测伪装成源事实。",
    "summary 和 evidence.rationale 面向中文审核者，必须使用简体中文；sourcePath 保持机器可读的原始路径。"
  ].join("\n");
}

function observationMessage(
  observation: ComponentObservation,
  includeImage: boolean
): string | Array<Record<string, unknown>> {
  const text = JSON.stringify(sanitizeObservation(observation));
  if (!includeImage) return text;
  const images = collectImages(observation.root, "root");
  if (images.length === 0) return text;
  return [
    { type: "text", text },
    ...images.flatMap((item) => [
      { type: "text", text: `Image evidence for ${item.sourcePath}` },
      {
        type: "image_url",
        image_url: { url: `data:image/png;base64,${item.imageBase64}` }
      }
    ])
  ];
}

function collectImages(
  node: ObservedNode,
  sourcePath: string
): Array<{ sourcePath: string; imageBase64: string }> {
  const own = node.imageBase64 ? [{ sourcePath, imageBase64: node.imageBase64 }] : [];
  return [
    ...own,
    // The package declaration widens children; the Observation schema validated them.
    ...(node.children as ObservedNode[]).flatMap((child, index) =>
      collectImages(child, `${sourcePath}.children[${index}]`)
    )
  ];
}

function sanitizeObservation(observation: ComponentObservation): ComponentObservation {
  return {
    ...observation,
    root: sanitizeNode(observation.root)
  };
}

function sanitizeNode(node: ObservedNode): ObservedNode {
  const { imageBase64, ...facts } = node;
  return {
    ...facts,
    ...(imageBase64 === undefined ? {} : { imageBase64: "[attached separately]" }),
    children: (node.children as ObservedNode[]).map(sanitizeNode)
  };
}

export type { SemanticProposal };
