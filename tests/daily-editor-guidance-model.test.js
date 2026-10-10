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

## 每日冥想

<!-- hz:daily-meditation:start -->
<!-- hz:daily-meditation:end -->
`;

test('approved prompt copy and exact six section ids are stable', () => {
  assert.deepEqual(GUIDANCE_SECTIONS.map(({ id, label }) => ({ id, label })), [
    { id: 'daily-photo', label: '为本篇日记添加最有意义的一张照片' },
    { id: 'time-entries', label: '为本篇日记补记时间' },
    { id: 'quick-notes', label: '此刻有什么值得记下的想法？' },
    { id: 'finance-entries', label: '为本篇日记补记收入或支出' },
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

test('empty daily note returns six prompts and hides all seven valid marker pairs', () => {
  const result = analyzeDailyEditor(TEMPLATE);
  assert.equal(result.isDaily, true);
  assert.deepEqual(result.placeholders.map((item) => item.id), [
    'daily-photo', 'time-entries', 'quick-notes', 'finance-entries', 'daily-summary', 'decisions',
  ]);
  assert.equal(result.hiddenMarkers.length, 14);
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

test('conflicting duplicate frontmatter type keys fail closed', () => {
  const duplicate = TEMPLATE.replace('type: 日记', 'type: 日记\ntype: 项目');
  assert.deepEqual(analyzeDailyEditor(duplicate), { isDaily: false, hiddenMarkers: [], placeholders: [] });
});

test('frontmatter accepts only an exact unquoted or symmetrically quoted daily scalar', () => {
  for (const accepted of ['日记', "'日记'", '"日记"']) {
    assert.equal(analyzeDailyEditor(TEMPLATE.replace('type: 日记', `type: ${accepted}`)).isDaily, true);
  }
  for (const rejected of ["'日记\"", '"日记\'', '[日记]', '日记 # comment', '|']) {
    assert.deepEqual(
      analyzeDailyEditor(TEMPLATE.replace('type: 日记', `type: ${rejected}`)),
      { isDaily: false, hiddenMarkers: [], placeholders: [] },
    );
  }
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
    if (broken.includes('<!-- hz:daily-photo:end -->') && !broken.includes('<!-- hz:time-entries:start -->')) {
      assert.equal(result.hiddenMarkers.some((item) => item.id === 'time-entries'), false);
      assert.equal(result.placeholders.some((item) => item.id === 'time-entries'), false);
    }
  }
});

test('settings independently suppress placeholders or hidden ranges', () => {
  assert.equal(analyzeDailyEditor(TEMPLATE, { showGuidance: false }).placeholders.length, 0);
  assert.equal(analyzeDailyEditor(TEMPLATE, { showTechnicalMarkers: true }).hiddenMarkers.length, 0);
});

test('quick notes cursor prompt requires an existing blank line before its start marker', () => {
  const unsafe = TEMPLATE.replace('## 随手记\n\n<!-- hz:quick-notes:start -->', '## 随手记\n<!-- hz:quick-notes:start -->');
  assert.equal(analyzeDailyEditor(unsafe).placeholders.some((item) => item.id === 'quick-notes'), false);

  const restored = unsafe.replace('## 随手记\n<!-- hz:quick-notes:start -->', '## 随手记\n\n<!-- hz:quick-notes:start -->');
  const prompt = analyzeDailyEditor(restored).placeholders.find((item) => item.id === 'quick-notes');
  assert.equal(prompt.cursor, restored.indexOf('## 随手记') + '## 随手记\n'.length);
});

test('handwritten cursor prompts require a blank line before the next heading', () => {
  const unsafe = TEMPLATE
    .replace('### 今日摘要\n\n\n### 重要决定与分流', '### 今日摘要\n### 重要决定与分流')
    .replace('### 重要决定与分流\n\n\n### 今日任务', '### 重要决定与分流\n### 今日任务');
  const promptIds = analyzeDailyEditor(unsafe).placeholders.map((item) => item.id);
  assert.equal(promptIds.includes('daily-summary'), false);
  assert.equal(promptIds.includes('decisions'), false);
});

test('heading at EOF is safe only when a trailing newline creates an empty final line', () => {
  const withoutNewline = '---\ntype: 日记\n---\n\n### 今日摘要';
  assert.equal(analyzeDailyEditor(withoutNewline).placeholders.some((item) => item.id === 'daily-summary'), false);

  const withNewline = `${withoutNewline}\n`;
  const prompt = analyzeDailyEditor(withNewline).placeholders.find((item) => item.id === 'daily-summary');
  assert.equal(prompt.cursor, withNewline.length);
});

test('safe cursor lines preserve CRLF offsets', () => {
  const crlf = TEMPLATE.replace(/\n/g, '\r\n');
  const result = analyzeDailyEditor(crlf);
  for (const [id, heading] of [
    ['quick-notes', '## 随手记'],
    ['daily-summary', '### 今日摘要'],
    ['decisions', '### 重要决定与分流'],
  ]) {
    const prompt = result.placeholders.find((item) => item.id === id);
    assert.equal(prompt.cursor, crlf.indexOf(heading) + `${heading}\r\n`.length);
    assert.equal(crlf.slice(prompt.cursor, prompt.cursor + 2), '\r\n');
  }
});

test('ATX-looking lines inside fenced code are not section headings', () => {
  const fenced = TEMPLATE.replace(
    '## 今日整理',
    '```md\n### 今日摘要\n```\n\n## 今日整理',
  );
  assert.equal(analyzeDailyEditor(fenced).placeholders.some((item) => item.id === 'daily-summary'), true);
});

test('a fence-like content line does not prematurely close a fenced block', () => {
  const fenced = TEMPLATE.replace(
    '## 今日整理',
    '```md\n```not-a-close\n### 今日摘要\n```\n\n## 今日整理',
  );
  assert.equal(analyzeDailyEditor(fenced).placeholders.some((item) => item.id === 'daily-summary'), true);
});

test('duplicate exact target headings fail closed for only the ambiguous section', () => {
  const duplicate = TEMPLATE.replace('### 今日摘要\n\n', '### 今日摘要\n\n### 今日摘要\n\n');
  const promptIds = analyzeDailyEditor(duplicate).placeholders.map((item) => item.id);
  assert.equal(promptIds.includes('daily-summary'), false);
  assert.equal(promptIds.includes('decisions'), true);
});
