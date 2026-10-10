const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const {
  normalizeTickTickTask,
  tasksForDate,
  nextLocalDate,
} = require('../src/ticktick-read-model');

test('normalizeTickTickTask maps TickTick fields into a readonly task', () => {
  const normalized = normalizeTickTickTask({
    id: 'task-1',
    title: '  Confirm delivery #ticktick %%[ticktick_id:: task-1]%% ',
    dueDate: '2026-08-12T09:30:00+08:00',
    status: 0,
    priority: 3,
  });

  assert.deepEqual(normalized, {
    id: 'task-1',
    title: 'Confirm delivery',
    due: '2026-08-12',
    scheduled: '2026-08-12',
    created: '',
    startMinutes: null,
    endMinutes: null,
    allDay: true,
    completed: false,
    priority: 3,
  });
});

test('normalizeTickTickTask excludes tasks without an id', () => {
  assert.equal(normalizeTickTickTask({ title: 'No ID', dueDate: '2026-08-12' }), null);
});

test('normalizeTickTickTask retains created-only tasks for monthly review', () => {
  const undated = normalizeTickTickTask({
    id: 'created-only', title: '整理资料', createdTime: '2026-08-03T08:20:00+08:00', status: 0,
  });

  assert.deepEqual(undated, {
    id: 'created-only', title: '整理资料', due: '', scheduled: '', created: '2026-08-03',
    startMinutes: null, endMinutes: null, allDay: true, completed: false, priority: 0,
  });
});

test('normalizeTickTickTask derives scheduled date and local times from a timed range', () => {
  const ranged = normalizeTickTickTask({
    id: 'range', title: '开会', startDate: '2026-08-19T09:00:00+08:00',
    dueDate: '2026-08-19T10:00:00+08:00', isAllDay: false,
    createdTime: '2026-08-01T08:00:00+08:00', status: 2,
  });

  assert.equal(ranged.scheduled, '2026-08-19');
  assert.equal(ranged.startMinutes, 540);
  assert.equal(ranged.endMinutes, 600);
});

test('normalizeTickTickTask treats every nonzero TickTick status as completed', () => {
  assert.equal(normalizeTickTickTask({
    id: 'done', title: 'Completed', dueDate: '2026-08-12', status: 2, priority: 1,
  }).completed, true);
});

test('tasksForDate compares due dates in the local calendar without UTC conversion', () => {
  const localEvening = new Date(2026, 7, 12, 23, 30);
  const tasks = [normalizeTickTickTask({
    id: 'local-time', title: 'Keep local date', dueDate: localEvening, status: 0, priority: 0,
  })];

  assert.deepEqual(tasksForDate(tasks, '2026-08-12', { includeCompleted: true }).map((task) => task.id), ['local-time']);
});

test('normalizeTickTickTask keeps a date-only TickTick due date on its written local date', () => {
  assert.equal(normalizeTickTickTask({
    id: 'date-only', title: 'Date only', dueDate: '2026-08-12', status: 0, priority: 0,
  }).due, '2026-08-12');
});

