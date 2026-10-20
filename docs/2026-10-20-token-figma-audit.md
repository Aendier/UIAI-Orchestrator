# Token 数据和 Figma 流程核对（2026-10-20）

## 结论

Token 正式账本、当前服务端接口和浏览器页面统计一致。Figma 本地测试通过，并已在用户确认的 `TheWarAIUI` 真实文件中完成验收：生成、复用、删除重建、手工修改保护、新修订保留旧页、图片和占位均得到实际结果。真实验收使用隔离数据中的测试审批，不替代正式页面签核。

## Token 正式数据

读取 `.local/usage.json` 的真实记录，使用当前源代码启动临时本地接口逐项对照，再在正式数据的隔离副本中检查页面。

| 指标 | 核对值 |
| --- | ---: |
| 任务 | 16（成功 14，停止 2） |
| 调用 | 31（成功 28，停止 3） |
| 输入 | 126,603 |
| 输出 | 17,831 |
| 已报告总量 | 144,434 |
| 缓存读取（输入子集） | 10,496 |
| 推理输出（输出子集） | 1,904 |
| 未报告用量 | 3 次调用 |

- 逐项核对任务、调用、总计、每日汇总、后端/模型分布和消耗构成；没有重复 ID、输入输出与总量冲突或子集超出父项的问题。
- 7 天、30 天、全部记录当前均包含 10 月 14、15 日这批调用，因此总计相同。浏览器实际操作三个范围，均显示 144,434 tokens、28/31 次调用已报告。
- 选择 10 月 15 日后，仅显示当天 7 次任务，上方范围总计保持原值。缓存写入未返回，仍显示“未提供”。
- 当前 8 个有草稿的组件均正确关联到相应成功分析记录；不把失败或停止尝试替换成成功结果。
- 浏览器控制台无错误，观察到的 9 个页面/资源/API 请求均为 200；范围和日期切换没有新增模型请求。
- 本轮没有调用真实模型。正式 `usage.json`、`workbench.json`、`pages.json` 的 SHA-256 与核对前一致。

证据：`.local/verification/20261020-audit/token-audit.json`、`token-browser.json`、`production-before.json`、`summary.json`。

## 页面计划和 Figma 本地流程

- 在正式数据隔离副本中调用页面接口：旧页面 r11 因组件依赖失效返回 409；另一个已批准页面 r3 正常导出，HTTP 200。没有修改正式审批或重审记录。
- 当前可导出计划：`ac8a30ce-a38f-488b-8fd5-99f5b2186424:r3`，哈希 `1d941261edb8f910fc757490e31464dfc6ff28592e1fc1996e6794bc2aac9092`，7 个节点、2 个组件依赖。
- 只读使用 Figma 仓库在本轮构建时的源代码快照，编译、打包和测试输出全部放在本仓库 `.local/verification/20261020-audit/`。没有运行会写入其它工作副本的构建命令。
- Figma 既有 15 项测试通过，覆盖字体/图片/依赖预检、组件定义保护、实例关联、重复导入、删除后重建、保留手工修改、失败回滚及无 Node 全局变量的打包运行。
- 另用上面实际导出的计划执行打包后的插件：7 个节点均生成；实例关联与原始尺寸正确；重复导入复用页面；修改文本后返回 `result_conflict`；删除生成页后重新导入成功；Main Component 子节点保持不变。
- 该集成使用携带已批准版本元数据的 Main Component 测试替身，属于模拟执行，不能证明真实 Figma 中的组件和字体可用。

证据：`.local/verification/20261020-audit/page-plan-audit.json`、`current-approved-plan.json`、`figma-integration.json`、`figma-source-hashes.json`。

## 当前 Unity 与批准版本的差异

只读获取当前 4380 的 `/export`，发现批准计划引用的两个组件定义指纹均与当前 Unity 导出不同：

| 组件 | 已批准指纹（前 12 位） | 当前指纹（前 12 位） |
| --- | --- | --- |
| CommonPopBGUI | b2a797d8c605 | f0a4359d4625 |
| UI_Com_Common_Btn_Primary_L_AllInOne | c37fda72697a | e2653007e68f |

