import { z } from "zod";

export const MANAGER_PROTOCOL_VERSION = "uiai-manager/v2" as const;
export const LEGACY_MANAGER_PROTOCOL_VERSION = "uiai-manager/v1" as const;

const HttpUrlSchema = z.url().refine(
  (value) => ["http:", "https:"].includes(new URL(value).protocol),
  "Repository URL must use HTTP or HTTPS."
);

export const RepositoryDescriptorSchema = z.object({
  id: z.string().regex(/^[^/\s]+\/[^/\s]+$/),
  provider: z.literal("github"),
  url: HttpUrlSchema,
  defaultBranch: z.string().min(1),
  description: z.string().optional()
});

export type RepositoryDescriptor = z.infer<typeof RepositoryDescriptorSchema>;

const CoordinationTaskKindSchema = z.enum([
  "inspect_repository",
  "unify_protocol",
  "align_repository",
  "verify_repository"
]);

const CoordinationTaskStatusSchema = z.enum([
  "planned",
  "ready",
  "in_progress",
  "blocked",
  "completed",
  "failed"
]);

const WriteIntentSchema = z.enum(["read_only", "proposal", "write"]);

export const WorkerReportSchema = z.object({
  protocolVersion: z.string().min(1),
  workerId: z.string().regex(/^[^/\s]+$/),
  workerGeneration: z.string().min(1),
  protocolDecisionVersion: z.string().min(1).optional(),
  outcome: z.enum(["completed", "blocked", "failed"]),
  summary: z.string().min(1),
  changedFiles: z.array(z.string()),
  tests: z.array(z.string()),
  blockers: z.array(z.string()),
  evidence: z.array(z.object({
    path: z.string().min(1),
    summary: z.string().min(1),
    digest: z.string().min(1).optional()
  })),
  protocolDecision: z.lazy(() => ProtocolDecisionSchema).optional()
});

export type WorkerReport = z.infer<typeof WorkerReportSchema>;

export const ProtocolDecisionSchema = z.object({
  version: z.string().min(1),
  name: z.string().min(1),
  summary: z.string().min(1),
  contracts: z.array(z.object({
    name: z.string().min(1),
    format: z.string().min(1),
    schema: z.string().min(1).refine((value) => {
      try {
        JSON.parse(value);
        return true;
      } catch {
        return false;
      }
    }, "Contract schema must be valid JSON."),
    compatibility: z.string().min(1)
  })).min(1),
  migrationSteps: z.array(z.string().min(1)),
  evidence: z.array(z.string().min(1)).min(1)
});

export type ProtocolDecision = z.infer<typeof ProtocolDecisionSchema>;

export const WorkerDescriptorSchema = z.object({
  id: z.string().regex(/^[^/\s]+$/),
  capabilities: z.array(z.string().min(1)).min(1),
  protocolVersion: z.literal(MANAGER_PROTOCOL_VERSION),
  generation: z.string().min(1),
  registeredAt: z.string().datetime(),
  lastSeenAt: z.string().datetime().optional()
});

export type WorkerDescriptor = z.infer<typeof WorkerDescriptorSchema>;

export const CoordinationTaskSchema = z.object({
  id: z.string().min(1),
  repositoryId: z.string().min(1).optional(),
  kind: CoordinationTaskKindSchema,
  title: z.string().min(1),
  objective: z.string().min(1),
  dependsOn: z.array(z.string()),
  writeIntent: WriteIntentSchema,
  status: CoordinationTaskStatusSchema,
  assignedWorkerId: z.string().min(1).optional(),
  protocolDecisionVersion: z.string().min(1).optional(),
  startedAt: z.string().datetime().optional(),
  report: WorkerReportSchema.optional(),
  reportedAt: z.string().datetime().optional()
});

export type CoordinationTask = z.infer<typeof CoordinationTaskSchema>;
export const WorkItemSchema = CoordinationTaskSchema;
export type WorkItem = CoordinationTask;

