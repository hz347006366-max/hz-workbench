# 月复盘模板与只读月度统计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 HZ 个人工作台新增可由 Templater 创建的月复盘模板，并在月复盘中动态只读展示 TickTick 月任务、每日笔记月收支和四个手写复盘提示。

**Architecture:** 使用 `month-context` 纯函数严格解析月复盘自身月份；任务和收支分别由独立纯模型生成视图数据，再由两个 Obsidian Markdown code block processor 渲染。月复盘编辑提示沿用现有 CodeMirror 装饰架构但保持独立设置；所有外部数据只读，统计不写回 Markdown。

**Tech Stack:** CommonJS JavaScript、Obsidian Plugin API、CodeMirror 6、JSDOM、Node `node:test`、esbuild、CSS media queries、Templater。

## Global Constraints

- 插件版本保持 `0.3.0`，插件 ID 保持 `hz-workbench`，`minAppVersion` 保持 `1.5.0`。
- 模板路径固定为 `07 模板/月复盘模板.md`；实际月报路径格式为 `01 日记/YYYY年/M月/YYYY年-MM月复盘.md`。
- 月份只来自合法 `month: YYYY-MM` 或精确文件名 `YYYY年-MM月复盘.md`；冲突或无效时失败关闭，绝不使用电脑当前月份、ctime 或 mtime。
- TickTick 只通过 `getPlugin('tickticksync').taskRepository.loadAllTasks()` 读取；不得访问写接口、同步命令、REST API 或 Vault 任务回退。
- 月任务显示已完成和未完成；有计划/截止日期时按该日期归月，无日期时按创建日期归月，仍无日期则只计入不可归入数量。
- 月任务标题为纯文本，无 checkbox、链接、项目、清单、标签、优先级或任务跳转。
- 收支只读取目标月 `type: 日记` 的 `hz:finance-entries` 精确管理块；只支持人民币，金额使用整数分。
- 无效收支不进入汇总，但显示数量与去重后的源日记按钮；按钮在新标签页打开日记并保留月复盘。
- 动态统计不写回月复盘、日记或 TickTick；不轮询、不自动触发 TickTickSync。
- 月复盘不进入日记轮播。
- 桌面完整展示，iPhone 窄屏变为单列卡片且无横向滚动。
- 使用本机 bundled Node：`C:\Users\瀚中\AppData\Local\OpenAI\Codex\runtimes\cua_node\84464046935436b8\bin\node.exe`。
- 所有功能变更先取得由缺失行为造成的真实 RED，再做最小 GREEN；每个任务独立提交。
- live 安装前完整备份 `F:\Obsidian\.obsidian\plugins\hz-workbench` 并核对 SHA-256；只覆盖必要产物。

---

## File Structure

### 新增源码

- `src/month-context.js`：解析 frontmatter/文件名月份并生成月边界、中文日期。
- `src/monthly-review-template.js`：根据精确月报文件名生成稳定模板文本。
- `src/monthly-task-model.js`：将只读 TickTick 任务归月、汇总、排序并格式化。
- `src/monthly-finance-model.js`：解析每日收支管理块、汇总金额、分类和错误源。
- `src/monthly-review-blocks.js`：两个只读面板的 DOM 渲染与 Vault 读取边界。
- `src/monthly-editor-guidance-model.js`：分析四个手写栏目并返回提示位置。
- `src/monthly-editor-guidance-extension.js`：CodeMirror 月复盘提示装饰。

### 修改源码

- `src/ticktick-read-model.js`：保留无 dueDate 但有创建时间的只读任务，并暴露月任务所需时间元数据。
- `src/ticktick-read-adapter.js`：继续一次只读加载并返回扩展后的规范化任务。
- `src/main.js`：注册两个 processor、月提示扩展、设置开关与安全新标签页打开回调。
- `styles.css`：月任务、月收支、窄屏卡片与月编辑提示样式。

### 新增测试

- `tests/month-context.test.js`
- `tests/monthly-review-template.test.js`
- `tests/monthly-task-model.test.js`
- `tests/monthly-finance-model.test.js`
- `tests/monthly-review-blocks.test.js`
- `tests/monthly-editor-guidance-model.test.js`
- `tests/monthly-editor-guidance-extension.test.js`
- `tests/monthly-review-integration.test.js`

### 发布与 live 文件

- `development/obsidian-hz-workbench/main.js`
- `install/hz-workbench/main.js`
- `development/obsidian-hz-workbench/styles.css`
- `install/hz-workbench/styles.css`
- `F:\Obsidian\07 模板\月复盘模板.md`
- `F:\Obsidian\.obsidian\plugins\hz-workbench\main.js`
- `F:\Obsidian\.obsidian\plugins\hz-workbench\styles.css`

---

### Task 1: Month Context and Template Contract

**Files:**
- Create: `development/obsidian-hz-workbench/src/month-context.js`
- Create: `development/obsidian-hz-workbench/src/monthly-review-template.js`
- Create: `development/obsidian-hz-workbench/tests/month-context.test.js`
- Create: `development/obsidian-hz-workbench/tests/monthly-review-template.test.js`

