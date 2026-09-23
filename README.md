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

## Manager-first collaboration

The workbench exposes a Manager (`uiai-manager/v2`) for GitHub-based multi-repository coordination. Register
repositories, create a Coordination Plan, and confirm it before any write-intent Work
Item can become ready. This phase only reads repository metadata through the authenticated
`gh` CLI and records worker reports; it does not write, commit, push, or merge remote
changes.

The manager state is available at `GET /api/manager/state`. The write endpoints are:

- `POST /api/manager/repositories` with `{ "reference": "owner/repository" }`
- `POST /api/manager/workers` with `{ "id": "worker-1", "protocolVersion": "uiai-manager/v2", "capabilities": ["*"] }`
- `POST /api/manager/plans` with a request and registered repository IDs
- `POST /api/manager/plans/:planId/confirm` with `{ "confirmedBy": "manager" }`
- `POST /api/manager/workers/:workerId/claim?workerGeneration=...` to atomically claim the next compatible Work Item
- `POST /api/manager/plans/:planId/work-items/:workItemId/assign` with `workerId` and `workerGeneration`
- `POST /api/manager/plans/:planId/work-items/:workItemId/start` with `workerId` and `workerGeneration`
- `POST /api/manager/plans/:planId/work-items/:workItemId/scan` with `workerId` and `workerGeneration` for a read-only GitHub repository scan
- `POST /api/manager/plans/:planId/work-items/:workItemId/report`
- `POST /api/manager/plans/:planId/work-items/:workItemId/retry`

Workers only communicate with the Manager. A completed `unify_protocol` Work Item
must return a structured `protocolDecision` containing its version, language-neutral
contract schemas, compatibility rules, migration steps, and evidence. This phase produces proposals
and evidence; it never writes, commits, pushes, or merges remote repositories.
Repository scans use `gh api` so open pull requests are included alongside Issues;
they retain at most 24 prioritized context/protocol/configuration files and report
tree, file-selection, and issue pagination truncation in the scan evidence.
Worker identity is trusted within the controlled local runtime; this Manager API is
not a public remote authentication boundary.

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
