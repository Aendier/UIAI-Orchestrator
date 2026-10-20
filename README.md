# UIAI Orchestrator

The planning and review application for an auditable image-to-Figma-to-Unity
UI workflow. It consumes the independent `@uiai/protocol` package. Its current MVP
adapts UnityFigmaBridge exports, including each Main
Component screenshot, and uses independent AI roles
to create semantic drafts, requires human approval, and searches only approved component
knowledge.

## Page structure planning

Open the **页面规划** tab in the same workbench. Upload a PNG/JPEG reference (up to
10 MB and 8192 pixels per dimension), confirm the artboard name/size and optional
instructions, then analyze or edit the structure manually. The workbench reuses model
settings and verified component approvals. Legacy component approvals without an
fingerprint need component reanalysis/reapproval first. Adopt the versioned definition
fingerprint by upgrading Unity and Figma and reanalyzing/reviewing old components once.

Select nodes to inspect evidence, original component screenshots and size differences.
Edit ordinary nodes, choose compatible components, upload image assets and decide each
review issue. Component instances keep their original size and internal content.
Choose a decision in each issue's dropdown and provide a reason. Entering a reason
alone keeps the issue pending; the pending count updates immediately after each
decision. Placeholder issues offer **接受占位** to explicitly accept a gap in the
structure preview. Replace a placeholder with a compatible component or uploaded
asset to resolve the gap instead. Before approval, missing decisions or reasons
focus the corresponding control. Save the revision and approve its
structure, or use **保存并批准** to save unsaved edits before approving the new
revision, then download the plan JSON. Failed saves/approvals keep controls available
for correction or retry. Text revision
requests propose changes to the selected subtree; inspect the diff and accept it before
the draft changes. Accepted placeholders stay unresolved in the exported plan.

In the updated UnityFigmaBridge Figma plugin, use **导入页面计划** to open or paste the
JSON. Synchronize Unity components with the updated plugin first so Main Components
have matching definition fingerprints. Results are separate Generated Pages with
linked instances, editable ordinary nodes and a downloadable execution report.

Page history lives in `.local/pages.json`, independently of component library resets.
Structure approval is only for a preview and does not authorize Unity publication.
See [ADR 0008](docs/adr/0008-structure-page-plans.md).

The standalone contract is [`protocol/uiai-page.json`](protocol/uiai-page.json), a
fixed generated artifact from `@uiai/protocol@0.2.0`. TypeScript consumers import
`@uiai/protocol/page`; use `parsePagePlan` for relational validation in addition to
JSON Schema. The existing `uiai-orchestrator/page-protocol` entry remains a compatibility
reexport. Shared schemas, projection, hashes and fixtures are maintained in UIAI-Protocol;
each consumer installs its fixed package. The source-copy `protocol:sync` workflow has
been removed.

The `/api/pages` endpoints create/list tasks; `/:pageId` reads a task; `analyze`,
`edit`, `revise`, `assets` and `approve-structure` accept JSON POSTs; `plan` exports
the approved portable JSON. Edits, model calls and approvals require `expectedRevision`.

## Shared protocol

