# Monthly Review Automation and Readability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically create the current month review after the first valid daily note and replace dense monthly task/finance output with clear readonly summaries, timelines, category ranking, and collapsible details.

**Architecture:** Add a focused month-review ensurer that owns current-month path validation, idempotence, and the Vault create transaction. Keep month naming, TickTick task projection, finance projection, and DOM rendering as separate testable modules; `main.js` only wires settings, lifecycle, and Obsidian host services.

**Tech Stack:** Obsidian Plugin API, CommonJS JavaScript, Node.js built-in test runner, JSDOM, esbuild, CSS custom properties.

## Global Constraints

- New automatic filename is exactly `YYYY年-MM-00-月复盘.md`; existing `YYYY年-MM月复盘.md` remains supported and is never renamed.
- Only a valid current-month daily file at `${dailyFolder}/${year}年/${M}月/YYYY年-MM-DD-星期X.md` can trigger creation.
- Startup self-healing only covers the computer's current month and requires at least one valid daily note.
- Automatic creation directly renders final Markdown and never invokes Templater or depends on the active editor.
- TickTick remains strictly readonly: no task writes, sync commands, completion, deletion, or Vault fallback task scan.
- Monthly tasks use scheduled/due dates only; `created` never assigns a task to a month.
- Monthly finance reads only `${dailyFolder}/${year}年/${M}月/` and preserves integer-cent calculations.
- Existing files are never overwritten, renamed, moved, or deleted.
- All user-supplied text is rendered with `textContent`; no untrusted HTML injection.
- Mobile breakpoint remains exactly `700px`; monthly panels must not scroll horizontally.
- Development/install `main.js` and `styles.css` must be byte-identical before installation.
- Live installation requires a complete five-file backup and may overwrite only `main.js` and `styles.css`; the live monthly template requires its own byte-verified backup.
- Live acceptance must be performed by the user, not by automated editor-focus/template insertion.

---

## File Structure

- Create `src/monthly-review-automation.js`: current-month daily recognition, preferred/legacy paths, lock, and safe create transaction.
- Create `tests/monthly-review-automation.test.js`: pure path rules, startup/event behavior, races, failure, and destroy behavior.
- Modify `src/month-context.js`: accept preferred and legacy monthly filenames.
- Modify `src/monthly-review-template.js`: keep one canonical body and emit a dual-name Templater artifact.
- Modify `src/monthly-task-model.js`: remove created-date fallback and produce date groups.
- Modify `src/monthly-finance-model.js`: produce top-five-plus-other category ranking and date groups.
- Modify `src/monthly-review-blocks.js`: task filter/timeline and finance ranking/collapsible details.
- Modify `src/main.js`: setting, lifecycle, ensurer integration, and existing processor wiring.
- Modify `styles.css`: task timeline, filter buttons, category bars, detail disclosure, and mobile layout.
- Modify existing monthly tests and `tests/ui.test.js`: contract and CSS behavior.
- Rebuild and mirror `development/obsidian-hz-workbench/main.js`, `install/hz-workbench/main.js`, and both `styles.css` copies.
- Update live `F:\Obsidian\07 模板\月复盘模板.md` only after backup and automated verification.

---

### Task 1: Dual Monthly Filename and Canonical Template Contract

**Files:**
- Modify: `development/obsidian-hz-workbench/src/month-context.js`
- Modify: `development/obsidian-hz-workbench/src/monthly-review-template.js`
- Modify: `development/obsidian-hz-workbench/tests/month-context.test.js`
- Modify: `development/obsidian-hz-workbench/tests/monthly-review-template.test.js`

**Interfaces:**
- Produces: `parseMonthlyFilename(basename: string): string`
- Produces: `monthlyReviewBasenames(month: string): { preferred: string, legacy: string }`
- Produces: `renderMonthlyReviewTemplate(basename: string): string`
- Produces: `renderMonthlyReviewTemplaterArtifact(): string`

- [ ] **Step 1: Add failing filename and artifact tests**

Add exact assertions:

```js
const {
  parseMonthlyFilename,
  monthlyReviewBasenames,
} = require('../src/month-context');

test('accepts preferred and legacy monthly review basenames', () => {
  assert.equal(parseMonthlyFilename('2026年-08-00-月复盘'), '2026-08');
  assert.equal(parseMonthlyFilename('2026年-08月复盘'), '2026-08');
  assert.equal(parseMonthlyFilename('2026年-8-00-月复盘'), '');
  assert.equal(parseMonthlyFilename('2026年-08-01-月复盘'), '');
  assert.deepEqual(monthlyReviewBasenames('2026-08'), {
    preferred: '2026年-08-00-月复盘',
    legacy: '2026年-08月复盘',
  });
});

test('preferred and legacy names render byte-identical monthly content', () => {
  assert.equal(
    renderMonthlyReviewTemplate('2026年-08-00-月复盘'),
    renderMonthlyReviewTemplate('2026年-08月复盘'),
  );
  const artifact = renderMonthlyReviewTemplaterArtifact();
  assert.match(artifact, /00-月复盘/);
  assert.match(artifact, /兼容旧名称/);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run from `development/obsidian-hz-workbench`:

```powershell
& $NodeExe --test tests/month-context.test.js tests/monthly-review-template.test.js
```

Expected: FAIL because preferred filename support and `monthlyReviewBasenames` do not exist.

- [ ] **Step 3: Implement strict dual-name parsing**

Replace the single filename expression and export the helper:

```js
const MONTHLY_PREFERRED = /^(\d{4})年-(\d{2})-00-月复盘$/;
const MONTHLY_LEGACY = /^(\d{4})年-(\d{2})月复盘$/;

function parseMonthlyFilename(basename) {
  const value = String(basename ?? '').trim();
  const match = MONTHLY_PREFERRED.exec(value) || MONTHLY_LEGACY.exec(value);
  return match ? validMonth(match[1], match[2]) : '';
}

function monthlyReviewBasenames(month) {
  const parsed = parseMonthValue(month);
  if (!parsed) return { preferred: '', legacy: '' };
  const [year, monthNumber] = parsed.split('-');
  return {
    preferred: `${year}年-${monthNumber}-00-月复盘`,
    legacy: `${year}年-${monthNumber}月复盘`,
  };
}
```

Export `monthlyReviewBasenames` with the existing functions. Update the Templater regex to accept both exact names and keep the canonical final body generated by `renderMonthlyReviewTemplate()`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the same command. Expected: all month-context and template tests PASS.

- [ ] **Step 5: Commit Task 1**

```powershell
git add development/obsidian-hz-workbench/src/month-context.js development/obsidian-hz-workbench/src/monthly-review-template.js development/obsidian-hz-workbench/tests/month-context.test.js development/obsidian-hz-workbench/tests/monthly-review-template.test.js
git commit -m "feat: support sorted monthly review filenames"
```

---

### Task 2: Current-Month Review Ensurer

**Files:**
- Create: `development/obsidian-hz-workbench/src/monthly-review-automation.js`
- Create: `development/obsidian-hz-workbench/tests/monthly-review-automation.test.js`

**Interfaces:**
- Consumes: `monthlyReviewBasenames(month)` and `renderMonthlyReviewTemplate(basename)` from Task 1.
- Produces: `currentMonthKey(now: Date): string`
- Produces: `monthlyReviewPaths(dailyFolder: string, now: Date): { month, folder, preferred, legacy }`
- Produces: `isCurrentMonthDailyFile(file: TFileLike, dailyFolder: string, now: Date): boolean`
- Produces: `class MonthlyReviewEnsurer { ensure(now), handleCreate(file, now), destroy() }`

- [ ] **Step 1: Write failing pure-rule tests**

Use a fixed local date and exact paths:

```js
const now = new Date(2026, 7, 21, 9, 0, 0);

test('builds the preferred and legacy paths inside the current month folder', () => {
  assert.deepEqual(monthlyReviewPaths('01 日记', now), {
    month: '2026-08',
    folder: '01 日记/2026年/8月',
    preferred: '01 日记/2026年/8月/2026年-08-00-月复盘.md',
    legacy: '01 日记/2026年/8月/2026年-08月复盘.md',
  });
});

test('accepts only a valid current-month daily filename in the exact folder', () => {
  assert.equal(isCurrentMonthDailyFile({
    path: '01 日记/2026年/8月/2026年-08-21-星期五.md',
    basename: '2026年-08-21-星期五', extension: 'md',
  }, '01 日记', now), true);
  assert.equal(isCurrentMonthDailyFile({
    path: '01 日记/2026年/7月/2026年-07-21-星期二.md',
    basename: '2026年-07-21-星期二', extension: 'md',
  }, '01 日记', now), false);
  assert.equal(isCurrentMonthDailyFile({
    path: '01 日记/2026年/8月/项目.md', basename: '项目', extension: 'md',
  }, '01 日记', now), false);
});
```

- [ ] **Step 2: Write failing transaction tests**

Create a fake Vault with `getMarkdownFiles`, `getAbstractFileByPath`, and `create`. Assert:

```js
function dailyFile() {
  return {
    path: '01 日记/2026年/8月/2026年-08-21-星期五.md',
    basename: '2026年-08-21-星期五',
    extension: 'md',
  };
}

