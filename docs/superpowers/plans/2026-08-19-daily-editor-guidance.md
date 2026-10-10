# Daily Journal Editor Guidance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add non-persistent, clickable guidance placeholders to empty daily-note sections and hide valid `hz:*` marker lines in both Source mode and Live Preview without changing Markdown data.

**Architecture:** A pure parser converts the current Markdown document into conservative marker-hide ranges and placeholder descriptors. A CodeMirror 6 view plugin renders those descriptors as line/replace decorations and native buttons, while HZ Workbench owns two persisted settings and reconfigures registered editor extensions through `workspace.updateOptions()`.

**Tech Stack:** CommonJS JavaScript, Obsidian 1.13.x plugin API, CodeMirror 6 (`@codemirror/state` 6.5.0 and `@codemirror/view` 6.38.6), Node test runner, JSDOM, esbuild, CSS using Obsidian theme variables.

## Global Constraints

- Apply only when frontmatter contains the scalar value `type: 日记`; never decorate unrelated notes.
- Preserve every Markdown byte: placeholders and hidden markers are editor decorations only.
- Keep all valid `hz:*` marker comments in the file; malformed, duplicated, crossed, or incomplete marker pairs remain visible.
- Exact placeholder copy must match the approved design; `今日任务` and `明日行动` never receive input placeholders.
- `显示日记填写提示` defaults to `true`; `显示日记技术标记` defaults to `false`.
- Do not modify the daily template, journals, TickTickSync, tasks, attachments, layout files, logo, or live plugin `data.json`.
- Do not add Vault scans, background polling, TickTick writes, or custom Markdown persistence.
- Use the bundled Node executable `C:\Users\瀚中\AppData\Local\OpenAI\Codex\runtimes\cua_node\2fb562745e6d66f0\bin\node.exe` because `node` is not reliably available on PATH.
- Use TDD for every behavior change: obtain assertion-level RED evidence before production edits.
- Keep `development/obsidian-hz-workbench/main.js` and `styles.css` byte-identical to their `install/hz-workbench` copies before installation.

---

## File Map

- Create `development/obsidian-hz-workbench/src/daily-editor-guidance-model.js`: parse frontmatter, headings, marker pairs, section emptiness, hide ranges, placeholder and cursor positions.
- Create `development/obsidian-hz-workbench/src/daily-editor-guidance-extension.js`: CodeMirror decorations, clickable/focusable placeholder widget, extension factory.
- Create `development/obsidian-hz-workbench/tests/daily-editor-guidance-model.test.js`: pure parser edge cases.
- Create `development/obsidian-hz-workbench/tests/daily-editor-guidance-extension.test.js`: JSDOM + CodeMirror rendering and interaction.
- Create `development/obsidian-hz-workbench/tests/daily-editor-guidance-integration.test.js`: production registration, settings, CSS, and no-write boundaries.
- Modify `development/obsidian-hz-workbench/src/main.js`: defaults, extension lifecycle, settings toggles.
- Modify `development/obsidian-hz-workbench/styles.css`: placeholder and marker-line presentation.
- Modify `development/obsidian-hz-workbench/package.json` and `pnpm-lock.yaml`: declare the CodeMirror peer versions expected by the installed Obsidian API package.
- Rebuild `development/obsidian-hz-workbench/main.js` and mirror changed release files into `install/hz-workbench/`.

---

### Task 1: Pure Daily-Note Structure Analyzer

**Files:**
- Create: `development/obsidian-hz-workbench/src/daily-editor-guidance-model.js`
- Create: `development/obsidian-hz-workbench/tests/daily-editor-guidance-model.test.js`

**Interfaces:**
- Consumes: a complete Markdown string and `{ showGuidance?: boolean, showTechnicalMarkers?: boolean }`.
- Produces: `analyzeDailyEditor(text, options) -> { isDaily, hiddenMarkers, placeholders }`.
- Produces descriptor shape: `{ id, label, at, interaction, action, cursor, block }` for placeholders and `{ id, from, to, wholeLine }` for hidden markers. Photo, time, and finance prompts use `interaction: 'action'`; quick notes, summary, and decisions use `interaction: 'cursor'`.
- Produces: exported immutable `GUIDANCE_SECTIONS` copy used by tests and the editor extension.

- [ ] **Step 1: Write the failing parser contract tests**

Create `tests/daily-editor-guidance-model.test.js` with assertion-level cases for all approved behaviors:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  GUIDANCE_SECTIONS,
  analyzeDailyEditor,
} = require('../src/daily-editor-guidance-model');

const TEMPLATE = `---
date: "2026-08-19"
type: 日记
---

# 2026年-08-19-星期三

## 今日照片

<!-- hz:daily-photo:start -->
<!-- hz:daily-photo:end -->

## 柳比歇夫时间记录

### 时间流水

<!-- hz:time-entries:start -->
<!-- hz:time-entries:end -->

### 时间汇总

<!-- hz:time-summary:start -->
- 总计：0分
<!-- hz:time-summary:end -->

## 随手记

<!-- hz:quick-notes:start -->
<!-- hz:quick-notes:end -->

## 今日收支

### 收支流水

<!-- hz:finance-entries:start -->
<!-- hz:finance-entries:end -->

### 收支汇总

<!-- hz:finance-summary:start -->
- 收入：¥0.00
- 支出：¥0.00
- 净额：¥0.00
<!-- hz:finance-summary:end -->

## 今日整理

### 今日摘要


### 重要决定与分流


### 今日任务

\`\`\`hz-tasks
scope: today
includeCompleted: true
\`\`\`

### 明日行动

\`\`\`hz-tasks
scope: tomorrow
includeCompleted: false
\`\`\`
`;

