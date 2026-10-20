import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { imageSize } from "image-size";
import { z } from "zod";
import { hashBytes } from "../shared/fingerprint.js";
import { PAGE_SCHEMA_VERSION, PageAssetSchema, PageInputSchema, PageStructureDraftSchema,
  PageIssueSchema, StructureNodeSchema, usedDependencies, walkNodes, decodeBase64, type PageAsset,
  type PageStructureDraft, type StructureNode, type PageIssue, type PageGenerationPlan } from "../shared/page.js";
import { KnowledgeSchema, KnowledgeSnapshot, type KnowledgeFacts, type PageKnowledge } from "./knowledge.js";
import { PageError, StructureRevision, replaceRevisionSubtree } from "./revision.js";
import { ModelStructureProposalSchema, ProposalIntake } from "./proposal.js";
export { PageError } from "./revision.js";
export { ModelStructureProposalSchema } from "./proposal.js";
export { KnowledgeSnapshot, eligibleKnowledge } from "./knowledge.js";
export type { KnowledgeFacts, PageKnowledge } from "./knowledge.js";
const ProposalSchema = z.strictObject({ id: z.string(), expectedRevision: z.number(), nodeId: z.string(), root: StructureNodeSchema,
  issues: z.array(PageIssueSchema), diff: z.array(z.strictObject({ id: z.string(), change: z.enum(["added", "removed", "changed"]), name: z.string() })) });
export type SubtreeProposal = z.infer<typeof ProposalSchema>;
const PageRecordSchema = z.strictObject({ pageId: z.string(), reference: PageAssetSchema, knowledge: z.array(KnowledgeSchema),
  knowledgeHistory: z.array(z.strictObject({ id: z.string(), knowledge: z.array(KnowledgeSchema) })).default([]),
  assets: z.array(PageAssetSchema), revisions: z.array(PageStructureDraftSchema), approvals: z.array(PageStructureDraftSchema), proposals: z.array(ProposalSchema) });
export type PageRecord = z.infer<typeof PageRecordSchema>;
const PageStateSchema = z.strictObject({ schemaVersion: z.literal(PAGE_SCHEMA_VERSION), pages: z.array(PageRecordSchema) });
type PageState = z.infer<typeof PageStateSchema>;
export type PageModelInput = { reference: PageAsset; draft: PageStructureDraft; knowledge: PageKnowledge[];
  selectedNode?: StructureNode | undefined; instructions?: string | undefined };
export interface PagePlanner { propose(input: PageModelInput, signal?: AbortSignal): Promise<unknown> }

export function uploadedImage(input: unknown): PageAsset {
  const value = z.strictObject({ mime: z.enum(["image/png", "image/jpeg"]), base64: z.string().min(1).max(14000000) }).parse(input);
  const bytes = decodeBase64(value.base64);
  if (bytes.length > 10 * 1024 * 1024) throw new PageError(413, "图片超过 10 MB。");
  let dimensions: ReturnType<typeof imageSize>;
  try { dimensions = imageSize(bytes); } catch { throw new PageError(400, "图片内容无效。"); }
  const mime = dimensions.type === "png" ? "image/png" : dimensions.type === "jpg" ? "image/jpeg" : undefined;
  if (mime !== value.mime || dimensions.width > 8192 || dimensions.height > 8192 || dimensions.width <= 0 || dimensions.height <= 0) throw new PageError(400, "仅支持尺寸不超过 8192 的 PNG/JPEG 图片，类型必须与文件内容一致。");
  const sha256 = hashBytes(bytes);
  return PageAssetSchema.parse({ id: `asset-${sha256}`, mime, base64: value.base64, sha256, width: dimensions.width, height: dimensions.height, source: "upload" });
}

function latest(record: PageRecord): PageStructureDraft { return record.revisions.at(-1)!; }
function clone<T>(value: T): T { return structuredClone(value); }

