const test = require('node:test');
const assert = require('node:assert/strict');

const {
  dateKey,
  buildHeatmap,
  formatTickTickTask,
  cleanTaskDisplayTitle,
  extractJournalCover,
  journalStreak,
  upsertMustDoSection,
  dailyPath,
  isTodayTask,
  summarizeMarkdown,
} = require('../src/core');

test('cleanTaskDisplayTitle hides TickTickSync metadata but keeps user text', () => {
  assert.equal(
    cleanTaskDisplayTitle('HZ工作台同步测试 #hzworkbench [link](https://ticktick.com/webapp/#p/inbox/tasks/id) #ticktick %%[ticktick_id:: id]%% 📅 2026-08-12 ⏫'),
    'HZ工作台同步测试',
  );
});

test('dateKey formats local dates as YYYY-MM-DD', () => {
  assert.equal(dateKey(new Date(2026, 7, 8)), '2026-08-08');
});

test('buildHeatmap returns 13 weeks by 7 days with bounded intensity', () => {
  const counts = new Map([
    ['2026-08-08', 4],
    ['2026-08-07', 1],
  ]);
  const cells = buildHeatmap(counts, new Date(2026, 7, 8), 13);
  assert.equal(cells.length, 91);
  assert.ok(cells.every((cell) => cell.level >= 0 && cell.level <= 4));
  assert.equal(cells.at(-1).date, '2026-08-08');
  assert.equal(cells.at(-1).level, 4);
});

test('formatTickTickTask creates a due-today task TickTickSync can detect', () => {
  assert.equal(
    formatTickTickTask('确认施工节点', '2026-08-08'),
    '- [ ] 确认施工节点 📅 2026-08-08 #ticktick #hzworkbench',
  );
});

test('formatTickTickTask removes checkbox syntax and duplicate sync tags', () => {
  assert.equal(
    formatTickTickTask('- [ ] 整理工作台 #ticktick #hzworkbench #hzworkbench', '2026-08-08'),
    '- [ ] 整理工作台 📅 2026-08-08 #ticktick #hzworkbench',
  );
});

test('extractJournalCover prefers frontmatter cover over body image', () => {
  const markdown = '正文 ![[06 附件/body.jpg]]';
  assert.equal(extractJournalCover({ cover: '06 附件/front.jpg' }, markdown), '06 附件/front.jpg');
});

test('extractJournalCover falls back to the first wiki or markdown image', () => {
  assert.equal(extractJournalCover({}, '文字 ![[06 附件/first.png]] 后文'), '06 附件/first.png');
  assert.equal(extractJournalCover({}, '文字 ![](https://example.com/cover.jpg)'), 'https://example.com/cover.jpg');
});

test('journalStreak counts consecutive unique dates ending on the latest journal', () => {
  assert.equal(journalStreak(['2026-08-08', '2026-08-07', '2026-08-07', '2026-08-06']), 3);
  assert.equal(journalStreak(['2026-08-08', '2026-08-06']), 1);
});

test('upsertMustDoSection inserts a task under 今日必完成 and preserves other sections', () => {
  const source = '# 2026-08-08\n\n## 今日记录\n正文\n';
  const result = upsertMustDoSection(source, '- [ ] 确认施工节点 📅 2026-08-08 #ticktick');
  assert.match(result, /## 今日必完成\n- \[ \] 确认施工节点/);
  assert.match(result, /## 今日记录\n正文/);
});

test('upsertMustDoSection rejects a fourth incomplete must-do task', () => {
  const source = '## 今日必完成\n- [ ] A\n- [ ] B\n- [ ] C\n\n## 记录\n';
  assert.throws(
    () => upsertMustDoSection(source, '- [ ] D'),
    /今日必完成最多只能保留 3 项/,
  );
});

test('dailyPath follows the vault year/month journal convention', () => {
  assert.equal(
    dailyPath('01 日记', new Date(2026, 7, 8)),
    '01 日记/2026年/8月/2026年-08-08-星期六.md',
  );
});

test('isTodayTask excludes unrelated undated tasks but keeps today, overdue, daily and priority tasks', () => {
  const today = '2026-08-08';
  assert.equal(isTodayTask({ due: '', filePath: '02 项目/A.md', line: '- [ ] 普通任务' }, today, '01 日记/today.md'), false);
  assert.equal(isTodayTask({ due: today, filePath: '02 项目/A.md', line: '- [ ] 今天' }, today, '01 日记/today.md'), true);
  assert.equal(isTodayTask({ due: '2026-08-07', filePath: '02 项目/A.md', line: '- [ ] 逾期' }, today, '01 日记/today.md'), true);
  assert.equal(isTodayTask({ due: '', filePath: '01 日记/today.md', line: '- [ ] 日记任务' }, today, '01 日记/today.md'), true);
  assert.equal(isTodayTask({ due: '', filePath: '02 项目/A.md', line: '- [ ] 重点 ⏫' }, today, '01 日记/today.md'), true);
});

test('summarizeMarkdown removes frontmatter, navigation HTML, callouts and code blocks', () => {
  const source = '---\ndate: 2026-08-08\n---\n<span data-nav="x"></span>\n> [!note] 导航\n> 上一篇：[[昨天]]\n```dataview\nTABLE x\n```\n今天完成了工作台设计。';
  assert.equal(summarizeMarkdown(source, 80), '今天完成了工作台设计。');
});
