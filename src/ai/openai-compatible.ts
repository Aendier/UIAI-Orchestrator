import { z } from "zod";

import type { ComponentObservation, ObservedNode } from "../observation/index.js";
import {
  CapabilitySchema,
  SemanticRoleSchema,
  SemanticTypeSchema,
  type AnalysisAgent,
  type SemanticAdjudicator,
  type SemanticProposal
} from "../semantic/index.js";

export interface OpenAICompatibleConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export function createOpenAICompatibleAgents(
  config: OpenAICompatibleConfig,
  fetchImpl: typeof fetch = fetch
): {
  structuralAgent: AnalysisAgent;
  visualAgent: AnalysisAgent;
  adjudicator: SemanticAdjudicator;
} {
  const client = new OpenAICompatibleClient(config, fetchImpl);
  return {
    structuralAgent: {
      analyze: (observation) =>
        client.complete(
          analysisPrompt("结构分析", "只根据节点树、组件类型、命名、布局和层级推断。"),
          observationMessage(observation, false)
        )
    },
    visualAgent: {
      analyze: (observation) =>
        client.complete(
          analysisPrompt("视觉分析", "优先根据截图、尺寸、文本和视觉样式推断，不得臆造不可见结构。"),
          observationMessage(observation, true)
        )
    },
    adjudicator: {
      adjudicate: ({ observation, structural, visual }) =>
        client.complete(
          analysisPrompt(
            "冲突裁决",
            "比较两个独立提案，只能根据引用证据裁决；证据不足时降低置信度。"
          ),
          JSON.stringify({
            observation: sanitizeObservation(observation),
            proposals: { structural, visual }
          })
        )
    }
  };
}

class OpenAICompatibleClient {
  readonly #endpoint: string;

  public constructor(
    private readonly config: OpenAICompatibleConfig,
    private readonly fetchImpl: typeof fetch
  ) {
    this.#endpoint = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
  }

  public async complete(systemPrompt: string, userContent: unknown): Promise<unknown> {
    const response = await this.fetchImpl(this.#endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: this.config.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`Model request failed with HTTP ${response.status}.`);
    }

    const payload = CompletionResponseSchema.parse(await response.json());
    const firstChoice = payload.choices[0];
    if (firstChoice === undefined) {
      throw new Error("Model response did not contain a completion choice.");
    }
    return JSON.parse(firstChoice.message.content) as unknown;
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

function analysisPrompt(role: string, focus: string): string {
  return [
    `你是 UI 组件${role}角色。${focus}`,
    "只输出一个 JSON 对象，不要输出 Markdown。",
    `semanticType 只能取: ${SemanticTypeSchema.options.join(", ")}`,
    `role 只能取: ${SemanticRoleSchema.options.join(", ")}`,
    `capabilities 只能取: ${CapabilitySchema.options.join(", ")}`,
    "必须返回 semanticType、role、capabilities、confidence、evidence、summary。",
    "每条 evidence 必须包含 sourcePath、value、rationale；禁止把模型猜测伪装成源事实。"
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
    ...node.children.flatMap((child, index) =>
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
    children: node.children.map(sanitizeNode)
  };
}

export type { SemanticProposal };
