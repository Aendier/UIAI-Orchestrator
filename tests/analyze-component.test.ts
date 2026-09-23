import { describe, expect, it, vi } from "vitest";

import {
  analyzeComponent,
  type AnalysisAgent,
  type ComponentObservation,
  type SemanticAdjudicator,
  type SemanticProposal
} from "../src/semantic/index.js";
import { createOpenAICompatibleAgents } from "../src/ai/openai-compatible.js";

const observation: ComponentObservation = {
  schemaVersion: "1.0.0",
  source: {
    kind: "unity-figma-bridge",
    documentName: "reward-library"
  },
  root: {
    sourceId: "reward-claim",
    name: "RewardClaimButton",
    nodeType: "INSTANCE",
    visible: true,
    componentRef: {
      prefabGuid: "guid-reward-claim",
      prefabPath: "Assets/UI/Reward/UI_Button_Reward_Claim.prefab",
      componentTypes: ["RectTransform", "Image", "Button"]
    },
    bounds: { x: 0, y: 0, width: 240, height: 72, rotation: 0 },
    children: []
  }
};

const agreedProposal: SemanticProposal = {
  semanticType: "button",
  role: "reward.claim",
  capabilities: ["click", "text", "disabled.state"],
  confidence: {
    semanticType: 0.98,
    role: 0.96,
    capabilities: 0.92
  },
  evidence: [
    {
      sourcePath: "root.componentRef.componentTypes",
      value: ["RectTransform", "Image", "Button"],
      rationale: "The source contains a Unity Button."
    }
  ],
  summary: "A reward claim button."
};