const CoordinationPlanStatusSchema = z.enum([
  "awaiting_confirmation",
  "approved",
  "in_progress",
  "blocked",
  "completed",
  "cancelled"
]);

export const CoordinationPlanSchema = z.object({
  id: z.string().min(1),
  protocolVersion: z.literal(MANAGER_PROTOCOL_VERSION),
  request: z.string().min(1),
  repositoryIds: z.array(z.string().min(1)).min(1),
  repositorySnapshots: z.array(RepositoryDescriptorSchema).min(1),
  workItems: z.array(WorkItemSchema).min(1),
  status: CoordinationPlanStatusSchema,
  revision: z.number().int().positive(),
  createdAt: z.string().datetime(),
  confirmedAt: z.string().datetime().optional(),
  confirmedBy: z.string().min(1).optional(),
  protocolDecision: ProtocolDecisionSchema.optional()
});

export type CoordinationPlan = z.infer<typeof CoordinationPlanSchema>;

export const ManagerStateSchema = z.object({
  protocolVersion: z.literal(MANAGER_PROTOCOL_VERSION),
  repositories: z.array(RepositoryDescriptorSchema),
  workers: z.array(WorkerDescriptorSchema),
  plans: z.array(CoordinationPlanSchema)
});

export type ManagerState = z.infer<typeof ManagerStateSchema>;

export function createCoordinationPlan(input: {
  id: string;
  request: string;
  repositories: RepositoryDescriptor[];
  createdAt?: string;
}): CoordinationPlan {
  const repositories = input.repositories.map((repository) =>
    RepositoryDescriptorSchema.parse(repository)
  );
  if (repositories.length === 0) {
    throw new Error("A coordination plan requires at least one repository.");
  }
  if (new Set(repositories.map((repository) => repository.id)).size !== repositories.length) {
    throw new Error("Duplicate repository targets are not allowed.");
  }

  const inspectionTasks = repositories.map((repository) => ({
    id: `${input.id}:inspect:${encodeURIComponent(repository.id)}`,
    repositoryId: repository.id,
    kind: "inspect_repository" as const,
    title: `Inspect ${repository.id}`,
    objective: "Read the repository context, protocol manifests, open issues, and active work, then report evidence to the manager.",
    dependsOn: [],
    writeIntent: "read_only" as const,
    status: "planned" as const
  }));
  const inspectionIds = inspectionTasks.map((task) => task.id);
  const unifyTask = {
    id: `${input.id}:unify-protocol`,
    kind: "unify_protocol" as const,
    title: "Unify the shared protocol",
    objective: "Compare repository contracts and produce one manager-owned protocol decision.",
    dependsOn: inspectionIds,
    writeIntent: "proposal" as const,
    status: "planned" as const
  };
  const alignmentTasks = repositories.map((repository) => ({
    id: `${input.id}:align:${encodeURIComponent(repository.id)}`,
    repositoryId: repository.id,
    kind: "align_repository" as const,
    title: `Prepare protocol alignment for ${repository.id}`,
    objective: "Prepare a repository-scoped change proposal from the manager protocol without writing to the remote repository.",
    dependsOn: [unifyTask.id],
    writeIntent: "proposal" as const,
    status: "planned" as const
  }));
  const alignmentIds = alignmentTasks.map((task) => task.id);
  const verificationTasks = repositories.map((repository, index) => ({
    id: `${input.id}:verify:${encodeURIComponent(repository.id)}`,
    repositoryId: repository.id,
    kind: "verify_repository" as const,
    title: `Verify ${repository.id}`,
    objective: "Run the repository checks and report evidence back to the manager.",
    dependsOn: [alignmentIds[index]!],
    writeIntent: "read_only" as const,
    status: "planned" as const
  }));

  return CoordinationPlanSchema.parse({
    id: input.id,
    protocolVersion: MANAGER_PROTOCOL_VERSION,
    request: input.request,
    repositoryIds: repositories.map((repository) => repository.id),
    repositorySnapshots: repositories,
    workItems: [...inspectionTasks, unifyTask, ...alignmentTasks, ...verificationTasks],
    status: "awaiting_confirmation",
    revision: 1,
    createdAt: input.createdAt ?? new Date().toISOString()
  });
}

