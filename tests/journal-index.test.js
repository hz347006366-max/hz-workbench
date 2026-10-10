const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildJournalIndex,
  latestSelection,
  selectYear,
  selectMonth,
} = require('../src/journal-index');

function journal(date, path) {
  return { date, file: { path } };
}

test('buildJournalIndex groups journals into descending available years and months', () => {
  const index = buildJournalIndex([
    journal('2025-12-20', 'daily/2025-12-20.md'),
    journal('2026-01-10', 'daily/2026-01-10.md'),
    journal('2026-03-01', 'daily/2026-03-01.md'),
    journal('not-a-date', 'daily/invalid.md'),
    journal('2026-13-01', 'daily/invalid-month.md'),
  ]);

  assert.deepEqual(index.years, ['2026', '2025']);
  assert.deepEqual(index.monthsByYear.get('2026'), ['03', '01']);
  assert.deepEqual(index.monthsByYear.get('2025'), ['12']);
  assert.equal(index.itemsByMonth.has('2026-13'), false);
});

test('buildJournalIndex sorts same-date journals by file path ascending', () => {
  const index = buildJournalIndex([
    journal('2026-03-05', 'daily/zeta.md'),
    journal('2026-03-05', 'daily/alpha.md'),
    journal('2026-03-04', 'daily/older.md'),
  ]);

  assert.deepEqual(
    index.itemsByMonth.get('2026-03').map((item) => item.file.path),
    ['daily/alpha.md', 'daily/zeta.md', 'daily/older.md'],
  );
});

test('buildJournalIndex keeps only the newest 30 journals in each month', () => {
  const journals = Array.from({ length: 31 }, (_, index) => {
    const day = String(index + 1).padStart(2, '0');
    return journal(`2026-03-${day}`, `daily/${day}.md`);
  });
  const index = buildJournalIndex(journals);
  const items = index.itemsByMonth.get('2026-03');

  assert.equal(items.length, 30);
  assert.equal(items[0].date, '2026-03-31');
  assert.equal(items.at(-1).date, '2026-03-02');
});

test('latestSelection returns the newest month that contains journals', () => {
  const index = buildJournalIndex([
    journal('2025-12-31', 'daily/old.md'),
    journal('2026-02-01', 'daily/new.md'),
  ]);

  assert.deepEqual(latestSelection(index), { year: '2026', month: '02' });
});

test('selectYear returns the newest valid month in the requested year', () => {
  const index = buildJournalIndex([
    journal('2026-01-01', 'daily/jan.md'),
    journal('2026-03-01', 'daily/mar.md'),
    journal('2025-12-01', 'daily/old.md'),
  ]);

  assert.deepEqual(selectYear(index, '2026'), { year: '2026', month: '03' });
});

test('selectMonth returns a valid requested month', () => {
  const index = buildJournalIndex([
    journal('2026-01-01', 'daily/jan.md'),
    journal('2026-03-01', 'daily/mar.md'),
  ]);

  assert.deepEqual(selectMonth(index, '2026', '01'), { year: '2026', month: '01' });
});

test('invalid journal selection falls back deterministically', () => {
  const index = buildJournalIndex([
    journal('2026-01-01', 'daily/jan.md'),
    journal('2026-03-01', 'daily/mar.md'),
    journal('2025-12-01', 'daily/old.md'),
  ]);

  assert.deepEqual(selectYear(index, '2024'), { year: '2026', month: '03' });
  assert.deepEqual(selectMonth(index, '2026', '02'), { year: '2026', month: '03' });
  assert.deepEqual(selectMonth(index, '2024', '12'), { year: '2026', month: '03' });
});