test('normalizeTickTickTask preserves date-only due dates west of UTC', () => {
  const modulePath = path.resolve(__dirname, '../src/ticktick-read-model.js');
  const script = [
    `const { normalizeTickTickTask } = require(${JSON.stringify(modulePath)});`,
    "const task = normalizeTickTickTask({ id: 'west', title: 'West', dueDate: '2026-08-12', status: 0, priority: 0 });",
    "if (task.due !== '2026-08-12') throw new Error(`Expected 2026-08-12, received ${task.due}`);",
  ].join('\n');
  const result = spawnSync(process.execPath, ['-e', script], {
    env: { ...process.env, TZ: 'America/Los_Angeles' },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
});

test('timezone-qualified TickTick timestamps always use Asia Shanghai day and minute boundaries', () => {
  const modulePath = path.resolve(__dirname, '../src/ticktick-read-model.js');
  const script = [
    `const { normalizeTickTickTask } = require(${JSON.stringify(modulePath)});`,
    "const august = normalizeTickTickTask({ id: 'august', title: 'August', startDate: '2026-08-31T15:30:00Z', dueDate: '2026-08-31T15:45:00Z', isAllDay: false, status: 0 });",
    "const september = normalizeTickTickTask({ id: 'september', title: 'September', startDate: '2026-08-31T16:30:00Z', dueDate: '2026-08-31T17:30:00Z', isAllDay: false, status: 0 });",
    "if (august.scheduled !== '2026-08-31' || august.startMinutes !== 1410 || august.endMinutes !== 1425) throw new Error(JSON.stringify(august));",
    "if (september.scheduled !== '2026-09-01' || september.due !== '2026-09-01' || september.startMinutes !== 30 || september.endMinutes !== 90) throw new Error(JSON.stringify(september));",
  ].join('\n');

  for (const timezone of ['UTC', 'America/Los_Angeles']) {
    const result = spawnSync(process.execPath, ['-e', script], {
      env: { ...process.env, TZ: timezone }, encoding: 'utf8',
    });
    assert.equal(result.status, 0, `${timezone}: ${result.stderr}`);
  }
});

test('timezone-free local TickTick values retain their written calendar date and minutes', () => {
  const modulePath = path.resolve(__dirname, '../src/ticktick-read-model.js');
  const script = [
    `const { normalizeTickTickTask } = require(${JSON.stringify(modulePath)});`,
    "const task = normalizeTickTickTask({ id: 'local', title: 'Local', startDate: '2026-08-31T23:30:00', dueDate: '2026-09-01T00:15:00', isAllDay: false, status: 0 });",
    "if (task.scheduled !== '2026-08-31' || task.due !== '2026-09-01' || task.startMinutes !== 1410 || task.endMinutes !== 15) throw new Error(JSON.stringify(task));",
  ].join('\n');

  for (const timezone of ['UTC', 'America/Los_Angeles']) {
    const result = spawnSync(process.execPath, ['-e', script], {
      env: { ...process.env, TZ: timezone }, encoding: 'utf8',
    });
    assert.equal(result.status, 0, `${timezone}: ${result.stderr}`);
  }
});

test('nextLocalDate advances normal dates and calendar boundaries', () => {
  assert.equal(nextLocalDate('2026-08-12'), '2026-08-13');
  assert.equal(nextLocalDate('2026-08-31'), '2026-09-01');
  assert.equal(nextLocalDate('2026-12-31'), '2027-01-01');
});

test('tasksForDate can include completed and incomplete tasks for today', () => {
  const tasks = [
    normalizeTickTickTask({ id: 'open', title: 'Open', dueDate: '2026-08-12T09:00:00', status: 0, priority: 1 }),
    normalizeTickTickTask({ id: 'done', title: 'Done', dueDate: '2026-08-12T10:00:00', status: 2, priority: 1 }),
  ];

  assert.deepEqual(tasksForDate(tasks, '2026-08-12', { includeCompleted: true }).map((task) => task.id), ['open', 'done']);
});

test('tasksForDate excludes completed tasks when requested for tomorrow', () => {
  const tasks = [
    normalizeTickTickTask({ id: 'open', title: 'Open', dueDate: '2026-08-13T09:00:00', status: 0, priority: 1 }),
    normalizeTickTickTask({ id: 'done', title: 'Done', dueDate: '2026-08-13T10:00:00', status: 2, priority: 1 }),
  ];

  assert.deepEqual(tasksForDate(tasks, '2026-08-13', { includeCompleted: false }).map((task) => task.id), ['open']);
});

test('tasksForDate sorts by due time, priority, then id without mutating inputs', () => {
  const tasks = [
    normalizeTickTickTask({ id: 'z-last', title: 'Last', dueDate: '2026-08-12T11:00:00', status: 0, priority: 0 }),
    normalizeTickTickTask({ id: 'b-priority', title: 'Priority', dueDate: '2026-08-12T10:00:00', status: 0, priority: 2 }),
    normalizeTickTickTask({ id: 'a-priority', title: 'Tie', dueDate: '2026-08-12T10:00:00', status: 0, priority: 2 }),
    normalizeTickTickTask({ id: 'low-priority', title: 'Low', dueDate: '2026-08-12T10:00:00', status: 0, priority: 1 }),
  ];
  const originalOrder = tasks.map((task) => task.id);

  assert.deepEqual(
    tasksForDate(tasks, '2026-08-12', { includeCompleted: true }).map((task) => task.id),
    ['a-priority', 'b-priority', 'low-priority', 'z-last'],
  );
  assert.deepEqual(tasks.map((task) => task.id), originalOrder);
});
