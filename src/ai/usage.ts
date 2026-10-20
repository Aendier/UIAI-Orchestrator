import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { describeAnalysisError } from "./diagnostics.js";

const CountSchema = z.number().int().nonnegative().nullable();
const TokenUsageSchema = z.object({
  inputTokens: CountSchema, outputTokens: CountSchema, totalTokens: CountSchema,
  cachedInputTokens: CountSchema, reasoningTokens: CountSchema
});
const CallSchema = z.object({
  id: z.string(), stage: z.string(), model: z.string(), wireApi: z.enum(["responses", "chat_completions"]),
  provider: z.string().nullable().optional(),
  startedAt: z.string(), finishedAt: z.string().nullable(), durationMs: z.number().nonnegative(),
  status: z.enum(["running", "succeeded", "failed", "cancelled"]), httpStatus: CountSchema,
  tokens: TokenUsageSchema, error: z.string().nullable()
});
const OperationSchema = z.object({
  id: z.string(), kind: z.enum(["component_analysis", "page_analysis", "page_revision"]),
  subjectId: z.string(), subjectName: z.string(), startedAt: z.string(), finishedAt: z.string().nullable(),
  status: z.enum(["running", "succeeded", "failed", "cancelled"]), error: z.string().nullable(),
  resultFingerprint: z.string().nullable(), calls: z.array(CallSchema)
});
const UsageDocumentSchema = z.object({ version: z.literal(1), operations: z.array(OperationSchema) });
export type TokenUsage = z.infer<typeof TokenUsageSchema>;
export type ModelCall = z.infer<typeof CallSchema>;
export type ModelCallObserver = (call: ModelCall) => Promise<void> | void;
type UsageOperation = z.infer<typeof OperationSchema>;

// Counts come from provider usage only. Cache and reasoning are subsets, never added to total.
export function readTokenUsage(body: unknown): TokenUsage {
  const record = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
  const count = (value: unknown): number | null =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
  const usage = record(record(body).usage);
  const inputTokens = count(usage.input_tokens ?? usage.prompt_tokens);
  const outputTokens = count(usage.output_tokens ?? usage.completion_tokens);
  const totalTokens = count(usage.total_tokens) ?? (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null);
  return { inputTokens, outputTokens, totalTokens,
    cachedInputTokens: count(record(usage.input_tokens_details ?? usage.prompt_tokens_details).cached_tokens),
    reasoningTokens: count(record(usage.output_tokens_details ?? usage.completion_tokens_details).reasoning_tokens) };
}

export function summarizeCalls(calls: ModelCall[]) {
  return {
    calls: calls.length,
    unreportedCalls: calls.filter(call => call.tokens.totalTokens === null).length,
    inputTokens: calls.reduce((sum, call) => sum + (call.tokens.inputTokens ?? 0), 0),
    outputTokens: calls.reduce((sum, call) => sum + (call.tokens.outputTokens ?? 0), 0),
    totalTokens: calls.reduce((sum, call) => sum + (call.tokens.totalTokens ?? 0), 0),
    cachedInputTokens: calls.reduce((sum, call) => sum + (call.tokens.cachedInputTokens ?? 0), 0),
    reasoningTokens: calls.reduce((sum, call) => sum + (call.tokens.reasoningTokens ?? 0), 0)
  };
}

export class UsageStore {
  readonly #path: string;
  readonly #context = new AsyncLocalStorage<UsageOperation>();
  #operations: UsageOperation[] = [];
  #writes: Promise<void> = Promise.resolve();

  constructor(private readonly dataDirectory: string) { this.#path = resolve(dataDirectory, "usage.json"); }

  async initialize() {
    await mkdir(this.dataDirectory, { recursive: true });
    try {
      this.#operations = UsageDocumentSchema.parse(JSON.parse(await readFile(this.#path, "utf8"))).operations;
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
    }
    // Preserve reported partial consumption when a service restart interrupted an operation.
    let recovered = false;
    for (const operation of this.#operations) {
      if (operation.status !== "running") continue;
      operation.status = "cancelled";
      operation.finishedAt = new Date().toISOString();
      operation.error = "本地服务重启前分析未完成；已返回的消耗保留，未返回的消耗未知。";
      for (const call of operation.calls) {
        if (call.status !== "running") continue;
        call.status = "cancelled";
        call.finishedAt = operation.finishedAt;
        call.error = "服务重启时请求尚未完成，本次实际消耗未知。";
      }
      recovered = true;
    }
    if (recovered) await this.save();
  }

  readonly recordCall: ModelCallObserver = async call => {
    const operation = this.#context.getStore();
    if (!operation) return;
    const index = operation.calls.findIndex(existing => existing.id === call.id);
    const snapshot = { ...call, tokens: { ...call.tokens } };
    if (index < 0) operation.calls.push(snapshot);
    else operation.calls[index] = snapshot;
    await this.save();
  };

  async track<T>(kind: UsageOperation["kind"], subjectId: string, subjectName: string, task: () => Promise<T>): Promise<T> {
    const operation: UsageOperation = { id: randomUUID(), kind, subjectId, subjectName,
      startedAt: new Date().toISOString(), finishedAt: null, status: "running", error: null,
      resultFingerprint: null, calls: [] };
    this.#operations.unshift(operation);
    await this.save();
    return this.#context.run(operation, async () => {
      try {
        const result = await task();
        operation.status = "succeeded";
        if (result && typeof result === "object" && "observationFingerprint" in result && typeof result.observationFingerprint === "string") {
          operation.resultFingerprint = result.observationFingerprint;
        }
        return result;
      } catch (error) {
        operation.status = error instanceof Error && error.name === "AbortError" ? "cancelled" : "failed";
        operation.error = describeAnalysisError(error);
        // Model validation errors must remain visible instead of becoming generic request errors.
        if (error instanceof z.ZodError) throw new Error(operation.error, { cause: error });
        throw error;
      } finally {
        operation.finishedAt = new Date().toISOString();
        await this.save();
      }
    });
  }

  report() {
    const operations = this.#operations.map(operation => this.present(operation));
    return { version: 1, operations, totals: summarizeCalls(this.#operations.flatMap(operation => operation.calls)),
      operationCount: operations.length,
      failedOperations: operations.filter(operation => operation.status === "failed").length,
      cancelledOperations: operations.filter(operation => operation.status === "cancelled").length,
      recordedSince: this.#operations.at(-1)?.startedAt ?? null };
  }

  component(sourceId: string, draftFingerprint?: string) {
    const operations = this.#operations.filter(operation => operation.kind === "component_analysis" && operation.subjectId === sourceId);
    const result = draftFingerprint ? operations.find(operation =>
      operation.status === "succeeded" && operation.resultFingerprint === draftFingerprint) : undefined;
    return { latestAttempt: operations[0] ? this.present(operations[0]) : null,
      result: result ? this.present(result) : null,
      totals: summarizeCalls(operations.flatMap(operation => operation.calls)) };
  }

  private present(operation: UsageOperation) {
    return { ...operation, totals: summarizeCalls(operation.calls),
      durationMs: Math.max(0, Date.parse(operation.finishedAt ?? new Date().toISOString()) - Date.parse(operation.startedAt)) };
  }

  private async save() {
    const write = this.#writes.then(async () => {
      const temporary = `${this.#path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify({ version: 1, operations: this.#operations }, null, 2) + "\n", "utf8");
        await rename(temporary, this.#path);
      } finally { await unlink(temporary).catch(() => {}); }
    });
    this.#writes = write.catch(() => {});
    await write;
  }
}
