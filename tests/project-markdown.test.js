const assert = require('node:assert/strict');
const test = require('node:test');

const {
  parseChecklistSection,
  parseStageDetails,
  setChecklistItemChecked,
  updateStageFrontmatterAfterChecklist,
  parseCashlogLine,
  summarizeProjectCashlog,
  extractLinkedJournalParagraphs,
} = require('../src/project-markdown');
const { renderStageNote } = require('../src/project-template');

const CHECKLIST_SOURCE = [
  '# 阶段',
  '',
  '## 细项清单',
  '',
  '- [ ] 厨房',
  '- [x] 卫生间',
  '',
  '### 说明',
  '- [ ] 仍在清单内',
  '',
  '## 材料 / 设备预定',
  '',
  '- [ ] 热水器',
  '',
  '## 细项清单',
  '- [ ] 后续重复标题不可计入',
].join('\n');

test('parses only checkboxes in the first exact level-two checklist section', () => {
  const section = parseChecklistSection(CHECKLIST_SOURCE);

  assert.equal(section.found, true);
  assert.deepEqual(section.items, [
    { index: 0, text: '厨房', checked: false, lineNumber: 5 },
    { index: 1, text: '卫生间', checked: true, lineNumber: 6 },
    { index: 2, text: '仍在清单内', checked: false, lineNumber: 9 },
  ]);
  assert.ok(section.start < section.end);
});

test('reports a missing checklist section without throwing', () => {
  assert.deepEqual(parseChecklistSection('# 阶段\n\n### 细项清单\n- [ ] 厨房'), {
    found: false,
    start: -1,
    end: -1,
    items: [],
  });
});

test('parses every fixed stage detail section from the real stage template', () => {
  const note = renderStageNote({ name: '项目甲', projectId: 'p1' }, { order: 1, name: '准备', checklist: ['清点'], materialReminders: ['钢材'] })
    .replace('## 等待原因\n\n', '## 等待原因\n\n- 等审批\n')
    .replace('## 验收要点\n\n', '## 验收要点\n\n- 尺寸合格\n');
  assert.deepEqual(parseStageDetails(note), { materials: ['钢材'], waitingReasons: ['等审批'], acceptanceCriteria: ['尺寸合格'] });
});

test('keeps an empty checklist section valid without borrowing later checkboxes', () => {
  const section = parseChecklistSection('## 细项清单\n\n## 材料 / 设备预定\n- [ ] 热水器\n');

  assert.equal(section.found, true);
  assert.deepEqual(section.items, []);
});

