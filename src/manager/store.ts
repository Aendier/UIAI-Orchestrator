import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";

import {
  MANAGER_PROTOCOL_VERSION,
  LEGACY_MANAGER_PROTOCOL_VERSION,
  assignCoordinationTask,
  claimNextCoordinationTask,
  confirmCoordinationPlan,
  CoordinationPlanSchema,
  createCoordinationPlan,
  ManagerStateSchema,
  recordCoordinationTaskReport,
  RepositoryDescriptorSchema,
  RepositoryScanSchema,
  retryCoordinationTask,
  startCoordinationTask,
  WorkerDescriptorSchema,
  type CoordinationPlan,
  type ManagerState,
  type RepositoryDescriptor,
  type RepositoryScan,
  type WorkerDescriptor,
  type WorkerReport
} from "./protocol.js";

export class ManagerStoreError extends Error {
  public constructor(
    public readonly status: 404 | 409,
    message: string
  ) {
    super(message);
  }
}

export class ManagerStore {
  readonly #statePath: string;
  #mutationQueue: Promise<void> = Promise.resolve();

  public constructor(dataDirectory: string) {
    this.#statePath = resolve(dataDirectory, "manager.json");
  }

  public async initialize(): Promise<void> {
    await mkdir(dirname(this.#statePath), { recursive: true });
    try {
      const current = await this.readJson();
      const parsed = ManagerStateSchema.safeParse(current);
      if (parsed.success) return;
      const migrated = migrateManagerState(current);
      if (!migrated) throw parsed.error;
      await this.writeState(migrated);
    } catch (error: unknown) {
      if (!isMissingFile(error)) throw error;
      await this.writeState({
        protocolVersion: MANAGER_PROTOCOL_VERSION,
        repositories: [],
        workers: [],
        plans: []
      });
    }
  }

  public async readState(): Promise<ManagerState> {
    return ManagerStateSchema.parse(await this.readJson());
  }

  public async registerRepository(
    repositoryInput: RepositoryDescriptor
  ): Promise<RepositoryDescriptor> {
    const repository = RepositoryDescriptorSchema.parse(repositoryInput);
    return this.serializeMutation(async () => {
      const state = await this.readState();
      const repositories = [
        ...state.repositories.filter((candidate) => candidate.id !== repository.id),
        repository
      ];
      await this.writeState({ ...state, repositories });
      return repository;
    });
  }

  public async createPlan(
    request: string,
    repositoryIds: string[],
    id = `plan-${randomUUID()}`
  ): Promise<CoordinationPlan> {
    return this.serializeMutation(async () => {
      const state = await this.readState();
      const repositories = repositoryIds.map((repositoryId) => {
        const repository = state.repositories.find((candidate) => candidate.id === repositoryId);
        if (!repository) {
          throw new ManagerStoreError(404, `Repository is not registered: ${repositoryId}`);
        }
        return repository;
      });
      const plan = createCoordinationPlan({ id, request, repositories });
      await this.writeState({ ...state, plans: [...state.plans, plan] });
      return plan;
    });
  }

  public async registerWorker(workerInput: {
    id: string;
    capabilities: string[];
    protocolVersion: string;
    registeredAt?: string;
  }): Promise<WorkerDescriptor> {
    const worker = WorkerDescriptorSchema.parse({
      ...workerInput,
      generation: randomUUID(),
      registeredAt: workerInput.registeredAt ?? new Date().toISOString(),
      lastSeenAt: new Date().toISOString()
    });
    return this.serializeMutation(async () => {
      const state = await this.readState();
      const workers = [
        ...state.workers.filter((candidate) => candidate.id !== worker.id),
        worker
      ];
      await this.writeState({ ...state, workers });
      return worker;
    });
  }

  public async confirmPlan(planId: string, confirmedBy = "manager"): Promise<CoordinationPlan> {
    return this.serializeMutation(async () => {
      const state = await this.readState();
      const plan = this.requirePlan(state, planId);
      const confirmed = confirmCoordinationPlan(plan, confirmedBy);
      return this.replacePlan(state, confirmed);
    });
  }

  public async assignTask(
    planId: string,
    taskId: string,
    workerId: string,
    workerGeneration: string
  ): Promise<CoordinationPlan> {
    return this.serializeMutation(async () => {
      const state = await this.readState();
      const worker = state.workers.find((candidate) => candidate.id === workerId);
      if (!worker) throw new ManagerStoreError(404, `Worker is not registered: ${workerId}`);
      this.assertWorkerGeneration(worker, workerGeneration);
      const plan = this.requirePlan(state, planId);
      const task = plan.workItems.find((candidate) => candidate.id === taskId);
      if (!task) throw new ManagerStoreError(404, `Work Item is not found: ${taskId}`);
      if (!(worker.capabilities.includes("*") || worker.capabilities.includes(task.kind))) {
        throw new ManagerStoreError(409, `Worker cannot perform Work Item kind: ${task.kind}`);
      }
      return this.replacePlan(state, assignCoordinationTask(plan, taskId, workerId));
    });
  }

  public async claimNextTask(
    workerId: string,
    workerGeneration: string,
    planId?: string
  ): Promise<{ plan: CoordinationPlan; taskId: string } | undefined> {
    return this.serializeMutation(async () => {
      const state = await this.readState();
      const worker = state.workers.find((candidate) => candidate.id === workerId);
      if (!worker) throw new ManagerStoreError(404, `Worker is not registered: ${workerId}`);
      this.assertWorkerGeneration(worker, workerGeneration);
      const claimed = claimNextCoordinationTask(state.plans, worker, planId);
      if (!claimed) return undefined;
      await this.replacePlan(state, claimed.plan);
      return claimed;
    });
  }

  public async startTask(
    planId: string,
    taskId: string,
    workerId: string,
    workerGeneration: string
  ): Promise<CoordinationPlan> {
    return this.serializeMutation(async () => {
      const state = await this.readState();
      const worker = state.workers.find((candidate) => candidate.id === workerId);
      if (!worker) throw new ManagerStoreError(404, `Worker is not registered: ${workerId}`);
      this.assertWorkerGeneration(worker, workerGeneration);
      const plan = this.requirePlan(state, planId);
      const started = startCoordinationTask(plan, taskId, workerId);
      return this.replacePlan(state, started);
    });
  }

  public async reportTask(
    planId: string,
    taskId: string,
    report: WorkerReport
  ): Promise<CoordinationPlan> {
    return this.serializeMutation(async () => {
      const state = await this.readState();
      const plan = this.requirePlan(state, planId);
      const task = plan.workItems.find((candidate) => candidate.id === taskId);
      if (!task) throw new ManagerStoreError(404, `Work Item is not found: ${taskId}`);
      const worker = state.workers.find((candidate) => candidate.id === report.workerId);
      if (!worker) throw new ManagerStoreError(404, `Worker is not registered: ${report.workerId}`);
      this.assertWorkerGeneration(worker, report.workerGeneration);
      const reported = recordCoordinationTaskReport(plan, taskId, report);
      return this.replacePlan(state, reported);
    });
  }

  public async scanRepositoryWorkItem(
    planId: string,
    taskId: string,
    workerId: string,
    workerGeneration: string,
    scanner: (repository: RepositoryDescriptor) => Promise<RepositoryScan>
  ): Promise<CoordinationPlan> {
    const repository = await this.serializeMutation(async () => {
      const state = await this.readState();
      const worker = state.workers.find((candidate) => candidate.id === workerId);
      if (!worker) throw new ManagerStoreError(404, `Worker is not registered: ${workerId}`);
      this.assertWorkerGeneration(worker, workerGeneration);
      const plan = this.requirePlan(state, planId);
      const task = plan.workItems.find((candidate) => candidate.id === taskId);
      if (!task) throw new ManagerStoreError(404, `Work Item is not found: ${taskId}`);
      if (task.kind !== "inspect_repository" || task.status !== "in_progress") {
        throw new ManagerStoreError(409, `Work Item is not an active repository inspection: ${taskId}`);
      }
      if (task.assignedWorkerId !== workerId) {
        throw new ManagerStoreError(409, `Work Item is assigned to another worker: ${taskId}`);
      }
      const repository = plan.repositorySnapshots.find(
        (candidate) => candidate.id === task.repositoryId
      );
      if (!repository) {
        throw new ManagerStoreError(404, `Repository is not registered: ${task.repositoryId}`);
      }
      return RepositoryDescriptorSchema.parse(repository);
    });

    const scan = RepositoryScanSchema.parse(await scanner(repository));
    if (scan.repositoryId !== repository.id) {
      throw new ManagerStoreError(409, "Repository scan target does not match the Work Item.");
    }
    if (scan.defaultBranch !== repository.defaultBranch) {
      throw new ManagerStoreError(409, "Repository scan branch does not match the Work Item snapshot.");
    }

    return this.serializeMutation(async () => {
      const state = await this.readState();
      const worker = state.workers.find((candidate) => candidate.id === workerId);
      if (!worker) throw new ManagerStoreError(404, `Worker is not registered: ${workerId}`);
      this.assertWorkerGeneration(worker, workerGeneration);
      const plan = this.requirePlan(state, planId);
      const task = plan.workItems.find((candidate) => candidate.id === taskId);
      if (!task) throw new ManagerStoreError(404, `Work Item is not found: ${taskId}`);
      if (task.kind !== "inspect_repository" || task.status !== "in_progress") {
        throw new ManagerStoreError(409, `Work Item is not an active repository inspection: ${taskId}`);
      }
      if (task.assignedWorkerId !== workerId) {
        throw new ManagerStoreError(409, `Work Item is assigned to another worker: ${taskId}`);
      }
      const currentRepository = plan.repositorySnapshots.find(
        (candidate) => candidate.id === task.repositoryId
      );
      if (
        !currentRepository ||
        currentRepository.id !== repository.id ||
        currentRepository.defaultBranch !== repository.defaultBranch
      ) {
        throw new ManagerStoreError(409, "Repository snapshot changed while the scan was running.");
      }
      const partialEvidence = [
        scan.treeTruncated ? "repository tree" : undefined,
        scan.filesTruncated ? "selected files" : undefined,
        scan.issuesTruncated ? "open issues" : undefined
      ].filter((value): value is string => Boolean(value));
      const evidence = [
        {
          path: `github://tree/${repository.id}/${repository.defaultBranch}`,
          summary: `Read-only scan found ${scan.files.length} selected files and ${scan.issues.length} open issues or pull requests.${partialEvidence.length > 0 ? ` Partial evidence: ${partialEvidence.join(", ")}.` : ""}`
        },
        ...scan.files.map((file) => ({
          path: file.path,
          summary: `Scanned ${file.category} evidence from ${repository.id}.`,
          digest: file.sha
        })),
        ...scan.issues.map((issue) => ({
          path: `github://issues/${issue.number}`,
          summary: `${issue.isPullRequest ? "Open pull request" : "Open issue"}: ${issue.title}`
        }))
      ];
      const report: WorkerReport = {
        protocolVersion: MANAGER_PROTOCOL_VERSION,
        workerId,
        workerGeneration,
        outcome: "completed",
        summary: `Read-only repository scan completed for ${repository.id}.`,
        changedFiles: [],
        tests: ["github-read-only-scan"],
        blockers: [],
        evidence,
        repositoryScan: scan
      };
      const reported = recordCoordinationTaskReport(plan, taskId, report);
      return this.replacePlan(state, reported);
    });
  }

  public async retryTask(planId: string, taskId: string): Promise<CoordinationPlan> {
    return this.serializeMutation(async () => {
      const state = await this.readState();
      const plan = this.requirePlan(state, planId);
      return this.replacePlan(state, retryCoordinationTask(plan, taskId));
    });
  }

  private requirePlan(state: ManagerState, planId: string): CoordinationPlan {
    const plan = state.plans.find((candidate) => candidate.id === planId);
    if (!plan) throw new ManagerStoreError(404, `Plan is not found: ${planId}`);
    return CoordinationPlanSchema.parse(plan);
  }

  private assertWorkerGeneration(worker: WorkerDescriptor, generation: string): void {
    if (worker.generation !== generation) {
      throw new ManagerStoreError(409, `Worker generation is stale: ${worker.id}`);
    }
  }

  private async replacePlan(
    state: ManagerState,
    plan: CoordinationPlan
  ): Promise<CoordinationPlan> {
    await this.writeState({
      ...state,
      plans: state.plans.map((candidate) => (candidate.id === plan.id ? plan : candidate))
    });
    return plan;
  }

  private async serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#mutationQueue.then(operation, operation);
    this.#mutationQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private async readJson(): Promise<unknown> {
    return JSON.parse(await readFile(this.#statePath, "utf8")) as unknown;
  }

  private async writeState(state: ManagerState): Promise<void> {
    const validated = ManagerStateSchema.parse(state);
    const temporaryPath = `${this.#statePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
      await rename(temporaryPath, this.#statePath);
    } catch (error: unknown) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function migrateManagerState(input: unknown): ManagerState | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const record = input as Record<string, unknown>;
  if (![MANAGER_PROTOCOL_VERSION, LEGACY_MANAGER_PROTOCOL_VERSION].includes(record.protocolVersion as typeof MANAGER_PROTOCOL_VERSION | typeof LEGACY_MANAGER_PROTOCOL_VERSION)) return undefined;
  if (!Array.isArray(record.repositories) || !Array.isArray(record.plans)) return undefined;
  const plans = record.plans.map((rawPlan) => {
    if (typeof rawPlan !== "object" || rawPlan === null) return rawPlan;
    const plan = rawPlan as Record<string, unknown>;
    const legacyItems = Array.isArray(plan.tasks) ? plan.tasks : plan.workItems;
    const workItems = Array.isArray(legacyItems)
      ? legacyItems.map((rawItem) => {
          if (typeof rawItem !== "object" || rawItem === null) return rawItem;
          const item = rawItem as Record<string, unknown>;
          const report =
            typeof item.report === "object" && item.report !== null
              ? {
                  ...(item.report as Record<string, unknown>),
                  workerId: (item.report as Record<string, unknown>).workerId ?? "legacy",
                  workerGeneration: (item.report as Record<string, unknown>).workerGeneration ?? "legacy",
                  protocolVersion: MANAGER_PROTOCOL_VERSION,
                  evidence: (item.report as Record<string, unknown>).evidence ?? []
                }
              : item.report;
          return { ...item, report };
        })
      : legacyItems;
    const migratedItems = Array.isArray(workItems)
      ? workItems.map((rawItem) => {
          if (typeof rawItem !== "object" || rawItem === null) return rawItem;
          const item = rawItem as Record<string, unknown>;
          return item.status === "in_progress" && !item.assignedWorkerId
            ? { ...item, status: "blocked" }
            : item;
        })
      : workItems;
    const repositoryIds = Array.isArray(plan.repositoryIds)
      ? plan.repositoryIds.filter((repositoryId): repositoryId is string => typeof repositoryId === "string")
      : [];
    const registeredRepositories = Array.isArray(record.repositories)
      ? record.repositories
      : [];
    const repositorySnapshots = Array.isArray(plan.repositorySnapshots)
      ? plan.repositorySnapshots
      : repositoryIds
          .map((repositoryId) => registeredRepositories.find((repository) =>
            typeof repository === "object" && repository !== null &&
            (repository as Record<string, unknown>).id === repositoryId
          ))
          .filter((repository): repository is Record<string, unknown> => Boolean(repository));
    const hasBlockedItem = Array.isArray(migratedItems) && migratedItems.some((item) =>
      typeof item === "object" && item !== null && (item as Record<string, unknown>).status === "blocked"
    );
    return {
      ...plan,
      protocolVersion: MANAGER_PROTOCOL_VERSION,
      repositorySnapshots,
      workItems: migratedItems,
      status: hasBlockedItem ? "blocked" : plan.status,
      revision: typeof plan.revision === "number" ? plan.revision : 1
    };
  });
  const candidate = {
    ...record,
    protocolVersion: MANAGER_PROTOCOL_VERSION,
    workers: Array.isArray(record.workers)
      ? record.workers.map((worker) =>
          typeof worker === "object" && worker !== null
            ? {
                ...(worker as Record<string, unknown>),
                protocolVersion: MANAGER_PROTOCOL_VERSION,
                generation: (worker as Record<string, unknown>).generation ?? "legacy"
              }
            : worker
        )
      : [],
    plans
  };
  const parsed = ManagerStateSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}
