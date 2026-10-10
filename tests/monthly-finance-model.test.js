const test = require('node:test');
const assert = require('node:assert/strict');

const { parseFinanceBlock, buildMonthlyFinanceView } = require('../src/monthly-finance-model');

const START = '<!-- hz:finance-entries:start -->';
const END = '<!-- hz:finance-entries:end -->';
const august = { month: '2026-08' };

function financeBlock(lines) {
  return [START, ...lines, END].join('\n');
}

test('parses one exact finance marker pair and ignores blank interior lines', () => {
  assert.deepEqual(parseFinanceBlock(`before\n${financeBlock(['', '- 12:30｜支出｜餐饮｜午餐｜¥35.00', ''])}\nafter`), {
    lines: ['- 12:30｜支出｜餐饮｜午餐｜¥35.00'],
    structuralError: false,
  });
});

test('flags duplicate, unordered, or missing finance markers as structural errors', () => {
  assert.equal(parseFinanceBlock(`${START}\n${END}\n${START}\n${END}`).structuralError, true);
  assert.equal(parseFinanceBlock(`${END}\n${START}`).structuralError, true);
  assert.equal(parseFinanceBlock(`${START}\n- 12:30｜支出｜餐饮｜午餐｜¥35.00`).structuralError, true);
});

test('builds monthly finance totals, expense categories, and chronological rows', () => {
  const notes = [
    {
      path: '01 日记/2026年/8月/2026年-08-19-星期三.md', date: '2026-08-19', type: '日记',
      content: financeBlock(['- 12:30｜支出｜餐饮｜午餐｜¥35.00', '- 18:00｜支出｜交通｜打车｜¥20.50']),
    },
    {
      path: '01 日记/2026年/8月/2026年-08-20-星期四.md', date: '2026-08-20', type: '日记',
      content: financeBlock(['- 09:10｜收入｜其他｜退款｜¥88.00', '- 无效记录']),
    },
  ];

  const result = buildMonthlyFinanceView(notes, august);

  assert.equal(result.incomeCents, 8800);
  assert.equal(result.expenseCents, 5550);
  assert.equal(result.netCents, 3250);
  assert.deepEqual(result.categories.map(({ category, cents }) => [category, cents]), [['餐饮', 3500], ['交通', 2050]]);
  assert.deepEqual(result.categories.map(({ percentage }) => percentage), [63, 37]);
  assert.equal(result.invalidCount, 1);
  assert.deepEqual(result.invalidSources, ['01 日记/2026年/8月/2026年-08-20-星期四.md']);
  assert.deepEqual(result.readErrors, []);
  assert.equal(result.rows[0].text, '2026年-08-19-星期三 12:30｜支出｜餐饮｜午餐｜¥35.00');
  assert.equal(result.rows[2].text, '2026年-08-20-星期四 09:10｜收入｜其他｜退款｜¥88.00');
  assert.deepEqual(result.detailGroups.map((group) => [group.date, group.rows.length]), [
    ['2026-08-19', 2], ['2026-08-20', 1],
  ]);
});

test('keeps the five largest expense categories and combines the rest as other', () => {
  const lines = [60, 50, 40, 30, 20, 10, 5].map((amount, index) =>
    `- 09:0${index}｜支出｜分类${index + 1}｜事项${index + 1}｜¥${amount}.00`);
  const view = buildMonthlyFinanceView([{
    path: 'many.md', date: '2026-08-19', type: '日记', content: financeBlock(lines),
  }], august);

  assert.deepEqual(view.categories.map((item) => [item.category, item.cents]), [
    ['分类1', 6000], ['分类2', 5000], ['分类3', 4000], ['分类4', 3000], ['分类5', 2000], ['其他', 1500],
  ]);
  assert.equal(view.categories[0].barPercentage, 100);
  assert.equal(view.categories.at(-1).barPercentage, 25);
});

test('rejects noncanonical finance rows without inferring foreign or malformed amounts', () => {
  const view = buildMonthlyFinanceView([{
    path: 'invalid.md', date: '2026-08-19', type: '日记',
    content: financeBlock([
      '- 08:00｜支出｜餐饮｜美元｜$35.00',
      '- 08:00｜支出｜餐饮｜零额｜¥0.00',
      '- 08:00｜支出｜餐饮｜负数｜¥-1.00',
      '- 08:00｜支出｜餐饮｜三位小数｜¥1.000',
      '- 24:00｜支出｜餐饮｜错误时钟｜¥1.00',
      '今天花了 ¥999.99',
    ]),
  }], august);

  assert.deepEqual({ incomeCents: view.incomeCents, expenseCents: view.expenseCents, invalidCount: view.invalidCount }, {
    incomeCents: 0, expenseCents: 0, invalidCount: 6,
  });
  assert.deepEqual(view.invalidSources, ['invalid.md']);
});

test('omits project suffixes from rows and groups only expenses by rounded percentage', () => {
  const view = buildMonthlyFinanceView([{
    path: 'projects.md', date: '2026-08-19', type: '日记',
    content: financeBlock([
      '- 09:00｜支出｜餐饮｜早餐｜¥10.00｜[[项目甲]]',
      '- 10:00｜支出｜交通｜地铁｜¥20.00｜[[项目乙]]',
      '- 11:00｜收入｜餐饮｜报销｜¥5.00｜[[项目甲]]',
    ]),
  }], august);

  assert.equal(view.rows[0].text, '2026年-08-19-星期三 09:00｜支出｜餐饮｜早餐｜¥10.00');
  assert.equal(view.rows.some((row) => row.text.includes('项目')), false);
  assert.deepEqual(view.categories.map(({ category, cents, percentage, text }) => [category, cents, percentage, text]), [
    ['交通', 2000, 67, '交通｜¥20.00｜67%'],
    ['餐饮', 1000, 33, '餐饮｜¥10.00｜33%'],
  ]);
});

test('deduplicates invalid and read-error sources while excluding non-diary and out-of-month notes', () => {
  const view = buildMonthlyFinanceView([
    { path: 'bad.md', date: '2026-08-19', type: '日记', content: financeBlock(['坏', '也坏']) },
    { path: 'broken.md', date: '2026-08-20', type: '日记', content: `${START}\n${START}\n${END}` },
    { path: 'not-diary.md', date: '2026-08-20', type: '笔记', content: financeBlock(['坏']) },
    { path: 'other-month.md', date: '2026-09-01', type: '日记', content: financeBlock(['坏']) },
  ], august);

  assert.equal(view.invalidCount, 2);
  assert.deepEqual(view.invalidSources, ['bad.md']);
  assert.deepEqual(view.readErrors, ['broken.md']);
});

test('orders ties by path and original line number, handles zero expense percentages, and preserves source input', () => {
  const notes = [
    { path: 'z.md', date: '2026-08-19', type: '日记', content: financeBlock(['- 09:00｜收入｜其他｜后｜¥2.00', '- 09:00｜收入｜其他｜更后｜¥3.00']) },
    { path: 'a.md', date: '2026-08-19', type: '日记', content: financeBlock(['- 09:00｜收入｜其他｜先｜¥1.00']) },
  ];
  const snapshot = structuredClone(notes);

  const view = buildMonthlyFinanceView(notes, august);

  assert.deepEqual(view.rows.map((row) => row.title), ['先', '后', '更后']);
  assert.deepEqual(notes, snapshot);
  assert.deepEqual(buildMonthlyFinanceView([{
    path: 'income.md', date: '2026-08-19', type: '日记', content: financeBlock(['- 09:00｜收入｜其他｜工资｜¥1.00']),
  }], august).categories, []);
});
