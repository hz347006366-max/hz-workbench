# 任务标题纯净显示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让工作台任务卡片只显示用户输入的任务标题，同时完整保留 Markdown 中的 TickTickSync 同步元数据。

**Architecture:** 在 `core.js` 增加纯函数 `cleanTaskDisplayTitle(raw)`，并在 `main.js` 的任务解析边界调用。这样“今日必完成”和“今日任务”继续共用同一任务模型，源文件及同步流程无需变化。

**Tech Stack:** CommonJS、Node.js 内置测试运行器、esbuild、Obsidian 插件 API。

## Global Constraints

- 仅改变显示层，不修改日记 Markdown 源文件。
- 保留 `#ticktick`、`#hzworkbench`、TickTick 链接、内联 ID、日期和同步能力。
- 插件 ID 保持 `hz-workbench`，版本保持 `0.2.1`，不增加运行时依赖。

---

### Task 1: 任务标题显示清洗与安装验证

**Files:**
- Modify: `development/obsidian-hz-workbench/src/core.js`
- Modify: `development/obsidian-hz-workbench/src/main.js`
- Test: `development/obsidian-hz-workbench/tests/core.test.js`
- Generated: `development/obsidian-hz-workbench/main.js`
- Generated: `install/hz-workbench/main.js`
- Install: `F:/Obsidian/.obsidian/plugins/hz-workbench/main.js`

**Interfaces:**
- Consumes: TickTickSync Markdown 任务行中复选框之后的原始文字。
- Produces: `cleanTaskDisplayTitle(raw: unknown): string`，返回仅用于界面展示的标题。

- [ ] **Step 1: 写入失败测试**

```js
test('cleanTaskDisplayTitle hides TickTickSync metadata but keeps user text', () => {
  assert.equal(
    cleanTaskDisplayTitle('HZ工作台同步测试 #hzworkbench [link](https://ticktick.com/webapp/#p/inbox/tasks/id) #ticktick %%[ticktick_id:: id]%% 📅 2026-08-12 ⏫'),
    'HZ工作台同步测试',
  );
});
```

- [ ] **Step 2: 运行定向测试并确认 RED**

Run:

```powershell
& $node --test tests/core.test.js
```

Expected: FAIL，因为 `cleanTaskDisplayTitle` 尚未导出。

- [ ] **Step 3: 实现最小清洗函数并接入解析器**

```js
function cleanTaskDisplayTitle(value) {
  return String(value || '')
    .replace(/%%\[ticktick_id::\s*[^\]]+\]%%/gi, '')
    .replace(/\[link\]\([^\s)]+\)/gi, '')
    .replace(/#(?:ticktick|hzworkbench)\b/gi, '')
    .replace(/(?:📅|due::)\s*\d{4}-\d{2}-\d{2}/gi, '')
    .replace(/[⏬🔽🔼⏫🔺]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}
```

在 `parseTaskLine` 中把 `title` 设置为 `cleanTaskDisplayTitle(raw)`；日期、完成状态和 TickTick 标记仍从原始 `raw` 解析。

- [ ] **Step 4: 运行定向测试与全量检查**

Run:

```powershell
& $node --test tests/core.test.js
& $node scripts/check-syntax.js
& $node --test tests/*.test.js
```

Expected: 全部 PASS，且无语法错误。

- [ ] **Step 5: 构建、同步安装产物并检查哈希**

Run:

```powershell
& $node esbuild.config.mjs
Copy-Item development/obsidian-hz-workbench/main.js install/hz-workbench/main.js -Force
Copy-Item development/obsidian-hz-workbench/main.js F:/Obsidian/.obsidian/plugins/hz-workbench/main.js -Force
Get-FileHash development/obsidian-hz-workbench/main.js,install/hz-workbench/main.js,F:/Obsidian/.obsidian/plugins/hz-workbench/main.js
```

Expected: 构建退出码为 0，三份 `main.js` 的 SHA-256 相同。

- [ ] **Step 6: 重载插件并实机验收**

在 Obsidian 中重载应用或插件，确认任务卡片显示 `HZ工作台同步测试`，页面中不显示 `#hzworkbench`、`[link]`、URL 或 `ticktick_id`；日记源行仍完整保留同步元数据。

- [ ] **Step 7: 提交**

```bash
git add development/obsidian-hz-workbench/src/core.js development/obsidian-hz-workbench/src/main.js development/obsidian-hz-workbench/tests/core.test.js development/obsidian-hz-workbench/main.js install/hz-workbench/main.js
git commit -m "fix: show clean task titles"
```

