const PROJECT_STATUSES = Object.freeze(['筹备中', '进行中', '暂停', '已完成', '已归档']);
const STAGE_STATUSES = Object.freeze(['未开始', '进行中', '等待', '已完成']);

const LEGACY_STAGE_STATUSES = Object.freeze({
  待处理: '未开始',
  等待中: '等待',
});

function normalizeProjectStatus(status) {
  return PROJECT_STATUSES.includes(status) ? status : PROJECT_STATUSES[0];
}

function normalizeStageStatus(status) {
  if (STAGE_STATUSES.includes(status)) return status;
  return LEGACY_STAGE_STATUSES[status] || STAGE_STATUSES[0];
}

function validateIsoDate(value) {
  if (value === undefined || value === null || value === '') return { valid: true, value: '' };
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { valid: false, value: '' };
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid = date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;

  return { valid, value: valid ? value : '' };
}

function normalizeDateField(record, field) {
  const date = validateIsoDate(record[field]);
  return date.valid ? date.value : '';
}

function normalizeProject(project = {}) {
  const normalized = {
    ...project,
    project_status: normalizeProjectStatus(project.project_status),
  };
  for (const field of ['plan_start', 'plan_end']) {
    if (Object.prototype.hasOwnProperty.call(project, field)) normalized[field] = normalizeDateField(project, field);
  }
  return normalized;
}

function normalizeStage(stage = {}) {
  const normalized = {
    ...stage,
    status: normalizeStageStatus(stage.status),
  };
  for (const field of ['planned_start', 'planned_end', 'actual_start', 'actual_end']) {
    if (Object.prototype.hasOwnProperty.call(stage, field)) normalized[field] = normalizeDateField(stage, field);
  }
  return normalized;
}

function required(value, field, errors) {
  if (typeof value !== 'string' || value.trim() === '') errors.push(`${field} is required`);
}

function addDateError(value, field, errors) {
  if (!validateIsoDate(value).valid) errors.push(`${field} must be an ISO date`);
}

function validateProjectDraft(project = {}) {
  const errors = [];
  required(project.name, 'name', errors);
  required(project.project_id, 'project_id', errors);
  if (project.project_status !== undefined && !PROJECT_STATUSES.includes(project.project_status)) {
    errors.push('project_status is invalid');
  }
  addDateError(project.plan_start, 'plan_start', errors);
  addDateError(project.plan_end, 'plan_end', errors);
  return { valid: errors.length === 0, errors };
}

function validateStageDraft(stage = {}) {
  const errors = [];
  required(stage.name, 'name', errors);
  required(stage.project_id, 'project_id', errors);
  if (!Number.isInteger(stage.order) || stage.order < 1) errors.push('order must be a positive integer');
  if (!STAGE_STATUSES.includes(stage.status)) errors.push('status is invalid');
  addDateError(stage.planned_start, 'planned_start', errors);
  addDateError(stage.planned_end, 'planned_end', errors);
  addDateError(stage.actual_start, 'actual_start', errors);
  addDateError(stage.actual_end, 'actual_end', errors);
  return { valid: errors.length === 0, errors };
}

module.exports = {
  PROJECT_STATUSES,
  STAGE_STATUSES,
  normalizeProject,
  normalizeStage,
  normalizeProjectStatus,
  normalizeStageStatus,
  validateIsoDate,
  validateProjectDraft,
  validateStageDraft,
};
