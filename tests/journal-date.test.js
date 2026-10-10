const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveJournalDate } = require('../src/journal-date');

function makeFile(basename, ctime, path = `01 日记/${basename}.md`) {
  return { basename, path, stat: { ctime } };
}

test('Chinese basename wins over imported ctime', () => {
  const file = {
    basename: '2024年-12-01-星期日',
    path: '01 日记/2024年/12月/2024年-12-01-星期日.md',
    stat: { ctime: new Date(2026, 6, 22).getTime() },
  };
  assert.equal(resolveJournalDate(file, {}), '2024-12-01');
});

test('frontmatter, basename, folder/day, then ctime define priority', () => {
  assert.equal(resolveJournalDate(makeFile('2023-02-03', 0), { date: '2025-04-05' }), '2025-04-05');
  assert.equal(resolveJournalDate(makeFile('15日', 0, '01 日记/2024年/12月/15日.md'), {}), '2024-12-15');
  assert.equal(resolveJournalDate(makeFile('普通笔记', Date.UTC(2026, 7, 11)), {}), '2026-08-11');
});

test('invalid calendar dates never pass through', () => {
  assert.notEqual(resolveJournalDate(makeFile('2024年-02-31', 0), {}), '2024-02-31');
});
