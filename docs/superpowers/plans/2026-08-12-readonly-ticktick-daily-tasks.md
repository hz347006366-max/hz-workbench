# TickTick 只读日程与日记任务面板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让工作台与日记以 TickTickSync 本地缓存为唯一任务源，只读展示指定日期任务，并在 HZ 插件本地维护每天最多 3 项“今日必完成”。

**Architecture:** 新增纯任务模型/过滤模块、TickTickSync 只读适配器、本地重点选择存储和 Markdown 动态面板渲染器。`main.js` 只负责组合这些边界；任务写入、同步触发、复选框完成和标题导航全部移除。轮播继续复用现有控制器并用生产接线测试锁定新标签页打开行为。

**Tech Stack:** CommonJS、Node.js 内置测试运行器、jsdom、esbuild、Obsidian Plugin API、TickTickSync 2.0.5 运行时只读接口 `taskRepository.loadAllTasks()`。

## Global Constraints

- TickTick 是唯一任务数据源；HZ 插件不得调用 TickTick 写接口或同步命令。
- 任务标题不可点击，任务状态复选框必须 `disabled`。
- 今日任务按目标日期显示全部任务；明日行动按下一自然日显示未完成任务。
- 今日必完成每天最多 3 项，只保存到 HZ 插件 `data.json`。
- 插件 ID 保持 `hz-workbench`，版本保持 `0.2.1`，最低 Obsidian 版本保持 `1.5.0`。
- 不增加运行时依赖，不启用 TickTickSync Full Vault Sync，不扩大现有同步范围。

---

### Task 1: 只读任务领域模型

**Files:**
- Create: `development/obsidian-hz-workbench/src/ticktick-read-model.js`
- Create: `development/obsidian-hz-workbench/tests/ticktick-read-model.test.js`

**Interfaces:**
- Produces: `normalizeTickTickTask(task): ReadonlyTask | null`
- Produces: `tasksForDate(tasks, dateKey, { includeCompleted }): ReadonlyTask[]`
- Produces: `nextLocalDate(dateKey): string`
- `ReadonlyTask`: `{ id, title, due, completed, priority }`

- [ ] **Step 1: 写入日期与规范化失败测试**

测试必须覆盖 TickTick 的 `id/title/dueDate/status/priority` 映射、无 ID 或无到期日任务排除、本地日期 `2026-08-12 -> 2026-08-13`，以及月末/年末跨日。

- [ ] **Step 2: 运行定向测试确认 RED**

Run: `& $node --test tests/ticktick-read-model.test.js`

Expected: FAIL，因为模块尚不存在。

- [ ] **Step 3: 实现最小纯函数**

`normalizeTickTickTask` 必须使用现有 `cleanTaskDisplayTitle` 清理标题；`completed` 由 TickTick `status !== 0` 得出；日期只能转为本地 `YYYY-MM-DD`，不得使用 `toISOString().slice(0, 10)`。

- [ ] **Step 4: 添加过滤测试并实现**

断言今日包含已完成与未完成，明日过滤掉已完成，结果以到期时间、优先级和 ID 稳定排序。

- [ ] **Step 5: 运行定向测试确认 GREEN**

Run: `& $node --test tests/ticktick-read-model.test.js`

