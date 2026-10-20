import { z } from "zod";
import { CapabilitySchema } from "../semantic/index.js";
import { canonicalJson } from "../shared/fingerprint.js";
import { PageAssetSchema, PageComponentRefSchema, PageStructureDraftSchema, PageIssueSchema, StructureNodeSchema,
  usedDependencies, walkNodes, validateStructure, validateApproval, computePlanHash, parsePagePlan,
  type PageAsset, type PageComponentRef, type PageStructureDraft, type StructureNode, type PageIssue, type PageGenerationPlan } from "../shared/page.js";
import type { PageKnowledge } from "./store.js";

export class PageError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export type RevisionRecord = {
  knowledge: PageKnowledge[];
  assets: PageAsset[];
  revisions: PageStructureDraft[];
  approvals: PageStructureDraft[];
};

function latest(record: RevisionRecord): PageStructureDraft { return record.revisions.at(-1)!; }
function clone<T>(value: T): T { return structuredClone(value); }

function replaceSubtree(root: StructureNode, id: string, replacement: StructureNode): StructureNode {
  if (root.id === id) return clone(replacement);
  return root.kind === "container" ? { ...root, children: root.children.map(child => replaceSubtree(child, id, replacement)) } : root;
}

export function replaceRevisionSubtree(root: StructureNode, id: string, replacement: StructureNode): StructureNode {
  return replaceSubtree(root, id, replacement);
}

export function diffTrees(before: StructureNode, after: StructureNode): Array<{ id: string; change: "added" | "removed" | "changed"; name: string }> {
  const oldNodes = new Map(walkNodes(before).map(node => [node.id, node]));
  const newNodes = new Map(walkNodes(after).map(node => [node.id, node]));
  const diff: Array<{ id: string; change: "added" | "removed" | "changed"; name: string }> = [];
  for (const [id, node] of oldNodes) if (!newNodes.has(id)) diff.push({ id, name: node.name, change: "removed" });
  for (const [id, node] of newNodes) {
    if (!oldNodes.has(id)) diff.push({ id, name: node.name, change: "added" });
    else if (canonicalJson(node) !== canonicalJson(oldNodes.get(id))) diff.push({ id, name: node.name, change: "changed" });
  }
  return diff;
}

export class StructureRevision {
  constructor(private readonly record: RevisionRecord, private readonly knowledge: PageKnowledge[]) {}

  current(): PageStructureDraft { return latest(this.record); }

  dependencyErrors(draft = this.current()): string[] {
    return walkNodes(draft.root).filter(node => node.kind === "instance").filter(node => {
      const revisionKey = (ref: PageComponentRef) => canonicalJson({ ...ref,
        observationFingerprint: ref.definitionFingerprint ? undefined : ref.observationFingerprint });
      const current = this.knowledge.find(candidate => revisionKey(candidate.ref) === revisionKey(node.componentRef));
      return !current || (node.requiredCapabilities ?? []).some(capability => !current.approved.capabilities.includes(capability as never));
    }).map(node => `组件审核或 Observation 已失效：${node.componentRef.componentId}`);
  }

  invalidate(): string[] {
    const current = latest(this.record);
    const errors = this.dependencyErrors(current);
    if (errors.length && current.review.status !== "needs_review") {
      this.record.revisions.push({ ...clone(current), revision: current.revision + 1, review: { status: "needs_review", scope: "structure" } });
    }
    return errors;
  }

  validateDraft(draft: PageStructureDraft): void {
    try { this.validateDraftContent(draft); }
    catch (error) {
      if (error instanceof PageError || error instanceof z.ZodError) throw error;
      throw new PageError(400, error instanceof Error ? error.message : String(error));
    }
  }

