# Token 消耗与失败诊断验收（2026-10-12）

本次只调整 UIAIAgent，保留各仓库原有改动，未修改公共协议或其他消费仓库。

## 功能

- 设置 → Token 消耗：筛选组件/页面/模型/ID、任务和结果，显示实际输入、输出、总量、缓存输入和推理输出；展开可看各调用、时间、模型、耗时、HTTP 状态与错误。分批展示历史，筛选和展开不调用模型。
- 组件审核：显示当前 Draft 对应成功分析的消耗和步骤；累计消耗包含重试。最新失败或停止单独显示，刷新后保留，失败不会覆盖旧 Draft。
- 记录保存到当前数据目录的 `usage.json`。支持 Chat Completions 与 Responses；缓存和推理是子集，不再次加到总量。没有返回用量的显示未知，不估算。记录运行中请求，并在服务重启后保留已报告的部分消耗。
- 同步和导入按钮仅在组件库展示。JSON 导入是离线整库替换，清空草稿与 Registry；已补充用途说明及执行前确认。增量同步仍保留草稿和 Registry。

## 自动检查

- `pnpm test`：14 个测试文件，107 项通过。
- `pnpm typecheck`、`pnpm build`：通过。
- 新增 HTTP 回归覆盖双 API、实际模型名称、缓存/推理子集、失败调用消耗、具体字段/JSON 错误、重试保留旧结果、停止、重启恢复、页面分析与局部修改。
- 用量记录不包含测试密钥、请求头、提示词、图片或原始模型输出。前端输出对组件名称及错误文本进行 HTML 转义。

## 浏览器

- 使用隔离数据和模拟模型完成成功、单次失败、12 组件批量失败、刷新、筛选及成功重试。两个成功任务的固定用量向量总计 6,600，13 个失败任务没有用量时显示未知，旧结果消耗不混入失败重试。未调用真实模型。
- 桌面与 390px 手机视图无页面横向溢出，调用表格在自身区域滚动。未发现页面脚本错误或意外 HTTP 错误。
- 证据：`.local/verification/token-diagnostics-browser-report.json`、`token-diagnostics-settings-desktop.png`、`token-diagnostics-settings-mobile.png`、`token-diagnostics-component-desktop.png`、`token-diagnostics-component-mobile.png`。
- 正式工作台已更新在 `http://127.0.0.1:4320`。AIOA 内置浏览器检查新页签和接口通过，控制台无错误，已观测的网络请求均 200。
- 正式组件库保留 15 个组件，其中 12 个旧分析结果没有历史用量记录。它们显示历史不可追溯；之后的分析自动记录。验收没有重新分析正式组件或消耗真实模型额度。

## 数据与范围

正式 `workbench.json` 与 `pages.json` 的 SHA-256 已核对，与 `.local/verification/token-diagnostics-baseline/data-hashes.json` 一致。旧审批、页修订及批准计划保持原内容。代码、验收脚本、模拟数据和截图均位于当前工作副本。

## 参考图仪表盘追加验收（2026-10-12）

- 按用户参考图将 Token 页改为深蓝仪表盘：顶部总量/输入/输出/缓存读/缓存写/推理输出，随后是每日趋势、消耗构成、后端/模型分布和每日明细。保留完整的调用列表及失败原因。
- 默认最近 30 个本地日历日（含今天），支持 7 天及全部记录。柱子和日期按钮筛选当天的实际调用，跨午夜的任务按各调用开始日分别计入；日期筛选不改变上方范围汇总。
- 后端分布使用新调用记录的服务主机名；旧记录未知。仅保存 host，不保存 URL 用户名/密码、路径、参数。`usage.json` 保持版本 1，兼容无 provider 字段的历史文件。缓存写入未返回时显示“未提供”。
- 消耗图将缓存读从输入、推理从输出中拆出。子项缺失、超出父项或输入输出与总量不一致时保留未拆分区段，各区段总和始终等于已报告总量。部分报告的指标带覆盖数量或星号；失败且完全未报告的日期仍可从调用记录或虚线柱子查看。
- `pnpm test`：15 个测试文件、113 项通过；typecheck、build 通过。新增检查覆盖日历边界、跨日归属、按调用裁剪、未知/零/部分值、图表分区、旧来源、排序、转义及服务主机的隐私边界。
- 隔离浏览器验收使用 26 条模拟任务及本地模拟模型，真实模型费用为零。验证 30/7/全部范围、日期选择/清除、失败筛选、排名展开、主题切换和组件结果跳转；新增模拟分析正确记入 3,300 tokens 与服务主机。
- 桌面 1440px、手机 390px 均无页面或弹窗横向溢出。手机明细表在自身区域横向滚动；无页面脚本错误或意外 HTTP 错误。
- 证据：`.local/verification/token-dashboard-browser-report.json`、`token-dashboard-desktop.png`、`token-dashboard-mobile.png`、`token-dashboard-mobile-daily.png`。这些截图中的用量仅为隔离验收数据，未写入正式工作台。
- 正式工作台 `http://127.0.0.1:4320` 已更新并经 Chrome 只读验收：设置按钮可正常打开弹窗，六张卡片与 30 天趋势加载成功，0 次调用正确显示空状态，桌面/手机无脚本或 HTTP 错误。见 `.local/verification/token-dashboard-live-browser-report.json` 及 `token-dashboard-live-desktop.png`、`token-dashboard-live-mobile.png`。AIOA 原生浏览器本轮截图返回 `UnknownVizError`，可信点击也未激活控件，因此正式页面视觉验收使用独立 Chrome 完成。
- 正式 `workbench.json`、`pages.json` 与本轮 `.local/verification/token-dashboard-baseline/data-hashes.json` 一致，仍保留 15 个组件和 12 个历史分析草稿；没有回填模拟用量或重新分析正式组件。隔离模拟服务已停止，4320 正式工作台继续运行。

## 2026-10-20 正式账本核对

当前真实记录为 16 次任务、31 次调用，已报告总量 144,434 tokens，3 次停止调用用量未知。正式磁盘文件、当前接口和浏览器的 7/30/全部范围、每日汇总、消耗构成及组件结果关联一致；核对前后正式数据哈希一致，未调用真实模型。详情与证据见 [Token 和 Figma 核对报告](2026-10-20-token-figma-audit.md)。此前各日期的组件数量和服务 PID 是历史快照，不代表当前运行状态。
