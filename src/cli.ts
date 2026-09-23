#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { createOpenAICompatibleAgents } from "./ai/openai-compatible.js";
import { adaptBridgeDocument } from "./bridge/index.js";
import { ObservationDocumentSchema } from "./observation/index.js";
import {
  approveDraft,
  ComponentRegistrySchema,
  interpretQuery,
  searchRegistry
} from "./registry/index.js";
import { SCHEMA_VERSION } from "./schema-version.js";
import { createSharedProtocol } from "./protocol/index.js";
import { analyzeComponent } from "./semantic/index.js";

async function main(argv: string[]): Promise<void> {
  const [command, ...args] = argv;
  switch (command) {
    case "adapt":
      await adaptCommand(args);
      return;
    case "analyze":
      await analyzeCommand(args);
      return;
    case "approve":
      await approveCommand(args);
      return;
    case "search":
      await searchCommand(args);
      return;
    case "export-protocol":
      await writeJson(requiredOption(args, "--output"), createSharedProtocol());
      return;
    default:
      throw new Error(
        "Usage: ui-ai <adapt|analyze|approve|search|export-protocol> [options]"
      );
  }
}

async function adaptCommand(args: string[]): Promise<void> {
  const inputPath = requiredOption(args, "--input");
  const outputPath = requiredOption(args, "--output");
  const raw = await readJson(inputPath);
  const observations = adaptBridgeDocument(raw);
  await writeJson(outputPath, observations);
}

async function analyzeCommand(args: string[]): Promise<void> {
  const input = ObservationDocumentSchema.parse(
    await readJson(requiredOption(args, "--input"))
  );
  const sourceId = option(args, "--source-id");
  const observation = sourceId
    ? input.observations.find((entry) => entry.root.sourceId === sourceId)
    : input.observations[0];
  if (observation === undefined) {
    throw new Error(
      sourceId ? `Observation not found: ${sourceId}` : "No observations found."
    );
  }
  const agents = createOpenAICompatibleAgents({
    baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    apiKey: requiredEnvironment("OPENAI_API_KEY"),
    model: requiredEnvironment("OPENAI_MODEL")
  });
  const draft = await analyzeComponent({ observation, ...agents });
  await writeJson(requiredOption(args, "--output"), draft);
}

async function approveCommand(args: string[]): Promise<void> {
  const draft = await readJson(requiredOption(args, "--draft"));
  const registryPath = requiredOption(args, "--registry");
  const registry = await readRegistry(registryPath);
  const approved = approveDraft(draft, registry, {
    id: requiredOption(args, "--id"),
    approvedBy: requiredOption(args, "--reviewer"),
    useCases: options(args, "--use-case"),
    visualTraits: options(args, "--visual-trait")
  });
  await writeJson(registryPath, approved);
}

async function searchCommand(args: string[]): Promise<void> {
  const registry = ComponentRegistrySchema.parse(
    await readJson(requiredOption(args, "--registry"))
  );
  const query = interpretQuery(requiredOption(args, "--query"));
  const result = searchRegistry(registry, query);
  await writeJson(requiredOption(args, "--output"), result);
}

function requiredOption(args: string[], name: string): string {
  const value = option(args, name);
  if (!value) throw new Error(`Missing required option: ${name}`);
  return value;
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function options(args: string[], name: string): string[] {
  return args.flatMap((value, index) =>
    value === name && args[index + 1] ? [args[index + 1]!] : []
  );
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(path), "utf8")) as unknown;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  const output = resolve(path);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readRegistry(path: string): Promise<unknown> {
  try {
    return await readJson(path);
  } catch (error: unknown) {
    if (isMissingFile(error)) return { schemaVersion: SCHEMA_VERSION, components: [] };
    throw error;
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

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
