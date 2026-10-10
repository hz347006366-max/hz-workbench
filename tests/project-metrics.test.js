const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateStageProgress,
  calculateProjectProgress,
  selectCurrentStage,
  reconcileStageCompletion,
  calculateScheduleVariance,
  calculateGanttRange,
  positionStageBar,
} = require('../src/project-metrics');

test('calculates stage progress from checked items and returns null without items', () => {
  assert.equal(calculateStageProgress([{ checked: true }, { checked: false }]), 50);
  assert.equal(calculateStageProgress([{ checked: true }, { checked: true }]), 100);
  assert.equal(calculateStageProgress([]), null);
  assert.equal(calculateStageProgress(null), null);
});

test('calculates project progress as an equal-weight average of valid stages', () => {
  assert.equal(calculateProjectProgress([
    { progress: 50, valid: true },
    { progress: 100, valid: true },
    { progress: 0, valid: false },
    { progress: Number.NaN, valid: true },
  ]), 75);
  assert.equal(calculateProjectProgress([{ progress: 20, valid: false }]), null);
});

test('selects the first in-progress stage, otherwise the earliest incomplete stage', () => {
  const stages = [
    { order: 3, status: '进行中', id: 'third' },
    { order: 1, status: '未开始', id: 'first' },
    { order: 2, status: '进行中', id: 'second' },
  ];
  assert.equal(selectCurrentStage(stages).id, 'second');
  assert.equal(selectCurrentStage([
    { order: 2, status: '未开始', id: 'second' },
    { order: 1, status: '等待', id: 'first' },
    { order: 3, status: '已完成', id: 'done' },
  ]).id, 'first');
  assert.equal(selectCurrentStage([{ order: 1, status: '已完成' }]), null);
  assert.equal(selectCurrentStage([]), null);
});

test('reconciles completion by writing and clearing actual end dates', () => {
  assert.deepEqual(
    reconcileStageCompletion({ status: '进行中', actualEnd: '', progress: 100 }, '2026-09-02'),
    { status: '已完成', actualEnd: '2026-09-02' },
  );
  assert.deepEqual(
    reconcileStageCompletion({ status: '进行中', actualEnd: '2026-09-01', progress: 100 }, '2026-09-02'),
    { status: '已完成', actualEnd: '2026-09-01' },
  );
  assert.deepEqual(
    reconcileStageCompletion({ status: '进行中', actualEnd: '2026-99-99', progress: 100 }, '2026-09-02'),
    { status: '已完成', actualEnd: '2026-09-02' },
  );
  assert.throws(
    () => reconcileStageCompletion({ status: '进行中', actualEnd: '2026-99-99', progress: 100 }, '2026-99-99'),
    /today must be a valid ISO date/,
  );
  assert.deepEqual(
    reconcileStageCompletion({ status: '已完成', actualEnd: '2026-09-01', progress: 50 }, '2026-09-02'),
    { status: '进行中', actualEnd: '' },
  );
  assert.deepEqual(
    reconcileStageCompletion({ status: '等待', actualEnd: '', progress: 50 }, '2026-09-02'),
    { status: '等待', actualEnd: '' },
  );
});

test('reports draft and missing schedule states without calculating variance', () => {
  assert.deepEqual(
    calculateScheduleVariance({ schedule_status: '草案', planned_end: '2026-09-01' }, '2026-09-10'),
    { kind: 'draft', days: 0, label: '草案排期' },
  );
  assert.deepEqual(
    calculateScheduleVariance({ status: '进行中', planned_end: '' }, '2026-09-10'),
    { kind: 'missing', days: 0, label: '排期待完善' },
  );
  assert.deepEqual(
    calculateScheduleVariance({ status: '进行中', planned_end: '2026-09-31' }, '2026-09-10'),
    { kind: 'missing', days: 0, label: '排期待完善' },
  );
});

