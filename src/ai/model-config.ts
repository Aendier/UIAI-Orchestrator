import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { parse } from "smol-toml";
import { z } from "zod";

import type { ModelWireApi } from "./openai-compatible.js";
import { readAioaCredential, saveAioaCredential } from "./credential-cache.js";

export interface LoadedModelConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  wireApi: ModelWireApi;
  requiresAuth: boolean;
  source: "codex" | "aioa-cache" | "default" | "environment";
}

export interface ModelConfigOptions {
  environment?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  /** Optional Windows user-encrypted cache for the host-injected AIOA token. */
  credentialCachePath?: string;
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

  const codexDirectories = resolveCodexDirectories(options, environment);
  let codexDirectory = codexDirectories[0]!;
  let config: z.infer<typeof CodexConfigSchema> | undefined;
  for (const candidate of codexDirectories) {
    const candidateConfig = await readOptionalToml(join(candidate, "config.toml"));
    // AIOA may keep project trust settings in the same config directory. Only a
    // file that declares model selection belongs to the model provider loader.
    if (candidateConfig && (
      candidateConfig.model_provider ||
      candidateConfig.model ||
      candidateConfig.model_providers
    )) {
      codexDirectory = candidate;
      config = candidateConfig;
      break;
    }
  }
  const auth = await readOptionalJson(join(codexDirectory, "auth.json"));
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
  let apiKey = resolveProviderApiKey(provider, auth, environment, configuredEnvironment);
  let source: LoadedModelConfig["source"] = "codex";
  if (options.credentialCachePath && !provider.env_key && provider.requires_openai_auth !== false) {
    if (environment.CODEX_API_KEY) {
      try {
        await saveAioaCredential(options.credentialCachePath, { baseUrl: provider.base_url, apiKey });
      } catch {
        console.warn("AIOA 凭据加密缓存未能更新；当前会话仍可使用，独立启动可能需要重新连接。");
      }
    } else {
      const cached = await readAioaCredential(options.credentialCachePath, provider.base_url);
      if (cached) {
        apiKey = cached;
        source = "aioa-cache";
      }
    }
  }

  return {
    baseUrl: provider.base_url,
    apiKey,
    model: config.model,
    wireApi: parseWireApi(provider.wire_api, `Codex wire_api for ${config.model_provider}`),
    requiresAuth: provider.env_key !== undefined || provider.requires_openai_auth !== false,
    source
  };
}

function resolveCodexDirectories(
  options: ModelConfigOptions,
  environment: NodeJS.ProcessEnv
): string[] {
  if (options.homeDirectory !== undefined) return [join(options.homeDirectory, ".codex")];
  const directories = [
    ...(environment.CODEX_HOME ? [environment.CODEX_HOME] : []),
    ...(environment.APPDATA ? [join(environment.APPDATA, "AIOA", "codex")] : []),
    join(homedir(), ".codex")
  ];
  return [...new Set(directories)];
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
  // AIOA injects the active built-in credential as CODEX_API_KEY. Prefer it
  // over a stale Codex auth.json key when the provider does not name another
  // provider-specific environment variable.
  if (environment.CODEX_API_KEY) return environment.CODEX_API_KEY;
  return configuredEnvironment?.OPENAI_API_KEY ?? auth?.OPENAI_API_KEY ?? "";
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
