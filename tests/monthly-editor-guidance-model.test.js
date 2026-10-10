const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MONTHLY_GUIDANCE_SECTIONS,
  analyzeMonthlyEditor,
} = require('../src/monthly-editor-guidance-model');

function monthlyReview() {
  return `---
month: "2026-08"
type: 月复盘
---

# 2026年08月复盘

### 本月完成了什么


### 最重要的收获


### 遇到的问题


### 下月最重要的三件事

`;
}

test('publishes the four approved monthly guidance descriptors', () => {
  assert.deepEqual(MONTHLY_GUIDANCE_SECTIONS, [
    { id: 'completed', heading: '本月完成了什么', label: '这个月真正完成了哪些重要事情？' },
    { id: 'learning', heading: '最重要的收获', label: '这个月最值得带走的经验或认识是什么？' },
    { id: 'problems', heading: '遇到的问题', label: '什么事情没有做好，原因是什么？' },
    { id: 'next-three', heading: '下月最重要的三件事', label: '下个月最重要的三件事是什么？' },
  ]);
});

test('empty monthly review returns four safe cursor prompts', () => {
  const source = monthlyReview();
  const result = analyzeMonthlyEditor(source);
  assert.equal(result.isMonthly, true);
  assert.deepEqual(result.placeholders.map(({ id, label }) => ({ id, label })), MONTHLY_GUIDANCE_SECTIONS.map(({ id, label }) => ({ id, label })));
  for (const descriptor of result.placeholders) {
    assert.equal(descriptor.at, descriptor.cursor);
    assert.equal(source.slice(descriptor.cursor, descriptor.cursor + 1), '\n');
  }
});

test('content removes only its matching monthly prompt and clearing restores it', () => {
  const source = monthlyReview();
  const populated = source.replace('### 最重要的收获\n\n', '### 最重要的收获\n\n学会先缩小问题。\n');
  const cleared = populated.replace('学会先缩小问题。\n', '');
  assert.deepEqual(analyzeMonthlyEditor(populated).placeholders.map(({ id }) => id), [
    'completed', 'problems', 'next-three',
  ]);
  assert.deepEqual(analyzeMonthlyEditor(cleared).placeholders.map(({ id }) => id), [
    'completed', 'learning', 'problems', 'next-three',
  ]);
});

test('type must be one exact unquoted or symmetrically quoted 月复盘 scalar', () => {
  for (const accepted of ['月复盘', "'月复盘'", '"月复盘"']) {
    assert.equal(analyzeMonthlyEditor(monthlyReview().replace('type: 月复盘', `type: ${accepted}`)).isMonthly, true);
  }
  for (const rejected of ['项目', "'月复盘\"", '"月复盘\'', '[月复盘]', '月复盘 # comment', '|']) {
    assert.deepEqual(analyzeMonthlyEditor(monthlyReview().replace('type: 月复盘', `type: ${rejected}`)), {
      isMonthly: false,
      placeholders: [],
    });
  }
  assert.deepEqual(analyzeMonthlyEditor(monthlyReview().replace('type: 月复盘', 'type: 月复盘\ntype: 项目')), {
    isMonthly: false,
    placeholders: [],
  });
});

test('only unique exact level-three target headings qualify', () => {
  const source = monthlyReview()
    .replace('### 最重要的收获\n\n', '## 最重要的收获\n\n')
    .replace('### 遇到的问题\n\n', '### 遇到的问题\n\n### 遇到的问题\n\n');
  assert.deepEqual(analyzeMonthlyEditor(source).placeholders.map(({ id }) => id), [
    'completed', 'next-three',
  ]);
});

test('section boundary is the next heading at level three or above', () => {
  const source = monthlyReview()
    .replace('### 本月完成了什么\n\n\n### 最重要的收获', '### 本月完成了什么\n\n#### 不会终止本节\n\n### 最重要的收获')
    .replace('### 最重要的收获\n\n\n### 遇到的问题', '### 最重要的收获\n\n这个内容在二级标题前。\n\n## 会终止本节\n\n### 遇到的问题');
  assert.deepEqual(analyzeMonthlyEditor(source).placeholders.map(({ id }) => id), [
    'problems', 'next-three',
  ]);
});

test('ATX-looking lines in properly closed backtick and tilde fences do not count as headings', () => {
  const source = monthlyReview()
    .replace('# 2026年08月复盘\n\n', '# 2026年08月复盘\n\n```md\n### 本月完成了什么\n```\n\n~~~markdown\n### 最重要的收获\n~~~\n\n');
  assert.deepEqual(analyzeMonthlyEditor(source).placeholders.map(({ id }) => id), [
    'completed', 'learning', 'problems', 'next-three',
  ]);
});

test('a safe prompt requires a real blank line inside its section', () => {
  const noBlank = monthlyReview().replace('### 遇到的问题\n\n\n### 下月最重要的三件事', '### 遇到的问题\n### 下月最重要的三件事');
  assert.equal(analyzeMonthlyEditor(noBlank).placeholders.some(({ id }) => id === 'problems'), false);

  const eof = '---\ntype: 月复盘\n---\n\n### 本月完成了什么';
  assert.equal(analyzeMonthlyEditor(eof).placeholders.length, 0);
  const trailingBlank = `${eof}\n`;
  assert.deepEqual(analyzeMonthlyEditor(trailingBlank).placeholders.map(({ id }) => id), ['completed']);
});

test('guidance can be disabled and ordinary notes stay isolated', () => {
  assert.deepEqual(analyzeMonthlyEditor(monthlyReview(), { showGuidance: false }), {
    isMonthly: true,
    placeholders: [],
  });
  assert.deepEqual(analyzeMonthlyEditor(monthlyReview().replace('type: 月复盘', 'type: 日记')), {
    isMonthly: false,
    placeholders: [],
  });
});
