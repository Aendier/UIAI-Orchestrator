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

  it("treats null optional fields from Unity as absent", () => {
    const document = adaptBridgeDocument({
      version: "0.1.0",
      sourceCanvas: "UIComponentLibrary",
      nodes: [
        {
          name: "UI_Com_Common_Btn_Primary_M",
          u2f: {
            prefabGuid: "a7937bc110b999e4f96d4b15c37667a5",
            prefabPath: "Assets/UI/UI_Com_Common_Btn_Primary_M.prefab",
            scriptType: null,
            componentTypes: ["Button"]
          },
          layout: {
            rect: { x: 0, y: 0, width: 250, height: 69, rotation: 0 },
            text: null,
            style: { backgroundColor: null, backgroundOpacity: 1, fillType: null },
            imageBase64: null
          },
          screenshot: PNG_BASE64,
          children: [
            {
              name: "Root",
              u2f: { prefabGuid: null, prefabPath: null, scriptType: null },
              layout: { text: null, imageBase64: null },
              screenshot: null
            }
          ]
        }
      ]
    });

    const root = document.observations[0]?.root;
    expect(root?.sourceId).toBe("a7937bc110b999e4f96d4b15c37667a5");
    expect(root?.imageBase64).toBe(PNG_BASE64);
    expect(root?.text).toBeUndefined();
    expect(root?.style).toEqual({ backgroundOpacity: 1 });
    expect(root?.children[0]?.sourceId).toBe("nodes[0].children[0]");
    expect(root?.children[0]?.imageBase64).toBeUndefined();
    expect(root?.children[0]?.componentRef?.prefabGuid).toBeUndefined();
  });

});