const test = require('node:test');
const assert = require('node:assert/strict');

const { TickTickReadAdapter } = require('../src/ticktick-read-adapter');

test('loads TickTick tasks once through the repository without touching write or sync surfaces', async () => {
  let loadCalls = 0;
  const plugin = new Proxy({
    taskRepository: {
      async loadAllTasks() {
        loadCalls += 1;
        return [
          { id: 'valid', title: 'Valid #ticktick', dueDate: '2026-08-12', status: 0, priority: 2 },
          { id: 'created-only', title: 'Keep me', createdTime: '2026-08-03T08:20:00+08:00', status: 0 },
        ];
      },
    },
  }, {
    get(target, property, receiver) {
      if (['service', 'tickTickRestAPI', 'saveSettings'].includes(property)) {
        throw new Error(`forbidden TickTick surface accessed: ${String(property)}`);
      }
      return Reflect.get(target, property, receiver);
    },
  });
  const app = {
    plugins: { getPlugin: (id) => (id === 'tickticksync' ? plugin : null) },
    commands: new Proxy({}, {
      get() { throw new Error('Obsidian commands must not be accessed'); },
    }),
  };

  const result = await new TickTickReadAdapter(app).loadTasks();

  assert.equal(loadCalls, 1);
  assert.deepEqual(result, {
    tasks: [
      {
        id: 'valid', title: 'Valid', due: '2026-08-12', scheduled: '2026-08-12', created: '',
        startMinutes: null, endMinutes: null, allDay: true, completed: false, priority: 2,
      },
      {
        id: 'created-only', title: 'Keep me', due: '', scheduled: '', created: '2026-08-03',
        startMinutes: null, endMinutes: null, allDay: true, completed: false, priority: 0,
      },
    ],
    available: true,
    reason: null,
  });
});

test('reports unavailable instead of scanning the Vault when TickTickSync is missing', async () => {
  const app = {
    plugins: { getPlugin: () => null },
    vault: new Proxy({}, {
      get() { throw new Error('Vault fallback must not be accessed'); },
    }),
  };

  const result = await new TickTickReadAdapter(app).loadTasks();

  assert.deepEqual(result.tasks, []);
  assert.equal(result.available, false);
  assert.equal(typeof result.reason, 'string');
  assert.ok(result.reason.length > 0);
});

test('reports unavailable when the TickTick repository is missing', async () => {
  const result = await new TickTickReadAdapter({
    plugins: { getPlugin: () => ({}) },
  }).loadTasks();

  assert.deepEqual(result.tasks, []);
  assert.equal(result.available, false);
  assert.equal(typeof result.reason, 'string');
  assert.ok(result.reason.length > 0);
});

test('reports unavailable when repository loading throws', async () => {
  let loadCalls = 0;
  const result = await new TickTickReadAdapter({
    plugins: {
      getPlugin: () => ({
        taskRepository: {
          async loadAllTasks() {
            loadCalls += 1;
            throw new Error('database unavailable');
          },
        },
      }),
    },
  }).loadTasks();

  assert.equal(loadCalls, 1);
  assert.deepEqual(result.tasks, []);
  assert.equal(result.available, false);
  assert.match(result.reason, /database unavailable/);
});
