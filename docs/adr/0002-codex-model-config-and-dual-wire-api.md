# ADR 0002: Codex model discovery and dual wire APIs

## Status

Accepted

## Context

The local workbench must run without command-line configuration. Codex already stores
the selected model provider and authentication in the user's `.codex` directory.
Providers may expose either the Responses API or Chat Completions API.

## Decision

- Load provider, model, wire API, and authentication from `~/.codex/config.toml` and
  `~/.codex/auth.json` when a complete `OPENAI_*` environment configuration is absent.
- When a selected provider declares `env_key`, resolve only that environment variable;
  never fall back to an unrelated `OPENAI_API_KEY` from Codex authentication.
- Providers that explicitly set `requires_openai_auth = false` may run without an API
  key; the adapter omits the Authorization header for those requests.
- Treat environment configuration as an atomic override so credentials are not mixed
  with a provider from another source.
- Support both `responses` and `chat_completions` wire APIs behind the same analysis
  agent interface.
- Keep credentials in server memory. Expose only readiness, model, base URL, wire API,
  and configuration source to the browser.
- Keep browser-entered model settings process-local and do not persist them.

## Consequences

- Double-click startup can use the same provider as Codex without copying secrets.
- Provider-specific request and response shapes remain isolated in the model adapter.
- A malformed Codex configuration fails startup visibly instead of silently selecting a
  different provider.
