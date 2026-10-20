# ADR 0002: Codex model discovery and dual wire APIs

## Status

Superseded by [ADR 0012](0012-model-config-and-encrypted-aioa-credentials.md).

## Context

The local workbench must run without command-line configuration. Codex already stores
the selected model provider and authentication in the user's `.codex` directory.
Providers may expose either the Responses API or Chat Completions API.

## Decision

- Load provider, model, wire API, and authentication from `~/.codex/config.toml` and
  `~/.codex/auth.json` when a complete `OPENAI_*` environment configuration is absent.
- When a selected provider declares `env_key`, resolve only that environment variable;
  never fall back to an unrelated `OPENAI_API_KEY` from Codex authentication.
- In the AIOA runtime, prefer the host-injected `CODEX_API_KEY` for providers that do
  not declare another `env_key`; use `.codex/auth.json` only when that built-in token
  is unavailable.
- Providers that explicitly set `requires_openai_auth = false` may run without an API
  key; the adapter omits the Authorization header for those requests.
- Treat environment configuration as an atomic override so credentials are not mixed
  with a provider from another source.
- Support both `responses` and `chat_completions` wire APIs behind the same analysis
  agent interface.
- Keep credentials in server memory. Expose only readiness, model, base URL, wire API,
  and configuration source to the browser.
- Keep browser-entered model settings process-local and do not persist them.
- A model-only change preserves the original credential's local model catalog fallback.
  Supplying a different credential or provider address disables that fallback; cache
  results must be labeled as unverified and must not imply working authentication.

## Consequences

- Double-click startup can load provider settings and any existing stored key, but
  does not inherit AIOA's host-injected credential. Built-in authentication requires
  launching in an AIOA session; standalone startup needs a valid user-configured key.
- Provider-specific request and response shapes remain isolated in the model adapter.
- A malformed Codex configuration fails startup visibly instead of silently selecting a
  different provider.
