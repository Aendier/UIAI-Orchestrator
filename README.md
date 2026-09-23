# UIAI Orchestrator

The orchestration and shared-protocol repository for an auditable image-to-Figma-to-Unity
UI workflow. Its current MVP adapts UnityFigmaBridge exports, uses independent AI roles
to create semantic drafts, requires human approval, and searches only approved component
knowledge.

## Direct use

Double-click `启动组件注册表.cmd`. The local workbench opens in the browser with the
12 sample components already loaded. It automatically loads the selected provider,
model, wire API, and authentication from `~/.codex/config.toml` and
`~/.codex/auth.json`. Complete `OPENAI_*` environment settings take precedence. Model
credentials remain in server memory and are never returned to the browser or written
to workbench data. The model dialog can still override settings for the current process.

## Requirements

- Node.js 22 or newer
- pnpm
- An OpenAI-compatible Responses or Chat Completions endpoint for `analyze`

## Setup

```powershell
pnpm install
Copy-Item .env.example .env
```

Set `OPENAI_BASE_URL`, `OPENAI_API_KEY`, and `OPENAI_MODEL` in the environment used to
run the CLI. The CLI does not load `.env` automatically.

## Workflow

Adapt a Bridge export:

```powershell
pnpm cli adapt --input fixtures/bridge-components.json --output observations.json
```

Analyze one observation with structural and visual roles:

```powershell
pnpm cli analyze --input observations.json --source-id guid-reward-claim --output draft.json
```

Approve a reviewed Component Draft:

```powershell
pnpm cli approve --draft draft.json --registry registry.json `
  --id button.reward.claim --reviewer reviewer-name `
  --use-case "领取奖励" --visual-trait "宽按钮"
```

Search approved knowledge:

```powershell
pnpm cli search --registry registry.json --query "用于领取奖励的按钮" --output result.json
```

## Validation

```powershell
pnpm test
pnpm typecheck
pnpm build
```

See [CONTEXT.md](CONTEXT.md) for domain terms and
[ADR 0001](docs/adr/0001-read-only-bridge-and-reviewed-registry.md) for the trust boundary.