Canonical contract maintenance lives in [UIAI-Protocol](https://github.com/Aendier/UIAI-Protocol)
(private). This application consumes the fixed `0.2.0` local candidate archive as
`@uiai/protocol@0.2.0`, pinned by `package.json` and the integrity in `pnpm-lock.yaml`.
This candidate is not yet published to GitHub Releases.
See [ADR 0009](docs/adr/0009-independent-protocol-repository.md) and
[artifact provenance](protocol/README.md). The package is not published to npm.

The component contract is [`protocol/uiai-component.json`](protocol/uiai-component.json)
(`uiai-protocol/v1`), also a fixed generated artifact. It covers observations, semantic
drafts, approved components and the registry. TypeScript callers import
`@uiai/protocol/component`; `uiai-orchestrator/protocol` remains a compatibility reexport.
Analysis, model calls, approval, persistence and search stay in this application.

The CLI can still export the installed package's component contract:

```powershell
pnpm cli export-protocol --output component-protocol.json
```

## Direct use

Double-click `启动组件注册表.cmd`. The launcher reuses an already running workbench,
otherwise starts on port 4317 and automatically falls back to 4318 if needed, then
opens the browser with the 12 sample components on first use and preserves an existing library.
It loads the selected provider, model and wire API from `CODEX_HOME`, the AIOA-managed
Codex directory, or `~/.codex/config.toml`, skipping files that only contain project trust.
Complete `OPENAI_*` environment settings take precedence.

On Windows, an AIOA launch automatically saves its injected `CODEX_API_KEY` in
`.local/aioa-credential.dpapi`, encrypted with Windows DPAPI for the current user.
Subsequent double-click launches automatically reuse this credential for the same
provider address without needing an AIOA session. The launcher refreshes the cache
when a newer AIOA session credential is available, even if the workbench is already
running. If the provider expires or revokes the token, launch from AIOA once to update
the cache, then restart the workbench. The cache cannot be transferred to another
Windows user or computer; deleting it removes the saved credential.

The encrypted cache is ignored by Git. Credentials are never returned to the browser
or written to component, page or usage data. Browser-entered overrides remain in memory
for the current process. Providers declaring `env_key` use their own credential and do
not use the AIOA cache. Without a session token or matching cache, the configured
provider environment key or `auth.json` is used.

From a terminal, use `pnpm start` (or `pnpm web`) for the same automatic port selection.

A standalone double-click does not inherit AIOA's session credential. To use AIOA's
built-in authentication, launch from that AIOA session; otherwise configure your own
provider API key in model settings. An HTTP 401 means the credential was rejected;
typing a model name manually does not resolve it. If a matching AIOA model catalog
is available, the dropdown can use it after a provider failure, including after a
model-only switch. Cached model names do not verify authentication or model access.

## Requirements

- Node.js 22 or newer
- pnpm
- An OpenAI-compatible Responses or Chat Completions endpoint for `analyze`

## Setup

Before installing, obtain the fixed local candidate archive and its checksum in the
sibling protocol repository's `releases` directory. The earlier `v0.1.0` Release
remains available, but does not contain the stable definition extension:

```powershell
Get-FileHash ../UIAI-Protocol/releases/uiai-protocol-0.2.0.tgz -Algorithm SHA256
Get-Content ../UIAI-Protocol/releases/uiai-protocol-0.2.0.tgz.sha256
pnpm install --frozen-lockfile
Copy-Item .env.example .env
```

The archive SHA-256 must match the value in [artifact provenance](protocol/README.md).
The archive is already present in the current local workspace. Runtime imports resolve
the installed package, without reading the protocol repository's source files.

Set `OPENAI_BASE_URL`, `OPENAI_API_KEY`, and `OPENAI_MODEL` in the environment used to
run the CLI. The CLI does not load `.env` automatically.

## Workflow

Adapt a Bridge export:

```powershell
pnpm cli adapt --input fixtures/bridge-components.json --output observations.json
```

`POST /api/import` replaces the workbench library and clears review results. `POST /api/sync` accepts the same Bridge `0.1.0` document, updates Observations by `prefabGuid`, and keeps existing Drafts and Registry entries. See [ADR 0006](docs/adr/0006-sync-components-by-prefab-guid.md).
The workbench top bar can request a fresh export from the local Unity `GET /export` endpoint and feed it through the same incremental sync path. The detail action **从 Unity 更新此组件** remains a live one-component refresh through `/api/sync/unity`. The Unity settings tab also offers **同步导出文件** as a fallback for a manually selected Bridge JSON file.
Successful pulls mark the Observation as present; a not-found response for a known object marks it missing while retaining its Draft and Registry review.
New approvals keep both capture evidence and a versioned definition fingerprint.
Batch/single exports, temporary IDs, root placement and optional previews do not
invalidate the definition. Changed structure or resource content still requires
re-review. Legacy approvals/plans keep their original capture-based rules; explicitly
reanalyze/review components and reanalyze/review the page once to export stable refs.
Approval snapshots are never rewritten during this upgrade. The workbench can revoke
one approval, reset review data, or delete one component and its related review data.

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

First-phase page planning evidence and remaining live Figma checks are recorded in
[Platform 3 validation](docs/platform3-validation.md).
The fixed protocol package migration, data compatibility and HTTP smoke checks are
recorded in [Protocol migration validation](docs/protocol-migration.md).

```powershell
pnpm test
pnpm typecheck
pnpm build
```

See [CONTEXT.md](CONTEXT.md) for domain terms and
[ADR 0001](docs/adr/0001-read-only-bridge-and-reviewed-registry.md) for the trust boundary.

## Token 消耗和分析失败诊断

在“设置 → Token 消耗”查看工作台模型调用的输入、输出、总量、缓存输入和推理输出，按组件、页面、模型、任务或结果筛选，展开查看各调用及失败原因。组件审核页显示该分析结果对应的消耗，以及最近失败的原因；重新分析失败会保留旧结果。记录保存到本地数据目录的 `usage.json`，服务重启后仍可查看。

Token 页按深蓝仪表盘展示统计卡片、每日趋势、互不重复的消耗构成、后端/模型分布和每日明细。默认最近 30 天，也可选择最近 7 天或全部记录。点击柱子或日期查看当天的调用，清除日期恢复当前范围的全部调用。日期按本地时间、每次调用的开始日归属；跨日任务按各调用拆分。全部筛选在已读取记录上完成。后端按请求服务的主机名分组，旧记录来源未知；缓存写入未返回时显示“未提供”。

只记录模型服务返回的实际用量。启用前的历史分析无法追溯；未返回用量、停止后未完成的请求显示未知。缓存输入和推理输出分别属于输入、输出，不重复计入总量。

“重新导出并同步”和“导入 JSON”位于组件库页面。导入 JSON 用于离线导入 Unity Bridge 的组件结构和截图，会替换整库并清空旧草稿和人工审核记录，执行前需确认。日常更新使用“重新导出并同步”，或在“设置 → Unity 连接”同步已有导出文件，保留审核结果。页面计划 JSON 由 Figma 插件导入。

验证记录见 [Token 与失败诊断验收](docs/token-diagnostics-validation.md)。