Expected: 全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add development/obsidian-hz-workbench/src/ticktick-read-model.js development/obsidian-hz-workbench/tests/ticktick-read-model.test.js
git commit -m "feat: add readonly TickTick task model"
```

---

### Task 2: TickTickSync 只读适配器与本地必完成选择

**Files:**
- Create: `development/obsidian-hz-workbench/src/ticktick-read-adapter.js`
- Create: `development/obsidian-hz-workbench/src/focus-selection.js`
- Create: `development/obsidian-hz-workbench/tests/ticktick-read-adapter.test.js`
- Create: `development/obsidian-hz-workbench/tests/focus-selection.test.js`

**Interfaces:**
- Consumes: `app.plugins.getPlugin('tickticksync')`
- Produces: `TickTickReadAdapter.loadTasks(): Promise<{ tasks: ReadonlyTask[], available: boolean, reason: string | null }>`
- Produces: `toggleFocusSelection(selections, dateKey, taskId, availableIds): { selections, selected, limitReached }`
- Produces: `selectedTasksForDate(tasks, selections, dateKey): ReadonlyTask[]`

- [ ] **Step 1: 写入只读适配器失败测试**

用假插件实例断言只调用一次 `taskRepository.loadAllTasks()`；断言绝不访问 `service.synchronization`, `tickTickRestAPI`, `saveSettings` 或 Obsidian 命令。

- [ ] **Step 2: 运行测试确认 RED 并实现适配器**

TickTickSync 缺失、仓库缺失或读取抛错时返回结构化状态 `{ tasks: [], available: false, reason }`，不得扫描 Vault 普通任务作为回退。

- [ ] **Step 3: 写入必完成选择失败测试**

覆盖添加、取消、第四项拒绝、跨日期隔离、完成任务保留、保存时清除失效 ID，并保证输入对象不被原地修改。

- [ ] **Step 4: 实现选择纯函数并确认 GREEN**

选择数据结构固定为：

```js
focusSelections: {
  '2026-08-12': ['task-id-1', 'task-id-2']
}
```

- [ ] **Step 5: 运行两组定向测试**

Run: `& $node --test tests/ticktick-read-adapter.test.js tests/focus-selection.test.js`

Expected: 全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add development/obsidian-hz-workbench/src/ticktick-read-adapter.js development/obsidian-hz-workbench/src/focus-selection.js development/obsidian-hz-workbench/tests/ticktick-read-adapter.test.js development/obsidian-hz-workbench/tests/focus-selection.test.js
git commit -m "feat: add readonly TickTick adapter and focus selection"
```

---

### Task 3: 工作台只读任务交互

**Files:**
- Modify: `development/obsidian-hz-workbench/src/main.js`
- Modify: `development/obsidian-hz-workbench/styles.css`
- Modify: `development/obsidian-hz-workbench/tests/render-boundary.test.js`
- Create: `development/obsidian-hz-workbench/tests/readonly-task-ui.test.js`

**Interfaces:**
- Consumes: `TickTickReadAdapter.loadTasks()`、`tasksForDate()`、`selectedTasksForDate()`、`toggleFocusSelection()`
- Persists: `plugin.settings.focusSelections`
- Removes: `WorkbenchIndex.addMustDo()`、任务输入表单、`tickticksync:tts-sync` 调用和任务行文件导航。

- [ ] **Step 1: 写入生产边界失败测试**

断言 `main.js` 不含 `addMustDo(`、`tickticksync:tts-sync`、`hz-quick-input` 或任务项 `getLeaf(false).openFile(task.file)`；断言默认设置包含空的 `focusSelections`。

- [ ] **Step 2: 写入 jsdom UI 失败测试**

构造三条今日任务，断言：

- 每条任务有 `disabled` 复选框；
- 标题是普通文本且没有 click 导航；
- 今日必完成没有 input/form；
- 点击“设为必完成”只调用 HZ 设置保存；
- 选满 3 项后第四项按钮禁用；
- 再次点击取消并刷新两个面板。

- [ ] **Step 3: 重构数据加载**

`loadRenderData()` 从只读适配器读取任务快照；`todayTasks` 使用 `tasksForDate(tasks, dateKey(new Date()), { includeCompleted: true })`；统计卡同步显示全部任务数。

- [ ] **Step 4: 重写今日任务与今日必完成渲染**

使用真实 `<input type="checkbox" disabled>` 反映状态；按钮仅切换 `focusSelections`。达到上限时显示“最多 3 项”，完成任务仍保留删除线和选中状态。

- [ ] **Step 5: 更新设置与文案**