test('approved prompt copy and exact six section ids are stable', () => {
  assert.deepEqual(GUIDANCE_SECTIONS.map(({ id, label }) => ({ id, label })), [
    { id: 'daily-photo', label: '通过“记录今日”添加今天最有意义的一张照片' },
    { id: 'time-entries', label: '通过“记录今日”开始计时、结束计时或补记时间' },
    { id: 'quick-notes', label: '此刻有什么值得记下的想法？' },
    { id: 'finance-entries', label: '通过“记录今日”添加今天的收入或支出' },
    { id: 'daily-summary', label: '今天最值得记住的事情是什么？' },
    { id: 'decisions', label: '今天做了什么决定？后续应该放到哪里？' },
  ]);
  assert.deepEqual(GUIDANCE_SECTIONS.map(({ id, interaction, action }) => ({ id, interaction, action })), [
    { id: 'daily-photo', interaction: 'action', action: 'photo' },
    { id: 'time-entries', interaction: 'action', action: 'record-today' },
    { id: 'quick-notes', interaction: 'cursor', action: null },
    { id: 'finance-entries', interaction: 'action', action: 'finance' },
    { id: 'daily-summary', interaction: 'cursor', action: null },
    { id: 'decisions', interaction: 'cursor', action: null },
  ]);
});

test('empty daily note returns six prompts and all six valid marker pairs', () => {
  const result = analyzeDailyEditor(TEMPLATE);
  assert.equal(result.isDaily, true);
  assert.deepEqual(result.placeholders.map((item) => item.id), [
    'daily-photo', 'time-entries', 'quick-notes', 'finance-entries', 'daily-summary', 'decisions',
  ]);
  assert.equal(result.hiddenMarkers.length, 12);
  assert.ok(result.placeholders.every((item) => Number.isInteger(item.at)));
  assert.ok(result.placeholders.filter((item) => item.interaction === 'cursor').every((item) => Number.isInteger(item.cursor)));
  assert.ok(result.placeholders.filter((item) => item.interaction === 'action').every((item) => item.cursor === null));
});

test('text image list and plugin records each suppress only their own prompt', () => {
  const populated = TEMPLATE
    .replace('<!-- hz:daily-photo:end -->', '![[06 附件/日记照片/2026/2026-08-19.jpg]]\n<!-- hz:daily-photo:end -->')
    .replace('<!-- hz:time-entries:end -->', '- 09:00–10:00 · 工作 · 方案\n<!-- hz:time-entries:end -->')
    .replace('<!-- hz:quick-notes:end -->', '- 10:20 一个想法\n<!-- hz:quick-notes:end -->')
    .replace('<!-- hz:finance-entries:end -->', '- 12:00 · 支出 · 餐饮 · ¥28.00\n<!-- hz:finance-entries:end -->')
    .replace('### 今日摘要\n\n', '### 今日摘要\n\n完成了关键方案。\n')
    .replace('### 重要决定与分流\n\n', '### 重要决定与分流\n\n- 决定归档到项目。\n');
  assert.deepEqual(analyzeDailyEditor(populated).placeholders, []);
});

test('non-journal notes are untouched and tasks never receive prompts', () => {
  const result = analyzeDailyEditor(TEMPLATE.replace('type: 日记', 'type: 项目'));
  assert.deepEqual(result, { isDaily: false, hiddenMarkers: [], placeholders: [] });
  assert.doesNotMatch(JSON.stringify(analyzeDailyEditor(TEMPLATE)), /today-tasks|tomorrow-actions/);
});

test('malformed duplicate crossed and incomplete markers remain visible', () => {
  for (const broken of [
    TEMPLATE.replace('<!-- hz:daily-photo:end -->', ''),
    TEMPLATE.replace('<!-- hz:daily-photo:start -->', '<!-- hz:daily-photo:start -->\n<!-- hz:daily-photo:start -->'),
    TEMPLATE.replace('<!-- hz:daily-photo:start -->\n<!-- hz:daily-photo:end -->', '<!-- hz:daily-photo:end -->\n<!-- hz:daily-photo:start -->'),
    TEMPLATE
      .replace('<!-- hz:daily-photo:end -->', '<!-- hz:time-entries:end -->')
      .replace('<!-- hz:time-entries:start -->', '<!-- hz:daily-photo:end -->'),
  ]) {
    const result = analyzeDailyEditor(broken);
    assert.equal(result.hiddenMarkers.some((item) => item.id === 'daily-photo'), false);
    assert.equal(result.placeholders.some((item) => item.id === 'daily-photo'), false);
  }
});