**Interfaces:**
- Produces: `parseMonthValue(value): string`
- Produces: `parseMonthlyFilename(basename): string`
- Produces: `resolveMonthContext({ frontmatter, basename }): { ok, month, year, monthNumber, startDate, endDate, error }`
- Produces: `formatChineseDate(dateKey): string`
- Produces: `renderMonthlyReviewTemplate(basename): string`

- [ ] **Step 1: Write failing month-context tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseMonthValue, parseMonthlyFilename, resolveMonthContext, formatChineseDate,
} = require('../src/month-context');

test('resolves frontmatter month and natural local month boundaries', () => {
  assert.deepEqual(resolveMonthContext({
    frontmatter: { month: '2026-08' }, basename: '2026年-08月复盘',
  }), {
    ok: true, month: '2026-08', year: 2026, monthNumber: 8,
    startDate: '2026-08-01', endDate: '2026-08-31', error: '',
  });
});

test('uses the exact filename only when frontmatter is absent', () => {
  assert.equal(parseMonthlyFilename('2026年-08月复盘'), '2026-08');
  assert.equal(parseMonthlyFilename('2026年-8月复盘'), '');
  assert.equal(resolveMonthContext({ frontmatter: {}, basename: '2026年-08月复盘' }).month, '2026-08');
});

test('fails closed on conflict, invalid month, or missing identity', () => {
  assert.match(resolveMonthContext({ frontmatter: { month: '2026-07' }, basename: '2026年-08月复盘' }).error, /不一致/);
  assert.equal(parseMonthValue('2026-13'), '');
  assert.equal(resolveMonthContext({ frontmatter: {}, basename: '普通笔记' }).ok, false);
});

test('formats a Chinese date with weekday', () => {
  assert.equal(formatChineseDate('2026-08-19'), '2026年-08-19-星期三');
});
```

- [ ] **Step 2: Run the month-context test and verify RED**

Run:

```powershell
& 'C:\Users\瀚中\AppData\Local\OpenAI\Codex\runtimes\cua_node\84464046935436b8\bin\node.exe' --test tests\month-context.test.js
```

Expected: FAIL with `Cannot find module '../src/month-context'`.

- [ ] **Step 3: Implement the pure month context**

Create `src/month-context.js` with these exact rules:

```js
const MONTH = /^(\d{4})-(\d{2})$/;
const MONTHLY_FILENAME = /^(\d{4})年-(\d{2})月复盘$/;

function validMonth(year, month) {
  const number = Number(month);
  return /^\d{4}$/.test(year) && number >= 1 && number <= 12 ? `${year}-${month}` : '';
}

function parseMonthValue(value) {
  const match = MONTH.exec(String(value ?? '').trim());
  return match ? validMonth(match[1], match[2]) : '';
}

function parseMonthlyFilename(basename) {
  const match = MONTHLY_FILENAME.exec(String(basename ?? '').trim());
  return match ? validMonth(match[1], match[2]) : '';
}

function pad(value) { return String(value).padStart(2, '0'); }

function resolveMonthContext({ frontmatter = {}, basename = '' } = {}) {
  const propertyPresent = Object.prototype.hasOwnProperty.call(frontmatter, 'month');
  const propertyMonth = parseMonthValue(frontmatter.month);
  const filenameMonth = parseMonthlyFilename(basename);
  if (propertyPresent && !propertyMonth) return { ok: false, month: '', error: 'month 属性必须使用 YYYY-MM。' };
  if (propertyMonth && filenameMonth && propertyMonth !== filenameMonth) {
    return { ok: false, month: '', error: 'month 属性与月复盘文件名不一致。' };
  }
  const month = propertyMonth || filenameMonth;
  if (!month) return { ok: false, month: '', error: '无法识别月复盘月份。' };
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  return {
    ok: true, month, year, monthNumber,
    startDate: `${month}-01`, endDate: `${month}-${pad(lastDay)}`, error: '',
  };
}

function formatChineseDate(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey));
  if (!match) return '';
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) return '';
  return `${match[1]}年-${match[2]}-${match[3]}-星期${'日一二三四五六'[date.getDay()]}`;
}

module.exports = { parseMonthValue, parseMonthlyFilename, resolveMonthContext, formatChineseDate };
```

- [ ] **Step 4: Write failing template tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderMonthlyReviewTemplate } = require('../src/monthly-review-template');

test('renders the confirmed monthly review contract', () => {
  const output = renderMonthlyReviewTemplate('2026年-08月复盘');
  assert.match(output, /^---\ntype: 月复盘\nmonth: 2026-08\ntags:\n  - 月复盘\n---/);
  assert.match(output, /# 2026年08月复盘/);
  assert.equal((output.match(/```hz-month-tasks/g) || []).length, 1);
  assert.equal((output.match(/```hz-month-finance/g) || []).length, 1);
  for (const heading of ['本月完成了什么', '最重要的收获', '遇到的问题', '下月最重要的三件事']) {
    assert.match(output, new RegExp(`### ${heading}`));
  }
  assert.doesNotMatch(output, /- \[[ x]\]/);
});

