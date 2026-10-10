# HZ 工作台智能体占位、记录入口与日记直建 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 精简工作台左侧、增加无状态智能体占位、恢复七项记录入口，并由 HZ 使用受控模板直接创建今日日记。

**Architecture:** 布局 schema 2 负责 Logo 与智能体模块的几何和旧布局迁移；模板渲染放入纯函数模块，Vault 查找、并发与创建仍由 `DailyCaptureService` 编排；`WorkbenchView` 只负责界面连接和只读展示。每项行为先写失败测试，再做最小实现。

**Tech Stack:** CommonJS JavaScript、Obsidian API、Node `node:test`、jsdom、esbuild、CSS。

## Global Constraints

- TickTick 严格只读；不得新增 TickTick 写入或同步调用。
- 右上角 `+` 只打开既有七项“记录今日”菜单。
- 日记模板默认路径固定为 `07 模板/每日模板.md`，可在设置中修改。
- 新日记路径固定遵循 `01 日记/YYYY年/M月/YYYY年-MM-DD-星期X.md`。
- 创建过程不调用 Daily Notes、Templater 或当前编辑器。
- 模板只支持 `{{date:FORMAT}}`；token 仅 `YYYY`、`MM`、`DD`、`dddd`。
- 桌面画布宽 `1640px`；智能体模块基础尺寸 `306 × 760px`；其他旧模块 `x + 194`。
- 移动端不得横向滚动。

---

### Task 1: 布局 schema 2 与安全迁移

**Files:**
- Modify: `src/layout-model.js`
- Modify: `src/layout-store.js`
- Modify: `tests/layout-model.test.js`
- Modify: `tests/layout-store.test.js`
- Modify: `tests/layout-integration.test.js`

**Interfaces:**
- Produces: `CANVAS_WIDTH = 1640`、含 `agent-panel` 的 `MODULE_DEFINITIONS`/`DEFAULT_LAYOUT`、schema 1→2 迁移与 `<deviceId>.schema-v1.backup.json`。

- [ ] **Step 1: 写失败测试**

```js
assert.equal(CANVAS_WIDTH, 1640);
assert.deepEqual(MODULE_DEFINITIONS['agent-panel'], {
  label: 'HZ 智能体', baseWidth: 306, baseHeight: 760, minScale: 0.65, maxScale: 2,
});
assert.deepEqual(DEFAULT_LAYOUT['agent-panel'], { x: 16, y: 144, scale: 1 });
assert.equal(DEFAULT_LAYOUT.header.x, 338);
```

为 store 增加 schema 1 原始字节只备份一次、已知模块 `x + 194`、sidebar 保留 x/y/scale、未知模块 payload 保留、备份失败中止、非法迁移回退默认的断言。

- [ ] **Step 2: 运行并确认 RED**

Run: `node --test tests/layout-model.test.js tests/layout-store.test.js tests/layout-integration.test.js`

Expected: 因画布仍为 1440、没有 `agent-panel`、schema 仍为 1 而失败。

- [ ] **Step 3: 最小实现**

```js
const CANVAS_WIDTH = 1640;
const LAYOUT_X_SHIFT = 194;
const CURRENT_SCHEMA_VERSION = 2;
```

将 `sidebar` 改为 `112 × 112`，加入 `agent-panel`，其余默认 x 增加 194。迁移 schema 1 时复制文档、补模块、平移已知非 sidebar 模块、验证无冲突；迁移前以 `adapter.write()` 写一次不可覆盖备份，失败直接抛错。迁移验证失败时返回 `DEFAULT_LAYOUT` 并通过可注入 `onRecovery` 回调发出一次提示。

- [ ] **Step 4: 运行并确认 GREEN**

Run: `node --test tests/layout-model.test.js tests/layout-store.test.js tests/layout-integration.test.js`

Expected: 0 failed。

- [ ] **Step 5: 提交**

```bash
git add development/obsidian-hz-workbench/src/layout-model.js development/obsidian-hz-workbench/src/layout-store.js development/obsidian-hz-workbench/tests/layout-*.test.js
git commit -m "feat: migrate workbench layout for agent panel"
```

### Task 2: 精简工作台界面并加入智能体占位