test('settings independently suppress placeholders or hidden ranges', () => {
  assert.equal(analyzeDailyEditor(TEMPLATE, { showGuidance: false }).placeholders.length, 0);
  assert.equal(analyzeDailyEditor(TEMPLATE, { showTechnicalMarkers: true }).hiddenMarkers.length, 0);
});
```

- [ ] **Step 2: Run the parser tests and capture RED**

Run:

```powershell
& 'C:\Users\瀚中\AppData\Local\OpenAI\Codex\runtimes\cua_node\2fb562745e6d66f0\bin\node.exe' --test tests\daily-editor-guidance-model.test.js
```

Expected: exit 1 with `MODULE_NOT_FOUND` for `../src/daily-editor-guidance-model` and zero passing production assertions. Do not count a missing Node executable as RED.

- [ ] **Step 3: Implement the minimal pure analyzer**

Create `src/daily-editor-guidance-model.js` with these concrete exports and conservative behavior:

```js
const GUIDANCE_SECTIONS = Object.freeze([
  Object.freeze({ id: 'daily-photo', marker: 'daily-photo', heading: '今日照片', level: 2, interaction: 'action', action: 'photo', label: '通过“记录今日”添加今天最有意义的一张照片' }),
  Object.freeze({ id: 'time-entries', marker: 'time-entries', heading: '时间流水', level: 3, interaction: 'action', action: 'record-today', label: '通过“记录今日”开始计时、结束计时或补记时间' }),
  Object.freeze({ id: 'quick-notes', marker: 'quick-notes', heading: '随手记', level: 2, interaction: 'cursor', action: null, label: '此刻有什么值得记下的想法？' }),
  Object.freeze({ id: 'finance-entries', marker: 'finance-entries', heading: '收支流水', level: 3, interaction: 'action', action: 'finance', label: '通过“记录今日”添加今天的收入或支出' }),
  Object.freeze({ id: 'daily-summary', heading: '今日摘要', level: 3, interaction: 'cursor', action: null, label: '今天最值得记住的事情是什么？' }),
  Object.freeze({ id: 'decisions', heading: '重要决定与分流', level: 3, interaction: 'cursor', action: null, label: '今天做了什么决定？后续应该放到哪里？' }),
]);

const TECHNICAL_MARKERS = Object.freeze([
  'daily-photo', 'time-entries', 'time-summary', 'quick-notes', 'finance-entries', 'finance-summary',
]);

function lineRecords(text) {
  const records = [];
  let from = 0;
  for (const raw of String(text).split('\n')) {
    const to = from + raw.length;
    records.push({ raw: raw.endsWith('\r') ? raw.slice(0, -1) : raw, from, to, lineTo: to < text.length ? to + 1 : to });
    from = to + 1;
  }
  return records;
}

