const test = require('node:test');
const assert = require('node:assert/strict');

const {
  toggleFocusSelection,
  selectedTasksForDate,
} = require('../src/focus-selection');

test('adds a valid task to a detached daily selection', () => {
  const input = { '2026-08-11': ['older'] };
  const result = toggleFocusSelection(input, '2026-08-12', 'task-1', ['task-1', 'older']);

  assert.deepEqual(result, {
    selections: { '2026-08-11': ['older'], '2026-08-12': ['task-1'] },
    selected: true,
    limitReached: false,
  });
  assert.notStrictEqual(result.selections, input);
  assert.notStrictEqual(result.selections['2026-08-11'], input['2026-08-11']);
  assert.deepEqual(input, { '2026-08-11': ['older'] });
});

test('removes a currently selected task even when it is no longer available', () => {
  const input = { '2026-08-12': ['removed', 'kept'] };
  const result = toggleFocusSelection(input, '2026-08-12', 'removed', ['kept']);

  assert.deepEqual(result, {
    selections: { '2026-08-12': ['kept'] },
    selected: false,
    limitReached: false,
  });
  assert.deepEqual(input, { '2026-08-12': ['removed', 'kept'] });
});

test('rejects a fourth valid task and leaves the capped selection intact', () => {
  const input = { '2026-08-12': ['one', 'two', 'three'] };
  const result = toggleFocusSelection(input, '2026-08-12', 'four', ['one', 'two', 'three', 'four']);

  assert.deepEqual(result.selections['2026-08-12'], ['one', 'two', 'three']);
  assert.equal(result.selected, false);
  assert.equal(result.limitReached, true);
  assert.deepEqual(input, { '2026-08-12': ['one', 'two', 'three'] });
});

test('keeps selections isolated by date', () => {
  const input = {
    '2026-08-12': ['today'],
    '2026-08-13': ['tomorrow'],
  };
  const result = toggleFocusSelection(input, '2026-08-13', 'next', ['tomorrow', 'next']);

  assert.deepEqual(result.selections, {
    '2026-08-12': ['today'],
    '2026-08-13': ['tomorrow', 'next'],
  });
});

test('prunes stale and duplicate IDs before adding and rejects an invalid addition', () => {
  const input = { '2026-08-12': ['valid', 'stale', 'valid'] };
  const result = toggleFocusSelection(input, '2026-08-12', 'invalid', ['valid']);

  assert.deepEqual(result, {
    selections: { '2026-08-12': ['valid'] },
    selected: false,
    limitReached: false,
  });
  assert.deepEqual(input, { '2026-08-12': ['valid', 'stale', 'valid'] });
});

test('prunes an over-limit stored day to three valid IDs', () => {
  const input = { '2026-08-12': ['one', 'two', 'three', 'four'] };
  const result = toggleFocusSelection(input, '2026-08-12', 'invalid', ['one', 'two', 'three', 'four']);

  assert.deepEqual(result.selections['2026-08-12'], ['one', 'two', 'three']);
  assert.deepEqual(input['2026-08-12'], ['one', 'two', 'three', 'four']);
});

test('returns selected tasks in stored order and retains completed tasks', () => {
  const tasks = [
    { id: 'open', title: 'Open', due: '2026-08-12', completed: false, priority: 0 },
    { id: 'done', title: 'Done', due: '2026-08-12', completed: true, priority: 1 },
  ];
  const selections = { '2026-08-12': ['done', 'missing', 'open'] };

  const selected = selectedTasksForDate(tasks, selections, '2026-08-12');

  assert.deepEqual(selected.map((task) => task.id), ['done', 'open']);
  assert.strictEqual(selected[0], tasks[1]);
  assert.deepEqual(tasks.map((task) => task.id), ['open', 'done']);
  assert.deepEqual(selections, { '2026-08-12': ['done', 'missing', 'open'] });
});