移除“双向联动”“写入日记”“新增任务”相关设置和文案；新增只读来源状态：“TickTickSync 本地缓存 · 仅展示”。

- [ ] **Step 6: 运行定向测试与 UI 测试**

Run: `& $node --test tests/readonly-task-ui.test.js tests/render-boundary.test.js tests/ui.test.js`

Expected: 全部 PASS。

- [ ] **Step 7: 提交**

```bash
git add development/obsidian-hz-workbench/src/main.js development/obsidian-hz-workbench/styles.css development/obsidian-hz-workbench/tests/readonly-task-ui.test.js development/obsidian-hz-workbench/tests/render-boundary.test.js development/obsidian-hz-workbench/tests/ui.test.js
git commit -m "feat: make workbench tasks readonly"
```

---

### Task 4: 日记动态任务代码块

**Files:**
- Create: `development/obsidian-hz-workbench/src/daily-task-block.js`
- Create: `development/obsidian-hz-workbench/tests/daily-task-block.test.js`
- Modify: `development/obsidian-hz-workbench/src/main.js`
- Modify: `development/obsidian-hz-workbench/styles.css`

**Interfaces:**
- Produces: `parseTaskBlockSource(source): { scope, includeCompleted }`
- Produces: `resolveSourceDate(app, sourcePath): string`
- Produces: `renderDailyTaskBlock(container, tasks, options): void`
- Registers: `registerMarkdownCodeBlockProcessor('hz-tasks', processor)`

- [ ] **Step 1: 写入代码块配置与历史日期失败测试**

覆盖 `scope: today/tomorrow`、布尔值解析、frontmatter 日期优先、中文文件名回退、不可识别日期明确报错。

- [ ] **Step 2: 实现解析与日期边界**

复用 `resolveJournalDate` 和 `nextLocalDate`；不得把无法识别日期静默替换为电脑当天。

- [ ] **Step 3: 写入只读渲染失败测试**

断言复选框 disabled、标题无链接/点击、今日包含已完成、明日排除已完成、空状态可读。

- [ ] **Step 4: 实现 Markdown 处理器并注册**

处理器每次只调用只读适配器；使用 `ctx.addChild` 或插件注册生命周期确保清理，无持续轮询。

- [ ] **Step 5: 添加样式并运行定向测试**

Run: `& $node --test tests/daily-task-block.test.js tests/ui.test.js`

Expected: 全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add development/obsidian-hz-workbench/src/daily-task-block.js development/obsidian-hz-workbench/src/main.js development/obsidian-hz-workbench/styles.css development/obsidian-hz-workbench/tests/daily-task-block.test.js development/obsidian-hz-workbench/tests/ui.test.js
git commit -m "feat: render readonly tasks in daily notes"
```

---

### Task 5: 模板迁移与轮播新标签页回归

**Files:**
- Create: `development/obsidian-hz-workbench/src/daily-template.js`
- Modify: `F:/Obsidian/07 模板/每日模板.md`
- Create: `development/obsidian-hz-workbench/tests/daily-template.test.js`
- Modify: `development/obsidian-hz-workbench/tests/carousel-controller.test.js`
- Modify: `development/obsidian-hz-workbench/tests/render-boundary.test.js`

**Interfaces:**
- Produces: `updateDailyTemplate(source): string`
- Template today block: `scope: today`, `includeCompleted: true`
- Template tomorrow block: `scope: tomorrow`, `includeCompleted: false`
- Carousel activation: `workspace.getLeaf('tab').openFile(journal.file)`

- [ ] **Step 1: 备份真实每日模板**

复制到 `D:/Chat GPT/HZ--工作平台/备份/<timestamp>-before-readonly-daily-task-template/每日模板.md`，记录 SHA-256。

- [ ] **Step 2: 写入模板转换失败测试**

使用仓库内最小模板字符串调用 `updateDailyTemplate(source)`，断言顺序为“今日摘要 → 重要决定与分流 → 今日任务 → 明日行动”，存在两个准确 `hz-tasks` 代码块，原模板其余段落逐字保留，重复执行结果不再变化，并且没有静态 `- [ ] ... #ticktick` 行。常规测试不得依赖 `F:` 盘符；真实 Vault 文件只在安装验收步骤单独核验。