  private validateDraftContent(draft: PageStructureDraft): void {
    validateStructure(draft.root, draft.input.page, draft.issues);
    const refs = usedDependencies(draft.root);
    for (const ref of refs) {
      if (!this.record.knowledge.some(candidate => canonicalJson(candidate.ref) === canonicalJson(ref))) {
        throw new PageError(400, `组件不在冻结的审核知识中：${ref.componentId}`);
      }
    }
    for (const node of walkNodes(draft.root)) {
      for (const capability of node.requiredCapabilities ?? []) {
        if (!CapabilitySchema.safeParse(capability).success) throw new PageError(400, `未知业务能力：${capability}`);
      }
      const candidateIds = node.match?.candidateIds ?? [];
      if (candidateIds.some(id => !this.record.knowledge.some(candidate => candidate.ref.componentId === id))) {
        throw new PageError(400, "候选组件身份无效。");
      }
      if (node.kind === "instance") {
        const candidate = this.record.knowledge.find(item => item.ref.componentId === node.componentRef.componentId)!;
        if ((node.requiredCapabilities ?? []).some(capability => !candidate.approved.capabilities.includes(capability as never))) {
          throw new PageError(400, `组件能力不满足要求：${node.id}`);
        }
      }
      if (node.kind === "image" && !this.record.assets.some(asset => asset.id === node.assetId)) {
        throw new PageError(400, "图片节点引用了不存在的上传素材。");
      }
      if (node.kind !== "instance" && node.kind !== "placeholder") {
        const staticCapabilities = node.kind === "container" ? ["container.children"] : node.kind === "text" ? ["text"] : ["image", "display.icon"];
        if ((node.requiredCapabilities ?? []).some(capability => !staticCapabilities.includes(capability))) {
          throw new PageError(400, "普通节点不能承诺项目能力，请保留明确缺口。");
        }
      }
      if (node.kind === "placeholder") {
        const issue = draft.issues.find(issue => issue.id === node.placeholder.issueId)!;
        if (issue.decision !== "pending" && issue.decision !== "accepted_placeholder") {
          throw new PageError(400, "占位缺口只能等待决定或明确接受占位。");
        }
      }
    }
    for (const issue of draft.issues) {
      if (issue.candidateIds.some(id => !this.record.knowledge.some(item => item.ref.componentId === id))) {
        throw new PageError(400, "问题引用了无效候选。");
      }
    }
    draft.knowledgeSnapshot.dependencies = refs;
  }

  next(root: StructureNode, issues: PageIssue[], status: "draft" | "in_review" = "draft", snapshotId = latest(this.record).knowledgeSnapshot.id): PageStructureDraft {
    const current = latest(this.record);
    const draft = PageStructureDraftSchema.parse({ ...current, revision: current.revision + 1, root, issues,
      knowledgeSnapshot: { id: snapshotId, dependencies: [] }, review: { status, scope: "structure" } });
    this.validateDraft(draft);
    this.record.revisions.push(draft);
    return clone(draft);
  }

  approve(reviewer: string): { draft?: PageStructureDraft; errors?: string[] } {
    const errors = this.invalidate();
    if (errors.length) return { errors };
    const draft = clone(latest(this.record));
    const pending = draft.issues.filter(issue => issue.decision === "pending");
    if (pending.length) throw new PageError(409, `还有 ${pending.length} 项待确认，请在“待确认项”中逐项选择审核决定并填写依据，再重新批准。`);
    this.validateDraft(draft);
    draft.review = { status: "structure_approved", scope: "structure", reviewer, reviewedAt: new Date().toISOString(), approvedRevision: draft.revision };
    try { validateApproval(draft.review, draft.revision, draft.issues); }
    catch (error) {
      throw new PageError(409, error instanceof Error && error.message === "A critical structural conflict remains unresolved."
        ? "仍有结构冲突或歧义未解决，请处理后重新批准。" : error instanceof Error ? error.message : String(error));
    }
    if (this.record.approvals.some(item => item.revision === draft.revision)) {
      return { draft: this.record.approvals.find(item => item.revision === draft.revision)! };
    }
    this.record.revisions[this.record.revisions.length - 1] = draft;
    this.record.approvals.push(clone(draft));
    return { draft };
  }

  compilePlan(pageId: string): { plan?: PageGenerationPlan; errors?: string[] } {
    const errors = this.invalidate();
    if (errors.length) return { errors };
    const current = latest(this.record);
    if (current.review.status !== "structure_approved") return { errors: ["当前修订尚未通过结构审核。"] };
    const draft = this.record.approvals.find(item => item.revision === current.revision)!;
    const assetIds = new Set(walkNodes(draft.root).filter(node => node.kind === "image").map(node => node.assetId));
    const content = { schemaVersion: draft.schemaVersion, stage: "structure" as const, purpose: "structure-preview" as const,
      planId: `${pageId}:r${draft.revision}`, pageId, revision: draft.revision, page: draft.input.page, review: draft.review,
      dependencies: usedDependencies(draft.root), root: draft.root,
      assets: this.record.assets.filter(asset => assetIds.has(asset.id)).sort((a, b) => a.id.localeCompare(b.id)),
      unresolved: draft.issues.filter(issue => issue.decision === "accepted_placeholder" || issue.decision === "accepted_difference") };
    return { plan: parsePagePlan({ ...content, planHash: computePlanHash(content) }) };
  }
}