test('changes only the requested checklist checkbox and leaves later sections intact', () => {
  const changed = setChecklistItemChecked(CHECKLIST_SOURCE, { index: 0, checked: true });

  assert.match(changed, /- \[x\] 厨房/);
  assert.match(changed, /## 材料 \/ 设备预定\n\n- \[ \] 热水器/);
  assert.match(changed, /## 细项清单\n- \[ \] 后续重复标题不可计入/);
  assert.equal(setChecklistItemChecked(changed, { index: 1, checked: false }).includes('- [ ] 卫生间'), true);
});

test('rejects invalid checklist mutations with clear Chinese errors', () => {
  assert.throws(
    () => setChecklistItemChecked('# 阶段', { index: 0, checked: true }),
    /未找到.*细项清单/,
  );
  assert.throws(
    () => setChecklistItemChecked(CHECKLIST_SOURCE, { index: 3, checked: true }),
    /索引.*越界/,
  );
  assert.throws(
    () => setChecklistItemChecked(CHECKLIST_SOURCE, { index: 0, checked: 'true' }),
    /checked.*布尔/,
  );
});

test('updates only stage status and actual end in existing frontmatter', () => {
  const source = '---\nproject_id: p-1\nstatus: 进行中\nactual_end: 2026-07-01\nowner: 瀚中\n---\n# 阶段\n';

  assert.equal(updateStageFrontmatterAfterChecklist(source, { status: '已完成', actualEnd: '' }),
    '---\nproject_id: p-1\nstatus: 已完成\nactual_end: \nowner: 瀚中\n---\n# 阶段\n');
});

test('inserts status fields into missing frontmatter without changing the body', () => {
  const source = '# 阶段\n\n正文\n';

  assert.equal(updateStageFrontmatterAfterChecklist(source, { status: '进行中', actualEnd: '2026-09-02' }),
    '---\nstatus: 进行中\nactual_end: 2026-09-02\n---\n# 阶段\n\n正文\n');
});

test('updates an empty frontmatter block instead of adding a second block', () => {
  const source = '---\n---\n# 阶段\n';

  assert.equal(updateStageFrontmatterAfterChecklist(source, { status: '进行中', actualEnd: '' }),
    '---\nstatus: 进行中\nactual_end: \n---\n# 阶段\n');
});

test('uses CRLF when inserting frontmatter into CRLF markdown', () => {
  const source = '# 阶段\r\n\r\n正文\r\n';

  assert.equal(updateStageFrontmatterAfterChecklist(source, { status: '进行中', actualEnd: '2026-09-02' }),
    '---\r\nstatus: 进行中\r\nactual_end: 2026-09-02\r\n---\r\n# 阶段\r\n\r\n正文\r\n');
});

test('parses both cashlog formats with positive normalized amounts', () => {
  assert.deepEqual(parseCashlogLine(
    '- #支出/项目/材料 [[省地勘局宿舍]] 灯具定金 💴 -860 ➕2026-07-14',
    '省地勘局宿舍',
  ), {
    valid: true,
    type: 'expense',
    amount: 860,
    date: '2026-07-14',
    time: '',
    categoryPath: '项目/材料',
    item: '灯具定金',
    project: '省地勘局宿舍',
    raw: '- #支出/项目/材料 [[省地勘局宿舍]] 灯具定金 💴 -860 ➕2026-07-14',
  });
  assert.deepEqual(parseCashlogLine(
    '- 21:55｜支出｜项目｜买酒｜¥14.00｜[[省地勘局宿舍|宿舍]]',
    '省地勘局宿舍',
  ), {
    valid: true,
    type: 'expense',
    amount: 14,
    date: '',
    time: '21:55',
    categoryPath: '项目',
    item: '买酒',
    project: '省地勘局宿舍',
    raw: '- 21:55｜支出｜项目｜买酒｜¥14.00｜[[省地勘局宿舍|宿舍]]',
  });
});

test('distinguishes unrelated and invalid linked cashlog lines', () => {
  assert.equal(parseCashlogLine('- #支出/项目 [[别的项目]] 💴-10', '省地勘局宿舍'), null);
  assert.equal(parseCashlogLine('- #支出/项目 [[省地勘局宿舍二期]] 💴-10', '省地勘局宿舍'), null);
  assert.equal(parseCashlogLine(
    '- #支出/项目 [[别的项目]] 备注 [[省地勘局宿舍]] 💴-10 ➕2026-07-14',
    '省地勘局宿舍',
  ), null);
  assert.deepEqual(parseCashlogLine('- #支出/项目 [[省地勘局宿舍]] 缺少金额', '省地勘局宿舍'), {
    valid: false,
    raw: '- #支出/项目 [[省地勘局宿舍]] 缺少金额',
    reason: '无法识别账目格式',
  });
});

test('counts linked cashlog rows with impossible dates or malformed thousands separators as invalid', () => {
  const target = '省地勘局宿舍';
  const badDate = '- #支出/项目 [[省地勘局宿舍]] 灯具 💴-860 ➕2026-99-99';
  const badAmount = '- #支出/项目 [[省地勘局宿舍]] 灯具 💴-1,2,3 ➕2026-07-14';

  assert.deepEqual(parseCashlogLine(badDate, target), {
    valid: false,
    raw: badDate,
    reason: '无法识别账目格式',
  });
  assert.deepEqual(parseCashlogLine(badAmount, target), {
    valid: false,
    raw: badAmount,
    reason: '无法识别账目格式',
  });
  assert.equal(summarizeProjectCashlog([badDate, badAmount], target).invalidCount, 2);
});

test('summarizes valid cashlog lines while retaining an invalid count', () => {
  const summary = summarizeProjectCashlog([
    '- #收入/项目/预付款 [[省地勘局宿舍]] 首款 💴 +5000 ➕2026-07-01',
    '- #支出/项目/材料 [[省地勘局宿舍]] 灯具定金 💴 -860 ➕2026-07-14',
    '- 21:55｜支出｜项目｜买酒｜¥14.00｜[[省地勘局宿舍]]',
    '- #支出/项目 [[省地勘局宿舍]] 缺少金额',
    '- #支出/项目 [[别的项目]] 忽略 💴-10',
  ], '省地勘局宿舍');

  assert.equal(summary.income, 5000);
  assert.equal(summary.expense, 874);
  assert.equal(summary.balance, 4126);
  assert.equal(summary.invalidCount, 1);
  assert.equal(summary.entries.length, 3);
  assert.deepEqual(summary.categories.map(({ name, type, total }) => ({ name, type, total })), [
    { name: '项目/预付款', type: 'income', total: 5000 },
    { name: '项目/材料', type: 'expense', total: 860 },
    { name: '项目', type: 'expense', total: 14 },
  ]);
});

test('extracts only linked journal paragraphs after frontmatter in source order', () => {
  const markdown = [
    '---',
    'project: [[省地勘局宿舍]]',
    '---',
    '',
    '这是无关正文。',
    '',
    '水电验收完成，[[省地勘局宿舍|宿舍]] 现场确认。',
    '',
    '- [[省地勘局宿舍]] 约了灯具商',
    '',
    '> [[省地勘局宿舍]] 的报价需要复核',
    '> 明天联系供应商',
    '',
    '另一个项目 [[别的项目]]。',
  ].join('\n');

  assert.deepEqual(extractLinkedJournalParagraphs(markdown, '省地勘局宿舍', {
    date: '2026-09-02',
    filePath: '01 日记/2026-09-02.md',
  }), [
    {
      date: '2026-09-02',
      filePath: '01 日记/2026-09-02.md',
      text: '水电验收完成，[[省地勘局宿舍|宿舍]] 现场确认。',
    },
    {
      date: '2026-09-02',
      filePath: '01 日记/2026-09-02.md',
      text: '- [[省地勘局宿舍]] 约了灯具商',
    },
    {
      date: '2026-09-02',
      filePath: '01 日记/2026-09-02.md',
      text: '> [[省地勘局宿舍]] 的报价需要复核\n> 明天联系供应商',
    },
  ]);
});