- [ ] **Step 3: 实现纯转换并使用 apply_patch 修改真实模板**

在 `daily-template.js` 实现幂等的 `updateDailyTemplate(source)`；只替换“今日整理”末尾区域。先用纯函数验证真实模板转换结果，再使用 `apply_patch` 写入 `F:/Obsidian/07 模板/每日模板.md`；其他模板内容在备份与当前文件的结构化比较中必须保持一致。

- [ ] **Step 4: 增强轮播回归测试**

断言鼠标单击卡片图片、标题或空白区域，以及键盘 Enter/Space，都激活卡片当前绑定日记；拖动后的合成点击仍被抑制；生产回调仍为 `getLeaf('tab')`。

- [ ] **Step 5: 运行定向测试**

Run: `& $node --test tests/daily-template.test.js tests/carousel-controller.test.js tests/render-boundary.test.js`

Expected: 全部 PASS。

- [ ] **Step 6: 提交仓库测试**

真实 Vault 模板不纳入插件 Git；只提交对应测试和代码变更。

```bash
git add development/obsidian-hz-workbench/src/daily-template.js development/obsidian-hz-workbench/tests/daily-template.test.js development/obsidian-hz-workbench/tests/carousel-controller.test.js development/obsidian-hz-workbench/tests/render-boundary.test.js
git commit -m "test: lock daily template and carousel navigation"
```

---

### Task 6: 全量验证、构建与 Windows 安装验收

**Files:**
- Generated: `development/obsidian-hz-workbench/main.js`
- Generated: `install/hz-workbench/main.js`
- Generated: `install/hz-workbench/styles.css`
- Install: `F:/Obsidian/.obsidian/plugins/hz-workbench/main.js`
- Install: `F:/Obsidian/.obsidian/plugins/hz-workbench/styles.css`

- [ ] **Step 1: 运行全量检查**

```powershell
& $node scripts/check-syntax.js
& $node --test tests/*.test.js
```

Expected: 0 failures。

- [ ] **Step 2: 构建并同步安装产物**

```powershell
& $node esbuild.config.mjs
Copy-Item development/obsidian-hz-workbench/main.js install/hz-workbench/main.js -Force
Copy-Item development/obsidian-hz-workbench/styles.css install/hz-workbench/styles.css -Force
```

- [ ] **Step 3: 备份并安装到 Windows Vault**

备份现有 `F:/Obsidian/.obsidian/plugins/hz-workbench` 后，仅覆盖 `main.js` 与 `styles.css`；`manifest.json`、`data.json`、Logo 和布局数据保持不变。

- [ ] **Step 4: 核验哈希**

开发、install 和 live 三份 `main.js/styles.css` 的 SHA-256 必须分别一致。

- [ ] **Step 5: 完整重启 Obsidian 实机验收**

逐项验证：

- 今日任务包含已完成和未完成任务；
- 复选框不可点击，标题无导航；
- 今日必完成无输入框，选择/取消最多 3 项并在重启后保持；
- 历史日记按自身日期显示今日任务与次日未完成任务；
- 模板新建日记包含两个动态面板；
- 轮播整卡在新标签页打开对应日记并保留工作台；
- 不出现 TickTick 删除确认、批量标签通知或 Markdown 异常改写。

- [ ] **Step 6: 最终回归与提交**

再次运行全量检查、`git diff --check` 和安装哈希；提交构建产物：

```bash
git add development/obsidian-hz-workbench/main.js install/hz-workbench/main.js install/hz-workbench/styles.css
git commit -m "release: install readonly TickTick task panels"
```
