import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { KnowledgeSnapshot, PageStore, eligibleKnowledge, type PagePlanner } from "../src/pages/store.js";
import { adaptBridgeDocument } from "../src/bridge/index.js";
import { createObservationFingerprint, createDefinitionFingerprint } from "../src/shared/fingerprint.js";
import { type StructureNode, type PageIssue } from "../src/shared/page.js";
import { createWorkbenchServer } from "../src/web/server.js";
import { createPagePlanner } from "../src/pages/model.js";
import { SCHEMA_VERSION } from "../src/schema-version.js";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
async function setup(modern = false) {
  const bridge = JSON.parse(await readFile("fixtures/bridge-components.json", "utf8"));
  if (modern) {
    bridge.nodes[0].u2f.assetDependencyHash = '123456789abcdef0123456789abcdef0';
    bridge.nodes[0].children = [{ name: 'Content', type: 'FRAME', layout: { rect: { x: 10, y: 5, width: 200, height: 60 } } }];
  }
  const observations = adaptBridgeDocument(bridge);
  const observation = observations.observations[0]!;
  const registry = { schemaVersion: SCHEMA_VERSION, components: [{ schemaVersion: SCHEMA_VERSION, id: "button.reward.claim", sourceId: observation.root.sourceId,
    name: observation.root.name, status: "approved" as const, semanticType: "button" as const, role: "reward.claim" as const,
    capabilities: ["click" as const], useCases: ["领取奖励"], visualTraits: [], evidence: [],
    observationFingerprint: createObservationFingerprint(observation),
    ...(modern ? { definitionFingerprint: createDefinitionFingerprint(observation) } : {}),
    approvedBy: "tester", approvedAt: "2026-10-09T00:00:00.000Z" }] };
  const directory = await mkdtemp(join(tmpdir(), "uiai-pages-"));
  const facts = { observations, registry };
  const store = new PageStore(directory, async () => facts);
  await store.initialize();
  await store.create({ name: "Mixed", reference: { mime: "image/png", base64: PNG }, width: 640, height: 480 });
  const pageId = (await store.list())[0]!.pageId;
  await store.asset(pageId, { mime: "image/png", base64: PNG });
  const record = await store.get(pageId);
  const sample = JSON.parse(await readFile(new URL(import.meta.resolve("@uiai/protocol/fixtures/page/valid-plan.json")), "utf8"));
  const root: StructureNode = sample.root;
  if (modern) for (const node of root.kind === 'container' ? root.children : []) {
    if (node.kind === 'instance') node.componentRef = eligibleKnowledge(facts)[0]!.ref;
  }
  const issues: PageIssue[] = sample.unresolved;
  return { store, directory, facts, observation, pageId, record, root, issues };
}
describe("page review and plan compilation", () => {
  it("keeps stable approved plans unchanged across captures and reapprovals, but blocks actual resource changes", async () => {
    const {store, pageId, root, issues, facts, observation} = await setup(true);
    await store.edit(pageId, {expectedRevision: 1, root, issues});
    await store.approve(pageId, {expectedRevision: 2, reviewer: 'tester'});
    const plan = await store.plan(pageId);
    const approvedSnapshot = structuredClone((await store.get(pageId)).approvals);
    expect(plan.dependencies[0]!.definitionFingerprint?.version).toBe('uiai-definition/v1');
    observation.root.name = 'Renamed scene instance';
    observation.root.bounds!.x += 100;
    observation.root.imageBase64 = PNG;
    observation.root.children[0]!.sourceId = 'nodes[15].children[0]';
    expect(eligibleKnowledge(facts)).toHaveLength(1);
    expect(await store.plan(pageId)).toEqual(plan);
    // A later explicit component review can record new capture evidence without
    // changing the already-approved page's definition or provenance.
    facts.registry.components[0]!.observationFingerprint = createObservationFingerprint(observation);
    expect(await store.plan(pageId)).toEqual(plan);
    expect((await store.get(pageId)).approvals).toEqual(approvedSnapshot);
    observation.root.componentRef!.assetDependencyHash = 'abcdef0123456789abcdef0123456789';
    expect(eligibleKnowledge(facts)).toHaveLength(0);
    await expect(store.plan(pageId)).rejects.toMatchObject({status: 409});
    expect((await store.get(pageId)).approvals).toEqual(approvedSnapshot);
  });
  it("does not upgrade legacy approvals or accept a declared stable revision without its resource evidence", async () => {
    const legacy = await setup();
    legacy.observation.root.componentRef!.assetDependencyHash = '123456789abcdef0123456789abcdef0';
    expect(legacy.facts.registry.components[0]!.definitionFingerprint).toBeUndefined();
    expect(eligibleKnowledge(legacy.facts)).toHaveLength(0);
    const modern = await setup(true);
    delete modern.observation.root.componentRef!.assetDependencyHash;
    modern.facts.registry.components[0]!.observationFingerprint = createObservationFingerprint(modern.observation);
    expect(eligibleKnowledge(modern.facts)).toHaveLength(0);
  });
  it("freezes only verified approvals; unknown presence is eligible while missing, legacy and stale approvals are excluded", async () => {
    const { facts, observation } = await setup();
    expect(eligibleKnowledge(facts)).toHaveLength(1);
    observation.enginePresence = "missing"; expect(eligibleKnowledge(facts)).toHaveLength(0);
    observation.enginePresence = "unknown"; expect(eligibleKnowledge(facts)).toHaveLength(1);
    facts.registry.components[0]!.observationFingerprint = ""; expect(eligibleKnowledge(facts)).toHaveLength(0);
    facts.registry.components[0]!.observationFingerprint = "0".repeat(64); expect(eligibleKnowledge(facts)).toHaveLength(0);
    facts.registry.components = []; expect(eligibleKnowledge(facts)).toHaveLength(0);
  });
  it("keeps one knowledge snapshot id and filters frozen candidates against current evidence", async () => {
    const { facts } = await setup();
    const initial = KnowledgeSnapshot.from(facts);
    const frozen = structuredClone(initial.knowledge);
    expect(initial.id).toBe(KnowledgeSnapshot.from(facts).id);
    expect(initial.has(frozen[0]!.ref)).toBe(true);
    facts.observations.observations[0]!.enginePresence = "missing";
    const current = KnowledgeSnapshot.from(facts);
    expect(current.id).not.toBe(initial.id);
    expect(current.availableCandidates(frozen)).toEqual([]);
  });
  it("exports stable hashes only after exact human approval; edits preserve the approved revision and assets are deduplicated", async () => {
    const { store, pageId, root, issues, directory } = await setup();
    await expect(store.plan(pageId)).rejects.toMatchObject({ status: 409 });
    const draft = await store.edit(pageId, { expectedRevision: 1, root, issues });
    await store.approve(pageId, { expectedRevision: draft.revision, reviewer: "tester" });
    const first = await store.plan(pageId); expect(await store.plan(pageId)).toEqual(first);
    const image = await store.asset(pageId, { mime: "image/png", base64: PNG });
    await store.asset(pageId, { mime: "image/png", base64: PNG });
    expect((await store.get(pageId)).assets).toHaveLength(1);
    const next = structuredClone(root); if (next.kind !== "container") throw Error("fixture");
    next.children.push({ id: "image", name: "Image", kind: "image", rect: { x: 500, y: 20, width: 40, height: 40 }, assetId: image.id });
    await store.edit(pageId, { expectedRevision: draft.revision, root: next, issues });
    await expect(store.plan(pageId)).rejects.toMatchObject({ status: 409 });
    const saved = JSON.parse(await readFile(join(directory, "pages.json"), "utf8"));
    expect(saved.pages[0].approvals[0].root).toEqual(root);
    const reopened = new PageStore(directory, async () => ({ observations: { schemaVersion: SCHEMA_VERSION, observations: [] }, registry: { schemaVersion: SCHEMA_VERSION, components: [] } }));
    await reopened.initialize(); expect((await reopened.get(pageId)).approvals[0]!.root).toEqual(root);
  });
  it("invalidates used dependencies but tolerates unrelated changes and preserves approval history", async () => {
    const { store, pageId, root, issues, facts, observation } = await setup();
    await store.edit(pageId, { expectedRevision: 1, root, issues });
    await store.approve(pageId, { expectedRevision: 2, reviewer: "tester" });
    const plan = await store.plan(pageId);
    facts.observations.observations[1]!.root.name = "Unrelated change";
    expect(await store.plan(pageId)).toEqual(plan);
    observation.root.name = "Changed";
    await expect(store.plan(pageId)).rejects.toMatchObject({ status: 409 });
    const record = await store.get(pageId);
    expect(record.draft.review.status).toBe("needs_review"); expect(record.draft.revision).toBe(3);
    expect(record.approvals[0]!.review.status).toBe("structure_approved");
    expect(record.approvals[0]!.revision).toBe(2);
  });
  it.each(["revoked", "missing", "legacy"])("blocks export after a used dependency becomes %s", async reason => {
    const { store, pageId, root, issues, facts, observation } = await setup();
    await store.edit(pageId, { expectedRevision: 1, root, issues });
    await store.approve(pageId, { expectedRevision: 2, reviewer: "tester" });
    if (reason === "revoked") facts.registry.components = [];
    if (reason === "missing") observation.enginePresence = "missing";
    if (reason === "legacy") facts.registry.components[0]!.observationFingerprint = "";
    await expect(store.plan(pageId)).rejects.toMatchObject({ status: 409 });
    expect((await store.get(pageId)).draft.review.status).toBe("needs_review");
  });
  it("explicit reanalysis freezes new reviewed knowledge while preserving prior approved snapshots", async () => {
    const { store, pageId, root, issues, facts, observation } = await setup();
    await store.edit(pageId, { expectedRevision: 1, root, issues });
    await store.approve(pageId, { expectedRevision: 2, reviewer: "tester" });
    const oldFingerprint = facts.registry.components[0]!.observationFingerprint;
    observation.root.name = "Updated button";
    facts.registry.components[0]!.observationFingerprint = createObservationFingerprint(observation);
    const invalidated = await store.get(pageId);
    const changedRoot = structuredClone(root); if (changedRoot.kind !== "container" || changedRoot.children[1]?.kind !== "instance") throw Error("fixture");
    changedRoot.children[1].componentRef = eligibleKnowledge(facts)[0]!.ref;
    const pending = issues.map(issue => ({ ...issue, decision: "pending", resolution: undefined }));
    await store.analyze(pageId, { expectedRevision: invalidated.draft.revision }, { propose: async input => {
      expect(input.knowledge[0]!.ref.observationFingerprint).not.toBe(oldFingerprint);
      return { coordinateSpace: "local", root: changedRoot, issues: pending };
    } });
    const reanalyzed = await store.get(pageId);
    expect(reanalyzed.knowledgeHistory).toHaveLength(1);
    expect(reanalyzed.knowledgeHistory[0]!.knowledge[0]!.ref.observationFingerprint).toBe(oldFingerprint);
    expect(reanalyzed.approvals[0]!.knowledgeSnapshot.dependencies[0]!.observationFingerprint).toBe(oldFingerprint);
    const reviewed = await store.edit(pageId, { expectedRevision: reanalyzed.draft.revision, root: changedRoot, issues });
    await store.approve(pageId, { expectedRevision: reviewed.revision, reviewer: "tester" });
    expect((await store.plan(pageId)).dependencies[0]!.observationFingerprint).not.toBe(oldFingerprint);
  });
  it("rejects stale writes, forged refs, stretched instances, scripts, unmet capabilities and unreviewed critical issues", async () => {
    const { store, pageId, root, issues } = await setup();
    await expect(store.edit(pageId, { expectedRevision: 2, root, issues })).rejects.toMatchObject({ status: 409 });
    for (const mutate of [
      (value: any) => { value.children[1].componentRef.componentId = "fake"; },
      (value: any) => { value.children[1].rect.width = 300; },
      (value: any) => { value.children[1].children = []; },
      (value: any) => { value.children[1].requiredCapabilities = ["image"]; },
      (value: any) => { value.script = "danger"; }
    ]) { const bad = structuredClone(root); mutate(bad); await expect(store.edit(pageId, { expectedRevision: 1, root: bad, issues })).rejects.toThrow(); }
    const pending = issues.map(issue => ({ ...issue, decision: "pending", resolution: undefined }));
    await store.edit(pageId, { expectedRevision: 1, root, issues: pending });
    await expect(store.approve(pageId, { expectedRevision: 2, reviewer: "tester" })).rejects.toThrow();
  });
  it("rejects pending approval with actionable Chinese feedback and preserves the saved revision for retry", async () => {
    const { store, pageId, root, issues, directory } = await setup();
    const pending = issues.map(issue => ({ ...issue, decision: "pending", resolution: undefined }));
    await store.edit(pageId, { expectedRevision: 1, root, issues: pending });
    const before = await readFile(join(directory, "pages.json"), "utf8");
    await expect(store.approve(pageId, { expectedRevision: 2, reviewer: "tester" })).rejects.toMatchObject({
      status: 409, message: expect.stringContaining(`还有 ${pending.length} 项待确认`)
    });
    expect(await readFile(join(directory, "pages.json"), "utf8")).toBe(before);
    await store.edit(pageId, { expectedRevision: 2, root, issues });
    await store.approve(pageId, { expectedRevision: 3, reviewer: "tester" });
    expect((await store.plan(pageId)).review.approvedRevision).toBe(3);
  });

  it("local revision proposals do not mutate the draft until accepted and preserve nodes outside the selected subtree", async () => {
    const { store, pageId, root, issues } = await setup();
    await store.edit(pageId, { expectedRevision: 1, root, issues });
    if (root.kind !== "container") throw Error("fixture");
    const heading = structuredClone(root.children[0]!); if (heading.kind !== "text") throw Error("fixture");
    heading.text.characters = "New heading";
    const planner: PagePlanner = { propose: vi.fn().mockResolvedValue({ coordinateSpace: "local", root: heading, issues: [] }) };
    const proposal = await store.revise(pageId, { expectedRevision: 2, nodeId: "heading", instructions: "修改标题" }, planner);
    expect((await store.get(pageId)).draft.root).toEqual(root);
    expect(proposal.diff).toEqual([{ id: "heading", name: "Heading", change: "changed" }]);
    const accepted = await store.edit(pageId, { expectedRevision: 2, proposalId: proposal.id });
    if (accepted.root.kind !== "container") throw Error("fixture");
    expect(accepted.root.children.slice(1)).toEqual(root.children.slice(1));
    await expect(store.edit(pageId, { expectedRevision: 2, proposalId: proposal.id })).rejects.toMatchObject({ status: 409 });
  });
  it("failed, cancelled and self-approved model proposals preserve saved data; model calls do not hold the page write queue", async () => {
    const { store, pageId, root, issues } = await setup();
    const controller = new AbortController();
    const planner: PagePlanner = { propose: async () => { await store.asset(pageId, { mime: "image/png", base64: PNG }); controller.abort(); return { coordinateSpace: "local", root, issues: [] }; } };
    await expect(store.analyze(pageId, { expectedRevision: 1 }, planner, controller.signal)).rejects.toThrow();
    expect((await store.get(pageId)).draft.revision).toBe(1);
    await expect(store.analyze(pageId, { expectedRevision: 1 }, { propose: async () => ({ nonsense: true }) })).rejects.toThrow();
    await expect(store.analyze(pageId, { expectedRevision: 1 }, { propose: async () => ({ coordinateSpace: "local", root, issues }) })).rejects.toMatchObject({ status: 400 });
    expect((await store.get(pageId)).draft.revision).toBe(1);
  });
  it("rejects a model proposal completed after a concurrent edit", async () => {
    const { store, pageId, root } = await setup();
    const emptyRoot = { ...root, kind: "container", children: [] };
    const planner: PagePlanner = { propose: async () => {
      await store.edit(pageId, { expectedRevision: 1, root: emptyRoot, issues: [] });
      return { coordinateSpace: "local", root: emptyRoot, issues: [] };
    } };
    await expect(store.analyze(pageId, { expectedRevision: 1 }, planner)).rejects.toMatchObject({ status: 409 });
    expect((await store.get(pageId)).draft.revision).toBe(2);
  });
  it.each(["chat_completions", "responses"] as const)("sends reference images over %s without embedding credentials in proposals", async wireApi => {
    const { record } = await setup();
    const modelFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(wireApi === "responses" ? { output_text: "{}" } : { choices: [{ message: { content: "{}" } }] }), { status: 200 }));
    const planner = createPagePlanner({ baseUrl: "https://example.invalid/v1", apiKey: "secret-value", model: "vision", wireApi }, modelFetch);
    await planner.propose({ reference: record.reference, draft: record.draft, knowledge: record.knowledge });
    const body = JSON.parse(modelFetch.mock.calls[0]![1].body);
    expect(JSON.stringify(body)).toContain(`data:image/png;base64,${PNG}`);
    expect(JSON.stringify(body)).not.toContain("secret-value");
    expect(body[wireApi === "responses" ? "input" : "messages"]).toBeDefined();
  });
  it("returns 400 for invalid package contracts without changing component or page data", async () => {
    const directory = await mkdtemp(join(tmpdir(), "uiai-contracts-http-"));
    const app = await createWorkbenchServer({ dataDirectory: directory, fixturePath: resolve("fixtures/bridge-components.json") });
    const address = await app.listen(0);
    const post = (path: string, value: unknown) => fetch(address + path, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value)
    });
    try {
      const created = await post("/api/pages", { name: "Page", reference: { mime: "image/png", base64: PNG } });
      expect(created.status).toBe(200);
      const page = await created.json() as { pageId: string };
      const before = await Promise.all(["workbench.json", "pages.json"].map(name => readFile(join(directory, name), "utf8")));
      for (const path of ["/api/import", "/api/sync"]) {
        const response = await post(path, { version: "0.1.0", sourceCanvas: "Invalid", nodes: [{ name: "" }] });
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: "Invalid request parameters." });
      }
      const malformed = await post(`/api/pages/${page.pageId}/edit`, {
        expectedRevision: 1, root: { id: "root", name: "Invalid", kind: "script" }, issues: []
      });
      expect(malformed.status).toBe(400);
      expect(await malformed.json()).toEqual({ error: "Invalid request parameters." });
      expect(await Promise.all(["workbench.json", "pages.json"].map(name => readFile(join(directory, name), "utf8")))).toEqual(before);
    } finally { await app.close(); }
  });

  it("serves page inputs and approved downloads independently of component library reset", async () => {
    const directory = await mkdtemp(join(tmpdir(), "uiai-pages-http-"));
    const app = await createWorkbenchServer({ dataDirectory: directory, fixturePath: resolve("fixtures/bridge-components.json") });
    const address = await app.listen(0);
    const post = async (path: string, value: unknown) => {
      const response = await fetch(address + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
      expect(response.ok).toBe(true); return response.json() as Promise<any>;
    };
    try {
      const page = await post("/api/pages", { name: "Page", reference: { mime: "image/png", base64: PNG } });
      await post("/api/pages/" + page.pageId + "/approve-structure", { expectedRevision: 1, reviewer: "tester" });
      const plan = await fetch(address + `/api/pages/${page.pageId}/plan`); expect(plan.status).toBe(200);
      expect(plan.headers.get("content-disposition")).toContain("attachment");
      const imported = JSON.parse(await readFile("fixtures/bridge-components.json", "utf8")); await post("/api/import", imported);
      const loaded = await (await fetch(address + `/api/pages/${page.pageId}`)).json() as any;
      expect(loaded.approvals).toHaveLength(1); expect(JSON.stringify(loaded)).not.toContain("apiKey");
    } finally { await app.close(); }
  });
});