function fakeVault({ files, created }) {
  return {
    getMarkdownFiles: () => files,
    getAbstractFileByPath: (path) => files.find((file) => file.path === path) || null,
    async create(path, content) {
      const basename = path.split('/').pop().replace(/\.md$/i, '');
      const file = { path, basename, extension: 'md', content };
      files.push(file);
      created.push(file);
      return file;
    },
  };
}

test('startup and create event share one idempotent creation', async () => {
  const created = [];
  const daily = dailyFile();
  const vault = fakeVault({ files: [daily], created });
  const ensurer = new MonthlyReviewEnsurer({
    vault,
    dailyFolder: () => '01 日记',
    enabled: () => true,
    render: renderMonthlyReviewTemplate,
    onCreated: () => created.push('notice'),
    onError: (error) => { throw error; },
    isActive: () => true,
  });
  await Promise.all([ensurer.ensure(now), ensurer.handleCreate(daily, now)]);
  assert.equal(created.filter((value) => typeof value === 'object').length, 1);
  assert.equal(created.filter((value) => value === 'notice').length, 1);
});
```

Also assert no create when no current daily exists, when preferred exists, when legacy exists, when disabled, or after `destroy()`. Make `vault.create` reject once and assert one error callback, released lock, and successful later retry.

- [ ] **Step 3: Run the new test file and verify RED**

```powershell
& $NodeExe --test tests/monthly-review-automation.test.js
```

Expected: FAIL with `MODULE_NOT_FOUND` for `monthly-review-automation`.

- [ ] **Step 4: Implement the focused module**

Implement a class with one in-flight promise:

```js
class MonthlyReviewEnsurer {
  constructor({ vault, dailyFolder, enabled, render, onCreated, onError, isActive }) {
    Object.assign(this, { vault, dailyFolder, enabled, render, onCreated, onError, isActive });
    this.inFlight = null;
    this.active = true;
  }

  async handleCreate(file, now = new Date()) {
    if (!isCurrentMonthDailyFile(file, this.dailyFolder(), now)) return false;
    return this.ensure(now);
  }

