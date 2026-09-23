import { describe, expect, it } from "vitest";

import { adaptBridgeDocument } from "../src/bridge/index.js";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("UFB component import", () => {
  it("keeps a main-component screenshot as observation image evidence", () => {
    const document = adaptBridgeDocument({
      version: "0.1.0",
      sourceCanvas: "Component Definition",
      nodes: [
        {
          name: "RewardClaimButton",
          type: "COMPONENT",
          u2f: { prefabGuid: "guid-reward-claim" },
          screenshot: PNG_BASE64
        }
      ]
    });

    expect(document.observations[0]?.root.imageBase64).toBe(PNG_BASE64);
  });

  it("keeps an existing layout image instead of the component screenshot", () => {
    const document = adaptBridgeDocument({
      version: "0.1.0",
      sourceCanvas: "Component Definition",
      nodes: [
        {
          name: "RewardClaimButton",
          type: "COMPONENT",
          u2f: { prefabGuid: "guid-reward-claim" },
          layout: { imageBase64: "layout-image" },
          screenshot: PNG_BASE64
        }
      ]
    });

    expect(document.observations[0]?.root.imageBase64).toBe("layout-image");
  });
});