test('reports early, on-time and late completed or active schedules in calendar days', () => {
  assert.deepEqual(
    calculateScheduleVariance({ status: '已完成', planned_end: '2026-09-10', actual_end: '2026-09-08' }, '2026-09-20'),
    { kind: 'early', days: 2, label: '提前' },
  );
  assert.deepEqual(
    calculateScheduleVariance({ status: '已完成', planned_end: '2026-09-10', actual_end: '2026-09-10' }, '2026-09-20'),
    { kind: 'on-time', days: 0, label: '按时' },
  );
  assert.deepEqual(
    calculateScheduleVariance({ status: '已完成', planned_end: '2026-09-10', actual_end: '2026-09-13' }, '2026-09-20'),
    { kind: 'late', days: 3, label: '延期' },
  );
  assert.deepEqual(
    calculateScheduleVariance({ status: '进行中', planned_end: '2026-09-10' }, '2026-09-13'),
    { kind: 'late', days: 3, label: '延期' },
  );
  assert.deepEqual(
    calculateScheduleVariance({ status: '进行中', planned_end: '2026-09-10' }, '2026-09-10'),
    { kind: 'on-time', days: 0, label: '按时' },
  );
});

test('calculates month, three-month and all-project gantt ranges', () => {
  assert.deepEqual(calculateGanttRange('month', [], '2026-09-15'), {
    start: '2026-09-01', end: '2026-09-30',
  });
  assert.deepEqual(calculateGanttRange('quarter', [], '2026-01-15'), {
    start: '2025-12-01', end: '2026-02-28',
  });
  assert.deepEqual(calculateGanttRange('all', [
    { planned_start: '2026-09-10', planned_end: '2026-09-20' },
    { planned_start: '2026-08-01', planned_end: '2026-10-03' },
    { planned_start: '2026-99-01', planned_end: '2026-12-01' },
  ], '2026-09-15'), {
    start: '2026-08-01', end: '2026-10-03',
  });
  assert.equal(calculateGanttRange('all', [{ planned_start: '', planned_end: '' }], '2026-09-15'), null);
});

test('positions gantt bars, clipping them to the visible range and rejecting invalid dates', () => {
  const range = { start: '2026-09-01', end: '2026-09-30' };
  const normal = positionStageBar({ planned_start: '2026-09-08', planned_end: '2026-09-15' }, range);
  assert.equal(normal.valid, true);
  assert.ok(Math.abs(normal.left - 24.13793103448276) < 1e-9);
  assert.ok(Math.abs(normal.width - 24.13793103448276) < 1e-9);
  const clipped = positionStageBar({ planned_start: '2026-08-20', planned_end: '2026-09-10' }, range);
  assert.equal(clipped.valid, true);
  assert.equal(clipped.left, 0);
  assert.ok(Math.abs(clipped.width - 31.03448275862069) < 1e-9);
  assert.deepEqual(positionStageBar({ planned_start: '', planned_end: '2026-09-10' }, range), {
    valid: false, left: 0, width: 0,
  });
  assert.deepEqual(positionStageBar({ planned_start: '2026-09-20', planned_end: '2026-09-10' }, range), {
    valid: false, left: 0, width: 0,
  });
  assert.deepEqual(positionStageBar(
    { planned_start: '2026-09-10', planned_end: '2026-09-10' },
    { start: '2026-09-10', end: '2026-09-10' },
  ), { valid: true, left: 0, width: 100 });
});

test('positions actual gantt bars and carries draft state', () => {
  const range = { start: '2026-09-01', end: '2026-09-30' };
  const draft = positionStageBar({ planned_start: '2026-09-05', planned_end: '2026-09-10', schedule_status: '草案' }, range);
  assert.equal(draft.draft, true);
  assert.equal(draft.actualLeft, null);
  const actual = positionStageBar({ planned_start: '2026-09-05', planned_end: '2026-09-10', actual_start: '2026-09-07', actual_end: '2026-09-12' }, range);
  assert.ok(actual.actualLeft > actual.left);
  assert.ok(actual.actualWidth > 0);
});
