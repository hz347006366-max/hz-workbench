const { validateIsoDate } = require('./project-schema');

const DAY_MS = 24 * 60 * 60 * 1000;

function validIsoDate(value) {
  return validateIsoDate(value).valid && typeof value === 'string' && value !== '';
}

function dayNumber(value) {
  if (!validIsoDate(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

function isoDateFromDate(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return '';
  return [value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate()]
    .map((part, index) => index === 0 ? String(part).padStart(4, '0') : String(part).padStart(2, '0'))
    .join('-');
}

function normalizeToday(value) {
  if (value instanceof Date) return isoDateFromDate(value);
  return validIsoDate(value) ? value : '';
}

function calculateStageProgress(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const checked = items.filter((item) => item && item.checked === true).length;
  return Math.round((checked / items.length) * 100);
}

function calculateProjectProgress(stages) {
  const validStages = (Array.isArray(stages) ? stages : [])
    .filter((stage) => stage && stage.valid === true && Number.isFinite(stage.progress));
  if (validStages.length === 0) return null;
  const total = validStages.reduce((sum, stage) => sum + stage.progress, 0);
  return Math.round(total / validStages.length);
}

function selectCurrentStage(stages) {
  const ordered = (Array.isArray(stages) ? stages : [])
    .map((stage, index) => ({ stage, index }))
    .sort((a, b) => {
      const orderA = Number.isFinite(a.stage?.order) ? a.stage.order : Number.POSITIVE_INFINITY;
      const orderB = Number.isFinite(b.stage?.order) ? b.stage.order : Number.POSITIVE_INFINITY;
      return orderA - orderB || a.index - b.index;
    })
    .map(({ stage }) => stage);
  return ordered.find((stage) => stage?.status === '进行中')
    || ordered.find((stage) => stage?.status !== '已完成')
    || null;
}

function reconcileStageCompletion({ status, actualEnd, progress } = {}, today) {
  if (progress === 100) {
    if (validIsoDate(actualEnd)) {
      return { status: '已完成', actualEnd };
    }
    const normalizedToday = normalizeToday(today);
    if (!normalizedToday) throw new Error('today must be a valid ISO date');
    return { status: '已完成', actualEnd: normalizedToday };
  }
  if (status === '已完成' && progress < 100) {
    return { status: '进行中', actualEnd: '' };
  }
  return { status, actualEnd };
}

function calculateScheduleVariance(stage = {}, today) {
  if (stage.schedule_status === '草案') {
    return { kind: 'draft', days: 0, label: '草案排期' };
  }

  const plannedEnd = dayNumber(stage.planned_end);
  const todayNumber = dayNumber(normalizeToday(today));
  if (plannedEnd === null || todayNumber === null) {
    return { kind: 'missing', days: 0, label: '排期待完善' };
  }

  if (stage.status === '已完成') {
    const actualEnd = dayNumber(stage.actual_end);
    if (actualEnd === null) return { kind: 'missing', days: 0, label: '排期待完善' };
    const difference = actualEnd - plannedEnd;
    if (difference < 0) return { kind: 'early', days: Math.abs(difference), label: '提前' };
    if (difference > 0) return { kind: 'late', days: difference, label: '延期' };
    return { kind: 'on-time', days: 0, label: '按时' };
  }

  if (todayNumber > plannedEnd) {
    return { kind: 'late', days: todayNumber - plannedEnd, label: '延期' };
  }
  return { kind: 'on-time', days: 0, label: '按时' };
}

function calculateGanttRange(mode, stages, now) {
  const current = normalizeToday(now);
  if (mode === 'month' || mode === 'quarter') {
    if (!current) return null;
    const [year, month] = current.split('-').slice(0, 2).map(Number);
    const offset = mode === 'quarter' ? -1 : 0;
    const endOffset = mode === 'quarter' ? 1 : 0;
    const startDate = new Date(Date.UTC(year, month - 1 + offset, 1));
    const endDate = new Date(Date.UTC(year, month - 1 + endOffset + 1, 0));
    return { start: isoDateFromDate(startDate), end: isoDateFromDate(endDate) };
  }
  if (mode !== 'all') return null;

  const ranges = (Array.isArray(stages) ? stages : [])
    .map((stage) => ({ start: dayNumber(stage?.planned_start), end: dayNumber(stage?.planned_end) }))
    .filter(({ start, end }) => start !== null && end !== null && start <= end);
  if (ranges.length === 0) return null;
  const start = Math.min(...ranges.map((range) => range.start));
  const end = Math.max(...ranges.map((range) => range.end));
  return { start: dayToIso(start), end: dayToIso(end) };
}

function dayToIso(day) {
  return isoDateFromDate(new Date(day * DAY_MS));
}

function positionStageBar(stage = {}, range = {}) {
  const start = dayNumber(stage.planned_start);
  const end = dayNumber(stage.planned_end);
  const rangeStart = dayNumber(range.start);
  const rangeEnd = dayNumber(range.end);
  if (start === null || end === null || rangeStart === null || rangeEnd === null
    || end < start || rangeEnd < rangeStart) {
    return stage.schedule_status === '草案'
      ? { valid: false, left: 0, width: 0, actualLeft: null, actualWidth: 0, draft: true }
      : { valid: false, left: 0, width: 0 };
  }

  if (rangeEnd === rangeStart) {
    const actualStart = dayNumber(stage.actual_start);
    const actualEnd = dayNumber(stage.actual_end);
    const result = {
      valid: true,
      left: 0,
      width: start <= rangeStart && end >= rangeStart ? 100 : 0,
    };
    if (actualStart !== null && actualEnd !== null) { result.actualLeft = actualStart <= rangeStart && actualEnd >= rangeStart ? 0 : null; result.actualWidth = result.actualLeft === null ? 0 : 100; }
    if (stage.schedule_status === '草案') result.draft = true;
    return result;
  }

  const total = rangeEnd - rangeStart;
  const rawLeft = ((start - rangeStart) / total) * 100;
  const rawRight = ((end - rangeStart) / total) * 100;
  const left = Math.max(0, Math.min(100, rawLeft));
  const right = Math.max(0, Math.min(100, rawRight));
  const actualStart = dayNumber(stage.actual_start);
  const actualEnd = dayNumber(stage.actual_end);
  let actualLeft = null;
  let actualWidth = 0;
  if (actualStart !== null && actualEnd !== null && actualEnd >= actualStart) {
    const actualRawLeft = ((actualStart - rangeStart) / total) * 100;
    const actualRawRight = ((actualEnd - rangeStart) / total) * 100;
    actualLeft = Math.max(0, Math.min(100, actualRawLeft));
    actualWidth = Math.max(0, Math.min(100, actualRawRight) - actualLeft);
  }
  const result = { valid: true, left, width: Math.max(0, right - left) };
  if (actualLeft !== null) { result.actualLeft = actualLeft; result.actualWidth = actualWidth; }
  if (stage.schedule_status === '草案') { result.draft = true; if (actualLeft === null) { result.actualLeft = null; result.actualWidth = 0; } }
  return result;
}

module.exports = {
  calculateStageProgress,
  calculateProjectProgress,
  selectCurrentStage,
  reconcileStageCompletion,
  calculateScheduleVariance,
  calculateGanttRange,
  positionStageBar,
};