把当前指纹交给插件预检后，实际得到 `version_conflict`。此保护符合预期。后续需要将同一批 Unity 导出同步到工作台和 Figma，审核发生变化的定义及页面新修订，再导出新计划；本轮没有自动回填指纹或批准新版本。

证据：`.local/verification/20261020-audit/unity-current-export.json`、`page-plan-audit.json`、`figma-integration.json`。

## 真实 Figma 验收

最初目标是空白 `TheWarUIAI`，文件 key `cbNWyVkYSNY7RIG38Hu50O`。内置浏览器无法打开该文件，桌面账号随后提示需要 Design 插件运行权限。没有发送权限申请；用户反馈内置浏览器登录 AIOA 会闪退，后续避开内置浏览器登录。

用户切换账号后，明确授权改用当前打开的 `TheWarAIUI`，文件 key `adUcvRi1PAy4pv6r4L0VCT`。以下结果来自该文件的真实 PluginAPI、执行报告下载和桌面属性面板，已不再是模拟结果。

本轮把已核对的 Unity 导出及其匹配版本放入隔离数据，以“流程验收（隔离副本，非正式审批）”批准专用计划；正式工作台审批保持原样。独立登记的 `UIAI 流程验收（隔离包）` 从本仓库加载已打包插件，复用文件中已有的匹配组件，未重新同步或替换组件库。

| 场景 | 真实结果 |
| --- | --- |
| 首次导入 r2 | success，7 节点，页面 `152:617` |
| 重复导入 r2 | success，仍为 `152:617`，报告含复用提示 |
| 只删除本轮 r2 验收页后重导 | success，新页面 `153:687` |
| 手工移动验收文本 X：44 → 21 | 再导入得到 `result_conflict`，没有覆盖修改；恢复到 44 后正常复用 |
| 待确认占位尚未决策 | 隔离工作台审批返回 409；填写接受占位依据后批准新修订 |
| 导入包含图片和接受占位的 r4 | success，9 节点，1 个明确接受的能力占位，新页面 `154:757`；r2 保留 |
| 输入错误 JSON | `invalid_plan`，前后页面列表一致；恢复正确计划后正常复用 |

实际实例在桌面属性面板显示为 Component instance，来源是 `UI_Com_Common_Btn_Primary_L_AllInOne`，尺寸为 276 × 86，父节点内坐标为 44、140，与计划一致。真实执行报告关联的 Main Component 为 `152:184`；背景组件为 `152:572`。普通文本可编辑，新增图片显示为可编辑 IMAGE 填充。

文件原有 `Main`、`[Unity] [Unity Mirror]`、`[UFB Component Definitions]` 三页均保留。最后保留两个明确标注“非正式审批”的验收页 r2、r4。原来的空白 `TheWarUIAI` 没有被本轮修改。

证据：`.local/verification/20261020-audit/live-acceptance.json`、`live-first-result.json`、`live-repeated-result.json`、`live-regenerated-result.json`、`live-edited-conflict-result.json`、`live-new-revision-result.json`、`live-invalid-plan-result.json`、`live-approved-page.png`、`live-instance-association.png`。

运行中 staging 创建失败后的回滚仍只在测试替身中验证；真实 Figma 的失败用例是错误 JSON 的预检保护，不能把它描述成真实运行时回滚验证。

本轮真实验收对应保存的 `figma-runtime/code.js` 固定构建。Figma 仓库的 `pagePlanExecutor.ts`、`pagePlanIntegrity.ts`、`pagePlanPreflight.ts` 在本轮构建后出现了其它修改；这些后续修改未自动算入本次验收结论。隔离包登记前曾观察到旧登记插件的 `exports is not defined` 启动提示，本轮未修改原插件仓库。

## 本轮检查

- 工作台全量：18 个测试文件、141 项通过。
- `pnpm typecheck`、`pnpm build` 通过。
- Figma 隔离构建成功，既有 15 项测试通过；实际批准计划的额外模拟集成通过。
- 正式数据哈希保持一致，真实模型调用为 0；上述固定隔离包的真实 Figma 验收通过。
- 下一步是将正式工作台的两个过旧组件同步到当前版本并人工复核，再批准正式页面新修订；本次测试审批不能代替这一过程。