test('rejects an imprecise filename instead of using the current month', () => {
  assert.throws(() => renderMonthlyReviewTemplate('2026年-8月复盘'), /文件名/);
});
```

- [ ] **Step 5: Run the template test and verify RED**

Run the test with the bundled Node. Expected: FAIL because `monthly-review-template` does not exist.

- [ ] **Step 6: Implement `renderMonthlyReviewTemplate`**

```js
const { parseMonthlyFilename } = require('./month-context');

function renderMonthlyReviewTemplate(basename) {
  const month = parseMonthlyFilename(basename);
  if (!month) throw new Error('月复盘文件名必须使用 YYYY年-MM月复盘');
  const [year, monthNumber] = month.split('-');
  return [
    '---', 'type: 月复盘', `month: ${month}`, 'tags:', '  - 月复盘', '---', '',
    `# ${year}年${monthNumber}月复盘`, '',
    '## 本月任务', '', '```hz-month-tasks', '```', '',
    '## 本月收支', '', '```hz-month-finance', '```', '',
    '## 本月总结', '',
    '### 本月完成了什么', '',
    '### 最重要的收获', '',
    '### 遇到的问题', '',
    '### 下月最重要的三件事', '',
  ].join('\n');
}

module.exports = { renderMonthlyReviewTemplate };
```

- [ ] **Step 7: Run both focused tests and commit**

Expected: all Task 1 tests PASS.

```powershell
git add src/month-context.js src/monthly-review-template.js tests/month-context.test.js tests/monthly-review-template.test.js
git commit -m "feat: define monthly review identity and template"
```

---

### Task 2: Read-only TickTick Monthly Task Model

**Files:**
- Modify: `development/obsidian-hz-workbench/src/ticktick-read-model.js`
- Modify: `development/obsidian-hz-workbench/tests/ticktick-read-model.test.js`
- Modify: `development/obsidian-hz-workbench/tests/ticktick-read-adapter.test.js`
- Create: `development/obsidian-hz-workbench/src/monthly-task-model.js`
- Create: `development/obsidian-hz-workbench/tests/monthly-task-model.test.js`

**Interfaces:**
- Consumes: `formatChineseDate(dateKey)` from Task 1.
- Extends: `normalizeTickTickTask(raw)` with enumerable `scheduled`, `created`, `startMinutes`, `endMinutes`, `allDay`; existing `due`, `completed`, `priority` remain compatible.
- Produces: `buildMonthlyTaskView(tasks, monthContext): { total, completed, incomplete, completionRate, unassigned, rows }`.

- [ ] **Step 1: Add failing normalization tests**

Add fixtures proving:

```js
const undated = normalizeTickTickTask({
  id: 'created-only', title: '整理资料', createdTime: '2026-08-03T08:20:00+08:00', status: 0,
});
assert.deepEqual(undated, {
  id: 'created-only', title: '整理资料', due: '', scheduled: '', created: '2026-08-03',
  startMinutes: null, endMinutes: null, allDay: true, completed: false, priority: 0,
});

const ranged = normalizeTickTickTask({
  id: 'range', title: '开会', startDate: '2026-08-19T09:00:00+08:00',
  dueDate: '2026-08-19T10:00:00+08:00', isAllDay: false, createdTime: '2026-08-01T08:00:00+08:00', status: 2,
});
assert.equal(ranged.scheduled, '2026-08-19');
assert.equal(ranged.startMinutes, 540);
assert.equal(ranged.endMinutes, 600);
```

Update the former “missing due date is excluded” assertion so only a missing ID is excluded. Keep all existing daily `tasksForDate` tests unchanged.

- [ ] **Step 2: Run model and adapter tests and verify RED**

Expected: created-only task is currently `null`, and the adapter drops it.

- [ ] **Step 3: Extend normalization without weakening the read-only adapter**

Implement candidate precedence exactly:

```js
const start = parseDueDate(task.startDate);
const due = parseDueDate(task.dueDate);
const created = parseDueDate(task.createdTime || task.dateHolder?.createdTime);
if (!task?.id) return null;
const scheduledDate = start || due;
const isAllDay = task.isAllDay !== false || (!start && !due);
```

Return `due: due ? localDateKey(due) : ''` for daily compatibility, `scheduled: scheduledDate ? localDateKey(scheduledDate) : ''`, and `created`. Only produce minutes when `isAllDay` is false. Preserve non-enumerable `dueTime` for `tasksForDate`. Do not access any additional TickTick plugin surface in `ticktick-read-adapter.js`.

- [ ] **Step 4: Write failing monthly task model tests**

```js
const view = buildMonthlyTaskView([
  { id: 'done', title: '会议', scheduled: '2026-08-19', created: '2026-07-01', startMinutes: 540, endMinutes: 600, allDay: false, completed: true },
  { id: 'open', title: '复盘', scheduled: '2026-08-20', created: '2026-07-01', startMinutes: null, endMinutes: null, allDay: true, completed: false },
  { id: 'created', title: '整理', scheduled: '', created: '2026-08-21', startMinutes: null, endMinutes: null, allDay: true, completed: false },
  { id: 'outside', title: '下月', scheduled: '2026-09-01', created: '2026-08-01', completed: false },
  { id: 'none', title: '无日期', scheduled: '', created: '', completed: false },
], resolveMonthContext({ frontmatter: { month: '2026-08' }, basename: '2026年-08月复盘' }));