function isDailyFrontmatter(text) {
  const match = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return false;
  const type = match[1].split(/\r?\n/).find((line) => /^type\s*:/.test(line));
  if (!type) return false;
  return type.replace(/^type\s*:\s*/, '').trim().replace(/^['"]|['"]$/g, '') === '日记';
}

function meaningful(value) {
  return String(value).trim().length > 0;
}

function markerPair(lines, marker) {
  const startText = `<!-- hz:${marker}:start -->`;
  const endText = `<!-- hz:${marker}:end -->`;
  const starts = lines.filter((line) => line.raw.trim() === startText);
  const ends = lines.filter((line) => line.raw.trim() === endText);
  if (starts.length !== 1 || ends.length !== 1 || starts[0].from >= ends[0].from) return null;
  const foreignBoundaryInside = lines.some((line) => (
    line.from > starts[0].from
    && line.from < ends[0].from
    && /^<!-- hz:[a-z0-9-]+:(?:start|end) -->$/.test(line.raw.trim())
  ));
  if (foreignBoundaryInside) return null;
  return { start: starts[0], end: ends[0] };
}

function headingRanges(lines) {
  return lines.flatMap((line, index) => {
    const match = line.raw.match(/^(#{1,6})[ \t]+(.+?)\s*$/);
    return match ? [{ index, level: match[1].length, title: match[2].trim(), line }] : [];
  });
}

function analyzeDailyEditor(text, options = {}) {
  const source = String(text || '');
  if (!isDailyFrontmatter(source)) return { isDaily: false, hiddenMarkers: [], placeholders: [] };
  const showGuidance = options.showGuidance !== false;
  const showTechnicalMarkers = options.showTechnicalMarkers === true;
  const lines = lineRecords(source);
  const headings = headingRanges(lines);
  const hiddenMarkers = [];
  const placeholders = [];
  const pairs = new Map(TECHNICAL_MARKERS.map((marker) => [marker, markerPair(lines, marker)]));

  if (!showTechnicalMarkers) {
    for (const marker of TECHNICAL_MARKERS) {
      const pair = pairs.get(marker);
      if (!pair) continue;
      hiddenMarkers.push(
        { id: marker, from: pair.start.from, to: pair.start.lineTo, wholeLine: true },
        { id: marker, from: pair.end.from, to: pair.end.lineTo, wholeLine: true },
      );
    }
  }

  for (const section of GUIDANCE_SECTIONS) {
    const heading = headings.find((item) => item.level === section.level && item.title === section.heading);
    if (!heading) continue;
    if (section.marker) {
      const pair = pairs.get(section.marker);
      if (!pair || heading.line.from >= pair.start.from) continue;
      const body = source.slice(heading.line.lineTo, pair.start.from) + source.slice(pair.start.lineTo, pair.end.from);
      if (showGuidance && !meaningful(body)) {
        const cursorInteraction = section.interaction === 'cursor';
        placeholders.push({
          id: section.id, label: section.label,
          interaction: section.interaction, action: section.action,
          at: cursorInteraction ? heading.line.lineTo : pair.start.from,
          cursor: cursorInteraction ? heading.line.lineTo : null,
          block: !cursorInteraction,
        });
      }
      continue;
    }

    const next = headings.find((item) => item.index > heading.index && item.level <= heading.level);
    const bodyFrom = heading.line.lineTo;
    const bodyTo = next ? next.line.from : source.length;
    if (showGuidance && !meaningful(source.slice(bodyFrom, bodyTo))) {
      placeholders.push({
        id: section.id, label: section.label,
        interaction: 'cursor', action: null,
        at: bodyFrom, cursor: bodyFrom, block: false,
      });
    }
  }

  return { isDaily: true, hiddenMarkers, placeholders };
}

module.exports = { GUIDANCE_SECTIONS, analyzeDailyEditor };
```

During implementation, preserve CRLF offsets and ensure hidden ranges do not exceed `text.length`; add assertion tests before changing the shown algorithm if CRLF exposes an offset defect.

- [ ] **Step 4: Run focused tests and make them GREEN**

Run the same command from Step 2. Expected: all parser tests pass, exit 0.

- [ ] **Step 5: Commit Task 1**

```powershell
git add -- development/obsidian-hz-workbench/src/daily-editor-guidance-model.js development/obsidian-hz-workbench/tests/daily-editor-guidance-model.test.js
git commit -m "feat: analyze daily note guidance sections"
```

---

### Task 2: CodeMirror Decorations and Click-to-Write Widget

**Files:**
- Create: `development/obsidian-hz-workbench/src/daily-editor-guidance-extension.js`
- Create: `development/obsidian-hz-workbench/tests/daily-editor-guidance-extension.test.js`
- Modify: `development/obsidian-hz-workbench/package.json`
- Modify: `development/obsidian-hz-workbench/pnpm-lock.yaml`

**Interfaces:**
- Consumes: `analyzeDailyEditor(text, settings)` from Task 1.
- Produces: `createDailyEditorGuidanceExtension({ settings, onAction }) -> CodeMirror Extension`.
- Settings snapshot: `{ showDailyGuidance: boolean, showDailyTechnicalMarkers: boolean }`.
- Widget contract: native `<button type="button" class="hz-daily-editor-placeholder">` with `data-hz-guidance-id`, label text, context-sensitive action/cursor activation, and native Enter/Space activation.

- [ ] **Step 1: Declare exact CodeMirror peer versions**

Run from `development/obsidian-hz-workbench`:

```powershell
pnpm add -D @codemirror/state@6.5.0 @codemirror/view@6.38.6
```

Expected: `package.json` gains both exact devDependencies and `pnpm-lock.yaml` resolves them without changing Obsidian, esbuild, or jsdom versions.

- [ ] **Step 2: Write failing extension tests**

Create `tests/daily-editor-guidance-extension.test.js`. Use JSDOM, expose `window`, `document`, `MutationObserver`, `requestAnimationFrame`, `cancelAnimationFrame`, and a no-op `ResizeObserver`, then create a real `EditorView`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { EditorState } = require('@codemirror/state');
const { EditorView } = require('@codemirror/view');
const { createDailyEditorGuidanceExtension } = require('../src/daily-editor-guidance-extension');

function journal() {
  return `---\ntype: 日记\n---\n\n## 今日照片\n\n<!-- hz:daily-photo:start -->\n<!-- hz:daily-photo:end -->\n\n## 今日整理\n\n### 今日摘要\n\n\n### 重要决定与分流\n\n`;
}

function mount(doc = journal(), settings = { showDailyGuidance: true, showDailyTechnicalMarkers: false }) {
  const dom = new JSDOM('<main id="editor"></main>', { pretendToBeVisual: true });
  global.window = dom.window;
  global.document = dom.window.document;
  global.MutationObserver = dom.window.MutationObserver;
  global.requestAnimationFrame = (callback) => setTimeout(callback, 0);
  global.cancelAnimationFrame = clearTimeout;
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  const actions = [];
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [createDailyEditorGuidanceExtension({ settings, onAction: (action) => actions.push(action) })],
    }),
    parent: dom.window.document.querySelector('#editor'),
  });
  return { actions, dom, view, destroy: () => { view.destroy(); dom.window.close(); } };
}

test('renders native prompt buttons and hides valid dedicated marker lines', () => {
  const context = mount();
  try {
    const buttons = [...context.dom.window.document.querySelectorAll('button.hz-daily-editor-placeholder')];
    assert.deepEqual(buttons.map((button) => button.textContent), [
      '通过“记录今日”添加今天最有意义的一张照片',
      '今天最值得记住的事情是什么？',
      '今天做了什么决定？后续应该放到哪里？',
    ]);
    assert.ok(buttons.every((button) => button.type === 'button'));
    assert.equal(context.dom.window.document.querySelectorAll('.cm-hz-technical-marker-line').length, 2);
  } finally { context.destroy(); }
});

test('click re-analyzes current doc and moves selection without changing markdown', () => {
  const context = mount();
  try {
    const before = context.view.state.doc.toString();
    const button = context.dom.window.document.querySelector('[data-hz-guidance-id="daily-summary"]');
    button.dispatchEvent(new context.dom.window.MouseEvent('click', { bubbles: true }));
    assert.equal(context.view.state.doc.toString(), before);
    assert.equal(context.view.state.selection.main.head, before.indexOf('### 今日摘要') + '### 今日摘要\n'.length);
  } finally { context.destroy(); }
});

