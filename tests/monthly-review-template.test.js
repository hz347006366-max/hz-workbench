const test = require('node:test');
const assert = require('node:assert/strict');
const {
  renderMonthlyReviewTemplate,
  renderMonthlyReviewTemplaterArtifact,
} = require('../src/monthly-review-template');

const expectedTemplaterArtifact = `<%*
const match = tp.file.title.match(/^(\\d{4})年-(\\d{2})(?:-00-)?月复盘$/);
if (!match) throw new Error('月复盘文件名必须使用 YYYY年-MM-00-月复盘（兼容旧名称 YYYY年-MM月复盘）');
const [, year, month] = match;
tR += \`---\\ntype: 月复盘\\nmonth: \${year}-\${month}\\ntags:\\n  - 月复盘\\n---\\n\\n# \${year}年\${month}月复盘\`;
%>

## 本月任务

\`\`\`hz-month-tasks
\`\`\`

## 本月收支

\`\`\`hz-month-finance
\`\`\`

## 本月总结

### 本月完成了什么

### 最重要的收获

### 遇到的问题

### 下月最重要的三件事
`;

test('renders the confirmed monthly review contract', () => {
  const output = renderMonthlyReviewTemplate('2026年-08月复盘');
  assert.equal(output, renderMonthlyReviewTemplate('2026年-08-00-月复盘'));
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

test('renders the exact filename-derived Templater artifact', () => {
  const output = renderMonthlyReviewTemplaterArtifact();

  assert.equal(output, expectedTemplaterArtifact);
  assert.equal((output.match(/```hz-month-tasks/g) || []).length, 1);
  assert.equal((output.match(/```hz-month-finance/g) || []).length, 1);
  for (const heading of ['本月完成了什么', '最重要的收获', '遇到的问题', '下月最重要的三件事']) {
    assert.equal((output.match(new RegExp(`### ${heading}`, 'g')) || []).length, 1);
  }
  assert.doesNotMatch(output, /new Date\s*\(/);
  assert.doesNotMatch(output, /- \[[ x]\]/);
});
