const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  replaceManagedBlock,
  appendManagedLine,
  photoVaultPath,
  formatQuickNote,
  formatTimeEntry,
  parseTimeEntries,
  summarizeTimeEntries,
  splitIntervalByLocalDate,
  formatFinanceEntry,
  formatCents,
  parseFinanceEntries,
  summarizeFinanceEntries,
  normalizeList,
  extractMeditation,
  upsertMeditation,
  parseCaptureDate,
  combineCaptureDateTime,
  assertNotFuture,
} = require('../src/daily-capture-model');

test('capture dates parse as valid local calendar dates, including leap days', () => {
  const leap = parseCaptureDate('2024-02-29');
  assert.equal(leap.getFullYear(), 2024);
  assert.equal(leap.getMonth(), 1);
  assert.equal(leap.getDate(), 29);
  assert.equal(leap.getHours(), 0);
  assert.throws(() => parseCaptureDate('2023-02-29'), /日期无效/);
  assert.throws(() => parseCaptureDate('2024-02-30'), /日期无效/);
  assert.throws(() => parseCaptureDate('2024/02/29'), /日期无效/);
});

test('capture date/time combines with local DST-safe construction', () => {
  const date = parseCaptureDate('2026-03-08');
  const combined = combineCaptureDateTime(date, '01:30');
  assert.equal(combined.getFullYear(), 2026);
  assert.equal(combined.getMonth(), 2);
  assert.equal(combined.getDate(), 8);
  assert.equal(combined.getHours(), 1);
  assert.equal(combined.getMinutes(), 30);
  assert.equal(combineCaptureDateTime('2024-02-29', '23:45').getHours(), 23);
  assert.throws(() => combineCaptureDateTime(date, '24:00'), /时间无效/);
  assert.throws(() => combineCaptureDateTime(date, '12:60'), /时间无效/);
});