assert.deepEqual({ total: view.total, completed: view.completed, incomplete: view.incomplete, completionRate: view.completionRate, unassigned: view.unassigned }, {
  total: 3, completed: 1, incomplete: 2, completionRate: 33, unassigned: 1,
});
assert.deepEqual(view.rows.map((row) => row.text), [
  '已完成｜2026年-08-19-星期三 9:00–10:00 会议',
  '未完成｜2026年-08-20-星期四 全天 复盘',
  '未完成｜2026年-08-21-星期五 全天 整理',
]);
```

Also cover one-time display, all-day after timed items, title tie-break, empty month, and no input mutation.

- [ ] **Step 5: Run the monthly model test and verify RED**

Expected: FAIL with missing `monthly-task-model`.

- [ ] **Step 6: Implement the monthly task view**

Create functions `taskMonthDate`, `timeLabel`, `taskSortKey`, and `buildMonthlyTaskView`. Use `scheduled` before `created`; count `unassigned` only when both are invalid; exclude tasks assigned outside the target month. Format minutes without leading zero on hours and with two-digit minutes. Compute `Math.round(completed / total * 100)` or `0` for an empty month.

- [ ] **Step 7: Run focused tests and commit**

Expected: ticktick read model, adapter, daily task block, and monthly task model all PASS.

```powershell
git add src/ticktick-read-model.js src/monthly-task-model.js tests/ticktick-read-model.test.js tests/ticktick-read-adapter.test.js tests/monthly-task-model.test.js
git commit -m "feat: build readonly monthly TickTick task model"
```

---

### Task 3: Monthly Finance Parser and Aggregation

**Files:**
- Modify: `development/obsidian-hz-workbench/src/daily-capture-model.js`
- Modify: `development/obsidian-hz-workbench/tests/daily-capture-model.test.js`
- Create: `development/obsidian-hz-workbench/src/monthly-finance-model.js`
- Create: `development/obsidian-hz-workbench/tests/monthly-finance-model.test.js`

**Interfaces:**
- Consumes: `formatChineseDate(dateKey)` from Task 1.
- Consumes canonical finance syntax from `daily-capture-model.js`.
- Produces: `parseFinanceBlock(markdown): { lines, structuralError }`
- Produces: `buildMonthlyFinanceView(notes, monthContext): { incomeCents, expenseCents, netCents, categories, rows, invalidCount, invalidSources, readErrors }`

- [ ] **Step 1: Write failing parser and aggregation tests**

```js
const notes = [
  {
    path: '01 日记/2026年/8月/2026年-08-19-星期三.md', date: '2026-08-19', type: '日记',
    content: '<!-- hz:finance-entries:start -->\n- 12:30｜支出｜餐饮｜午餐｜¥35.00\n- 18:00｜支出｜交通｜打车｜¥20.50\n<!-- hz:finance-entries:end -->',
  },
  {
    path: '01 日记/2026年/8月/2026年-08-20-星期四.md', date: '2026-08-20', type: '日记',
    content: '<!-- hz:finance-entries:start -->\n- 09:10｜收入｜其他｜退款｜¥88.00\n- 无效记录\n<!-- hz:finance-entries:end -->',
  },
];
const result = buildMonthlyFinanceView(notes, { month: '2026-08' });
assert.equal(result.incomeCents, 8800);
assert.equal(result.expenseCents, 5550);
assert.equal(result.netCents, 3250);
assert.deepEqual(result.categories.map(({ category, cents }) => [category, cents]), [['餐饮', 3500], ['交通', 2050]]);
assert.equal(result.invalidCount, 1);
assert.deepEqual(result.invalidSources, ['01 日记/2026年/8月/2026年-08-20-星期四.md']);
assert.equal(result.rows[0].text, '2026年-08-19-星期三 12:30｜支出｜餐饮｜午餐｜¥35.00');
```

Add separate assertions for duplicate markers, foreign currency, zero/negative/three-decimal amounts, invalid clock, project suffix omission, source de-duplication, non-diary/out-of-month exclusion, category percentage, and source input immutability.

- [ ] **Step 2: Run the focused test and verify RED**

Expected: FAIL with missing `monthly-finance-model`.

- [ ] **Step 3: Implement exact marker parsing**

Use line equality for:

```js
const START = '<!-- hz:finance-entries:start -->';
const END = '<!-- hz:finance-entries:end -->';
```

Require exactly one ordered pair. Parse each nonblank interior line with:

```js
/^- (\d{2}:\d{2})｜(收入|支出)｜([^｜]+)｜([^｜]+)｜¥([\d,]+\.\d{2})(?:｜\[\[([^\]]+)\]\])?$/
```

Validate clock range and amount as safe positive integer cents. Structural marker errors add the source to `readErrors`; invalid interior rows increase `invalidCount`. Never infer amounts from arbitrary prose.

- [ ] **Step 4: Expose the existing currency formatter with a regression test**

Add `formatCents` to `daily-capture-model.js` exports and assert:

```js
assert.equal(formatCents(3250), '¥32.50');
assert.equal(formatCents(-2050), '-¥20.50');
```

Do not duplicate or change its current implementation.

- [ ] **Step 5: Implement immutable aggregation**

Filter notes by `type === '日记'` and `date.slice(0, 7) === monthContext.month`. Sort rows by date, clock, path, then original line number. Sort expense categories by cents descending then Chinese label. Store percentages as rounded whole numbers and display currency through the existing `formatCents` export from `daily-capture-model.js`.

- [ ] **Step 6: Run the focused test and commit**

Expected: all monthly finance tests PASS.

```powershell
git add src/daily-capture-model.js src/monthly-finance-model.js tests/daily-capture-model.test.js tests/monthly-finance-model.test.js
git commit -m "feat: aggregate monthly diary finances"
```

---

### Task 4: Read-only Monthly Markdown Blocks

**Files:**
- Create: `development/obsidian-hz-workbench/src/monthly-review-blocks.js`
- Create: `development/obsidian-hz-workbench/tests/monthly-review-blocks.test.js`

**Interfaces:**
- Consumes Task 1 month context, Task 2 task view, Task 3 finance view.
- Produces: `resolveMonthlySource(app, sourcePath): { file, context }`
- Produces: `loadMonthlyFinanceNotes(app, monthContext): Promise<{ notes, readErrors }>`
- Produces: `renderMonthlyTaskBlock(container, view, state): void`
- Produces: `renderMonthlyFinanceBlock(container, view, state, openSource): void`

- [ ] **Step 1: Write failing DOM tests**

Use JSDOM and assert:

```js
renderMonthlyTaskBlock(container, taskView, { available: true });
assert.equal(container.querySelectorAll('.hz-month-task-row').length, taskView.rows.length);
assert.equal(container.querySelectorAll('input,a,button').length, 0);
assert.match(container.textContent, /任务总数.*3.*已完成.*1.*完成率.*33%/s);