export class PageStore {
  readonly #path: string;
  #queue: Promise<unknown> = Promise.resolve();
  constructor(readonly directory: string, private readonly facts: () => Promise<KnowledgeFacts>) { this.#path = resolve(directory, "pages.json"); }
  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    try { await this.read(); } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
      await this.write({ schemaVersion: PAGE_SCHEMA_VERSION, pages: [] });
    }
  }
  private async read(): Promise<PageState> { return PageStateSchema.parse(JSON.parse(await readFile(this.#path, "utf8"))); }
  private async write(state: PageState): Promise<void> {
    const temporary = `${this.#path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(PageStateSchema.parse(state), null, 2), "utf8");
      await rename(temporary, this.#path);
    } finally { await unlink(temporary).catch(() => undefined); }
  }
  private mutate<T>(fn: (state: PageState) => Promise<T> | T): Promise<T> {
    const result = this.#queue.then(async () => { const state = await this.read(); const value = await fn(state); await this.write(state); return value; });
    this.#queue = result.catch(() => undefined);
    return result;
  }
  private record(state: PageState, pageId: string): PageRecord {
    const record = state.pages.find(page => page.pageId === pageId);
    if (!record) throw new PageError(404, "页面任务不存在。");
    return record;
  }
  private assertRevision(record: PageRecord, expected: number): void {
    if (latest(record).revision !== expected) throw new PageError(409, "页面已更新，请重新加载后再操作。");
  }
  async create(input: unknown): Promise<PageRecord> {
    const value = z.strictObject({ reference: z.unknown(), instructions: z.string().max(20000).default(""), name: z.string().min(1).max(200), width: z.number().positive().max(100000).optional(), height: z.number().positive().max(100000).optional() }).parse(input);
    const reference = uploadedImage(value.reference);
    const snapshot = KnowledgeSnapshot.from(await this.facts());
    const knowledge = snapshot.knowledge;
    const pageId = randomUUID();
    const page = { name: value.name, width: value.width ?? reference.width, height: value.height ?? reference.height };
    const draft = PageStructureDraftSchema.parse({ schemaVersion: PAGE_SCHEMA_VERSION, stage: "structure", pageId, revision: 1,
      input: { reference: { sha256: reference.sha256, mime: reference.mime, width: reference.width, height: reference.height }, instructions: value.instructions, page },
      knowledgeSnapshot: { id: snapshot.id, dependencies: [] },
      root: { id: `${pageId}-root`, kind: "container", name: page.name, rect: { x: 0, y: 0, width: page.width, height: page.height }, children: [] }, issues: [], review: { status: "draft", scope: "structure" } });
    const record: PageRecord = { pageId, reference, knowledge, knowledgeHistory: [], assets: [], revisions: [draft], approvals: [], proposals: [] };
    await this.mutate(state => { state.pages.push(record); });
    return clone(record);
  }
  async list() {
    const snapshot = KnowledgeSnapshot.from(await this.facts());
    return this.mutate(state => state.pages.map(record => {
      const revision = new StructureRevision(record, snapshot.knowledge); const dependencyErrors = revision.invalidate(); const draft = latest(record);
      return { pageId: record.pageId, name: draft.input.page.name, revision: draft.revision, status: draft.review.status, issues: draft.issues.length, dependencyErrors };
    }));
  }
  async get(pageId: string) {
    const snapshot = KnowledgeSnapshot.from(await this.facts());
    return this.mutate(state => {
      const record = this.record(state, pageId); const revision = new StructureRevision(record, snapshot.knowledge); const dependencyErrors = revision.invalidate();
      return { ...clone(record), draft: clone(latest(record)), dependencyErrors,
        candidates: snapshot.availableCandidates(record.knowledge) };
    });
  }
  async edit(pageId: string, input: unknown) {
    const value = z.strictObject({ expectedRevision: z.number().int().positive(), root: StructureNodeSchema.optional(), issues: z.array(PageIssueSchema).optional(), proposalId: z.string().optional(), status: z.enum(["draft", "in_review"]).default("draft") }).parse(input);
    return this.mutate(state => {
      const record = this.record(state, pageId); this.assertRevision(record, value.expectedRevision);
      const revision = new StructureRevision(record, record.knowledge);
      if (value.proposalId) {
        const proposal = record.proposals.find(item => item.id === value.proposalId);
        if (!proposal || proposal.expectedRevision !== value.expectedRevision) throw new PageError(409, "局部修改提案已过期。");
        const current = latest(record);
        const selected = walkNodes(current.root).find(node => node.id === proposal.nodeId)!;
        const oldIds = new Set(walkNodes(selected).map(node => node.id));
        return revision.next(replaceRevisionSubtree(current.root, proposal.nodeId, proposal.root), [...current.issues.filter(issue => !oldIds.has(issue.nodeId)), ...proposal.issues], value.status);
      }
      if (!value.root) throw new PageError(400, "缺少结构树。");
      return revision.next(value.root, value.issues ?? latest(record).issues, value.status);
    });
  }
  async asset(pageId: string, input: unknown): Promise<PageAsset> {
    const asset = uploadedImage(input);
    return this.mutate(state => { const record = this.record(state, pageId); if (!record.assets.some(item => item.id === asset.id)) record.assets.push(asset); return asset; });
  }
  async approve(pageId: string, input: unknown) {
    const value = z.strictObject({ expectedRevision: z.number().int().positive(), reviewer: z.string().trim().min(1).max(200) }).parse(input);
    const snapshot = KnowledgeSnapshot.from(await this.facts());
    const outcome = await this.mutate(state => {
      const record = this.record(state, pageId); this.assertRevision(record, value.expectedRevision);
      return new StructureRevision(record, snapshot.knowledge).approve(value.reviewer);
    });
    if (outcome.errors) throw new PageError(409, outcome.errors.join("\n"));
    return outcome.draft;
  }
  async plan(pageId: string): Promise<PageGenerationPlan> {
    const snapshot = KnowledgeSnapshot.from(await this.facts());
    const outcome = await this.mutate(state => {
      const record = this.record(state, pageId);
      return new StructureRevision(record, snapshot.knowledge).compilePlan(pageId);
    });
    if (outcome.errors) throw new PageError(409, outcome.errors.join("\n"));
    return outcome.plan!;
  }
  async analyze(pageId: string, input: unknown, planner: PagePlanner, signal?: AbortSignal) {
    const value = z.strictObject({ expectedRevision: z.number().int().positive() }).parse(input);
    const record = await this.get(pageId); this.assertRevision(record, value.expectedRevision);
    const snapshot = KnowledgeSnapshot.from(await this.facts());
    const knowledge = snapshot.knowledge;
    signal?.throwIfAborted();
    const proposal = new ProposalIntake(knowledge).page(await planner.propose({ reference: record.reference, draft: record.draft, knowledge }, signal));
    signal?.throwIfAborted();
    return this.mutate(state => {
      signal?.throwIfAborted();
      const saved = this.record(state, pageId); this.assertRevision(saved, value.expectedRevision);
      if (snapshot.id !== latest(saved).knowledgeSnapshot.id) {
        saved.knowledgeHistory.push({ id: latest(saved).knowledgeSnapshot.id, knowledge: clone(saved.knowledge) });
        saved.knowledge = clone(knowledge);
      }
      return new StructureRevision(saved, saved.knowledge).next(proposal.root, proposal.issues, "draft", snapshot.id);
    });
  }
  async revise(pageId: string, input: unknown, planner: PagePlanner, signal?: AbortSignal): Promise<SubtreeProposal> {
    const value = z.strictObject({ expectedRevision: z.number().int().positive(), nodeId: z.string().min(1), instructions: z.string().trim().min(1).max(20000) }).parse(input);
    const record = await this.get(pageId); this.assertRevision(record, value.expectedRevision);
    const selected = walkNodes(record.draft.root).find(node => node.id === value.nodeId);
    if (!selected || selected.kind === "instance") throw new PageError(400, "请选择普通节点或容器，组件内部不可修改。");
    signal?.throwIfAborted();
    const proposal = new ProposalIntake(record.candidates).revision(selected, await planner.propose({ reference: record.reference, draft: record.draft,
      knowledge: record.candidates, selectedNode: selected, instructions: value.instructions }, signal));
    signal?.throwIfAborted();
    const oldIds = new Set(walkNodes(selected).map(node => node.id));
    const fullRoot = replaceRevisionSubtree(record.draft.root, selected.id, proposal.root);
    const issues = [...record.draft.issues.filter(issue => !oldIds.has(issue.nodeId)), ...proposal.issues];
    const candidateDraft = clone(record.draft); candidateDraft.root = fullRoot; candidateDraft.issues = issues;
    new StructureRevision(record, record.knowledge).validateDraft(candidateDraft);
    const proposalRecord: SubtreeProposal = { id: randomUUID(), expectedRevision: value.expectedRevision, nodeId: selected.id,
      root: proposal.root, issues: proposal.issues, diff: proposal.diff };
    return this.mutate(state => {
      signal?.throwIfAborted(); const saved = this.record(state, pageId); this.assertRevision(saved, value.expectedRevision);
      saved.proposals.push(proposalRecord); return clone(proposalRecord);
    });
  }
}
