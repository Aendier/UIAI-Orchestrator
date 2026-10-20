import { OpenAICompatibleClient, type OpenAICompatibleConfig } from "../ai/openai-compatible.js";
import { ModelStructureProposalSchema } from "./proposal.js";
import type { PagePlanner } from "./store.js";
import { CapabilitySchema } from "../semantic/index.js";
import { componentIdentity } from "../registry/index.js";
import type { ModelCallObserver } from "../ai/usage.js";

export function createPagePlanner(config: OpenAICompatibleConfig, fetchImpl: typeof fetch = fetch, observe?: ModelCallObserver): PagePlanner {
  const client = new OpenAICompatibleClient(config, fetchImpl, observe);
  return {
    propose: async (input, signal) => {
      const knowledge = input.knowledge.map(candidate => ({ ref: candidate.ref, approved: candidate.approved,
        identity: componentIdentity(candidate.approved),
        root: removeImages(candidate.observation.root), hasScreenshot: Boolean(candidate.observation.root.imageBase64) }));
      const content: unknown[] = [
        { type: "text", text: JSON.stringify({ task: input.selectedNode ? "revise_selected_subtree" : "analyze_page", input: input.draft.input,
          currentRoot: input.draft.root, currentIssues: input.draft.issues, selectedNode: input.selectedNode, instructions: input.instructions,
          approvedKnowledge: knowledge }) },
        { type: "image_url", image_url: { url: `data:${input.reference.mime};base64,${input.reference.base64}` } }
      ];
      for (const candidate of input.knowledge) {
        const screenshot = candidate.observation.root.imageBase64;
        if (!screenshot) continue;
        content.push({ type: "text", text: `Component screenshot: ${candidate.ref.componentId}` });
        content.push({ type: "image_url", image_url: { url: screenshot.startsWith("data:") ? screenshot : `data:image/png;base64,${screenshot}` } });
      }
      return client.complete([
        "你规划 UI 页面的结构，输出严格 JSON 对象。明确文字要求优先，参考图用于布局证据，组件事实来自人工审核知识。",
        "只能引用 approvedKnowledge 中完整的 ref，instance 是叶节点，保持原尺寸、实际内容和内部外观。禁止 override、缩放、脚本、数据绑定。",
        "同一组件家族可以有多个尺寸变体：componentId 末尾的 .xs/.s/.m/.l/.xl 表示尺寸变体。用户只说主按钮时可提出同家族的近似变体；用户明确说小/中/大时优先对应变体，尺寸差异必须写入 evidence，并用 accepted_difference 交给人工确认。",
        `组件能力只允许 ${CapabilitySchema.options.join(", ")}。requiredCapabilities 必须来自真实需求，引用组件必须全部满足。`,
        "返回 root、issues、coordinateSpace。整页优先用 global 坐标，服务端会转换为父节点局部坐标；root 必须为 (0,0) 的画板容器，大小与 input.page 完全一致。",
        "节点包含 purpose、requiredCapabilities、match（status: match/no_match/ambiguous，candidateIds，confidence，rationale）和 evidence（source: image/text/component/inference，detail，可选 region）。坐标全部为像素。",
        "证据不足可以 no_match，不可强行匹配。素材缺失使用 asset placeholder；缺失项目能力使用 capability placeholder。每个占位必须关联同节点的 issue。",
        "issues 只提出 pending 决定，不可代替人类接受占位、内容差异或解决冲突。每条问题须有 id、nodeId、category、message、blocking、candidateIds、decision。图文冲突和关键歧义必须 blocking。",
        "局部修改只返回 selectedNode 的替代子树和其 issues，保留根 ID，coordinateSpace 必须 local；保留未受影响节点的 ID。不得改变子树外节点。",
        "image 只能使用 currentRoot 已存在的素材 ID，不能把参考图裁片作为正式素材。普通节点仅支持静态 container/text/image。",
        "名称、解释与审核证据使用简体中文。严格输出以下 Schema：",
        JSON.stringify(ModelStructureProposalSchema.toJSONSchema())
      ].join("\n"), content, signal, input.selectedNode ? "page_revision" : "page_analysis");
    }
  };
}

function removeImages(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(removeImages);
  if (node && typeof node === "object") return Object.fromEntries(Object.entries(node).filter(([key]) => key !== "imageBase64").map(([key, value]) => [key, removeImages(value)]));
  return node;
}
