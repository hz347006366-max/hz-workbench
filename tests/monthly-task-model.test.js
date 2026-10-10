const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveMonthContext } = require('../src/month-context');
const { buildMonthlyTaskView } = require('../src/monthly-task-model');

const august = resolveMonthContext({
  frontmatter: { month: '2026-08' },
  basename: '2026年-08月复盘',
});

test('Chinese title ties use an explicit locale instead of the host default', () => {
  const original = String.prototype.localeCompare;
  String.prototype.localeCompare = function localeCompare(other, locales, options) {
    if (!locales && ['甲', '乙'].includes(String(this)) && ['甲', '乙'].includes(String(other))) {
      return String(this) === '甲' ? 1 : -1;
    }
    return original.call(this, other, locales, options);
  };
  try {
    const view = buildMonthlyTaskView([
      { id: 'b', title: '乙', scheduled: '2026-08-01', startMinutes: 540, allDay: false },
      { id: 'a', title: '甲', scheduled: '2026-08-01', startMinutes: 540, allDay: false },
    ], august);
    assert.deepEqual(view.rows.map((item) => item.title), ['甲', '乙']);
  } finally {
    String.prototype.localeCompare = original;
  }
});

test('buildMonthlyTaskView includes only scheduled or due tasks in the target month and groups them by date', () => {
  const view = buildMonthlyTaskView([
    { id: 'done', title: '会议', scheduled: '2026-08-19', due: '2026-08-19', created: '2026-07-01', startMinutes: 540, endMinutes: 600, allDay: false, completed: true },
    { id: 'open', title: '复盘', scheduled: '2026-08-20', created: '2026-07-01', startMinutes: null, endMinutes: null, allDay: true, completed: false },
    { id: 'due', title: '整理', scheduled: '', due: '2026-08-21', created: '2026-07-01', startMinutes: null, endMinutes: null, allDay: true, completed: false },
    { id: 'created-only', title: '不应展示', scheduled: '', due: '', created: '2026-08-21', completed: false },
    { id: 'outside', title: '下月', scheduled: '2026-09-01', created: '2026-08-01', completed: false },
    { id: 'none', title: '无日期', scheduled: '', created: '', completed: false },
  ], august);

  assert.deepEqual({ total: view.total, completed: view.completed, incomplete: view.incomplete, completionRate: view.completionRate, unassigned: view.unassigned }, {
    total: 3, completed: 1, incomplete: 2, completionRate: 33, unassigned: 2,
  });
  assert.deepEqual(view.rows.map((row) => row.text), [
    '已完成｜2026年-08-19-星期三 9:00–10:00 会议',
    '未完成｜2026年-08-20-星期四 全天 复盘',
    '未完成｜2026年-08-21-星期五 全天 整理',
  ]);
  assert.deepEqual(view.groups.map((group) => ({ date: group.date, progress: group.progress, ids: group.rows.map((row) => row.id) })), [
    { date: '2026-08-19', progress: '1/1', ids: ['done'] },
    { date: '2026-08-20', progress: '0/1', ids: ['open'] },
    { date: '2026-08-21', progress: '0/1', ids: ['due'] },
  ]);
});

test('buildMonthlyTaskView orders timed tasks before all-day tasks and titles on ties', () => {
  const view = buildMonthlyTaskView([
    { id: 'late', title: '晚会', scheduled: '2026-08-22', due: '2026-08-22', startMinutes: 780, endMinutes: 840, allDay: false, completed: false },
    { id: 'all-day', title: '全天', scheduled: '2026-08-22', startMinutes: null, endMinutes: null, allDay: true, completed: false },
    { id: 'same-time-b', title: '乙', scheduled: '2026-08-22', startMinutes: 540, endMinutes: null, allDay: false, completed: false },
    { id: 'same-time-a', title: '甲', scheduled: '2026-08-22', startMinutes: 540, endMinutes: null, allDay: false, completed: false },
  ], august);

  assert.deepEqual(view.rows.map((row) => row.text), [
    '未完成｜2026年-08-22-星期六 9:00 甲',
    '未完成｜2026年-08-22-星期六 9:00 乙',
    '未完成｜2026年-08-22-星期六 13:00–14:00 晚会',
    '未完成｜2026年-08-22-星期六 全天 全天',
  ]);
});

test('buildMonthlyTaskView preserves input order for otherwise identical title ties', () => {
  const view = buildMonthlyTaskView([
    { id: 'z', title: '同名', scheduled: '2026-08-22', startMinutes: 540, endMinutes: null, allDay: false, completed: false },
    { id: 'a', title: '同名', scheduled: '2026-08-22', startMinutes: 540, endMinutes: null, allDay: false, completed: false },
  ], august);

  assert.deepEqual(view.rows.map((row) => row.id), ['z', 'a']);
});

test('buildMonthlyTaskView shows only the start time without a reliable same-day end date', () => {
  const view = buildMonthlyTaskView([
    { id: 'unknown-end', title: '待确认', scheduled: '2026-08-22', due: '', startMinutes: 540, endMinutes: 600, allDay: false, completed: false },
  ], august);

  assert.equal(view.rows[0].text, '未完成｜2026年-08-22-星期六 9:00 待确认');
});

test('buildMonthlyTaskView displays a start time only for a range crossing calendar dates', () => {
  const view = buildMonthlyTaskView([
    { id: 'overnight', title: '值班', scheduled: '2026-08-22', due: '2026-08-23', startMinutes: 1380, endMinutes: 60, allDay: false, completed: false },
  ], august);

  assert.equal(view.rows[0].text, '未完成｜2026年-08-22-星期六 23:00 值班');
});

test('buildMonthlyTaskView returns zero totals for an empty month without mutating input', () => {
  const tasks = [{ id: 'outside', title: '下月', scheduled: '2026-09-01', created: '', completed: false }];
  const snapshot = structuredClone(tasks);

  const view = buildMonthlyTaskView(tasks, august);

  assert.deepEqual(view, {
    total: 0, completed: 0, incomplete: 0, completionRate: 0, unassigned: 0, rows: [], groups: [],
  });
  assert.deepEqual(tasks, snapshot);
});