test('photo time and finance prompts call only their exact record actions', () => {
  const full = journal()
    .replace('## 今日整理', '### 时间流水\n\n<!-- hz:time-entries:start -->\n<!-- hz:time-entries:end -->\n\n### 收支流水\n\n<!-- hz:finance-entries:start -->\n<!-- hz:finance-entries:end -->\n\n## 今日整理');
  const context = mount(full);
  try {
    for (const id of ['daily-photo', 'time-entries', 'finance-entries']) {
      context.dom.window.document.querySelector(`[data-hz-guidance-id="${id}"]`).click();
    }
    assert.deepEqual(context.actions, ['photo', 'record-today', 'finance']);
    assert.equal(context.view.state.doc.toString(), full);
  } finally { context.destroy(); }
});

test('typing removes only the populated prompt and undo restores it', () => {
  const context = mount();
  try {
    const button = context.dom.window.document.querySelector('[data-hz-guidance-id="daily-summary"]');
    button.click();
    const anchor = context.view.state.selection.main.head;
    context.view.dispatch({ changes: { from: anchor, insert: '今天完成方案。' } });
    assert.equal(context.dom.window.document.querySelector('[data-hz-guidance-id="daily-summary"]'), null);
    context.view.dispatch({ changes: { from: anchor, to: anchor + 7, insert: '' } });
    assert.ok(context.dom.window.document.querySelector('[data-hz-guidance-id="daily-summary"]'));
  } finally { context.destroy(); }
});

test('non-journal and disabled settings render no accidental UI', () => {
  for (const context of [
    mount(journal().replace('type: 日记', 'type: 项目')),
    mount(journal(), { showDailyGuidance: false, showDailyTechnicalMarkers: true }),
  ]) {
    try {
      assert.equal(context.dom.window.document.querySelectorAll('.hz-daily-editor-placeholder').length, 0);
      assert.equal(context.dom.window.document.querySelectorAll('.cm-hz-technical-marker-line').length, 0);
    } finally { context.destroy(); }
  }
});
```

- [ ] **Step 3: Run extension tests and capture RED**

```powershell
& 'C:\Users\瀚中\AppData\Local\OpenAI\Codex\runtimes\cua_node\2fb562745e6d66f0\bin\node.exe' --test tests\daily-editor-guidance-extension.test.js
```

Expected: exit 1 because `daily-editor-guidance-extension.js` does not exist. The CodeMirror packages must load successfully; dependency-resolution failure is setup failure, not behavioral RED.

- [ ] **Step 4: Implement the editor extension**

Create `src/daily-editor-guidance-extension.js`:

```js
const { Decoration, EditorView, ViewPlugin, WidgetType } = require('@codemirror/view');
const { analyzeDailyEditor } = require('./daily-editor-guidance-model');

class GuidanceWidget extends WidgetType {
  constructor(descriptor, onAction) { super(); this.descriptor = descriptor; this.onAction = onAction; }
  eq(other) { return other instanceof GuidanceWidget && other.descriptor.id === this.descriptor.id && other.descriptor.label === this.descriptor.label; }
  toDOM(view) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hz-daily-editor-placeholder';
    button.dataset.hzGuidanceId = this.descriptor.id;
    button.textContent = this.descriptor.label;
    button.setAttribute('aria-label', `${this.descriptor.label}，点击开始填写`);
    button.addEventListener('click', () => {
      const current = analyzeDailyEditor(view.state.doc.toString());
      const latest = current.placeholders.find((item) => item.id === this.descriptor.id);
      if (!latest) return;
      if (latest.interaction === 'action') {
        this.onAction(latest.action);
        return;
      }
      view.dispatch({ selection: { anchor: latest.cursor }, scrollIntoView: true });
      view.focus();
    });
    return button;
  }
  ignoreEvent() { return false; }
}

function buildDecorations(view, settings, onAction) {
  const result = analyzeDailyEditor(view.state.doc.toString(), {
    showGuidance: settings.showDailyGuidance,
    showTechnicalMarkers: settings.showDailyTechnicalMarkers,
  });
  const ranges = [];
  for (const marker of result.hiddenMarkers) {
    ranges.push(Decoration.line({ attributes: { class: 'cm-hz-technical-marker-line' } }).range(marker.from));
  }
  for (const prompt of result.placeholders) {
    ranges.push(Decoration.widget({
      widget: new GuidanceWidget(prompt, onAction),
      side: prompt.block ? -1 : 1,
      block: prompt.block,
    }).range(prompt.at));
  }
  return Decoration.set(ranges, true);
}

function createDailyEditorGuidanceExtension({ settings, onAction }) {
  if (typeof onAction !== 'function') throw new TypeError('onAction must be a function');
  const snapshot = Object.freeze({
    showDailyGuidance: settings.showDailyGuidance !== false,
    showDailyTechnicalMarkers: settings.showDailyTechnicalMarkers === true,
  });
  return ViewPlugin.fromClass(class {
    constructor(view) { this.decorations = buildDecorations(view, snapshot, onAction); }
    update(update) {
      if (update.docChanged || update.viewportChanged) this.decorations = buildDecorations(update.view, snapshot, onAction);
    }
  }, { decorations: (value) => value.decorations });
}

