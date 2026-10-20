# 项目状态

## 目标

维护 UIAI Orchestrator 的组件审核、页面结构规划和 Token 用量诊断工作台。当前产品边界是单 agent 加共享协议，组件同步、页面审批和 Figma 执行保持分层。

## 已定

- 组件审核由单 agent 负责，Manager 已退役：[ADR 0004](docs/adr/0004-shared-component-protocol.md)、[ADR 0007](docs/adr/0007-retire-the-workbench-manager.md)。
- UFB 只提供 Unity 结构与截图证据；页面先形成 Structure Draft，审批后生成执行计划：[ADR 0001](docs/adr/0001-read-only-bridge-and-reviewed-registry.md)、[ADR 0008](docs/adr/0008-structure-page-plans.md)。
- 公共组件、页面和 Bridge 协议由独立 `UIAI-Protocol` 提供，固定使用本地候选 `@uiai/protocol@0.2.0`：[ADR 0009](docs/adr/0009-independent-protocol-repository.md)。
- 用量记录、未知值、失败诊断与恢复归属应用本地 `usage.json`：[ADR 0010](docs/adr/0010-model-usage-and-analysis-diagnostics.md)。
- 页面匹配保留证据、近似匹配决策、Page Gap、Accepted Placeholder 和版本化 Structure Draft：[ADR 0011](docs/adr/0011-page-matching-and-structure-review.md)。
- 组件按 `prefabGuid` 增量同步，保留 Draft 与 Registry；整库替换才清空它们：[ADR 0006](docs/adr/0006-sync-components-by-prefab-guid.md)。
- Windows 双击启动复用当前用户 DPAPI 加密的 AIOA 凭据，绑定服务地址，浏览器填写的密钥仍只在内存：[ADR 0012](docs/adr/0012-model-config-and-encrypted-aioa-credentials.md)，替代 ADR 0002。

## 现状

- 工作副本 `feat/platform3-structure`；本次 GitHub 检查点基于 `cccc3d4`，汇总此前已验证的页面规划、Token 用量、模型配置、启动凭据复用和验收文档。GitHub 仓库为 `Aendier/UIAI-Orchestrator`，本机运行数据及加密凭据保持被 Git 忽略。
- 2026-10-20 工作台全量 18 个测试文件、141 项通过，`pnpm typecheck`、`pnpm build` 通过。Figma 在本仓库隔离构建，15 项测试通过。
- 已核对真实 Token 账本、接口和浏览器：16 次任务、31 次调用，已报告 144,434 tokens；3 次停止调用未返回消耗，保持未知。7/30/全部范围、日期明细和组件结果关联一致；本轮真实模型调用为 0。
- 正式数据为 8 个组件观察、8 个已审核组件、2 个页面。核对前后 `usage.json`、`workbench.json`、`pages.json` 的 SHA-256 一致。一个旧页面 r11 依赖失效正常阻止导出，另一个 r3 可导出，但引用的两个定义与当前 Unity 导出版本不同，需要同步及重审。
- 用户切换账号并明确改用 `TheWarAIUI`（文件 key `adUcvRi1PAy4pv6r4L0VCT`）。真实 Figma 通过独立验收包验证生成、复用、删除重建、手工修改保护、新修订保留旧页、可编辑图片和接受占位；既有三页保留，留下两个标为“非正式审批”的验收页。
- 真实验收使用隔离数据中的测试审批，未替代正式签核。包与证据位于 `.local/verification/20261020-audit/`，入口为 `live-acceptance.json`；详细结论见 [核对报告](docs/2026-10-20-token-figma-audit.md)。Figma 源码在构建后有其它修改，本次通过结论仅对应保存的固定包。
- 启动器和 DPAPI 凭据复用功能保留；当前服务端口应实时检查，不沿用历史 PID。页面知识快照统一逻辑仍位于 `src/pages/knowledge.ts`。本轮临时工作台已关闭，未重启正式工作台或 Unity Bridge。

## 下一步

将正式工作台中 `CommonPopBGUI` 和 `UI_Com_Common_Btn_Primary_L_AllInOne` 同步到当前 Unity 版本，展示差异并完成人工复核，再批准正式页面的新修订；Figma 插件有后续源码改动时对相应固定包重新验收，不把本次测试审批当作正式签核。