  ensure(now = new Date()) {
    if (!this.active || !this.isActive() || !this.enabled()) return Promise.resolve(false);
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.runEnsure(now).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  async runEnsure(now) {
    const paths = monthlyReviewPaths(this.dailyFolder(), now);
    const files = this.vault.getMarkdownFiles();
    if (!files.some((file) => isCurrentMonthDailyFile(file, this.dailyFolder(), now))) return false;
    if (this.vault.getAbstractFileByPath(paths.preferred) || this.vault.getAbstractFileByPath(paths.legacy)) return false;
    try {
      if (!this.active || !this.isActive()) return false;
      if (this.vault.getAbstractFileByPath(paths.preferred)) return false;
      await this.vault.create(paths.preferred, this.render(paths.preferred.split('/').pop().replace(/\.md$/i, '')));
      if (this.active && this.isActive()) this.onCreated(paths.month);
      return true;
    } catch (error) {
      if (!this.vault.getAbstractFileByPath(paths.preferred) && this.active && this.isActive()) this.onError(error);
      return false;
    }
  }

  destroy() {
    this.active = false;
  }
}
```

The production implementation must normalize slashes, validate actual calendar dates/weekday through `formatChineseDate`, and export every stated interface.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the new test file. Expected: all automation tests PASS.

- [ ] **Step 6: Commit Task 2**

```powershell
git add development/obsidian-hz-workbench/src/monthly-review-automation.js development/obsidian-hz-workbench/tests/monthly-review-automation.test.js
git commit -m "feat: ensure the current monthly review"
```

---

### Task 3: Plugin Lifecycle and Setting Integration

**Files:**
- Modify: `development/obsidian-hz-workbench/src/main.js`
- Modify: `development/obsidian-hz-workbench/tests/monthly-review-integration.test.js`
- Modify: `development/obsidian-hz-workbench/tests/render-boundary.test.js`

**Interfaces:**
- Consumes: `MonthlyReviewEnsurer` from Task 2.
- Produces setting: `autoCreateMonthlyReview: boolean`, default `true`.
- Produces plugin method: `ensureCurrentMonthlyReview(): Promise<boolean>`.

- [ ] **Step 1: Add failing production-boundary tests**

Assert the default and setting label:

```js
assert.equal(plugin.settings.autoCreateMonthlyReview, true);
assert.match(source, /自动创建本月复盘/);
```

Mount a plugin with a fake Vault and assert one `create` listener, one startup ensure on layout ready, one create-event ensure for a valid file, no ensure when disabled, and `destroy()` on unload. Assert enabling the toggle saves settings and calls `ensureCurrentMonthlyReview()` exactly once.

- [ ] **Step 2: Run integration tests and verify RED**

```powershell
& $NodeExe --test tests/monthly-review-integration.test.js tests/render-boundary.test.js
```

Expected: FAIL because the setting and lifecycle owner are absent.

- [ ] **Step 3: Wire the ensurer without duplicating Vault listeners**

Add the default:

```js
autoCreateMonthlyReview: true,
```

Create the owner after settings load:

```js
this.monthlyReviewEnsurer = new MonthlyReviewEnsurer({
  vault: this.app.vault,
  dailyFolder: () => this.settings.dailyFolder,
  enabled: () => this.settings.autoCreateMonthlyReview,
  render: renderMonthlyReviewTemplate,
  onCreated: (month) => new Notice(`已自动创建 ${month.slice(0, 4)}年${month.slice(5)}月复盘`),
  onError: (error) => {
    console.error('[HZ Workbench] Failed to create monthly review', error);
    new Notice('自动创建本月复盘失败，请稍后手动创建。');
  },
  isActive: () => this.monthlyProcessorActive,
});
```

Replace the existing create listener callback with one callback that both refreshes views and safely consumes `handleCreate(file)`. In `onLayoutReady`, safely consume one `ensureCurrentMonthlyReview()` before or alongside workbench activation. In `onunload`, destroy the owner before detaching views.

Add the setting toggle:

```js
new Setting(containerEl)
  .setName('自动创建本月复盘')
  .setDesc('当前月首次出现合法日记时，在该月目录自动创建排在最前的月复盘。')
  .addToggle((toggle) => toggle
    .setValue(this.plugin.settings.autoCreateMonthlyReview)
    .onChange(async (value) => {
      this.plugin.settings.autoCreateMonthlyReview = value;
      await this.plugin.saveSettings();
      if (value) await this.plugin.ensureCurrentMonthlyReview();
    }));
```

- [ ] **Step 4: Run integration tests and verify GREEN**

Run the same focused command. Expected: all tests PASS with no unhandled rejection.

- [ ] **Step 5: Commit Task 3**

```powershell
git add development/obsidian-hz-workbench/src/main.js development/obsidian-hz-workbench/tests/monthly-review-integration.test.js development/obsidian-hz-workbench/tests/render-boundary.test.js
git commit -m "feat: automate current monthly review creation"
```

---

### Task 4: Scheduled-Only Monthly Task Projection

**Files:**
- Modify: `development/obsidian-hz-workbench/src/monthly-task-model.js`
- Modify: `development/obsidian-hz-workbench/tests/monthly-task-model.test.js`

**Interfaces:**
- Produces: `taskMonthDate(task): string` using scheduled/due only.
- Produces: `buildMonthlyTaskView(tasks, context): { total, completed, incomplete, completionRate, groups, rows }`.
- Each group: `{ date, dateLabel, total, completed, rows }`.

- [ ] **Step 1: Write failing selection and grouping tests**

```js
test('excludes created-only and unscheduled tasks from the month', () => {
  const view = buildMonthlyTaskView([
    { id: 'scheduled', title: '本月计划', scheduled: '2026-08-12', completed: false, allDay: true },
    { id: 'due', title: '本月截止', due: '2026-08-13', created: '2026-07-01', completed: true, allDay: true },
    { id: 'created-only', title: '本月新建未安排', created: '2026-08-02', completed: false },
    { id: 'future', title: '未来任务', scheduled: '2026-09-01', created: '2026-08-03', completed: false },
  ], { ok: true, month: '2026-08' });
  assert.deepEqual(view.rows.map((row) => row.id), ['scheduled', 'due']);
  assert.equal(view.total, 2);
});

test('groups tasks by date with timed tasks before all-day tasks', () => {
  const view = buildMonthlyTaskView([
    { id: 'timed', title: '上午会议', scheduled: '2026-08-12', completed: true, allDay: false, startMinutes: 540, endMinutes: 600, due: '2026-08-12' },
    { id: 'all-day', title: '整理资料', scheduled: '2026-08-12', completed: false, allDay: true },
    { id: 'next-day', title: '客户回访', scheduled: '2026-08-13', completed: false, allDay: true },
  ], { ok: true, month: '2026-08' });
  assert.deepEqual(view.groups.map((group) => group.date), ['2026-08-12', '2026-08-13']);
  assert.deepEqual(view.groups[0].rows.map((row) => row.timeLabel), ['9:00–10:00', '全天']);
});
```

- [ ] **Step 2: Run the model tests and verify RED**

```powershell
& $NodeExe --test tests/monthly-task-model.test.js
```

Expected: created-only task is incorrectly included and `groups` is absent.

- [ ] **Step 3: Implement scheduled/due selection and groups**

Use:

```js
function taskMonthDate(task) {
  return validDateKey(task?.scheduled) || validDateKey(task?.due);
}

function groupTaskRows(rows) {
  const groups = [];
  for (const row of rows) {
    let group = groups.at(-1);
    if (!group || group.date !== row.date) {
      group = { date: row.date, dateLabel: row.dateLabel, total: 0, completed: 0, rows: [] };
      groups.push(group);
    }
    group.rows.push(row);
    group.total += 1;
    if (row.completed) group.completed += 1;
  }
  return groups;
}
```

Remove created-date fallback and the unassigned count/message. Preserve stable sorting with an input index used only internally and stripped from public rows.

- [ ] **Step 4: Run model tests and verify GREEN**

Expected: all monthly task model tests PASS.

- [ ] **Step 5: Commit Task 4**

```powershell
git add development/obsidian-hz-workbench/src/monthly-task-model.js development/obsidian-hz-workbench/tests/monthly-task-model.test.js
git commit -m "fix: limit monthly tasks to scheduled dates"
```

---

### Task 5: Task Timeline, Local Filters, and Responsive CSS

**Files:**
- Modify: `development/obsidian-hz-workbench/src/monthly-review-blocks.js`
- Modify: `development/obsidian-hz-workbench/tests/monthly-review-blocks.test.js`
- Modify: `development/obsidian-hz-workbench/styles.css`
- Modify: `development/obsidian-hz-workbench/tests/ui.test.js`

**Interfaces:**
- Consumes: `view.groups` from Task 4.
- Produces DOM classes: `.hz-month-task-filters`, `.hz-month-task-day`, `.hz-month-task-day-heading`, `.hz-month-task-entry`.

- [ ] **Step 1: Add failing JSDOM behavior tests**

Assert four metric nodes, three native buttons, initial `全部` pressed state, date groups, and local filtering:

```js
const buttons = [...container.querySelectorAll('.hz-month-task-filter')];
assert.deepEqual(buttons.map((button) => button.textContent), ['全部', '已完成', '未完成']);
assert.equal(buttons[0].getAttribute('aria-pressed'), 'true');
buttons[1].click();
assert.equal(container.querySelectorAll('.hz-month-task-entry').length, 1);
assert.equal(container.querySelector('.hz-month-task-entry').dataset.completed, 'true');
```

Add a production-boundary assertion that the filter click path contains no Vault or TickTick adapter call. Add CSS assertions for focus-visible, no horizontal scroll, and the `max-width:700px` single-column rule.

- [ ] **Step 2: Run focused block/UI tests and verify RED**

```powershell
& $NodeExe --test tests/monthly-review-blocks.test.js tests/ui.test.js
```

Expected: filter buttons and timeline classes are missing.

- [ ] **Step 3: Implement a renderer-owned local filter**

Within `renderMonthlyTaskBlock`, create one timeline container and a local state variable:

```js
let filter = 'all';
const filterValues = [
  ['all', '全部'],
  ['completed', '已完成'],
  ['incomplete', '未完成'],
];

function matches(row) {
  if (filter === 'completed') return row.completed;
  if (filter === 'incomplete') return !row.completed;
  return true;
}
```

Each native button updates `aria-pressed`, clears only the timeline container, and renders groups containing matching rows. Each entry uses separate `time`, `title`, and visible status text nodes; set `data-completed` to `true` or `false`.

- [ ] **Step 4: Add scoped CSS**

Add tokenized styles with this structure:

```css
.hz-month-task-filters{display:flex;flex-wrap:wrap;gap:6px}
.hz-month-task-filter{appearance:none;min-height:32px;padding:4px 10px;border:1px solid var(--background-modifier-border);border-radius:999px;background:transparent;color:var(--text-muted);font:inherit;cursor:pointer}
.hz-month-task-filter[aria-pressed="true"]{background:var(--interactive-accent);color:var(--text-on-accent)}
.hz-month-task-filter:focus-visible{outline:2px solid var(--interactive-accent);outline-offset:2px}
.hz-month-task-day{display:grid;gap:6px;padding-block:8px;border-bottom:1px solid var(--background-modifier-border)}
.hz-month-task-entry{display:grid;grid-template-columns:minmax(4rem,.18fr) minmax(0,1fr) auto;gap:8px;align-items:start}
.hz-month-task-entry[data-completed="true"]{color:var(--text-muted)}
@media(max-width:700px){.hz-month-task-entry{grid-template-columns:4rem minmax(0,1fr)}.hz-month-task-status{grid-column:2}}
```

- [ ] **Step 5: Run focused tests and verify GREEN**

Expected: monthly block and UI tests PASS.

- [ ] **Step 6: Commit Task 5**

```powershell
git add development/obsidian-hz-workbench/src/monthly-review-blocks.js development/obsidian-hz-workbench/tests/monthly-review-blocks.test.js development/obsidian-hz-workbench/styles.css development/obsidian-hz-workbench/tests/ui.test.js
git commit -m "feat: present monthly tasks as a timeline"
```

---

### Task 6: Finance Ranking and Date-Grouped Projection

**Files:**
- Modify: `development/obsidian-hz-workbench/src/monthly-finance-model.js`
- Modify: `development/obsidian-hz-workbench/tests/monthly-finance-model.test.js`

**Interfaces:**
- Produces: `buildExpenseRanking(categories, expenseCents, limit = 5)`.
- Extends monthly finance view with `categoryRanking` and `detailGroups`.
- Each ranking row: `{ category, cents, amountLabel, percentage, isOther }`.
- Each detail group: `{ date, dateLabel, rows }`.

- [ ] **Step 1: Write failing ranking tests**

```js
test('shows five expense categories and combines the rest as other', () => {
  const view = buildMonthlyFinanceView([{
    path: '01 日记/2026年/8月/2026年-08-03-星期一.md',
    date: '2026-08-03',
    type: '日记',
    content: [
      '<!-- hz:finance-entries:start -->',
      '- 08:00｜支出｜餐饮｜聚餐｜¥400.00',
      '- 09:00｜支出｜交通｜高铁｜¥200.00',
      '- 10:00｜支出｜购物｜用品｜¥150.00',
      '- 11:00｜支出｜居住｜物业｜¥100.00',
      '- 12:00｜支出｜学习｜书籍｜¥50.00',
      '- 13:00｜支出｜娱乐｜电影｜¥20.00',
      '- 14:00｜支出｜医疗｜药品｜¥10.00',
      '<!-- hz:finance-entries:end -->',
    ].join('\n'),
  }], { ok: true, month: '2026-08' });
  assert.equal(view.categoryRanking.length, 6);
  assert.deepEqual(view.categoryRanking.slice(0, 5).map((row) => row.category), ['餐饮', '交通', '购物', '居住', '学习']);
  assert.deepEqual(view.categoryRanking[5], {
    category: '其他', cents: 3000, amountLabel: '¥30.00', percentage: 3, isOther: true,
  });
});

test('groups valid finance rows by date without changing totals', () => {
  const notes = [
    {
      path: '01 日记/2026年/8月/2026年-08-03-星期一.md', date: '2026-08-03', type: '日记',
      content: '<!-- hz:finance-entries:start -->\n- 09:00｜支出｜餐饮｜早餐｜¥20.00\n<!-- hz:finance-entries:end -->',
    },
    {
      path: '01 日记/2026年/8月/2026年-08-04-星期二.md', date: '2026-08-04', type: '日记',
      content: '<!-- hz:finance-entries:start -->\n- 18:00｜收入｜工资｜项目款｜¥100.00\n<!-- hz:finance-entries:end -->',
    },
  ];
  const view = buildMonthlyFinanceView(notes, { ok: true, month: '2026-08' });
  assert.deepEqual(view.detailGroups.map((group) => group.date), ['2026-08-03', '2026-08-04']);
  assert.equal(view.incomeCents - view.expenseCents, view.netCents);
});
```

Fixture values must make expected cents and percentages exact; do not loosen assertions with approximate matching.

- [ ] **Step 2: Run model tests and verify RED**

```powershell
& $NodeExe --test tests/monthly-finance-model.test.js
```

Expected: `categoryRanking` and `detailGroups` are absent.

- [ ] **Step 3: Implement the pure projections**

```js
function buildExpenseRanking(categories, expenseCents, limit = 5) {
  const ranked = categories.slice(0, limit).map((row) => ({
    category: row.category,
    cents: row.cents,
    amountLabel: formatCents(row.cents),
    percentage: expenseCents ? Math.round(row.cents / expenseCents * 100) : 0,
    isOther: false,
  }));
  const remaining = categories.slice(limit).reduce((sum, row) => sum + row.cents, 0);
  if (remaining > 0) ranked.push({
    category: '其他',
    cents: remaining,
    amountLabel: formatCents(remaining),
    percentage: expenseCents ? Math.round(remaining / expenseCents * 100) : 0,
    isOther: true,
  });
  return ranked;
}
```

Build `detailGroups` after chronological sorting. Preserve `rows` for backward compatibility during the renderer migration.

- [ ] **Step 4: Run model tests and verify GREEN**

Expected: all monthly finance model tests PASS.

- [ ] **Step 5: Commit Task 6**

```powershell
git add development/obsidian-hz-workbench/src/monthly-finance-model.js development/obsidian-hz-workbench/tests/monthly-finance-model.test.js
git commit -m "feat: summarize monthly expense categories"
```

---

### Task 7: Finance Ranking UI and Collapsible Details

**Files:**
- Modify: `development/obsidian-hz-workbench/src/monthly-review-blocks.js`
- Modify: `development/obsidian-hz-workbench/tests/monthly-review-blocks.test.js`
- Modify: `development/obsidian-hz-workbench/styles.css`
- Modify: `development/obsidian-hz-workbench/tests/ui.test.js`

**Interfaces:**
- Consumes: `categoryRanking` and `detailGroups` from Task 6.
- Produces DOM classes: `.hz-month-category-row`, `.hz-month-category-bar`, `.hz-month-finance-toggle`, `.hz-month-finance-details-panel`, `.hz-month-finance-day`.

- [ ] **Step 1: Write failing disclosure and ranking tests**

```js
const ranking = container.querySelectorAll('.hz-month-category-row');
assert.equal(ranking.length, 6);
assert.equal(ranking[0].querySelector('.hz-month-category-name').textContent, '餐饮');
assert.equal(ranking[0].querySelector('.hz-month-category-bar').getAttribute('aria-valuenow'), '40');
const toggle = container.querySelector('.hz-month-finance-toggle');
const panel = container.querySelector('.hz-month-finance-details-panel');
assert.equal(toggle.textContent, '查看全部明细（8 笔）');
assert.equal(toggle.getAttribute('aria-expanded'), 'false');
assert.equal(panel.hidden, true);
toggle.click();
assert.equal(toggle.getAttribute('aria-expanded'), 'true');
assert.equal(panel.hidden, false);
toggle.click();
assert.equal(panel.hidden, true);
```

Assert no toggle for zero valid rows, and assert invalid/read-error source buttons remain inside a separate error section after the detail groups.
Assert normal `.hz-month-finance-row` elements contain no button or click handler; only error-source controls navigate.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
& $NodeExe --test tests/monthly-review-blocks.test.js tests/ui.test.js
```

Expected: ranking, disclosure, and new CSS classes are missing.

- [ ] **Step 3: Implement accessible category bars**

For each category create text labels plus a meter element:

```js
const meter = appendTextElement(item, 'div', 'hz-month-category-bar', '');
meter.setAttribute('role', 'progressbar');
meter.setAttribute('aria-label', `${row.category}占本月支出${row.percentage}%`);
meter.setAttribute('aria-valuemin', '0');
meter.setAttribute('aria-valuemax', '100');
meter.setAttribute('aria-valuenow', String(row.percentage));
const fill = appendTextElement(meter, 'span', 'hz-month-category-fill', '');
fill.style.width = `${Math.max(0, Math.min(100, row.percentage))}%`;
```

Only numbers computed by the model enter the width style.

- [ ] **Step 4: Implement the native disclosure**

Create one `button` with `type="button"`, `aria-expanded`, and `aria-controls`. Create one details panel with a generated processor-local id and `hidden = true`. Clicking toggles only those two properties. Render date groups inside the panel, then an isolated error section with existing source buttons.

- [ ] **Step 5: Add scoped responsive CSS**

```css
.hz-month-category-row{display:grid;grid-template-columns:minmax(5rem,.22fr) minmax(0,1fr) auto;gap:8px;align-items:center}
.hz-month-category-bar{height:6px;border-radius:999px;background:var(--background-modifier-border);overflow:hidden}
.hz-month-category-fill{display:block;height:100%;border-radius:inherit;background:var(--interactive-accent)}
.hz-month-finance-toggle{appearance:none;min-height:36px;padding:6px 10px;border:1px solid var(--background-modifier-border);border-radius:var(--radius-s);background:transparent;color:var(--text-normal);font:inherit;cursor:pointer}
.hz-month-finance-toggle:focus-visible{outline:2px solid var(--interactive-accent);outline-offset:2px}
.hz-month-finance-day{display:grid;gap:6px;padding-block:8px;border-bottom:1px solid var(--background-modifier-border)}
@media(max-width:700px){.hz-month-category-row{grid-template-columns:minmax(0,1fr) auto}.hz-month-category-bar{grid-column:1/-1}}
```

Use existing semantic variables so dark, light, and monochrome themes remain neutral; never filter user images.

- [ ] **Step 6: Run focused tests and verify GREEN**

Expected: monthly block and UI tests PASS.

- [ ] **Step 7: Commit Task 7**

```powershell
git add development/obsidian-hz-workbench/src/monthly-review-blocks.js development/obsidian-hz-workbench/tests/monthly-review-blocks.test.js development/obsidian-hz-workbench/styles.css development/obsidian-hz-workbench/tests/ui.test.js
git commit -m "feat: simplify monthly finance review"
```

---

### Task 8: Full Integration, Build, Template Update, and Safe Live Handoff

**Files:**
- Modify generated: `development/obsidian-hz-workbench/main.js`
- Mirror generated: `install/hz-workbench/main.js`
- Mirror: `install/hz-workbench/styles.css`
- Test: `development/obsidian-hz-workbench/tests/release-package.test.js`
- Live after backup: `F:\Obsidian\.obsidian\plugins\hz-workbench/main.js`
- Live after backup: `F:\Obsidian\.obsidian\plugins\hz-workbench/styles.css`
- Live after separate backup: `F:\Obsidian\07 模板\月复盘模板.md`

**Interfaces:**
- Consumes all Tasks 1–7.
- Produces byte-identical development/install artifacts and an installation package ready for user-led live acceptance.

- [ ] **Step 1: Run fresh pre-build verification**

Resolve the current bundled Node path. From `development/obsidian-hz-workbench` run:

```powershell
& $NodeExe scripts/check-syntax.js
& $NodeExe --test tests/*.test.js
```

Expected: syntax exit 0 and every test PASS. Stop on any failure.

- [ ] **Step 2: Build and mirror only generated artifacts**

```powershell
& $NodeExe esbuild.config.mjs
Copy-Item -LiteralPath main.js -Destination '..\..\install\hz-workbench\main.js' -Force
Copy-Item -LiteralPath styles.css -Destination '..\..\install\hz-workbench\styles.css' -Force
```

Verify development/install SHA-256 equality for both files.

- [ ] **Step 3: Run fresh post-build verification**

```powershell
& $NodeExe scripts/check-syntax.js
& $NodeExe --test tests/*.test.js
& $NodeExe --test tests/release-package.test.js
git diff --check
```

Expected: all commands exit 0; release package reports 2/2 PASS.

- [ ] **Step 4: Commit generated release artifacts**

```powershell
git add development/obsidian-hz-workbench/main.js development/obsidian-hz-workbench/styles.css install/hz-workbench/main.js install/hz-workbench/styles.css
git commit -m "release: package automatic monthly review"
```

- [ ] **Step 5: Back up protected live files**

Create a timestamped directory under `D:\Chat GPT\HZ--工作平台\备份`. Copy all five files from `F:\Obsidian\.obsidian\plugins\hz-workbench` and verify each source/backup length and SHA-256. Separately back up `F:\Obsidian\07 模板\月复盘模板.md` and verify equality. Record baseline hashes for:

- live HZ `data.json`, `manifest.json`, `logo.png`
- daily template and monthly template
- every daily-note path and hash
- all four TickTickSync files

Stop before installation if any backup comparison fails.

- [ ] **Step 6: Install only the allowed files**

Copy the verified development `main.js/styles.css` to the live HZ plugin. Replace the live monthly template with the exact output of `renderMonthlyReviewTemplaterArtifact()`. Do not modify HZ `data.json`, `manifest.json`, `logo.png`, daily notes, daily template, or TickTickSync.

Verify live plugin still contains exactly five files and development/install/live hashes match for `main.js/styles.css`.

- [ ] **Step 7: Reload without automated note creation**

Lock the unique actual user Vault window, exclude Sandbox/settings/DevTools, and execute one precise Obsidian reload. Do not use automation to create or insert a monthly note. Confirm no delete confirmation or plugin startup error appears.

- [ ] **Step 8: Hand the acceptance checklist to the user**

Ask the user to manually create the first valid current-month daily note or, if it already exists, toggle `自动创建本月复盘` off and on. The user confirms:

1. preferred `00` monthly file appears once and sorts first;
2. current daily note remains active;
3. task totals include scheduled/due current-month tasks only;
4. task filters and timeline are readable;
5. finance ranking and collapsed details are readable;
6. mobile/narrow layout has no horizontal scrolling;
7. reload and additional daily creation do not duplicate the monthly file;
8. the monthly file does not enter the journal carousel.

- [ ] **Step 9: Final protected audit and report**

Compare every protected hash with baseline. Confirm zero daily-note and TickTickSync changes caused by installation. Record automated results, artifact hashes, backup paths, user acceptance results, remaining unverified items, commits, and clean worktree status in the handoff report. Do not claim live success for any item the user did not confirm.

---

## Final Review Gate

After Task 8, request an independent whole-range code review from the design commit through the release commit. Fix every confirmed Critical or Important finding with a new RED/GREEN cycle, rerun the full suite and release checks, rebuild/reinstall only if production artifacts changed, and repeat the protected audit. Minor findings may be documented for later only when they do not affect the confirmed user behavior or data safety.