**Files:**
- Modify: `src/main.js`
- Modify: `src/carousel-controller.js`
- Modify: `styles.css`
- Modify: `tests/ui.test.js`
- Modify: `tests/layout-view.test.js`
- Modify: `tests/readonly-task-ui.test.js`
- Modify: `tests/render-boundary.test.js`

**Interfaces:**
- Consumes: Task 1 的 `agent-panel` 模块。
- Produces: `renderLogo()`、`renderAgentPanel()`；`renderHeader()` 的 `+` 调用 `plugin.openDailyCapture()`。

- [ ] **Step 1: 写失败测试**

```js
assert.match(source, /moduleShell\(canvas, 'agent-panel'/);
assert.doesNotMatch(sidebarText, /今日|日记|项目|领域|资源|归档|个人工作台/);
assert.match(agent.textContent, /HZ 智能体.*待接入.*这里将用于与个人智能体对话/s);
assert.equal(agent.querySelector('input').disabled, true);
```

同时断言 `+` 调用 `openDailyCapture()`、六处常态脚注不再渲染、错误态仍出现、轮播说明 DOM 不存在、focus 按钮 CSS 高度 28–30px、移动端顺序和无横向滚动。

- [ ] **Step 2: 运行并确认 RED**

Run: `node --test tests/ui.test.js tests/layout-view.test.js tests/readonly-task-ui.test.js tests/render-boundary.test.js`

Expected: 旧导航、脚注、按钮尺寸与 `+` 行为导致失败。

- [ ] **Step 3: 最小实现**

```js
renderAgentPanel(parent) {
  const card = this.el(parent, 'section', 'hz-agent-panel');
  // 标题、待接入状态、空状态；input/button 均 disabled
  return card;
}
```

移动端按 Logo→agent→header→stats→carousel→projects→must-do→today-tasks 渲染；桌面添加 `agent-panel` shell。删除导航/profile 和六类正常脚注节点，但保留不可用/异常错误文本。`hz-focus-toggle` 改为紧凑 pill 并保持 `:focus-visible`。

- [ ] **Step 4: 运行并确认 GREEN**

Run: `node --test tests/ui.test.js tests/layout-view.test.js tests/readonly-task-ui.test.js tests/render-boundary.test.js`

Expected: 0 failed。

- [ ] **Step 5: 提交**

```bash
git add development/obsidian-hz-workbench/src/main.js development/obsidian-hz-workbench/src/carousel-controller.js development/obsidian-hz-workbench/styles.css development/obsidian-hz-workbench/tests
git commit -m "feat: simplify workbench and add agent placeholder"
```

### Task 3: 受控模板渲染与直接创建日记

**Files:**
- Create: `src/daily-template-renderer.js`
- Modify: `src/daily-capture-service.js`
- Modify: `src/main.js`
- Modify: `src/daily-capture-modal.js`
- Modify: `src/daily-template.js`
- Modify: `assets/每日模板.md`
- Modify: `tests/daily-template-renderer.test.js`
- Modify: `tests/daily-capture-service.test.js`
- Modify: `tests/daily-capture-ui.test.js`
- Modify: `tests/daily-template.test.js`
- Modify: `tests/production-integration.test.js`

**Interfaces:**
- Produces: `renderDailyTemplate(source, date): string`；`DailyCaptureService.ensureJournal(date): Promise<TFile>` 使用每日期共享的 in-flight Promise。

- [ ] **Step 1: 写模板渲染失败测试并确认 RED**

```js
assert.match(renderDailyTemplate('{{date:YYYY年-MM-DD-dddd}}', new Date(2026, 7, 24)), /2026年-08-24-星期一/);
assert.throws(() => renderDailyTemplate('{{title}}', date), /不支持/);
assert.throws(() => renderDailyTemplate('<% tp.file.title %>', date), /Templater/);
```

加入 FORMAT 空值、未知 ASCII token、非法 frontmatter、缺失/重复/交叉 marker、错误 hz-tasks 契约测试。

Run: `node --test tests/daily-template-renderer.test.js`

Expected: 模块不存在而失败。

- [ ] **Step 2: 实现渲染器并确认 GREEN**

