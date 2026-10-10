const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseMonthValue, parseMonthlyFilename, monthlyReviewBasenames, resolveMonthContext, formatChineseDate,
} = require('../src/month-context');

test('resolves frontmatter month and natural local month boundaries', () => {
  assert.deepEqual(resolveMonthContext({
    frontmatter: { month: '2026-08' }, basename: '2026年-08月复盘',
  }), {
    ok: true, month: '2026-08', year: 2026, monthNumber: 8,
    startDate: '2026-08-01', endDate: '2026-08-31', error: '',
  });
});

test('uses the exact filename only when frontmatter is absent', () => {
  assert.equal(parseMonthlyFilename('2026年-08月复盘'), '2026-08');
  assert.equal(parseMonthlyFilename('2026年-08-00-月复盘'), '2026-08');
  assert.equal(parseMonthlyFilename('2026年-8月复盘'), '');
  assert.equal(parseMonthlyFilename('2026年-08-01-月复盘'), '');
  assert.equal(resolveMonthContext({ frontmatter: {}, basename: '2026年-08月复盘' }).month, '2026-08');
  assert.deepEqual(monthlyReviewBasenames('2026-08'), {
    preferred: '2026年-08-00-月复盘', legacy: '2026年-08月复盘',
  });
});

test('fails closed on conflict, invalid month, or missing identity', () => {
  assert.match(resolveMonthContext({ frontmatter: { month: '2026-07' }, basename: '2026年-08月复盘' }).error, /不一致/);
  assert.equal(parseMonthValue('2026-13'), '');
  assert.equal(resolveMonthContext({ frontmatter: {}, basename: '普通笔记' }).ok, false);
});

test('formats a Chinese date with weekday', () => {
  assert.equal(formatChineseDate('2026-08-19'), '2026年-08-19-星期三');
});