export function confirmCoordinationPlan(
  input: CoordinationPlan,
  confirmedBy = "manager",
  confirmedAt = new Date().toISOString()
): CoordinationPlan {
  const plan = CoordinationPlanSchema.parse(input);
  if (plan.status !== "awaiting_confirmation") {
    throw new Error(`Cannot confirm a plan in status: ${plan.status}`);
  }
  return CoordinationPlanSchema.parse({
    ...plan,
    status: "approved",
    revision: plan.revision + 1,
    confirmedAt,
    confirmedBy,
    workItems: refreshReadyTasks(plan.workItems)
  });
}

export function startCoordinationTask(
  input: CoordinationPlan,
  taskId: string,
  workerId: string,
  startedAt = new Date().toISOString()
): CoordinationPlan {
  const plan = CoordinationPlanSchema.parse(input);
  if (!["approved", "in_progress"].includes(plan.status)) {
    throw new Error(`Cannot start work while plan is ${plan.status}.`);
  }
  const task = requireTask(plan, taskId);
  if (task.writeIntent === "write") {
    throw new Error("Remote write Work Items are disabled in this manager phase.");
  }
  if (["align_repository", "verify_repository"].includes(task.kind) && !plan.protocolDecision) {
    throw new Error("This Work Item requires the manager Protocol Decision.");
  }
  if (task.status !== "ready" || task.assignedWorkerId !== workerId) {
    throw new Error(`Task is not ready: ${taskId}`);
  }
  const workItems = plan.workItems.map((candidate) =>
    candidate.id === taskId
      ? {
          ...candidate,
          status: "in_progress" as const,
          startedAt,
          protocolDecisionVersion: plan.protocolDecision?.version ?? candidate.protocolDecisionVersion
        }
      : candidate
  );
  return CoordinationPlanSchema.parse({
    ...plan,
    status: "in_progress",
    revision: plan.revision + 1,
    workItems
  });
}

export function recordCoordinationTaskReport(
  input: CoordinationPlan,
  taskId: string,
  reportInput: WorkerReport,
  reportedAt = new Date().toISOString()
): CoordinationPlan {
  const plan = CoordinationPlanSchema.parse(input);
  const report = WorkerReportSchema.parse(reportInput);
  if (report.protocolVersion !== plan.protocolVersion) {
    throw new Error("Manager protocol version mismatch.");
  }
  const task = requireTask(plan, taskId);
  if (task.status !== "in_progress") {
    throw new Error(`Task is not in progress: ${taskId}`);
  }
  if (task.assignedWorkerId !== report.workerId) {
    throw new Error("Worker is not assigned to this Work Item.");
  }
  if (report.outcome === "completed" && report.evidence.length === 0) {
    throw new Error("A completed Work Item report must include evidence.");
  }
  if (["align_repository", "verify_repository"].includes(task.kind)) {
    if (!plan.protocolDecision || report.protocolDecisionVersion !== plan.protocolDecision.version) {
      throw new Error("Work Item report must reference the active Protocol Decision.");
    }
  }
  if (task.kind === "unify_protocol" && report.outcome === "completed" && !report.protocolDecision) {
    throw new Error("A completed protocol-unification report must include a protocol decision.");
  }
  const status = report.outcome;
  const workItems = plan.workItems.map((candidate) =>
    candidate.id === taskId
      ? { ...candidate, status, report, reportedAt }
      : candidate
  );
  const nextWorkItems = refreshReadyTasks(workItems);
  const nextStatus = nextPlanStatus(nextWorkItems);
  return CoordinationPlanSchema.parse({
    ...plan,
    status: nextStatus,
    revision: plan.revision + 1,
    protocolDecision:
      task.kind === "unify_protocol" && report.protocolDecision
        ? report.protocolDecision
        : plan.protocolDecision,
    workItems: nextWorkItems
  });
}