renderMonthlyFinanceBlock(container, financeView, {}, (path) => opened.push(path));
assert.equal(container.querySelectorAll('.hz-month-finance-row').length, financeView.rows.length);
container.querySelector('.hz-month-finance-source').click();
assert.deepEqual(opened, ['01 日记/2026年/8月/2026年-08-20-星期四.md']);
```

Cover invalid month, conflict, empty task, unavailable TickTick, empty finance, mixed invalid finance, and read error states. Assert all user text uses `textContent`, never `innerHTML`.

- [ ] **Step 2: Run block tests and verify RED**

Expected: FAIL with missing `monthly-review-blocks`.

- [ ] **Step 3: Implement the renderers**

Build native DOM with scoped classes:

```text
hz-month-block
hz-month-task-summary
hz-month-task-list
hz-month-task-row
hz-month-finance-summary
hz-month-finance-categories
hz-month-finance-list
hz-month-finance-source
hz-month-state
```

Task renderer contains no interactive element. Finance source uses a native `button type="button"`, exact source basename as accessible label, and invokes only `openSource(path)`.

- [ ] **Step 4: Implement the Vault read boundary**

`loadMonthlyFinanceNotes` calls `app.vault.getMarkdownFiles()` once, filters candidates using cached frontmatter and `resolveJournalDate({ basename, path }, frontmatter)` without passing `stat`, then calls `app.vault.cachedRead(file)` for target files. Return individual read failures rather than rejecting the entire month. Do not call `modify`, `create`, `process`, or adapter writes.

- [ ] **Step 5: Run focused tests and commit**

Expected: all month block tests PASS.

```powershell
git add src/monthly-review-blocks.js tests/monthly-review-blocks.test.js
git commit -m "feat: render readonly monthly review blocks"
```

---

### Task 5: Monthly Review Editor Guidance

**Files:**
- Create: `development/obsidian-hz-workbench/src/monthly-editor-guidance-model.js`
- Create: `development/obsidian-hz-workbench/src/monthly-editor-guidance-extension.js`
- Create: `development/obsidian-hz-workbench/tests/monthly-editor-guidance-model.test.js`
- Create: `development/obsidian-hz-workbench/tests/monthly-editor-guidance-extension.test.js`

**Interfaces:**
- Produces: `analyzeMonthlyEditor(text, { showGuidance }): { isMonthly, placeholders }`
- Produces: `createMonthlyEditorGuidanceExtension({ settings }): StateField`

- [ ] **Step 1: Write failing pure-model tests**

Define the four exact descriptors:

```js
[
  ['completed', '本月完成了什么', '这个月真正完成了哪些重要事情？'],
  ['learning', '最重要的收获', '这个月最值得带走的经验或认识是什么？'],
  ['problems', '遇到的问题', '什么事情没有做好，原因是什么？'],
  ['next-three', '下月最重要的三件事', '下个月最重要的三件事是什么？'],
]
```

Assert exact `type: 月复盘`, one exact level-3 heading, safe blank line, next level-3/2 boundary, fenced code exclusion, content disappearance, clear restoration, disabled setting, and non-month note isolation.

- [ ] **Step 2: Run the model test and verify RED**

Expected: missing module failure.

- [ ] **Step 3: Implement the pure analyzer**

Reuse the proven line-offset and fenced-heading ideas from `daily-editor-guidance-model.js`, but do not import its daily-only marker table. Return `{ id, label, at, cursor }` only for empty target sections in a single `type: 月复盘` note.

- [ ] **Step 4: Write failing CodeMirror extension tests**

Mount the extension with `EditorState`/`EditorView` and assert four native buttons, exact labels, click-to-cursor, content change disappearance, undo restoration, setting off, and extension destruction without residual DOM.

- [ ] **Step 5: Implement the extension**

Use a `WidgetType` button with class `hz-month-editor-placeholder`. On click, re-run `analyzeMonthlyEditor(view.state.doc.toString(), { showGuidance: true })`; if the descriptor still exists, dispatch the latest cursor and focus the editor. The widget never writes prompt text.

- [ ] **Step 6: Run focused tests and commit**

Expected: both guidance suites PASS.

```powershell
git add src/monthly-editor-guidance-model.js src/monthly-editor-guidance-extension.js tests/monthly-editor-guidance-model.test.js tests/monthly-editor-guidance-extension.test.js
git commit -m "feat: guide monthly review writing"
```

---

### Task 6: Plugin Integration, Settings, Carousel Isolation, and CSS

**Files:**
- Modify: `development/obsidian-hz-workbench/src/main.js`
- Modify: `development/obsidian-hz-workbench/styles.css`
- Create: `development/obsidian-hz-workbench/tests/monthly-review-integration.test.js`
- Modify: `development/obsidian-hz-workbench/tests/ui.test.js`
- Modify: `development/obsidian-hz-workbench/tests/render-boundary.test.js`

**Interfaces:**
- Consumes all Task 1–5 exports.
- Adds setting: `showMonthlyGuidance: true`.
- Adds methods: `registerMonthlyProcessor(language, render)`, `renderMonthlyTaskProcessor`, `renderMonthlyFinanceProcessor`, `openMonthlySourceInNewTab`, `monthlyEditorGuidanceExtension`, `refreshEditorGuidance`.

- [ ] **Step 1: Write failing integration tests**

Extend the VM Obsidian harness and assert registrations exactly include:

```js
['hz-tasks', 'hz-month-tasks', 'hz-month-finance']
```

For the task processor, assert one `loadAllTasks()` call, correct historical month, no commands/writes, and no late render after child or plugin unload. For finance, assert one Markdown inventory, only target daily files read, new-tab source opening via `workspace.getLeaf('tab').openFile(file)`, caught rejection with `[HZ Workbench]` log and Notice, and no detached promise rejection.

- [ ] **Step 2: Write failing settings and carousel isolation tests**

Assert `DEFAULT_SETTINGS.showMonthlyGuidance === true`, a setting named `显示月复盘编辑提示`, refresh of both editor extensions, and that `type: 月复盘` never enters `WorkbenchIndex.journals()` even if stored below `dailyFolder`. Export `WorkbenchIndex` from `main.js` only for this boundary test; do not change `journal-index.js`.

- [ ] **Step 3: Write failing CSS contract tests**

Assert scoped selectors, no global element rules, theme variables, `focus-visible`, desktop scroll containers, and:

```css
@media(max-width:700px) {
  .hz-month-task-row,.hz-month-finance-row { grid-template-columns:1fr; }
  .hz-month-summary-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
}
```

Also assert no `filter: grayscale` and no horizontal overflow requirement.

- [ ] **Step 4: Run the integration/UI tests and verify RED**

Expected failures: processors and setting are absent; monthly CSS is absent; month review eligibility is not explicitly locked.

- [ ] **Step 5: Integrate the two processors**

In `onload`, set one `monthlyProcessorActive = true`, register both code blocks using independent `Component` children, and use the same active predicate pattern as `hz-tasks`. Each processor first resolves the source file/month. The task processor awaits one adapter snapshot then builds/renders. The finance processor awaits one Vault read batch then builds/renders. Set both active flags false in `onunload` before detaching views.

- [ ] **Step 6: Add safe source navigation**

Implement:

```js
async openMonthlySourceInNewTab(path) {
  try {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file) throw new Error(`Source note not found: ${path}`);
    await this.app.workspace.getLeaf('tab').openFile(file);
  } catch (error) {
    console.error('[HZ Workbench] Failed to open monthly finance source', error);
    new Notice('无法打开对应日记，请检查文件是否仍然存在。');
  }
}
```

Do not attach click behavior to task rows.

- [ ] **Step 7: Integrate monthly guidance and its setting**

Register both guidance StateFields in the existing mutable extension array. Rename `refreshDailyEditorGuidance` to `refreshEditorGuidance` and update both existing daily setting callbacks. Add:

```js
new Setting(containerEl)
  .setName('显示月复盘编辑提示')
  .setDesc('月复盘空栏目显示灰色写作引导；提示不会写入笔记。')
  .addToggle((toggle) => toggle.setValue(this.plugin.settings.showMonthlyGuidance).onChange(async (value) => {
    this.plugin.settings.showMonthlyGuidance = value;
    await this.plugin.saveSettings();
    this.plugin.refreshEditorGuidance();
  }));