module.exports = { GuidanceWidget, buildDecorations, createDailyEditorGuidanceExtension };
```

Action prompts are block widgets immediately before their hidden start-marker lines. Cursor prompts are inline widgets on the safe blank line after their headings; `随手记` intentionally places hand-written text before `hz:quick-notes:start`, while protocol-written quick notes remain inside the marker pair. Do not place a cursor inside an empty `start\nend` marker pair because the first typed character would corrupt the end-marker line.

- [ ] **Step 5: Run Task 1 and Task 2 focused tests**

```powershell
& 'C:\Users\瀚中\AppData\Local\OpenAI\Codex\runtimes\cua_node\2fb562745e6d66f0\bin\node.exe' --test tests\daily-editor-guidance-model.test.js tests\daily-editor-guidance-extension.test.js
```

Expected: all focused tests pass, exit 0; no Markdown mutation assertion fails.

- [ ] **Step 6: Commit Task 2**

```powershell
git add -- development/obsidian-hz-workbench/src/daily-editor-guidance-extension.js development/obsidian-hz-workbench/tests/daily-editor-guidance-extension.test.js development/obsidian-hz-workbench/package.json development/obsidian-hz-workbench/pnpm-lock.yaml
git commit -m "feat: render daily note editor guidance"
```

---

### Task 3: Plugin Lifecycle, Persisted Settings, and Theme-Safe CSS

**Files:**
- Modify: `development/obsidian-hz-workbench/src/main.js`
- Modify: `development/obsidian-hz-workbench/styles.css`
- Create: `development/obsidian-hz-workbench/tests/daily-editor-guidance-integration.test.js`

**Interfaces:**
- Consumes: `createDailyEditorGuidanceExtension({ settings, onAction })` from Task 2.
- Produces defaults: `showDailyGuidance: true`, `showDailyTechnicalMarkers: false`.
- Produces plugin methods: `dailyEditorGuidanceExtension()` and `handleDailyEditorGuidanceAction(action)`.
- Produces plugin method: `refreshDailyEditorGuidance()`; replaces the registered extension array contents and calls `app.workspace.updateOptions()` exactly once.

- [ ] **Step 1: Write failing production-boundary and CSS tests**

Create `tests/daily-editor-guidance-integration.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../src/main.js'), 'utf8');
const css = fs.readFileSync(path.resolve(__dirname, '../styles.css'), 'utf8');

test('production registers one daily guidance editor extension with safe defaults', () => {
  assert.match(source, /showDailyGuidance:\s*true/);
  assert.match(source, /showDailyTechnicalMarkers:\s*false/);
  assert.equal((source.match(/registerEditorExtension\(/g) || []).length, 1);
  assert.match(source, /createDailyEditorGuidanceExtension/);
  assert.match(source, /action === 'record-today'[^}]*openDailyCapture\(\)/s);
  assert.match(source, /action === 'photo' \|\| action === 'finance'[^}]*openDailyCapture\(action\)/s);
  assert.match(source, /refreshDailyEditorGuidance\(\)/);
  assert.match(source, /workspace\.updateOptions\(\)/);
});

test('settings expose two independent persisted toggles and refresh open editors', () => {
  assert.match(source, /显示日记填写提示/);
  assert.match(source, /显示日记技术标记/);
  assert.match(source, /this\.plugin\.settings\.showDailyGuidance\s*=\s*value/);
  assert.match(source, /this\.plugin\.settings\.showDailyTechnicalMarkers\s*=\s*value/);
  assert.ok((source.match(/refreshDailyEditorGuidance\(\)/g) || []).length >= 3);
});

test('editor guidance CSS is theme-variable based and accessible', () => {
  assert.match(css, /\.cm-line\.cm-hz-technical-marker-line\s*\{[^}]*display:\s*none/s);
  assert.match(css, /\.hz-daily-editor-placeholder\s*\{[^}]*var\(--text-muted\)/s);
  assert.match(css, /\.hz-daily-editor-placeholder:hover/);
  assert.match(css, /\.hz-daily-editor-placeholder:focus-visible/);
  assert.doesNotMatch(css, /\.hz-daily-editor-placeholder[^}]*#[0-9a-f]{3,8}/i);
});

test('guidance integration adds no Vault task or TickTick write path', () => {
  const extension = fs.readFileSync(path.resolve(__dirname, '../src/daily-editor-guidance-extension.js'), 'utf8');
  assert.doesNotMatch(extension, /vault\.(?:create|modify|delete|process)|taskRepository|TickTick|setInterval/);
});
```

- [ ] **Step 2: Run integration tests and capture RED**

```powershell
& 'C:\Users\瀚中\AppData\Local\OpenAI\Codex\runtimes\cua_node\2fb562745e6d66f0\bin\node.exe' --test tests\daily-editor-guidance-integration.test.js
```

Expected: exit 1 because defaults, registration, toggles, refresh method, and CSS do not yet exist.

- [ ] **Step 3: Wire the extension into `main.js`**

Add the import beside the daily-capture imports:

```js
const { createDailyEditorGuidanceExtension } = require('./daily-editor-guidance-extension');
```

Add exact defaults inside `DEFAULT_SETTINGS`:

```js
showDailyGuidance: true,
showDailyTechnicalMarkers: false,
```

Immediately after `await this.loadSettings()` in `onload()`, register a mutable extension array:

```js
this.dailyEditorGuidanceExtensions = [this.dailyEditorGuidanceExtension()];
this.registerEditorExtension(this.dailyEditorGuidanceExtensions);
```

Add these methods to `HZWorkbenchPlugin`. The callback maps only the three approved action tokens to existing plugin UI methods and does not write Markdown itself:

```js
dailyEditorGuidanceExtension() {
  return createDailyEditorGuidanceExtension({
    settings: this.settings,
    onAction: (action) => this.handleDailyEditorGuidanceAction(action),
  });
}

