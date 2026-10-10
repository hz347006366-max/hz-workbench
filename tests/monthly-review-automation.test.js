const test = require('node:test');
const assert = require('node:assert/strict');
const {
  monthlyReviewPaths,
  isCurrentMonthDailyFile,
  MonthlyReviewEnsurer,
} = require('../src/monthly-review-automation');
const { renderMonthlyReviewTemplate } = require('../src/monthly-review-template');

const now = new Date(2026, 7, 21, 9, 0, 0);

function dailyFile(day = '21', weekday = '五') {
  const basename = `2026年-08-${day}-星期${weekday}`;
  return { path: `01 日记/2026年/8月/${basename}.md`, basename, extension: 'md' };
}

function fakeVault(initial = []) {
  const files = [...initial];
  const creates = [];
  return {
    files,
    creates,
    getMarkdownFiles: () => files,
    getAbstractFileByPath: (path) => files.find((file) => file.path === path) || null,
    async create(path, content) {
      const basename = path.split('/').pop().replace(/\.md$/i, '');
      const file = { path, basename, extension: 'md', content };
      creates.push(file);
      files.push(file);
      return file;
    },
  };
}

function ensurer(vault, overrides = {}) {
  const created = [];
  const errors = [];
  return {
    created,
    errors,
    owner: new MonthlyReviewEnsurer({
      vault,
      dailyFolder: () => '01 日记',
      enabled: () => true,
      render: renderMonthlyReviewTemplate,
      onCreated: (month) => created.push(month),
      onError: (error) => errors.push(error),
      isActive: () => true,
      ...overrides,
    }),
  };
}

test('builds sorted current-month paths and accepts only an exact daily filename', () => {
  assert.deepEqual(monthlyReviewPaths('01 日记', now), {
    month: '2026-08',
    folder: '01 日记/2026年/8月',
    preferred: '01 日记/2026年/8月/2026年-08-00-月复盘.md',
    legacy: '01 日记/2026年/8月/2026年-08月复盘.md',
  });
  assert.equal(isCurrentMonthDailyFile(dailyFile(), '01 日记', now), true);
  assert.equal(isCurrentMonthDailyFile({ path: '01 日记/2026年/8月/项目.md', basename: '项目', extension: 'md' }, '01 日记', now), false);
  assert.equal(isCurrentMonthDailyFile({ path: '01 日记/2026年/7月/2026年-07-21-星期二.md', basename: '2026年-07-21-星期二', extension: 'md' }, '01 日记', now), false);
});

test('startup and create event share one idempotent creation', async () => {
  const daily = dailyFile();
  const vault = fakeVault([daily]);
  const state = ensurer(vault);
  await Promise.all([state.owner.ensure(now), state.owner.handleCreate(daily, now)]);
  assert.equal(vault.creates.length, 1);
  assert.equal(vault.creates[0].path, monthlyReviewPaths('01 日记', now).preferred);
  assert.match(vault.creates[0].content, /```hz-month-tasks/);
  assert.deepEqual(state.created, ['2026-08']);
});

test('does not create without a current daily or when either monthly name exists', async () => {
  const empty = fakeVault();
  await ensurer(empty).owner.ensure(now);
  assert.equal(empty.creates.length, 0);

  for (const key of ['preferred', 'legacy']) {
    const paths = monthlyReviewPaths('01 日记', now);
    const path = paths[key];
    const monthly = { path, basename: path.split('/').pop().replace(/\.md$/i, ''), extension: 'md' };
    const vault = fakeVault([dailyFile(), monthly]);
    await ensurer(vault).owner.ensure(now);
    assert.equal(vault.creates.length, 0);
  }
});

test('disabled and destroyed owners stay inert, while failure releases the lock for retry', async () => {
  const vault = fakeVault([dailyFile()]);
  let fail = true;
  const baseCreate = vault.create.bind(vault);
  vault.create = async (...args) => {
    if (fail) { fail = false; throw new Error('disk locked'); }
    return baseCreate(...args);
  };
  const state = ensurer(vault);
  assert.equal(await state.owner.ensure(now), false);
  assert.equal(state.errors.length, 1);
  assert.equal(await state.owner.ensure(now), true);
  state.owner.destroy();
  assert.equal(await state.owner.handleCreate(dailyFile('22', '六'), now), false);

  const disabled = fakeVault([dailyFile()]);
  await ensurer(disabled, { enabled: () => false }).owner.ensure(now);
  assert.equal(disabled.creates.length, 0);
});