```

- [ ] **Step 8: Add scoped responsive CSS**

Use Obsidian variables only: `--background-secondary`, `--background-modifier-border`, `--text-normal`, `--text-muted`, `--interactive-accent`, `--radius-s`, `--font-ui-smaller`. Keep task and finance list max-height with `overflow-y:auto`; make rows single-column under 700px; use native button reset and a tokenized `:focus-visible` outline for source and prompt buttons.

- [ ] **Step 9: Run focused integration tests and commit**

Expected: monthly integration, UI, render boundary, daily guidance regression and daily task block tests PASS.

```powershell
git add src/main.js styles.css tests/monthly-review-integration.test.js tests/ui.test.js tests/render-boundary.test.js
git commit -m "feat: integrate monthly review panels"
```

---

### Task 7: Live Template Installation with Exact Backup

**Files:**
- Create live: `F:\Obsidian\07 模板\月复盘模板.md`
- Create backup: timestamped directory under `D:\Chat GPT\HZ--工作平台\备份`, using the exact command in Step 4.
- Test: `development/obsidian-hz-workbench/tests/monthly-review-template.test.js`

**Interfaces:**
- Consumes: `renderMonthlyReviewTemplate` contract.
- Produces: a Templater template that derives the target month only from the new note filename and emits the same canonical Markdown body.

- [ ] **Step 1: Extend the template test with the exact Templater artifact**

The expected live template begins with this guard and output logic:

````markdown
<%*
const match = tp.file.title.match(/^(\d{4})年-(\d{2})月复盘$/);
if (!match) throw new Error('月复盘文件名必须使用 YYYY年-MM月复盘');
const [, year, month] = match;
tR += `---\ntype: 月复盘\nmonth: ${year}-${month}\ntags:\n  - 月复盘\n---\n\n# ${year}年${month}月复盘`;
%>