describe("analyzeComponent", () => {
  it("produces a draft without adjudication when independent agents agree", async () => {
    const structuralAgent: AnalysisAgent = {
      analyze: vi.fn().mockResolvedValue(agreedProposal)
    };
    const visualAgent: AnalysisAgent = {
      analyze: vi.fn().mockResolvedValue({
        ...agreedProposal,
        evidence: [
          {
            sourcePath: "root.bounds",
            value: observation.root.bounds,
            rationale: "The wide control geometry is consistent with a button."
          }
        ]
      })
    };
    const adjudicator: SemanticAdjudicator = {
      adjudicate: vi.fn()
    };

    const draft = await analyzeComponent({
      observation,
      structuralAgent,
      visualAgent,
      adjudicator
    });

    expect(structuralAgent.analyze).toHaveBeenCalledWith(observation);
    expect(visualAgent.analyze).toHaveBeenCalledWith(observation);
    expect(adjudicator.adjudicate).not.toHaveBeenCalled();
    expect(draft.decision).toMatchObject({
      semanticType: "button",
      role: "reward.claim",
      capabilities: ["click", "disabled.state", "text"],
      status: "draft"
    });
    expect(draft.decision.evidence).toHaveLength(2);
    expect(draft.conflicts).toEqual([]);
  });

  it("uses adjudication and preserves the conflict when agents disagree", async () => {
    const structuralProposal = agreedProposal;
    const visualProposal: SemanticProposal = {
      ...agreedProposal,
      role: "primary.action",
      confidence: {
        semanticType: 0.93,
        role: 0.82,
        capabilities: 0.9
      },
      evidence: [
        {
          sourcePath: "root.bounds",
          value: observation.root.bounds,
          rationale: "The wide control geometry suggests a primary action."
        }
      ]
    };
    const adjudicatedProposal: SemanticProposal = {
      ...agreedProposal,
      confidence: {
        semanticType: 0.96,
        role: 0.91,
        capabilities: 0.9
      },
      evidence: [
        {
          sourcePath: "root.componentRef.prefabPath",
          value: "Assets/UI/Reward/UI_Button_Reward_Claim.prefab",
          rationale: "The approved Unity asset path carries explicit reward-claim context."
        }
      ]
    };
    const adjudicator: SemanticAdjudicator = {
      adjudicate: vi.fn().mockResolvedValue(adjudicatedProposal)
    };

    const draft = await analyzeComponent({
      observation,
      structuralAgent: {
        analyze: vi.fn().mockResolvedValue(structuralProposal)
      },
      visualAgent: {
        analyze: vi.fn().mockResolvedValue(visualProposal)
      },
      adjudicator
    });

    expect(adjudicator.adjudicate).toHaveBeenCalledWith({
      observation,
      structural: structuralProposal,
      visual: visualProposal
    });
    expect(draft.conflicts).toEqual(["role"]);
    expect(draft.decision).toMatchObject({
      role: "reward.claim",
      status: "draft"
    });
    expect(draft.decision.evidence).toHaveLength(3);
  });

  it("runs independent structural and visual roles through an OpenAI-compatible endpoint", async () => {
    const observationWithImages: ComponentObservation = {
      ...observation,
      root: {
        ...observation.root,
        imageBase64: "root-image",
        children: [
          {
            sourceId: "reward-label",
            name: "Label",
            nodeType: "TEXT",
            visible: true,
            imageBase64: "child-image",
            children: []
          }
        ]
      }
    };
    const responseBody = {
      choices: [
        {
          message: {
            content: JSON.stringify(agreedProposal)
          }
        }
      ]
    };
    const fetchMock = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    const agents = createOpenAICompatibleAgents(
      {
        baseUrl: "https://models.example.test/v1",
        apiKey: "test-key",
        model: "ui-model"
      },
      fetchMock
    );

    const draft = await analyzeComponent({
      observation: observationWithImages,
      structuralAgent: agents.structuralAgent,
      visualAgent: agents.visualAgent,
      adjudicator: agents.adjudicator
    });

    expect(draft.decision.role).toBe("reward.claim");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const requestBodies = fetchMock.mock.calls.map((call) =>
      JSON.parse(String((call[1] as RequestInit).body)) as {
        messages: Array<{ content: unknown }>;
      }
    );
    expect(String(requestBodies[0]?.messages[0]?.content)).toContain("结构分析");
    expect(String(requestBodies[1]?.messages[0]?.content)).toContain("视觉分析");
    const visualContent = requestBodies[1]?.messages[1]?.content as Array<{
      type: string;
    }>;
    expect(visualContent.filter((part) => part.type === "image_url")).toHaveLength(2);
  });

  it("uses the Responses API wire format when the provider requires it", async () => {
    const responseBody = {
      output: [
        {
          type: "reasoning"
        },
        {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: JSON.stringify(agreedProposal)
            }
          ]
        }
      ]
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    const agents = createOpenAICompatibleAgents(
      {
        baseUrl: "https://models.example.test/v1",
        apiKey: "test-key",
        model: "ui-model",
        wireApi: "responses"
      },
      fetchMock
    );

    await agents.structuralAgent.analyze(observation);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://models.example.test/v1/responses");
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      model: string;
      instructions: string;
      input: Array<{
        role: string;
        content: Array<{ type: string; text?: string }>;
      }>;
      text: { format: { type: string } };
    };
    expect(request).toMatchObject({
      model: "ui-model",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "Return only one JSON object." },
            { type: "input_text" }
          ]
        }
      ],
      text: { format: { type: "json_object" } }
    });
    expect(request.instructions).toContain("结构分析");
    expect(request.instructions).toContain("confidence 必须是对象");
    expect(JSON.stringify(request.input).toLowerCase()).toContain("json");
  });

  it("preserves image evidence in Responses API input", async () => {
    const responseBody = {
      output: [
        {
          content: [
            {
              type: "output_text",
              text: JSON.stringify(agreedProposal)
            }
          ]
        }
      ]
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    const agents = createOpenAICompatibleAgents(
      {
        baseUrl: "https://models.example.test/v1",
        apiKey: "test-key",
        model: "ui-model",
        wireApi: "responses"
      },
      fetchMock
    );

    await agents.visualAgent.analyze({
      ...observation,
      root: {
        ...observation.root,
        imageBase64: "root-image",
        children: [
          {
            sourceId: "reward-label",
            name: "Label",
            nodeType: "TEXT",
            visible: true,
            imageBase64: "child-image",
            children: []
          }
        ]
      }
    });

    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      input: Array<{ content: Array<{ type: string; image_url?: string }> }>;
    };
    expect(request.input[0]?.content).toEqual(
      expect.arrayContaining([
        { type: "input_image", image_url: "data:image/png;base64,root-image" },
        { type: "input_image", image_url: "data:image/png;base64,child-image" }
      ])
    );
  });

  it("accepts a top-level output_text from Responses-compatible providers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ output_text: JSON.stringify(agreedProposal) }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const agents = createOpenAICompatibleAgents(
      {
        baseUrl: "https://models.example.test/v1",
        apiKey: "test-key",
        model: "ui-model",
        wireApi: "responses"
      },
      fetchMock
    );

    await expect(agents.structuralAgent.analyze(observation)).resolves.toEqual(
      agreedProposal
    );
  });
});
