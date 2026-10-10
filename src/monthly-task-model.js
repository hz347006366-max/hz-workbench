const { formatChineseDate } = require('./month-context');

function validDateKey(value) {
  const dateKey = String(value || '');
  return formatChineseDate(dateKey) ? dateKey : '';
}

function taskMonthDate(task) {
  return validDateKey(task?.scheduled) || validDateKey(task?.due);
}

function formatMinutes(value) {
  if (!Number.isInteger(value) || value < 0 || value >= 24 * 60) return '';
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

function timeLabel(task, dateKey) {
  if (task?.allDay !== false) return '全天';

  const start = formatMinutes(task.startMinutes);
  const end = formatMinutes(task.endMinutes);
  const dueDate = validDateKey(task.due);
  if (start && end && dueDate === dateKey) return `${start}–${end}`;
  return start || end || '全天';
}

function taskSortKey(task, dateKey) {
  const start = Number.isInteger(task?.startMinutes) ? task.startMinutes : task?.endMinutes;
  return {
    dateKey,
    allDay: task?.allDay === false ? 0 : 1,
    minutes: Number.isInteger(start) ? start : Infinity,
    title: String(task?.title || ''),
  };
}

function compareTaskRows(left, right) {
  return left.sortKey.dateKey.localeCompare(right.sortKey.dateKey)
    || left.sortKey.allDay - right.sortKey.allDay
    || left.sortKey.minutes - right.sortKey.minutes
    || left.sortKey.title.localeCompare(right.sortKey.title, 'zh-CN');
}

function buildMonthlyTaskView(tasks, monthContext) {
  const month = monthContext?.ok ? String(monthContext.month || '') : '';
  const rows = [];
  let unassigned = 0;

  for (const task of Array.isArray(tasks) ? tasks : []) {
    const dateKey = taskMonthDate(task);
    if (!dateKey) {
      unassigned += 1;
      continue;
    }
    if (!month || !dateKey.startsWith(`${month}-`)) continue;

    const time = timeLabel(task, dateKey);
    const status = task?.completed ? '已完成' : '未完成';
    const dateLabel = formatChineseDate(dateKey);
    const title = String(task?.title || '');
    rows.push({
      id: String(task?.id || ''),
      date: dateKey,
      completed: Boolean(task?.completed),
      status,
      dateLabel,
      timeLabel: time,
      title,
      text: `${status}｜${dateLabel} ${time} ${title}`,
      sortKey: taskSortKey(task, dateKey),
    });
  }

  rows.sort(compareTaskRows);
  const completed = rows.filter((row) => row.completed).length;
  const total = rows.length;
  const publicRows = rows.map(({ sortKey, ...row }) => row);
  const groups = [];
  for (const row of publicRows) {
    let group = groups[groups.length - 1];
    if (!group || group.date !== row.date) {
      group = { date: row.date, dateLabel: row.dateLabel, rows: [], progress: '' };
      groups.push(group);
    }
    group.rows.push(row);
  }
  for (const group of groups) {
    group.progress = `${group.rows.filter((row) => row.completed).length}/${group.rows.length}`;
  }
  return {
    total,
    completed,
    incomplete: total - completed,
    completionRate: total ? Math.round(completed / total * 100) : 0,
    unassigned,
    rows: publicRows,
    groups,
  };
}

module.exports = { taskMonthDate, timeLabel, taskSortKey, buildMonthlyTaskView };