## 本月任务

```hz-month-tasks
```

## 本月收支

```hz-month-finance
```

## 本月总结

### 本月完成了什么

### 最重要的收获

### 遇到的问题

### 下月最重要的三件事
````

Test that both code blocks and all four headings occur exactly once, and that no JavaScript `new Date()` and no checkbox syntax appears.

- [ ] **Step 2: Run the template test and verify RED against the absent live artifact fixture**

Use a repository fixture string first; do not read or write live during RED. Expected failure is the missing Templater artifact export from `monthly-review-template.js`.

- [ ] **Step 3: Add `renderMonthlyReviewTemplaterArtifact()` and make tests GREEN**

Return the complete string shown above. Keep the pure concrete-month renderer from Task 1 unchanged.

- [ ] **Step 4: Inspect and back up the live target safely**

Resolve `F:\Obsidian\07 模板` and the exact target. Create the backup directory with:

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = Join-Path 'D:\Chat GPT\HZ--工作平台\备份' ($stamp + '-before-monthly-review-template')
New-Item -ItemType Directory -Path $backupDir
```

If a target already exists, copy it into `$backupDir` and record SHA-256; if absent, record `TARGET_ABSENT` in the execution report. Do not overwrite any other template.

- [ ] **Step 5: Create the live template with `apply_patch`**

Use the exact tested artifact text. Read it back as UTF-8 and compare byte-for-byte with the expected string after normalizing only the intended LF line endings.

- [ ] **Step 6: Commit repository source/tests**

```powershell
git add src/monthly-review-template.js tests/monthly-review-template.test.js
git commit -m "feat: generate monthly review Templater template"
```

The live Vault template is not added to Git; its path, previous state and SHA evidence go into the execution report.

---

### Task 8: Full Verification, Build, Install, and Live Acceptance

**Files:**
- Modify generated: `development/obsidian-hz-workbench/main.js`
- Modify mirrored: `install/hz-workbench/main.js`
- Mirror: `install/hz-workbench/styles.css`
- Install: `F:\Obsidian\.obsidian\plugins\hz-workbench\main.js`
- Install: `F:\Obsidian\.obsidian\plugins\hz-workbench\styles.css`
- Create report: `.superpowers/sdd/monthly-review-task-8-report.md`

**Interfaces:**
- Consumes the complete feature.
- Produces byte-identical development/install/live artifacts and bounded real-Obsidian evidence.

- [ ] **Step 1: Run fresh syntax and full tests**

```powershell
& 'C:\Users\瀚中\AppData\Local\OpenAI\Codex\runtimes\cua_node\84464046935436b8\bin\node.exe' scripts\check-syntax.js
& 'C:\Users\瀚中\AppData\Local\OpenAI\Codex\runtimes\cua_node\84464046935436b8\bin\node.exe' --test tests\*.test.js
git diff --check
```

Expected: exit 0, all tests PASS, no whitespace errors.

- [ ] **Step 2: Build and mirror release artifacts**

```powershell
& 'C:\Users\瀚中\AppData\Local\OpenAI\Codex\runtimes\cua_node\84464046935436b8\bin\node.exe' esbuild.config.mjs
Copy-Item -LiteralPath '.\main.js' -Destination '..\..\install\hz-workbench\main.js' -Force
Copy-Item -LiteralPath '.\styles.css' -Destination '..\..\install\hz-workbench\styles.css' -Force
& 'C:\Users\瀚中\AppData\Local\OpenAI\Codex\runtimes\cua_node\84464046935436b8\bin\node.exe' --test tests\release-package.test.js
```

Expected: build exit 0; release tests PASS; development/install main and CSS SHA-256 match.

- [ ] **Step 3: Back up the complete live plugin and protected data**

Create a timestamped directory under `D:\Chat GPT\HZ--工作平台\备份`. Copy all five live HZ plugin files, then verify length and SHA-256 source/backup equality. Record hashes for HZ `data.json`, `manifest.json`, `logo.png`, external layout, daily template, new monthly template, all daily notes, and all TickTickSync files.

- [ ] **Step 4: Install only `main.js` and `styles.css`**

Copy development artifacts to `F:\Obsidian\.obsidian\plugins\hz-workbench`. Verify development/install/live SHA-256 and lengths are equal. Assert the live plugin directory still contains exactly its expected five files.

- [ ] **Step 5: Perform bounded real-Obsidian acceptance**

Use a controlled month review for a month containing known tasks and at least two finance notes. Verify in order and stop at the first reproducible failure:

1. Templater creates exact frontmatter/title/blocks from an exact filename; invalid filename errors without current-month fallback.
2. Task totals, completed/incomplete/rate, date/time/all-day formatting and ordering match the TickTick local cache.
3. Task rows have no checkbox, no navigation and do not change TickTick.
4. Finance income, expense, net, category totals and chronological rows match source notes.
5. One controlled invalid finance line is excluded, warned, and its source button opens the daily note in a new tab while retaining the month review; restore source afterward.
6. Four prompts appear only when empty, move the cursor safely, disappear after typing, and return after undo.
7. `显示月复盘编辑提示` changes immediately and persists after one precise reload.
8. Historical month remains historical after reload; conflict/invalid/empty/unavailable states are readable.
9. The month review is absent from the daily carousel.
10. Desktop and iPhone-width layouts show every item without horizontal overflow; dark, light and monochrome themes remain legible.

- [ ] **Step 6: Restore all controlled test data and audit protected files**

Delete only the explicitly created controlled month-review test note, restore any intentionally edited daily note byte-for-byte, restore the prior theme/settings if changed, and verify all protected hashes/inventories match the baseline. Never delete or modify actual TickTick tasks.

- [ ] **Step 7: Run final fresh verification**

Repeat syntax, full suite, release tests, diff-check and three-tier hashes. Expected: all exit 0 and all protected audits show zero differences.

- [ ] **Step 8: Commit generated artifacts and write the report**

```powershell
git add main.js styles.css ..\..\install\hz-workbench\main.js ..\..\install\hz-workbench\styles.css
git commit -m "release: install monthly review support"
```

The report records RED/GREEN evidence, commit IDs, test totals, backup path, hashes, live acceptance results and any bounded concern. Do not claim completion if any required live path is failed or unverified.

---

## Final Acceptance Matrix

| Requirement | Owning task |
| --- | --- |
| Strict target month and conflict handling | Task 1 |
| Templater template and exact file convention | Tasks 1, 7 |
| All TickTick tasks, created-date fallback, read-only boundary | Task 2 |
| Task totals, status, time format and stable sorting | Task 2 |
| Daily finance marker parsing and integer-cent totals | Task 3 |
| Category totals, full timeline, invalid-source reporting | Tasks 3, 4 |
| New-tab source opening while retaining month review | Tasks 4, 6 |
| Two native Markdown processors and disposal safety | Tasks 4, 6 |
| Four ephemeral manual prompts and persistent setting | Tasks 5, 6 |
| Monthly note excluded from daily carousel | Task 6 |
| Desktop/iPhone responsive styles and theme compatibility | Task 6 |
| Full build, backup, install, protected-data audit and live proof | Task 8 |
