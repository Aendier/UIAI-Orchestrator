# ADR 0012: Model configuration and encrypted AIOA credentials

## Status

Accepted. Supersedes ADR 0002.

## Context

Explorer double-click launches do not inherit the active AIOA session's
`CODEX_API_KEY`. Existing Codex authentication can be stale even while the current
AIOA credential works. The user wants double-click startup to reuse that built-in
credential without returning to a session on every launch.

## Decision

- Treat complete `OPENAI_BASE_URL`, `OPENAI_API_KEY`, and `OPENAI_MODEL` environment
  settings as an atomic override.
- Otherwise discover the selected provider in `CODEX_HOME`, the AIOA-managed Codex
  directory, and `~/.codex`, in order. Skip configs containing only project trust;
  reject malformed or incomplete model selections visibly.
- Providers declaring `env_key` use that named environment variable or its configured
  value. Providers disabling authentication send no Authorization header. Neither
  case consumes the AIOA credential cache.
- For other authenticated providers, prefer the session's `CODEX_API_KEY`, then a
  matching encrypted AIOA cache, then configured `OPENAI_API_KEY`, then `auth.json`.
- On Windows, save only the injected AIOA credential and its provider address in
  `.local/aioa-credential.dpapi`. Encrypt the entire payload with Windows DPAPI
  `CurrentUser`; never persist a plaintext copy or put secrets in command arguments.
  Write the encrypted envelope atomically. `.local` remains ignored by Git.
- Cache reuse requires the same provider address, allowing only trailing-slash
  normalization. Damaged, missing or undecryptable caches fall back to ordinary
  provider configuration. A cache-write failure warns without breaking session use.
- The launcher refreshes the cache when an injected credential is available, including
  when reusing a running service. Newly started servers also refresh or load it.
  Updating the cache does not change a running service's selected model or overrides.
- Support Responses and Chat Completions through the same model adapter. Expose only
  readiness, selected model, base URL, wire API, and configuration source to browsers.
  `aioa-cache` identifies startup from the encrypted cache.
- Browser-entered settings stay process-local. Credentials never enter component,
  page, Registry or usage data.
- A model-only change preserves the original credential's local model catalog fallback.
  A different key or provider disables that fallback. A local model catalog must be
  labeled as unverified and cannot imply working authentication.

## Consequences

- After an initial AIOA launch, Windows double-click startup can work without an AIOA
  session. It does not decrypt AIOA's own application keychain or require changes to AIOA.
- Token expiration or revocation still requires a fresh AIOA launch to update the cache,
  followed by a workbench restart. This cache cannot refresh a token by itself.
- The cache belongs to this working copy and Windows user. It cannot be moved to a
  different user or computer. Deleting the cache removes the saved credential.
- Other operating systems continue to use session or provider configuration without
  writing an unencrypted replacement cache.
