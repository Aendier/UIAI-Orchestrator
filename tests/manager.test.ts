import { describe, expect, it } from "vitest";

import {
  MANAGER_PROTOCOL_VERSION,
  assignCoordinationTask,
  createCoordinationPlan,
  confirmCoordinationPlan,
  recordCoordinationTaskReport,
  retryCoordinationTask,
  startCoordinationTask,
  type RepositoryDescriptor
} from "../src/manager/protocol.js";

const repositories: RepositoryDescriptor[] = [
  {
    id: "acme/client",
    provider: "github",
    url: "https://github.com/acme/client",
    defaultBranch: "main",
    description: "Client repository"
  },
  {
    id: "acme/backend",
    provider: "github",
    url: "https://github.com/acme/backend",
    defaultBranch: "main"
  }
];
const workerGeneration = "generation-1";

describe("manager coordination protocol", () => {
  it("creates a cross-repository plan that waits for manager confirmation", () => {
    const plan = createCoordinationPlan({
      id: "plan-001",
      request: "统一登录协议并准备客户端和服务端协同改动",
      repositories,
      createdAt: "2026-09-23T00:00:00.000Z"
    });

    expect(plan).toMatchObject({
      id: "plan-001",
      protocolVersion: MANAGER_PROTOCOL_VERSION,
      status: "awaiting_confirmation",
      repositoryIds: ["acme/client", "acme/backend"]
    });
    expect(plan.workItems).toHaveLength(7);
    expect(plan.workItems.filter((task) => task.writeIntent === "proposal")).toHaveLength(3);
    expect(plan.workItems.find((task) => task.kind === "unify_protocol")).toMatchObject({
      dependsOn: expect.arrayContaining([
        "plan-001:inspect:acme%2Fclient",
        "plan-001:inspect:acme%2Fbackend"
      ])
    });
  });

  it("unlocks work in dependency order after confirmation and worker reports", () => {
    const draft = createCoordinationPlan({
      id: "plan-002",
      request: "统一协议",
      repositories,
      createdAt: "2026-09-23T00:00:00.000Z"
    });
    const approved = confirmCoordinationPlan(
      draft,
      "manager",
      "2026-09-23T00:01:00.000Z"
    );
    const firstInspection = approved.workItems.find(
      (task) => task.kind === "inspect_repository" && task.repositoryId === "acme/client"
    );
    expect(firstInspection?.status).toBe("ready");
    expect(approved.workItems.find((task) => task.kind === "unify_protocol")?.status).toBe(
      "planned"
    );

    const assigned = assignCoordinationTask(approved, firstInspection!.id, "worker-1");
    const running = startCoordinationTask(assigned, firstInspection!.id, "worker-1");
    const reported = recordCoordinationTaskReport(running, firstInspection!.id, {
      protocolVersion: MANAGER_PROTOCOL_VERSION,
      workerId: "worker-1",
      workerGeneration,
      outcome: "completed",
      summary: "协议清单已读取",
      changedFiles: [],
      tests: ["context-present"],
      blockers: [],
      evidence: [{ path: "CONTEXT.md", summary: "Context loaded" }],
      repositoryScan: {
        protocolVersion: MANAGER_PROTOCOL_VERSION,
        repositoryId: "acme/client",
        defaultBranch: "main",
        scannedAt: "2026-09-23T00:02:00.000Z",
        treeTruncated: false,
        filesTruncated: false,
        issuesTruncated: false,
        files: [{ path: "CONTEXT.md", category: "context", sha: "sha-context", content: "# Context", truncated: false }],
        issues: []
      }
    }, "2026-09-23T00:02:00.000Z");

    expect(reported.workItems.find((task) => task.id === firstInspection!.id)?.status).toBe(
      "completed"
    );
    expect(reported.workItems.find((task) => task.kind === "unify_protocol")?.status).toBe(
      "planned"
    );
  });

  it("rejects reports from a different protocol version", () => {
    const draft = createCoordinationPlan({
      id: "plan-003",
      request: "统一协议",
      repositories,
      createdAt: "2026-09-23T00:00:00.000Z"
    });
    const approved = confirmCoordinationPlan(draft, "manager", "2026-09-23T00:01:00.000Z");
    const task = approved.workItems.find((item) => item.status === "ready")!;
    const assigned = assignCoordinationTask(approved, task.id, "worker-1");
    const running = startCoordinationTask(assigned, task.id, "worker-1");

    expect(() =>
      recordCoordinationTaskReport(running, task.id, {
        protocolVersion: "other/v1",
        workerId: "worker-1",
        workerGeneration,
        outcome: "completed",
        summary: "错误协议",
        changedFiles: [],
        tests: [],
        blockers: [],
        evidence: []
      })
    ).toThrow("Manager protocol version mismatch");
  });

  it("rejects duplicate repository targets", () => {
    expect(() =>
      createCoordinationPlan({
        id: "plan-004",
        request: "统一协议",
        repositories: [repositories[0]!, repositories[0]!]
      })
    ).toThrow("Duplicate repository");
  });

  it("stores one structured protocol decision before unlocking alignment work", () => {
    let plan = confirmCoordinationPlan(
      createCoordinationPlan({
        id: "plan-protocol",
        request: "unify contracts",
        repositories,
        createdAt: "2026-09-23T00:00:00.000Z"
      }),
      "manager",
      "2026-09-23T00:01:00.000Z"
    );
    for (const repository of repositories) {
      const inspection = plan.workItems.find(
        (item) => item.kind === "inspect_repository" && item.repositoryId === repository.id
      )!;
      plan = recordCoordinationTaskReport(
        startCoordinationTask(
          assignCoordinationTask(plan, inspection.id, "worker-1"),
          inspection.id,
          "worker-1"
        ),
        inspection.id,
        {
          protocolVersion: MANAGER_PROTOCOL_VERSION,
          workerId: "worker-1",
          workerGeneration,
          outcome: "completed",
          summary: `inspected ${repository.id}`,
          changedFiles: [],
          tests: ["context-present"],
          blockers: [],
          evidence: [{ path: "CONTEXT.md", summary: "Context loaded" }],
          repositoryScan: {
            protocolVersion: MANAGER_PROTOCOL_VERSION,
            repositoryId: repository.id,
            defaultBranch: repository.defaultBranch,
            scannedAt: "2026-09-23T00:02:00.000Z",
            treeTruncated: false,
            filesTruncated: false,
            issuesTruncated: false,
            files: [{ path: "CONTEXT.md", category: "context", sha: "sha-context", content: "# Context", truncated: false }],
            issues: []
          }
        }
      );
    }
    const unify = plan.workItems.find((item) => item.kind === "unify_protocol")!;
    expect(unify.status).toBe("ready");
    plan = recordCoordinationTaskReport(
      startCoordinationTask(
        assignCoordinationTask(plan, unify.id, "worker-1"),
        unify.id,
        "worker-1"
      ),
      unify.id,
      {
        protocolVersion: MANAGER_PROTOCOL_VERSION,
        workerId: "worker-1",
        workerGeneration,
        outcome: "completed",
        summary: "protocol decision produced",
        changedFiles: [],
        tests: ["contract-check"],
        blockers: [],
        evidence: [{ path: "protocol.json", summary: "Compared repository contracts" }],
        protocolDecision: {
          version: "shared/v1",
          name: "Manager Work Item Protocol",
          summary: "One manager-owned contract for all repositories.",
          contracts: [{
            name: "worker-report",
            format: "JSON",
            schema: "{\"type\":\"object\"}",
            compatibility: "additive fields only"
          }],
          migrationSteps: ["adopt the manager report schema"],
          evidence: ["acme/client", "acme/backend"]
        }
      }
    );
    expect(plan.protocolDecision?.version).toBe("shared/v1");
    expect(plan.workItems.filter((item) => item.kind === "align_repository").every((item) => item.status === "ready")).toBe(true);
    const alignment = plan.workItems.find((item) => item.kind === "align_repository")!;
    const alignmentRunning = startCoordinationTask(
      assignCoordinationTask(plan, alignment.id, "worker-1"),
      alignment.id,
      "worker-1"
    );
    expect(() => recordCoordinationTaskReport(alignmentRunning, alignment.id, {
      protocolVersion: MANAGER_PROTOCOL_VERSION,
      workerId: "worker-1",
      workerGeneration,
      outcome: "completed",
      summary: "proposal ready",
      changedFiles: [],
      tests: [],
      blockers: [],
      evidence: [{ path: "proposal.md", summary: "Proposal prepared" }]
    })).toThrow("active Protocol Decision");
    const aligned = recordCoordinationTaskReport(alignmentRunning, alignment.id, {
      protocolVersion: MANAGER_PROTOCOL_VERSION,
      workerId: "worker-1",
      workerGeneration,
      protocolDecisionVersion: "shared/v1",
      outcome: "completed",
      summary: "proposal ready",
      changedFiles: [],
      tests: ["proposal-check"],
      blockers: [],
      evidence: [{ path: "proposal.md", summary: "Proposal prepared" }]
    });
    expect(aligned.workItems.find((item) => item.id === alignment.id)?.protocolDecisionVersion).toBe("shared/v1");
  });

  it("retries a blocked Work Item and avoids repository ID collisions", () => {
    const collisionPlan = createCoordinationPlan({
      id: "plan-collision",
      request: "check IDs",
      repositories: [
        { ...repositories[0]!, id: "a/b-c", url: "https://github.com/a/b-c" },
        { ...repositories[0]!, id: "a-b/c", url: "https://github.com/a-b/c" }
      ]
    });
    const inspectionIds = collisionPlan.workItems
      .filter((item) => item.kind === "inspect_repository")
      .map((item) => item.id);
    expect(new Set(inspectionIds).size).toBe(2);

    const approved = confirmCoordinationPlan(collisionPlan);
    const inspection = approved.workItems.find((item) => item.kind === "inspect_repository")!;
    const blocked = recordCoordinationTaskReport(
      startCoordinationTask(
        assignCoordinationTask(approved, inspection.id, "worker-1"),
        inspection.id,
        "worker-1"
      ),
      inspection.id,
      {
        protocolVersion: MANAGER_PROTOCOL_VERSION,
        workerId: "worker-1",
        workerGeneration,
        outcome: "blocked",
        summary: "worker needs credentials",
        changedFiles: [],
        tests: [],
        blockers: ["credentials"],
        evidence: []
      }
    );
    expect(blocked.status).toBe("blocked");
    expect(retryCoordinationTask(blocked, inspection.id).workItems.find((item) => item.id === inspection.id)?.status).toBe("ready");
  });
});
