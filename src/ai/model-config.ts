import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { parse } from "smol-toml";
import { z } from "zod";

import type { ModelWireApi } from "./openai-compatible.js";

export interface LoadedModelConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  wireApi: ModelWireApi;
  requiresAuth: boolean;
  source: "codex" | "default" | "environment";
}

export interface ModelConfigOptions {
  environment?: NodeJS.ProcessEnv;
  homeDirectory?: string;
}

export const ModelBaseUrlSchema = z.url().refine(
  (value) => ["http:", "https:"].includes(new URL(value).protocol),
  "Model base URL must use HTTP or HTTPS."
);

const ProviderSchema = z.object({
  base_url: ModelBaseUrlSchema.optional(),
  wire_api: z.string().optional(),
  env_key: z
    .string()
    .regex(
      /^[A-Za-z_][A-Za-z0-9_]*$/,
      "Provider env_key must be a valid environment variable name."
    )
    .optional(),
  requires_openai_auth: z.boolean().optional()
});

const CodexConfigSchema = z.object({
  model_provider: z.string().optional(),
  model: z.string().optional(),
  model_providers: z.record(z.string(), ProviderSchema).optional(),
  shell_environment_policy: z
    .object({ set: z.record(z.string(), z.string()).optional() })
    .optional()
});

const AuthSchema = z.object({ OPENAI_API_KEY: z.string().optional() });

export async function loadModelConfig(
  options: ModelConfigOptions = {}
): Promise<LoadedModelConfig> {
  const environment = options.environment ?? process.env;
  const hasCompleteEnvironment = Boolean(
    environment.OPENAI_BASE_URL && environment.OPENAI_API_KEY && environment.OPENAI_MODEL
  );

  if (hasCompleteEnvironment) {
    return {
      baseUrl: ModelBaseUrlSchema.parse(environment.OPENAI_BASE_URL),
      apiKey: environment.OPENAI_API_KEY!,
      model: environment.OPENAI_MODEL!,
      wireApi: parseWireApi(environment.OPENAI_WIRE_API, "OPENAI_WIRE_API"),
      requiresAuth: true,
      source: "environment"
    };
  }

  const codexDirectory = join(options.homeDirectory ?? homedir(), ".codex");
  const [config, auth] = await Promise.all([
    readOptionalToml(join(codexDirectory, "config.toml")),
    readOptionalJson(join(codexDirectory, "auth.json"))
  ]);
  if (!config) {
    if (auth?.OPENAI_API_KEY) {
      throw new Error(
        "Codex authentication exists without a model provider configuration."
      );
    }
    return {
      baseUrl: "https://api.openai.com/v1",
      apiKey: "",
      model: "gpt-4.1-mini",
      wireApi: "chat_completions",
      requiresAuth: true,
      source: "default"
    };
  }
  if (!config.model_provider || !config.model) {
    throw new Error("Codex config must select both model_provider and model.");
  }
  const provider = config.model_providers?.[config.model_provider];
  if (!provider?.base_url) {
    throw new Error(`Codex provider is missing base_url: ${config.model_provider}`);
  }
  const configuredEnvironment = config.shell_environment_policy?.set;

  return {
    baseUrl: provider.base_url,
    apiKey: resolveProviderApiKey(provider, auth, environment, configuredEnvironment),
    model: config.model,
    wireApi: parseWireApi(provider.wire_api, `Codex wire_api for ${config.model_provider}`),
    requiresAuth: provider.env_key !== undefined || provider.requires_openai_auth !== false,
    source: "codex"
  };
}

function resolveProviderApiKey(
  provider: z.infer<typeof ProviderSchema>,
  auth: z.infer<typeof AuthSchema> | undefined,
  environment: NodeJS.ProcessEnv,
  configuredEnvironment: Record<string, string> | undefined
): string {
  if (provider.env_key) {
    return environment[provider.env_key] ?? configuredEnvironment?.[provider.env_key] ?? "";
  }
  if (provider.requires_openai_auth === false) return "";
  return auth?.OPENAI_API_KEY ?? configuredEnvironment?.OPENAI_API_KEY ?? "";
}

async function readOptionalToml(
  path: string
): Promise<z.infer<typeof CodexConfigSchema> | undefined> {
  try {
    return CodexConfigSchema.parse(parse(await readFile(path, "utf8")));
  } catch (error: unknown) {
    if (isMissingFile(error)) return undefined;
    throw error;
  }
}

async function readOptionalJson(path: string): Promise<z.infer<typeof AuthSchema> | undefined> {
  try {
    return AuthSchema.parse(JSON.parse(await readFile(path, "utf8")) as unknown);
  } catch (error: unknown) {
    if (isMissingFile(error)) return undefined;
    throw error;
  }
}

function parseWireApi(value: string | undefined, source: string): ModelWireApi {
  if (value === undefined || value === "chat_completions") return "chat_completions";
  if (value === "responses") return "responses";
  const label = source.startsWith("Codex")
    ? "Unsupported Codex wire_api"
    : `Unsupported ${source}`;
  throw new Error(`${label}: ${value}`);
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
