import { describe, expect, it } from "vitest";

import {
  PAGE_SIZE,
  UNCLASSIFIED_TYPE,
  availableTypes,
  enginePresence,
  paginate,
  reviewStatus,
  selectLibraryItems
} from "../public/library-view.js";

const approved = {
  sourceId: "guid-approved",
  name: "RewardButton",
  componentRef: { prefabPath: "Assets/UI/Rewards/RewardButton.prefab" },
  approved: { semanticType: "button" }
};
const draft = {
  sourceId: "guid-draft",
  name: "ShopPanel",
  draft: { decision: { semanticType: "container" } }
};
const observed = { sourceId: "guid-observed", name: "AvatarFrame" };

describe("component library view", () => {
  it("filters by review status, semantic type, name, source ID and Prefab path", () => {
    const items = [approved, draft, observed];
    expect(items.map(reviewStatus)).toEqual(["approved", "draft", "observed"]);
    expect(availableTypes(items)).toEqual(["button", "container"]);
    expect(selectLibraryItems(items, { status: "approved" })).toEqual([approved]);
    expect(selectLibraryItems(items, { status: "draft", type: "container" })).toEqual([draft]);
    expect(selectLibraryItems(items, { type: UNCLASSIFIED_TYPE })).toEqual([observed]);
    expect(selectLibraryItems(items, { query: "REWARDS" })).toEqual([approved]);
    expect(selectLibraryItems(items, { query: "guid-draft" })).toEqual([draft]);
  });

  it("sorts by name or semantic type without changing the source array", () => {
    const items = [approved, draft, observed];
    expect(selectLibraryItems(items, {}).map((item) => item.name)).toEqual([
      "AvatarFrame", "RewardButton", "ShopPanel"
    ]);
    expect(selectLibraryItems(items, { sort: "name-desc" }).map((item) => item.name)).toEqual([
      "ShopPanel", "RewardButton", "AvatarFrame"
    ]);
    expect(selectLibraryItems(items, { sort: "type-asc" }).map((item) => item.name)).toEqual([
      "RewardButton", "ShopPanel", "AvatarFrame"
    ]);
    expect(items).toEqual([approved, draft, observed]);
  });

  it("shows 30 items per page and clamps pages after the result shrinks", () => {
    const items = Array.from({ length: PAGE_SIZE + 1 }, (_, index) => index);
    expect(paginate(items, 1)).toMatchObject({ page: 1, totalPages: 2 });
    expect(paginate(items, 1).items).toHaveLength(PAGE_SIZE);
    expect(paginate(items, 2).items).toEqual([PAGE_SIZE]);
    expect(paginate(items.slice(0, 2), 2)).toMatchObject({ page: 1, totalPages: 1 });
    expect(paginate([], 1)).toEqual({ items: [], page: 1, totalPages: 0 });
  });

  it("filters components by Unity engine presence without changing review status", () => {
    const items = [
      { ...approved, enginePresence: "present" },
      { ...draft, enginePresence: "missing" },
      observed
    ];
    expect(items.map(enginePresence)).toEqual(["present", "missing", "unknown"]);
    expect(selectLibraryItems(items, { presence: "missing" })).toEqual([items[1]]);
    expect(selectLibraryItems(items, { presence: "unknown" })).toEqual([observed]);
    expect(selectLibraryItems(items, { status: "draft", presence: "missing" })).toEqual([items[1]]);
  });

  it("separates approved components whose source content changed", () => {
    const changed = { ...approved, approvedChanged: true };
    expect(reviewStatus(changed)).toBe("changed");
    expect(selectLibraryItems([changed], { status: "changed" })).toEqual([changed]);
  });
});