export function assignCoordinationTask(
  input: CoordinationPlan,
  taskId: string,
  workerId: string
): CoordinationPlan {
  const plan = CoordinationPlanSchema.parse(input);
  if (!["approved", "in_progress"].includes(plan.status)) {
    throw new Error(`Cannot assign work while plan is ${plan.status}.`);
  }
  const task = requireTask(plan, taskId);
  if (task.status !== "ready") throw new Error(`Task is not ready: ${taskId}`);
  if (task.assignedWorkerId && task.assignedWorkerId !== workerId) {
    throw new Error(`Task is already assigned: ${taskId}`);
  }
  return CoordinationPlanSchema.parse({
    ...plan,
    revision: plan.revision + 1,
    workItems: plan.workItems.map((candidate) =>
      candidate.id === taskId ? { ...candidate, assignedWorkerId: workerId } : candidate
    )
  });
}

export function retryCoordinationTask(
  input: CoordinationPlan,
  taskId: string
): CoordinationPlan {
  const plan = CoordinationPlanSchema.parse(input);
  if (!["blocked", "in_progress"].includes(plan.status)) {
    throw new Error(`Cannot retry work while plan is ${plan.status}.`);
  }
  const task = requireTask(plan, taskId);
  if (!["blocked", "failed"].includes(task.status)) {
    throw new Error(`Task cannot be retried: ${taskId}`);
  }
  const resetStatus = task.dependsOn.every((dependency) =>
      plan.workItems.some((candidate) => candidate.id === dependency && candidate.status === "completed")
  ) ? "ready" : "planned";
  const remainingBlockers = plan.workItems.some(
    (candidate) => candidate.id !== taskId && ["blocked", "failed"].includes(candidate.status)
  );
  return CoordinationPlanSchema.parse({
    ...plan,
    status: remainingBlockers ? "blocked" : "in_progress",
    revision: plan.revision + 1,
    workItems: plan.workItems.map((candidate) =>
      candidate.id === taskId
        ? { ...candidate, status: resetStatus as "ready" | "planned", assignedWorkerId: undefined, report: undefined, reportedAt: undefined, startedAt: undefined }
        : candidate
    )
  });
}

function requireTask(plan: CoordinationPlan, taskId: string): CoordinationTask {
  const task = plan.workItems.find((candidate) => candidate.id === taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  return task;
}

function refreshReadyTasks(tasks: CoordinationTask[]): CoordinationTask[] {
  const completed = new Set(
    tasks.filter((task) => task.status === "completed").map((task) => task.id)
  );
  return tasks.map((task) =>
    task.status === "planned" && task.dependsOn.every((dependency) => completed.has(dependency))
      ? { ...task, status: "ready" as const }
      : task
  );
}

export function claimNextCoordinationTask(
  plans: CoordinationPlan[],
  worker: WorkerDescriptor,
  planId?: string
): { plan: CoordinationPlan; taskId: string } | undefined {
  const candidates = plans.filter((plan) =>
    (!planId || plan.id === planId) && ["approved", "in_progress"].includes(plan.status)
  );
  for (const plan of candidates) {
    const task = plan.workItems.find((candidate) =>
      candidate.status === "ready" &&
      !candidate.assignedWorkerId &&
      (worker.capabilities.includes("*") || worker.capabilities.includes(candidate.kind))
    );
    if (task) return { plan: assignCoordinationTask(plan, task.id, worker.id), taskId: task.id };
  }
  return undefined;
}

function nextPlanStatus(tasks: CoordinationTask[]): CoordinationPlan["status"] {
  if (tasks.some((task) => task.status === "blocked" || task.status === "failed")) {
    return "blocked";
  }
  if (tasks.every((task) => task.status === "completed")) return "completed";
  return "in_progress";
}