handleDailyEditorGuidanceAction(action) {
  if (action === 'record-today') this.openDailyCapture();
  else if (action === 'photo' || action === 'finance') this.openDailyCapture(action);
}

refreshDailyEditorGuidance() {
  if (!this.dailyEditorGuidanceExtensions) return;
  this.dailyEditorGuidanceExtensions.splice(
    0,
    this.dailyEditorGuidanceExtensions.length,
    this.dailyEditorGuidanceExtension(),
  );
  this.app.workspace.updateOptions();
}
```

Do not access private `view.editor.cm`; use the documented mutable-array plus `Workspace.updateOptions()` flow.

- [ ] **Step 4: Add the two setting toggles**

Under the existing `每日记录` settings heading, add:

```js
new Setting(containerEl)
  .setName('显示日记填写提示')
  .setDesc('空栏目显示灰色填写引导；提示不会写入日记。')
  .addToggle((toggle) => toggle.setValue(this.plugin.settings.showDailyGuidance).onChange(async (value) => {
    this.plugin.settings.showDailyGuidance = value;
    await this.plugin.saveSettings();
    this.plugin.refreshDailyEditorGuidance();
  }));

new Setting(containerEl)
  .setName('显示日记技术标记')
  .setDesc('排查问题时显示 hz:* 定位标记；默认隐藏。')
  .addToggle((toggle) => toggle.setValue(this.plugin.settings.showDailyTechnicalMarkers).onChange(async (value) => {
    this.plugin.settings.showDailyTechnicalMarkers = value;
    await this.plugin.saveSettings();
    this.plugin.refreshDailyEditorGuidance();
  }));
```

- [ ] **Step 5: Add scoped, theme-safe CSS**

Append to `development/obsidian-hz-workbench/styles.css`:

```css
.cm-line.cm-hz-technical-marker-line {
  display: none;
}

.hz-daily-editor-placeholder {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: var(--font-smallest);
  line-height: var(--line-height-normal);
  padding: 2px 0;
  text-align: left;
  cursor: text;
  opacity: 0.78;
}

.hz-daily-editor-placeholder:hover {
  color: var(--text-normal);
  opacity: 1;
}

