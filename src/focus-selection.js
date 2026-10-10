const MAX_DAILY_SELECTIONS = 3;

function detachedSelections(selections) {
  return Object.fromEntries(Object.entries(selections || {}).map(([dateKey, taskIds]) => [
    dateKey,
    (Array.isArray(taskIds) ? taskIds : []).slice(0, MAX_DAILY_SELECTIONS),
  ]));
}

function toggleFocusSelection(selections, dateKey, taskId, availableIds) {
  const storedIds = Array.isArray(selections?.[dateKey]) ? selections[dateKey] : [];
  const wasSelected = storedIds.includes(taskId);
  const available = new Set(availableIds || []);
  const detached = detachedSelections(selections);
  const seen = new Set();
  const daily = storedIds
    .filter((id) => available.has(id) && !seen.has(id) && seen.add(id))
    .slice(0, MAX_DAILY_SELECTIONS);

  if (wasSelected) {
    detached[dateKey] = daily.filter((id) => id !== taskId);
    return { selections: detached, selected: false, limitReached: false };
  }

  if (!available.has(taskId)) {
    detached[dateKey] = daily;
    return { selections: detached, selected: false, limitReached: false };
  }

  if (daily.length >= MAX_DAILY_SELECTIONS) {
    detached[dateKey] = daily;
    return { selections: detached, selected: false, limitReached: true };
  }

  detached[dateKey] = [...daily, taskId];
  return { selections: detached, selected: true, limitReached: false };
}

function selectedTasksForDate(tasks, selections, dateKey) {
  const tasksById = new Map((Array.isArray(tasks) ? tasks : []).map((task) => [task.id, task]));
  const selectedIds = Array.isArray(selections?.[dateKey]) ? selections[dateKey] : [];
  return selectedIds.map((taskId) => tasksById.get(taskId)).filter(Boolean);
}

module.exports = { toggleFocusSelection, selectedTasksForDate };
