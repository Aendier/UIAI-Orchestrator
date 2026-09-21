import { describe, expect, it } from "vitest";

import {
  interpretQuery,
  searchRegistry,
  type ApprovedComponent,
  type ComponentRegistry
} from "../src/registry/index.js";

const approved = (entry: Partial<ApprovedComponent>): ApprovedComponent => ({
  schemaVersion: "1.0.0",
  id: "button.reward.claim",
  sourceId: "reward-claim",
  name: "RewardClaimButton",
  status: "approved",
  semanticType: "button",
  role: "reward.claim",
  capabilities: ["click", "text", "disabled.state"],
  useCases: ["领取奖励", "claim reward"],
  visualTraits: ["wide", "primary action"],
  evidence: [],
  approvedBy: "fixture-reviewer",
  approvedAt: "2026-09-21T00:00:00.000Z",
  ...entry
});

const registry: ComponentRegistry = {
  schemaVersion: "1.0.0",
  components: [
    approved({}),
    approved({
      id: "button.shop.buy",
      sourceId: "shop-buy",
      name: "ShopBuyButton",
      role: "shop.purchase",
      useCases: ["购买商品", "buy item"]
    })
  ]
};

describe("searchRegistry", () => {
  it.each([
    [
      "显示奖励图标、数量和品质的格子",
      {
        semanticType: "item",
        role: "reward.display",
        requiredCapabilities: ["display.icon", "display.quantity", "display.rarity"]
      }
    ],
    [
      "页面顶部的关闭按钮",
      { semanticType: "button", role: "common.close", requiredCapabilities: ["click"] }
    ],
    [
      "一个 Tab",
      {
        semanticType: "navigation",
        role: "navigation.tab",
        requiredCapabilities: ["navigation.select", "selected.state"]
      }
    ]
  ])("interprets the controlled MVP intent: %s", (text, expected) => {
    expect(interpretQuery(text)).toMatchObject(expected);
  });

  it("ranks an approved component using semantic, role and capability evidence", () => {
    const result = searchRegistry(registry, {
      text: "用于领取奖励的按钮",
      semanticType: "button",
      role: "reward.claim",
      requiredCapabilities: ["click", "disabled.state"]
    });

    expect(result.status).toBe("match");
    expect(result.matches[0]).toMatchObject({
      componentId: "button.reward.claim",
      breakdown: {
        semanticType: 0.3,
        role: 0.35,
        capabilities: 0.25
      }
    });
    expect(result.matches[0]?.score).toBeGreaterThan(0.9);
    expect(result.matches[0]?.reasons).toContain("角色匹配: reward.claim");
  });

  it("returns no_match for a request outside the controlled taxonomy", () => {
    const query = interpretQuery("一个可以拖动旋转的三维模型查看器");
    const result = searchRegistry(registry, query);

    expect(result).toMatchObject({ status: "no_match", matches: [] });
  });

  it("rejects candidates missing any required capability", () => {
    const incompleteRewardItem = approved({
      id: "reward.item",
      sourceId: "reward-item",
      name: "RewardItem",
      semanticType: "item",
      role: "reward.display",
      capabilities: ["display.icon"],
      useCases: ["显示奖励图标、数量和品质"]
    });
    const query = interpretQuery("显示奖励图标、数量和品质的格子");
    const result = searchRegistry(
      { schemaVersion: "1.0.0", components: [incompleteRewardItem] },
      query
    );

    expect(result).toMatchObject({ status: "no_match", matches: [] });
  });
});
