# Figma 页面计划：删除产物后重新导入同一 JSON

## 交给谁

请在 `C:\Users\TU\AIOA\UnityFigmaBridge-Figma` 仓库中处理。当前
`UIAI-Orchestrator` 工作副本只保存这份交接文档，没有修改 Figma 插件仓库。

目标文件：

- `src/pagePlanExecutor.ts`
- `tests/page-plan.test.cjs`

## 用户症状

操作顺序：

1. 用一个页面计划 JSON 成功生成页面。
2. 手动删除生成的 Figma 页面/产物。
3. 再次选择同一个 JSON 导入。

当前返回：

```text
blocked: result_conflict: The generated result was changed or removed.
```

界面没有重新生成页面。

## 根因

`executePagePlan` 使用根节点上的 `uiai.page.results.v1` 保存
`planId -> { result, integrity }`。再次导入同一个 `planId` 时，当前逻辑进入
`previous` 分支：

```ts
const page = api.root.children.find(node => node.id === previous.result.figmaPageId);
if (!page || await pageIntegrity(page, previous.integrityVersion || 1) !== previous.integrity) {
  throw new ExecutionError('result_conflict', 'The generated result was changed or removed.');
}
```

这里把两种状态合并了：

- 页面仍存在但内容被修改：应该保留 `result_conflict`；
- 页面已经被删除：旧 Registry 记录已失效，应该清理后走正常生成流程。

现有测试在 `tests/page-plan.test.cjs` 中把删除页面后的旧行为固定为
`result_conflict`，需要改成新的产品行为。

## 修复要求

只调整“结果页不存在”的分支：

1. 读取旧 Registry 记录。
2. 如果 `previous.result.figmaPageId` 对应的页面不存在：
   - 删除 `registry[plan.planId]`；
   - 立即写回 `REGISTRY_KEY`；
   - 不抛 `result_conflict`；
   - 继续执行后面的 staging page 创建和生成流程。
3. 如果页面存在：
   - 完整性哈希一致时，继续复用旧页面；
   - 完整性哈希不一致时，继续返回 `result_conflict`。
4. `planId` 相同但 `planHash` 不同仍然必须返回 `plan_conflict`，不能覆盖旧结果。
5. 生成失败时仍清理本次 staging page，并保留原有错误处理。

推荐改成等价的结构：

```ts
if (previous) {
  const page = api.root.children.find(node => node.id === previous.result.figmaPageId);
  if (!page) {
    delete registry[plan.planId];
    api.root.setPluginData(REGISTRY_KEY, JSON.stringify(registry));
  } else {
    if (await pageIntegrity(page, previous.integrityVersion || 1) !== previous.integrity) {
      throw new ExecutionError('result_conflict', 'The generated result was changed or removed.');
    }
    await api.setCurrentPageAsync(page);
    api.viewport.scrollAndZoomIntoView(page.children);
    return GenerationResultSchema.parse({
      ...previous.result,
      warnings: [...previous.result.warnings, 'Reused the unchanged generated page.']
    });
  }
}
```

## 必须新增/修改的回归测试

在 `tests/page-plan.test.cjs` 中修改现有“新修订保留旧结果……”测试的最后部分，或新增独立测试：

```js
const first = await executePagePlan(plan, api);
assert.equal(first.status, 'success');
const deletedPage = api.root.children.find(page => page.id === first.figmaPageId);
assert.ok(deletedPage);
deletedPage.remove();

const regenerated = await executePagePlan(plan, api);
assert.equal(regenerated.status, 'success', JSON.stringify(regenerated.errors));
assert.notEqual(regenerated.figmaPageId, first.figmaPageId);
assert.ok(api.root.children.some(page => page.id === regenerated.figmaPageId));
```

同时保留以下已有保护测试：

- 页面存在但被修改后，仍返回 `result_conflict`；
- 同一 `planId` 不同 `planHash` 返回 `plan_conflict`；
- 新 revision 生成新页面，并保留旧页面；
- staging 生成失败时不删除旧成功页面。

## 验收命令

在目标仓库执行：

```powershell
npm test
```

验收结果应包括：

- 删除旧生成页后重新导入同一 JSON，返回 `success`；
- 新页面 ID 与旧页面 ID 不同；
- 页面被手动编辑但仍存在时，返回 `result_conflict`；
- 既有全部测试继续通过。

## 不要做的改动

- 不要把所有 `result_conflict` 都改成自动覆盖。
- 不要在页面仍存在且完整性不一致时静默重建，否则会覆盖用户手工修改。
- 不要修改 `@uiai/protocol` 的 `GenerationResult` 合同；现有错误码已经足够表达结果。
- 不要清空整个 `uiai.page.results.v1`，只删除当前失效的 `planId` 记录。

## Suggested skills

- `diagnosing-bugs`：先建立“生成 → 删除页面 → 同 JSON 再生成”的红灯回归测试，再修复并验证。
- `handoff`：如果需要把后续实现继续交给另一个会话，沿用本文件并补充实际测试结果。