```js
function renderDailyTemplate(source, date) {
  rejectTemplaterAndUnknownMustache(source);
  const rendered = replaceSupportedDateExpressions(source, date);
  const errors = validateDailyTemplate(rendered);
  if (errors.length) throw new Error(`日记模板结构无效：${errors.join('；')}`);
  return rendered;
}
```

Run: `node --test tests/daily-template-renderer.test.js tests/daily-template.test.js`

Expected: 0 failed。

- [ ] **Step 3: 写日记直建失败测试并确认 RED**

断言：已有文件不读模板；缺失时读取设置路径并创建精确目标；并发只 create 一次；模板/mkdir/create 失败释放锁；打开失败保留文件；不调用 commands；七项入口顺序不变。

Run: `node --test tests/daily-capture-service.test.js tests/daily-capture-ui.test.js tests/production-integration.test.js`

Expected: 旧实现调用 `daily-notes`，断言失败。

- [ ] **Step 4: 实现直建和设置项并确认 GREEN**

```js
DEFAULT_SETTINGS.dailyTemplatePath = '07 模板/每日模板.md';

async ensureJournal(date = this.now()) {
  const target = typeof date === 'string' ? date : dateKey(date);
  if (this.inFlight.has(target)) return this.inFlight.get(target);
  const operation = this.createOrFindJournal(target, date).finally(() => this.inFlight.delete(target));
  this.inFlight.set(target, operation);
  return operation;
}
```

创建前完整读取、渲染、校验；再二次查找；用 `ensureFolders()` 与 `vault.create()` 写入；等待 Vault 可识别后返回。`openToday()` 用 `getLeaf('tab')`。插件设置增加“日记模板路径”。删除发布模板中的 Templater 导航行。

Run: `node --test tests/daily-template-renderer.test.js tests/daily-capture-service.test.js tests/daily-capture-ui.test.js tests/daily-template.test.js tests/production-integration.test.js`

Expected: 0 failed。

- [ ] **Step 5: 提交**

```bash
git add development/obsidian-hz-workbench/src development/obsidian-hz-workbench/assets/每日模板.md development/obsidian-hz-workbench/tests
git commit -m "feat: create daily journals from validated templates"
```

### Task 4: 构建、安装、真机文件校验与交接

**Files:**
- Modify: `F:/Obsidian/07 模板/每日模板.md`
- Modify: `F:/Obsidian/09 知识库/Hanzhong-codex.md`
- Update generated: `development/obsidian-hz-workbench/main.js`
- Update install: `install/hz-workbench/main.js`
- Update install: `install/hz-workbench/styles.css`

**Interfaces:**
- Consumes: Task 1–3 全部行为。
- Produces: 已安装插件、无导航的新模板、可独立接手的交接文档。

- [ ] **Step 1: 跑定向测试与完整检查**

Run: `node scripts/check-syntax.js && node --test tests/*.test.js`

Expected: 全部测试通过，0 failed。

- [ ] **Step 2: 构建并检查产物**

Run: `node esbuild.config.mjs`

Expected: exit 0；`main.js` 不含 private CodeMirror runtime 或 `daily-notes` 创建路径。

- [ ] **Step 3: 备份并安装**

先解析 live 插件绝对路径，复制 `main.js`、`styles.css`、`manifest.json` 到带时间戳的同级备份目录；保留 live `data.json`。再将 development 产物同步到 `install/hz-workbench` 与 live 插件目录。

- [ ] **Step 4: 更新 Vault 模板与交接**

用精确补丁从 `F:/Obsidian/07 模板/每日模板.md` 删除导航行，不改其他内容。更新 `F:/Obsidian/09 知识库/Hanzhong-codex.md`，覆盖目标、完成项、验证证据、当前阻塞、下一步和禁踩坑。

- [ ] **Step 5: 最终新鲜验证**

再次运行完整 `check` 与 `build`；比较 development/install/live 的 `main.js`、`styles.css` SHA-256；检查 live `data.json` 存在；检查两个模板均无 `<%`；检查 git diff 和状态。

- [ ] **Step 6: 提交**

```bash
git add development/obsidian-hz-workbench/main.js development/obsidian-hz-workbench/styles.css development/obsidian-hz-workbench/assets/每日模板.md install/hz-workbench/main.js install/hz-workbench/styles.css install/hz-workbench/manifest.json
git commit -m "release: install refined HZ workbench"
```
