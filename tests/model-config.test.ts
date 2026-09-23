import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadModelConfig } from "../src/ai/model-config.js";

describe("loadModelConfig", () => {
  it("loads the selected Codex provider and authentication without browser input", async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), "ui-ai-codex-home-"));
    const codexDirectory = join(homeDirectory, ".codex");
    await mkdir(codexDirectory);
    await writeFile(
      join(codexDirectory, "config.toml"),
      [
        'model_provider = "taishi"',
        'model = "gpt-5.6-sol"',
        "",
        "[model_providers.taishi]",
        'base_url = "https://models.example.test/v1"',
        'wire_api = "responses"'
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(codexDirectory, "auth.json"),
      JSON.stringify({ OPENAI_API_KEY: "codex-secret" }),
      "utf8"
    );

    const model = await loadModelConfig({ homeDirectory, environment: {} });

    expect(model).toEqual({
      baseUrl: "https://models.example.test/v1",
      apiKey: "codex-secret",
      model: "gpt-5.6-sol",
      wireApi: "responses",
      requiresAuth: true,
      source: "codex"
    });
  });

  it("prefers explicit environment settings over Codex defaults", async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), "ui-ai-codex-home-"));
    const codexDirectory = join(homeDirectory, ".codex");
    await mkdir(codexDirectory);
    await writeFile(
      join(codexDirectory, "config.toml"),
      [
        'model_provider = "local"',
        'model = "codex-model"',
        "[model_providers.local]",
        'base_url = "https://codex.example.test/v1"',
        'wire_api = "responses"'
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(codexDirectory, "auth.json"),
      JSON.stringify({ OPENAI_API_KEY: "codex-secret" }),
      "utf8"
    );

    const model = await loadModelConfig({
      homeDirectory,
      environment: {
        OPENAI_BASE_URL: "https://environment.example.test/v1",
        OPENAI_API_KEY: "environment-secret",
        OPENAI_MODEL: "environment-model",
        OPENAI_WIRE_API: "chat_completions"
      }
    });

    expect(model).toEqual({
      baseUrl: "https://environment.example.test/v1",
      apiKey: "environment-secret",
      model: "environment-model",
      wireApi: "chat_completions",
      requiresAuth: true,
      source: "environment"
    });
  });

  it("does not let partial runtime variables split a Codex provider configuration", async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), "ui-ai-codex-home-"));
    const codexDirectory = join(homeDirectory, ".codex");
    await mkdir(codexDirectory);
    await writeFile(
      join(codexDirectory, "config.toml"),
      [
        'model_provider = "taishi"',
        'model = "gpt-5.6-sol"',
        "[model_providers.taishi]",
        'base_url = "https://models.example.test/v1"',
        'wire_api = "responses"'
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(codexDirectory, "auth.json"),
      JSON.stringify({ OPENAI_API_KEY: "codex-secret" }),
      "utf8"
    );

    const model = await loadModelConfig({
      homeDirectory,
      environment: {
        CODEX_HOME: join(homeDirectory, "other-codex-runtime"),
        OPENAI_API_KEY: "orphaned-environment-key"
      }
    });

    expect(model).toEqual({
      baseUrl: "https://models.example.test/v1",
      apiKey: "codex-secret",
      model: "gpt-5.6-sol",
      wireApi: "responses",
      requiresAuth: true,
      source: "codex"
    });
  });

  it("uses a provider-specific env_key instead of unrelated OpenAI auth", async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), "ui-ai-codex-home-"));
    const codexDirectory = join(homeDirectory, ".codex");
    await mkdir(codexDirectory);
    await writeFile(
      join(codexDirectory, "config.toml"),
      [
        'model_provider = "custom"',
        'model = "custom-model"',
        "[model_providers.custom]",
        'base_url = "https://custom.example.test/v1"',
        'env_key = "CUSTOM_API_KEY"',
        'wire_api = "chat_completions"'
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(codexDirectory, "auth.json"),
      JSON.stringify({ OPENAI_API_KEY: "unrelated-openai-secret" }),
      "utf8"
    );

    const model = await loadModelConfig({
      homeDirectory,
      environment: { CUSTOM_API_KEY: "custom-secret" }
    });

    expect(model).toEqual({
      baseUrl: "https://custom.example.test/v1",
      apiKey: "custom-secret",
      model: "custom-model",
      wireApi: "chat_completions",
      requiresAuth: true,
      source: "codex"
    });
  });

  it("does not fall back to unrelated OpenAI auth when a provider env_key is missing", async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), "ui-ai-codex-home-"));
    const codexDirectory = join(homeDirectory, ".codex");
    await mkdir(codexDirectory);
    await writeFile(
      join(codexDirectory, "config.toml"),
      [
        'model_provider = "custom"',
        'model = "custom-model"',
        "[model_providers.custom]",
        'base_url = "https://custom.example.test/v1"',
        'env_key = "CUSTOM_API_KEY"'
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(codexDirectory, "auth.json"),
      JSON.stringify({ OPENAI_API_KEY: "unrelated-openai-secret" }),
      "utf8"
    );

    const model = await loadModelConfig({ homeDirectory, environment: {} });

    expect(model).toMatchObject({ apiKey: "", requiresAuth: true });
  });

  it("does not use OpenAI auth for a provider that explicitly disables it", async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), "ui-ai-codex-home-"));
    const codexDirectory = join(homeDirectory, ".codex");
    await mkdir(codexDirectory);
    await writeFile(
      join(codexDirectory, "config.toml"),
      [
        'model_provider = "local"',
        'model = "local-model"',
        "[model_providers.local]",
        'base_url = "http://127.0.0.1:9000/v1"',
        "requires_openai_auth = false"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(codexDirectory, "auth.json"),
      JSON.stringify({ OPENAI_API_KEY: "unrelated-openai-secret" }),
      "utf8"
    );

    const model = await loadModelConfig({ homeDirectory, environment: {} });

    expect(model).toMatchObject({ apiKey: "", requiresAuth: false });
  });

  it("does not read Codex files when a complete environment override is present", async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), "ui-ai-codex-home-"));
    const codexDirectory = join(homeDirectory, ".codex");
    await mkdir(codexDirectory);
    await writeFile(join(codexDirectory, "config.toml"), "not valid = [", "utf8");
    await writeFile(join(codexDirectory, "auth.json"), "not-json", "utf8");

    const model = await loadModelConfig({
      homeDirectory,
      environment: {
        OPENAI_BASE_URL: "https://environment.example.test/v1",
        OPENAI_API_KEY: "environment-secret",
        OPENAI_MODEL: "environment-model",
        OPENAI_WIRE_API: "responses"
      }
    });

    expect(model.source).toBe("environment");
  });

  it("rejects an unsupported Codex wire API instead of silently changing protocol", async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), "ui-ai-codex-home-"));
    const codexDirectory = join(homeDirectory, ".codex");
    await mkdir(codexDirectory);
    await writeFile(
      join(codexDirectory, "config.toml"),
      [
        'model_provider = "legacy"',
        'model = "legacy-model"',
        "[model_providers.legacy]",
        'base_url = "https://legacy.example.test/v1"',
        'wire_api = "legacy_completions"'
      ].join("\n"),
      "utf8"
    );

    await expect(loadModelConfig({ homeDirectory, environment: {} })).rejects.toThrow(
      "Unsupported Codex wire_api: legacy_completions"
    );
  });

  it("rejects credentials without a selected provider instead of using defaults", async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), "ui-ai-codex-home-"));
    const codexDirectory = join(homeDirectory, ".codex");
    await mkdir(codexDirectory);
    await writeFile(
      join(codexDirectory, "auth.json"),
      JSON.stringify({ OPENAI_API_KEY: "unbound-secret" }),
      "utf8"
    );

    await expect(loadModelConfig({ homeDirectory, environment: {} })).rejects.toThrow(
      "Codex authentication exists without a model provider configuration."
    );
  });

  it("rejects a provider base URL that cannot be used for HTTP requests", async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), "ui-ai-codex-home-"));
    const codexDirectory = join(homeDirectory, ".codex");
    await mkdir(codexDirectory);
    await writeFile(
      join(codexDirectory, "config.toml"),
      [
        'model_provider = "broken"',
        'model = "broken-model"',
        "[model_providers.broken]",
        'base_url = "not-a-url"',
        'wire_api = "responses"'
      ].join("\n"),
      "utf8"
    );

    await expect(loadModelConfig({ homeDirectory, environment: {} })).rejects.toThrow();
  });
});
