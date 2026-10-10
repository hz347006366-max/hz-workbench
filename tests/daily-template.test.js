const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { updateDailyTemplate, validateDailyTemplate } = require('../src/daily-template');

const CURRENT_TEMPLATE = `---
date: "{{date:YYYY-MM-DD}}"
type: 日记
tags:
  - 日记
aliases:
  - "日记-{{date:YYYY-MM-DD}}"
---

# {{date:YYYY年-MM-DD-dddd}}

<%* tR += await tp.user.journal_navigation.run(tp); %>

> [!note]- 今日照片
> -

> [!note]- 柳比歇夫时间记录
> - 09:00-10:30 ｜ 写方案
> - 总计：1小时30分

> [!note]- 随手记
> - 经历、想法、人物、地点和项目都先记在这里。

> [!note]- 今日收支
> - #支出/餐饮 事项 💴-金额

> [!summary]- 今日整理
> **今日摘要**
>
> **重要决定与分流**
> - [[项目或主题]]：
>
> **今日任务**
>
> \`\`\`hz-tasks
> scope: today
> includeCompleted: true
> \`\`\`
>
> **明日行动**
>
> \`\`\`hz-tasks
> scope: tomorrow
> includeCompleted: false
> \`\`\`
`;

function canonicalAsset() {
  return fs.readFileSync(path.resolve(__dirname, '../assets/每日模板.md'), 'utf8');
}

test('migrates the exact current callout template to the canonical ordinary-heading asset', () => {
  const transformed = updateDailyTemplate(CURRENT_TEMPLATE);
  assert.equal(transformed, canonicalAsset());
  assert.deepEqual(validateDailyTemplate(transformed), []);
  assert.equal(updateDailyTemplate(transformed), transformed);
});

test('canonical template keeps metadata section order markers and readonly tasks without templater navigation', () => {
  const template = canonicalAsset();
  assert.match(template, /^---\ndate: "\{\{date:YYYY-MM-DD\}\}"/);
  assert.doesNotMatch(template, /journal_navigation\.run\(tp\)|<%/);
  const headings = ['## 今日照片', '## 柳比歇夫时间记录', '### 时间流水', '### 时间汇总', '## 随手记', '## 今日收支', '### 收支流水', '### 收支汇总', '## 今日整理', '### 今日摘要', '### 重要决定与分流', '### 今日任务', '### 明日行动', '## 每日冥想'];
  const positions = headings.map((heading) => template.indexOf(heading));
  assert.equal(positions.every((position) => position >= 0), true);
  assert.deepEqual(positions, positions.slice().sort((left, right) => left - right));
  for (const marker of ['daily-photo', 'time-entries', 'time-summary', 'quick-notes', 'finance-entries', 'finance-summary', 'daily-meditation']) {
    assert.equal((template.match(new RegExp(`<!-- hz:${marker}:start -->`, 'g')) || []).length, 1);
    assert.equal((template.match(new RegExp(`<!-- hz:${marker}:end -->`, 'g')) || []).length, 1);
  }
  assert.equal((template.match(/```hz-tasks/g) || []).length, 2);
  assert.doesNotMatch(template, /^> \[!/m);
  assert.match(template, /## 每日冥想\n\n<!-- hz:daily-meditation:start -->\n<!-- hz:daily-meditation:end -->\n$/);
});

test('migration preserves CRLF and missing final newline', () => {
  const source = CURRENT_TEMPLATE.trimEnd().replaceAll('\n', '\r\n');
  const transformed = updateDailyTemplate(source);
  assert.doesNotMatch(transformed, /(?<!\r)\n/);
  assert.equal(transformed.endsWith('\r\n'), false);
  assert.deepEqual(validateDailyTemplate(transformed), []);
  assert.equal(updateDailyTemplate(transformed), transformed);
});

test('unrelated or incomplete templates are returned byte-for-byte unchanged', () => {
  const unrelated = '# 普通模板\n\n## 今日照片\n';
  const incomplete = CURRENT_TEMPLATE.replace('> [!note]- 今日收支\n', '');
  assert.equal(updateDailyTemplate(unrelated), unrelated);
  assert.equal(updateDailyTemplate(incomplete), incomplete);
});

test('validation reports missing duplicate and out-of-order managed markers', () => {
  const template = canonicalAsset();
  assert.match(validateDailyTemplate(template.replace('<!-- hz:quick-notes:end -->', '')).join('\n'), /quick-notes/);
  assert.match(validateDailyTemplate(template.replace('<!-- hz:quick-notes:end -->', '<!-- hz:quick-notes:start -->\n<!-- hz:quick-notes:end -->')).join('\n'), /quick-notes/);
  const reversed = template.replace('<!-- hz:daily-photo:start -->', 'TEMP').replace('<!-- hz:daily-photo:end -->', '<!-- hz:daily-photo:start -->').replace('TEMP', '<!-- hz:daily-photo:end -->');
  assert.match(validateDailyTemplate(reversed).join('\n'), /daily-photo/);
});
