const assert = require('node:assert/strict');
const test = require('node:test');

const {
  PROJECT_STATUSES,
  STAGE_STATUSES,
  normalizeProject,
  normalizeStage,
  normalizeProjectStatus,
  normalizeStageStatus,
  validateIsoDate,
  validateProjectDraft,
  validateStageDraft,
} = require('../src/project-schema');

test('exports the fixed project and stage statuses', () => {
  assert.deepEqual(PROJECT_STATUSES, ['筹备中', '进行中', '暂停', '已完成', '已归档']);
  assert.deepEqual(STAGE_STATUSES, ['未开始', '进行中', '等待', '已完成']);
});

test('normalizes legacy and fixed statuses to their supported values', () => {
  assert.equal(normalizeStageStatus('待处理'), '未开始');
  assert.equal(normalizeStageStatus('等待中'), '等待');
  assert.equal(normalizeStageStatus('进行中'), '进行中');
  assert.equal(normalizeStageStatus('未知'), '未开始');
  assert.equal(normalizeProjectStatus('进行中'), '进行中');
  assert.equal(normalizeProjectStatus('未知'), '筹备中');
});

test('validates real ISO calendar dates and accepts empty optional dates', () => {
  assert.deepEqual(validateIsoDate('2026-09-02'), { valid: true, value: '2026-09-02' });
  assert.deepEqual(validateIsoDate(''), { valid: true, value: '' });
  assert.equal(validateIsoDate('2026-13-40').valid, false);
  assert.equal(validateIsoDate('2026-02-29').valid, false);
  assert.equal(validateIsoDate('2028-02-29').valid, true);
});

test('normalizes project and stage records without changing unrelated fields', () => {
  assert.deepEqual(normalizeProject({ project_status: '未知', plan_start: '2026-13-40', extra: 1 }), {
    project_status: '筹备中',
    plan_start: '',
    extra: 1,
  });
  assert.deepEqual(normalizeStage({ status: '等待中', planned_end: '2026-09-02', extra: 1 }), {
    status: '等待',
    planned_end: '2026-09-02',
    extra: 1,
  });
});

test('validates the required project draft fields and its dates', () => {
  assert.deepEqual(validateProjectDraft({
    name: '省地勘局宿舍',
    project_id: 'project-20260902-001',
    project_status: '进行中',
    plan_start: '2026-09-01',
    plan_end: '2026-12-01',
  }), { valid: true, errors: [] });
  assert.deepEqual(validateProjectDraft({ name: '', project_id: '', plan_start: '2026-13-40' }), {
    valid: false,
    errors: ['name is required', 'project_id is required', 'plan_start must be an ISO date'],
  });
});

test('validates stage order, status, and dates', () => {
  assert.deepEqual(validateStageDraft({
    name: '水电暖改造',
    project_id: 'project-20260902-001',
    order: 6,
    status: '进行中',
    planned_start: '2026-09-01',
    planned_end: '2026-09-10',
  }), { valid: true, errors: [] });
  assert.deepEqual(validateStageDraft({ name: '', project_id: '', order: 0, status: '未知', planned_end: '2026-13-40' }), {
    valid: false,
    errors: ['name is required', 'project_id is required', 'order must be a positive integer', 'status is invalid', 'planned_end must be an ISO date'],
  });
});