.hz-daily-editor-placeholder:focus-visible {
  outline: 2px solid var(--interactive-accent);
  outline-offset: 2px;
  border-radius: var(--radius-s);
}
```

- [ ] **Step 6: Run all guidance-focused tests**

```powershell
& 'C:\Users\瀚中\AppData\Local\OpenAI\Codex\runtimes\cua_node\2fb562745e6d66f0\bin\node.exe' --test tests\daily-editor-guidance-model.test.js tests\daily-editor-guidance-extension.test.js tests\daily-editor-guidance-integration.test.js
```

Expected: all focused tests pass, exit 0.

- [ ] **Step 7: Run the fresh full check once**

```powershell
& 'C:\Users\瀚中\AppData\Local\OpenAI\Codex\runtimes\cua_node\2fb562745e6d66f0\bin\node.exe' scripts\check-syntax.js
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& 'C:\Users\瀚中\AppData\Local\OpenAI\Codex\runtimes\cua_node\2fb562745e6d66f0\bin\node.exe' --test tests\*.test.js
```

Expected: syntax exit 0 and every test passes. If the only failure is development/install CSS drift, do not weaken the release test; Task 4 owns release mirroring.

- [ ] **Step 8: Commit Task 3**

```powershell
git add -- development/obsidian-hz-workbench/src/main.js development/obsidian-hz-workbench/styles.css development/obsidian-hz-workbench/tests/daily-editor-guidance-integration.test.js
git commit -m "feat: configure guided daily note editing"
```

---

### Task 4: Build, Release Invariants, Protected Installation, and Live Acceptance

**Files:**
- Modify generated: `development/obsidian-hz-workbench/main.js`
- Mirror: `install/hz-workbench/main.js`
- Mirror: `install/hz-workbench/styles.css`
- Protect unchanged: live `data.json`, `manifest.json`, `logo.png`, daily template, every journal, TickTickSync, and layout files.

**Interfaces:**
- Consumes all source and tests from Tasks 1–3.
- Produces byte-identical development/install/live `main.js` and `styles.css` after a verified build and install.

- [ ] **Step 1: Verify the worktree and run fresh pre-build checks**

```powershell
git status --short
git diff --check
& 'C:\Users\瀚中\AppData\Local\OpenAI\Codex\runtimes\cua_node\2fb562745e6d66f0\bin\node.exe' scripts\check-syntax.js
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& 'C:\Users\瀚中\AppData\Local\OpenAI\Codex\runtimes\cua_node\2fb562745e6d66f0\bin\node.exe' --test tests\*.test.js
```

Expected: no unrelated edits, diff-check exit 0, syntax exit 0, all tests pass except a pre-mirror release byte mismatch if CSS changed.

- [ ] **Step 2: Build and mirror release artifacts**

```powershell
& 'C:\Users\瀚中\AppData\Local\OpenAI\Codex\runtimes\cua_node\2fb562745e6d66f0\bin\node.exe' esbuild.config.mjs
Copy-Item -LiteralPath 'main.js' -Destination '..\..\install\hz-workbench\main.js' -Force
Copy-Item -LiteralPath 'styles.css' -Destination '..\..\install\hz-workbench\styles.css' -Force
```

Expected: build exit 0; only generated/mirrored release files change.

- [ ] **Step 3: Prove release bytes and tests**

```powershell
& 'C:\Users\瀚中\AppData\Local\OpenAI\Codex\runtimes\cua_node\2fb562745e6d66f0\bin\node.exe' --test tests\release-package.test.js tests\daily-editor-guidance-model.test.js tests\daily-editor-guidance-extension.test.js tests\daily-editor-guidance-integration.test.js
git diff --check
```

Expected: release package tests and guidance tests all pass; diff-check exit 0.

- [ ] **Step 4: Record protected baselines and make a complete live-plugin backup**

Create a timestamped directory under `D:\Chat GPT\HZ--工作平台\备份\<timestamp>-before-daily-editor-guidance`. Copy all five live HZ plugin files from `F:\Obsidian\.obsidian\plugins\hz-workbench` and verify source/backup SHA-256 equality.

Record SHA-256 or deterministic inventories for:

```text
F:\Obsidian\.obsidian\plugins\hz-workbench\data.json
F:\Obsidian\.obsidian\plugins\hz-workbench\manifest.json
F:\Obsidian\.obsidian\plugins\hz-workbench\logo.png
F:\Obsidian\07 模板\每日模板.md
F:\Obsidian\01 日记\**\*.md
F:\Obsidian\.obsidian\plugins\tickticksync\*
the actual HZ layout file previously identified by the repository reports
```

Expected: complete backup exists and every copied file matches before installation.

- [ ] **Step 5: Install only the two release artifacts**

```powershell
Copy-Item -LiteralPath '..\..\install\hz-workbench\main.js' -Destination 'F:\Obsidian\.obsidian\plugins\hz-workbench\main.js' -Force
Copy-Item -LiteralPath '..\..\install\hz-workbench\styles.css' -Destination 'F:\Obsidian\.obsidian\plugins\hz-workbench\styles.css' -Force
```

Expected: live folder still contains exactly the original five files; `data.json`, `manifest.json`, and `logo.png` hashes are unchanged.

- [ ] **Step 6: Reload the exact user Vault safely**

Enumerate Obsidian windows and target the one whose title belongs to the `F:\Obsidian` Vault. Open the command palette, type the full command name `重新加载 Obsidian`, verify the single result, then execute it. Never select the command by list index; that previously opened Obsidian Sandbox.

Expected: the user Vault reloads, HZ Workbench remains enabled, and no Sandbox window is opened.

- [ ] **Step 7: Perform bounded live acceptance**

Use an authorized temporary daily-note copy or a non-personal controlled test note with `type: 日记`; do not alter a real journal. Verify in this exact order:

1. Source mode hides all valid `hz:*` lines.
2. Live Preview hides the same lines.
3. The six approved prompts appear only while their sections are empty.
4. Clicking `今日照片` opens the photo form, `时间流水` opens the record-today menu, and `收支流水` opens the finance form; each action fires once.
5. Clicking `随手记`, `今日摘要`, and `重要决定与分流` places the caret on the first safe blank line after the heading, outside any marker comment.
6. Entering text removes only that prompt; undoing to empty restores it.
7. “显示日记填写提示” toggles prompts immediately and persists after reload.
8. “显示日记技术标记” toggles markers immediately and persists after reload.
9. A non-journal note is unchanged.
10. `今日任务` and `明日行动` remain read-only and receive no prompt.
11. Deep, light, and 墨影黑白 themes keep prompt text subdued and focus-visible.

Stop after the first reproducible failure, record the exact observation, and return to TDD. Do not stack speculative CSS or CodeMirror fixes.

- [ ] **Step 8: Restore any temporary acceptance state and audit protected files**

Delete only the explicitly authorized temporary test note, or restore its verified pre-test backup. Restore the two setting values to the agreed defaults. Recompute every protected hash/inventory from Step 4.

Expected: zero journal inventory drift, zero template drift, zero TickTickSync drift, zero layout drift, and unchanged HZ `data.json` except the two intended persisted guidance settings if the user elects to keep them.

- [ ] **Step 9: Prove three-way artifact equality and commit generated files**

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath `
  'development\obsidian-hz-workbench\main.js', `
  'install\hz-workbench\main.js', `
  'F:\Obsidian\.obsidian\plugins\hz-workbench\main.js'
Get-FileHash -Algorithm SHA256 -LiteralPath `
  'development\obsidian-hz-workbench\styles.css', `
  'install\hz-workbench\styles.css', `
  'F:\Obsidian\.obsidian\plugins\hz-workbench\styles.css'
```

Expected: each set of three hashes and lengths is identical.

Then commit only changed generated/install artifacts:

```powershell
git add -- development/obsidian-hz-workbench/main.js install/hz-workbench/main.js install/hz-workbench/styles.css
git commit -m "release: install guided daily note editing"
git status --short
```

Expected: commit succeeds and final tracked worktree status is empty.

---

## Completion Evidence

Before claiming completion, report all of the following together:

- Task commits and final HEAD.
- Focused RED and GREEN commands with pass/fail counts.
- Fresh full test count and exit code.
- Release-package result.
- Backup directory and five-file equality result.
- Development/install/live SHA-256 for `main.js` and `styles.css`.
- Each protected inventory result.
- Source, Live Preview, three action prompts, three cursor prompts, input, undo, settings, non-journal, tasks, and theme live acceptance results.
- Any item that could not be verified, stated as unverified rather than passed.
