const { cleanTaskDisplayTitle } = require('./core');

function pad(value) {
  return String(value).padStart(2, '0');
}

function localDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const SHANGHAI_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function calendarValue(year, month, day, hour = 0, minute = 0) {
  const probe = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1
    || probe.getUTCDate() !== day || probe.getUTCHours() !== hour || probe.getUTCMinutes() !== minute) return null;
  return {
    dateKey: `${year}-${pad(month)}-${pad(day)}`,
    minutes: hour * 60 + minute,
    time: probe.getTime(),
  };
}

function shanghaiValue(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(SHANGHAI_PARTS.formatToParts(date)
    .filter(({ type }) => type !== 'literal')
    .map(({ type, value }) => [type, Number(value)]));
  return {
    dateKey: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`,
    minutes: parts.hour * 60 + parts.minute,
    time: date.getTime(),
  };
}

function parseDueDate(value) {
  if (value instanceof Date) return shanghaiValue(new Date(value.getTime()));
  if (typeof value !== 'string' || !value.trim()) return null;

  const text = value.trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (dateOnly) {
    const [year, month, day] = dateOnly.slice(1).map(Number);
    return calendarValue(year, month, day);
  }

  const localDateTime = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(text);
  if (localDateTime) return calendarValue(...localDateTime.slice(1, 6).map(Number));

  return shanghaiValue(new Date(text));
}

function normalizeTickTickTask(task) {
  const start = parseDueDate(task?.startDate);
  const due = parseDueDate(task?.dueDate);
  const created = parseDueDate(task?.createdTime || task?.dateHolder?.createdTime);
  if (!task?.id) return null;

  const scheduledDate = start || due;
  const isAllDay = task.isAllDay !== false || (!start && !due);

  const normalized = {
    id: String(task.id),
    title: cleanTaskDisplayTitle(task.title),
    due: due?.dateKey || '',
    scheduled: scheduledDate?.dateKey || '',
    created: created?.dateKey || '',
    startMinutes: isAllDay ? null : start?.minutes ?? null,
    endMinutes: isAllDay ? null : due?.minutes ?? null,
    allDay: isAllDay,
    completed: task.status !== 0,
    priority: Number(task.priority) || 0,
  };

  Object.defineProperty(normalized, 'dueTime', {
    value: due?.time || 0,
    enumerable: false,
  });
  return normalized;
}

function nextLocalDate(dateKey) {
  const [year, month, day] = String(dateKey).split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + 1);
  return localDateKey(date);
}

function tasksForDate(tasks, dateKey, { includeCompleted } = {}) {
  return tasks
    .filter((task) => task && task.due === dateKey && (includeCompleted || !task.completed))
    .slice()
    .sort((left, right) => (
      (left.dueTime || 0) - (right.dueTime || 0)
      || right.priority - left.priority
      || left.id.localeCompare(right.id)
    ));
}

module.exports = {
  normalizeTickTickTask,
  tasksForDate,
  nextLocalDate,
};