test('capture date/time rejects a clock value inside a local DST spring-forward gap', () => {
  const modelPath = path.resolve(__dirname, '../src/daily-capture-model.js');
  const script = `const { parseCaptureDate, combineCaptureDateTime } = require(${JSON.stringify(modelPath)});
const date = parseCaptureDate('2026-03-08');
try { combineCaptureDateTime(date, '02:30'); process.exitCode = 2; }
catch (error) { if (!/时间无效/.test(error.message)) process.exitCode = 3; }`;
  const result = spawnSync(process.execPath, ['-e', script], {
    env: { ...process.env, TZ: 'America/New_York' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('capture targets cannot be in the future relative to injected now', () => {
  const now = new Date(2026, 7, 18, 12, 0);
  const target = combineCaptureDateTime('2026-08-18', '11:59');
  assert.equal(assertNotFuture(target, now), target);
  assert.throws(() => assertNotFuture(new Date(2026, 7, 18, 12, 1), now), /未来/);
});

test('daily meditation appends once, replaces once, and preserves unlimited source text', () => {
  const oldDaily = '---\ntype: 日记\n---\n# 2026年-08-27-星期四\n';
  const longText = '今天把注意力放回真正重要的事情。'.repeat(40);
  const appended = upsertMeditation(oldDaily, longText);
  assert.equal((appended.match(/^## 每日冥想$/gm) || []).length, 1);
  assert.equal(extractMeditation(appended), longText);

  const replaced = upsertMeditation(appended, '**慢下来，再做决定。**');
  assert.equal((replaced.match(/hz:daily-meditation:start/g) || []).length, 1);
  assert.equal(extractMeditation(replaced), '慢下来，再做决定。');
});

test('daily meditation reads absent history as blank and rejects malformed writes', () => {
  assert.equal(extractMeditation('---\ntype: 日记\n---\n正文'), '');
  const malformed = '## 每日冥想\n<!-- hz:daily-meditation:start -->\n内容';
  assert.equal(extractMeditation(malformed), '');
  assert.throws(() => upsertMeditation(malformed, '新内容'), /模板结构不完整：daily-meditation/);
});

test('managed blocks replace only their exact interior and preserve CRLF', () => {
  const source = 'before\r\n<!-- hz:quick-notes:start -->\r\nold\r\n<!-- hz:quick-notes:end -->\r\nafter';
  assert.equal(
    replaceManagedBlock(source, 'quickNotes', ['- 09:00 新内容']),
    'before\r\n<!-- hz:quick-notes:start -->\r\n- 09:00 新内容\r\n<!-- hz:quick-notes:end -->\r\nafter',
  );
  assert.equal(
    appendManagedLine(source, 'quickNotes', '- 10:00 第二条'),
    'before\r\n<!-- hz:quick-notes:start -->\r\nold\r\n- 10:00 第二条\r\n<!-- hz:quick-notes:end -->\r\nafter',
  );
});

test('managed blocks reject missing duplicate and reversed boundaries', () => {
  assert.throws(() => replaceManagedBlock('plain', 'quickNotes', []), /模板结构不完整/);
  assert.throws(() => replaceManagedBlock('<!-- hz:quick-notes:start -->\n<!-- hz:quick-notes:start -->\n<!-- hz:quick-notes:end -->', 'quickNotes', []), /模板结构不完整/);
  assert.throws(() => replaceManagedBlock('<!-- hz:quick-notes:end -->\n<!-- hz:quick-notes:start -->', 'quickNotes', []), /模板结构不完整/);
});

test('quick notes and fixed photo paths are canonical and validated', () => {
  const at = new Date(2026, 7, 18, 9, 5);
  assert.equal(formatQuickNote('  一个想法  ', at), '- 09:05 一个想法');
  assert.equal(photoVaultPath('06 附件/日记照片/', '2026-08-18'), '06 附件/日记照片/2026/2026-08-18.jpg');
  assert.throws(() => formatQuickNote('   ', at), /内容不能为空/);
  assert.throws(() => photoVaultPath('../附件', '2026-08-18'), /照片目录无效/);
});

test('time entries format parse and summarize in first-seen category order', () => {
  const lines = [
    formatTimeEntry({ start: new Date(2026, 7, 18, 9), end: new Date(2026, 7, 18, 10, 30), category: '工作', title: '写方案', project: '项目 A' }),
    formatTimeEntry({ start: new Date(2026, 7, 18, 10, 30), end: new Date(2026, 7, 18, 11, 10), category: '沟通', title: '回复消息' }),
    '- 手写内容不参与统计',
  ];
  assert.equal(lines[0], '- 09:00–10:30｜工作｜写方案｜[[项目 A]]');
  const parsed = parseTimeEntries(lines);
  assert.equal(parsed.length, 2);
  assert.deepEqual(summarizeTimeEntries(parsed), [
    '- 总计：2小时10分',
    '- 工作：1小时30分',
    '- 沟通：40分',
  ]);
});

test('time entries reject invalid values and midnight intervals split by local date', () => {
  assert.throws(() => formatTimeEntry({ start: new Date(2026, 7, 18, 10), end: new Date(2026, 7, 18, 9), category: '工作', title: '倒序' }), /结束时间必须晚于开始时间/);
  assert.throws(() => formatTimeEntry({ start: new Date(2026, 7, 18, 9), end: new Date(2026, 7, 18, 10), category: '', title: '缺类别' }), /类别不能为空/);
  const segments = splitIntervalByLocalDate(new Date(2026, 7, 18, 23, 30), new Date(2026, 7, 19, 0, 30));
  assert.deepEqual(segments.map((item) => [item.date, item.start.getHours(), item.start.getMinutes(), item.end.getHours(), item.end.getMinutes()]), [
    ['2026-08-18', 23, 30, 0, 0],
    ['2026-08-19', 0, 0, 0, 30],
  ]);
});

test('finance entries use integer cents and summarize income expense and net', () => {
  const lines = [
    formatFinanceEntry({ at: new Date(2026, 7, 18, 12, 16), type: '支出', category: '餐饮', title: '午餐', amount: '32', currency: '¥' }),
    formatFinanceEntry({ at: new Date(2026, 7, 18, 16, 20), type: '收入', category: '设计费', title: '方案费用', amount: '2000.50', project: '项目 A', currency: '¥' }),
  ];
  assert.equal(lines[1], '- 16:20｜收入｜设计费｜方案费用｜¥2,000.50｜[[项目 A]]');
  const parsed = parseFinanceEntries(lines, '¥');
  assert.deepEqual(parsed.map((item) => item.cents), [3200, 200050]);
  assert.deepEqual(summarizeFinanceEntries(parsed, '¥'), [
    '- 收入：¥2,000.50',
    '- 支出：¥32.00',
    '- 净额：¥1,968.50',
  ]);
});

test('formats positive and negative cents for finance displays', () => {
  assert.equal(formatCents(3250), '¥32.50');
  assert.equal(formatCents(-2050), '-¥20.50');
});

test('finance validation rejects bad types amounts and unsafe project links', () => {
  const base = { at: new Date(2026, 7, 18, 12), category: '餐饮', title: '午餐', currency: '¥' };
  assert.throws(() => formatFinanceEntry({ ...base, type: '转账', amount: '1' }), /收支类型无效/);
  assert.throws(() => formatFinanceEntry({ ...base, type: '支出', amount: '-1' }), /金额必须大于 0/);
  assert.throws(() => formatFinanceEntry({ ...base, type: '支出', amount: '1.999' }), /金额格式无效/);
  assert.throws(() => formatFinanceEntry({ ...base, type: '支出', amount: '1', project: '坏]]链接' }), /关联项目无效/);
});

test('comma separated settings normalize trim deduplicate and accept Chinese commas', () => {
  assert.deepEqual(normalizeList(' 工作,学习，工作, 生活 '), ['工作', '学习', '生活']);
  assert.deepEqual(normalizeList(['餐饮', ' 餐饮 ', '交通']), ['餐饮', '交通']);
});
