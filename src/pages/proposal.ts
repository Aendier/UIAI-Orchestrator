import { z } from "zod";
import { canonicalJson } from "../shared/fingerprint.js";
import { PageIssueSchema, StructureNodeSchema, normalizeGlobalCoordinates, usedDependencies, walkNodes, type PageIssue, type StructureNode } from "../shared/page.js";
import { PageError, diffTrees } from "./revision.js";
import type { PageKnowledge } from "./store.js";

export const ModelStructureProposalSchema = z.strictObject({
  coordinateSpace: z.enum(["global", "local"]),
  root: StructureNodeSchema,
  issues: z.array(PageIssueSchema)
});
export type ModelStructureProposal = z.infer<typeof ModelStructureProposalSchema>;
export type ProposalRevision = { root: StructureNode; issues: PageIssue[]; diff: ReturnType<typeof diffTrees> };

export class ProposalIntake {
  constructor(private readonly candidates: PageKnowledge[]) {}

  parse(input: unknown): ModelStructureProposal {
    const result = ModelStructureProposalSchema.safeParse(input);
    if (!result.success) {
      throw new PageError(502, "模型输出不符合页面协议：" + result.error.issues.slice(0, 6).map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; "));
    }
    return result.data;
  }

  page(input: unknown): { root: StructureNode; issues: PageIssue[] } {
    const proposal = this.parse(input);
    this.validateCandidates(proposal.root, proposal.issues);
    return {
      root: proposal.coordinateSpace === "global" ? normalizeGlobalCoordinates(proposal.root) : proposal.root,
      issues: proposal.issues
    };
  }

  revision(selected: StructureNode, input: unknown): ProposalRevision {
    const proposal = this.parse(input);
    this.validateCandidates(proposal.root, proposal.issues);
    if (proposal.coordinateSpace !== "local" || proposal.root.id !== selected.id) {
      throw new PageError(400, "局部提案必须保留所选节点 ID，并使用父节点局部坐标。");
    }
    const subtreeIds = new Set(walkNodes(proposal.root).map(node => node.id));
    if (proposal.issues.some(issue => !subtreeIds.has(issue.nodeId))) {
      throw new PageError(400, "局部提案修改了范围外的问题。");
    }
    return { root: proposal.root, issues: proposal.issues, diff: diffTrees(selected, proposal.root) };
  }

  private validateCandidates(root: StructureNode, issues: PageIssue[]): void {
    if (issues.some(issue => issue.decision !== "pending")) {
      throw new PageError(400, "模型不能代替人工作出审核决定。");
    }
    for (const ref of usedDependencies(root)) {
      if (!this.candidates.some(candidate => canonicalJson(candidate.ref) === canonicalJson(ref))) {
        throw new PageError(400, "模型引用了允许集合之外的组件。");
      }
    }
  }
}
