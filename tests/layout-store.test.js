const test = require('node:test');
const assert = require('node:assert/strict');

const { DEFAULT_LAYOUT } = require('../src/layout-model');
const { LayoutStore } = require('../src/layout-store');

const DEVICE_A = '11111111-1111-4111-8111-111111111111';
const DEVICE_B = '22222222-2222-4222-8222-222222222222';
const DEVICE_C = '33333333-3333-4333-8333-333333333333';
const STORAGE_KEY = 'hz-workbench:device-id:v1';

class MemoryAdapter {
  constructor({ refuseOverwrite = false } = {}) {
    this.files = new Map();
    this.folders = new Set();
    this.mkdirCalls = [];
    this.refuseOverwrite = refuseOverwrite;
  }

  async exists(path) { return this.files.has(path) || this.folders.has(path); }

  async mkdir(path) {
    this.mkdirCalls.push(path);
    this.folders.add(path);
  }

  async read(path) {
    if (!this.files.has(path)) throw new Error(`missing ${path}`);
    return this.files.get(path);
  }

  async write(path, value) { this.files.set(path, value); }

  async rename(from, to) {
    if (!this.files.has(from)) throw new Error(`missing ${from}`);
    if (this.refuseOverwrite && this.files.has(to)) throw new Error(`exists ${to}`);
    this.files.set(to, this.files.get(from));
    this.files.delete(from);
  }

  async remove(path) { this.files.delete(path); }
}

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    value: (key) => values.get(key),
  };
}

function createStore({
  adapter = new MemoryAdapter(),
  local = storage({ [STORAGE_KEY]: DEVICE_A }),
  configDir = '.obsidian',
  uuid = () => DEVICE_C,
  now = () => '2026-08-09T00:00:00.000Z',
  onRecovery = () => {},
} = {}) {
  return new LayoutStore({ adapter, configDir, localStorage: local, uuid, now, onRecovery });
}

test('creates, persists, and reuses a valid local UUID', () => {
  const local = storage();
  let calls = 0;
  const store = createStore({
    local,
    uuid: () => {
      calls += 1;
      return DEVICE_A;
    },
  });

  assert.equal(store.deviceId(), DEVICE_A);
  assert.equal(store.deviceId(), DEVICE_A);
  assert.equal(local.value(STORAGE_KEY), DEVICE_A);
  assert.equal(calls, 1);
});

test('regenerates invalid and traversal-like stored device ids before composing paths', () => {
  for (const invalid of ['not-a-uuid', '../../escape.json', '11111111-1111-1111-8111-111111111111']) {
    const local = storage({ [STORAGE_KEY]: invalid });
    const store = createStore({ local, uuid: () => DEVICE_B });
    assert.equal(store.deviceId(), DEVICE_B);
    assert.equal(store.layoutPath(), `.obsidian/hz-workbench/layouts/${DEVICE_B}.json`);
    assert.equal(local.value(STORAGE_KEY), DEVICE_B);
  }
});

test('rejects an injected generator that does not return a UUID v4', () => {
  const store = createStore({ local: storage(), uuid: () => '../invalid' });
  assert.throws(() => store.deviceId(), /UUID v4/);
});

test('uses the current config directory and creates its layout directory recursively', async () => {
  const adapter = new MemoryAdapter();
  const store = createStore({ adapter, configDir: '.custom/config' });

  await store.save(DEFAULT_LAYOUT);

  assert.deepEqual(adapter.mkdirCalls, [
    '.custom',
    '.custom/config',
    '.custom/config/hz-workbench',
    '.custom/config/hz-workbench/layouts',
  ]);
  assert.ok(adapter.files.has(`.custom/config/hz-workbench/layouts/${DEVICE_A}.json`));
});

test('missing layout loads a validated independent default', async () => {
  const store = createStore();
  const loaded = await store.load();

  assert.deepEqual(loaded, DEFAULT_LAYOUT);
  assert.notEqual(loaded, DEFAULT_LAYOUT);
  assert.notEqual(loaded.sidebar, DEFAULT_LAYOUT.sidebar);
});

test('two devices sharing one adapter write distinct files', async () => {
  const adapter = new MemoryAdapter();
  const a = createStore({ adapter, local: storage({ [STORAGE_KEY]: DEVICE_A }) });
  const b = createStore({ adapter, local: storage({ [STORAGE_KEY]: DEVICE_B }) });

  await a.save({ sidebar: { x: 1, y: 2, scale: 1 } });
  await b.save({ sidebar: { x: 3, y: 4, scale: 1 } });

  const pathA = `.obsidian/hz-workbench/layouts/${DEVICE_A}.json`;
  const pathB = `.obsidian/hz-workbench/layouts/${DEVICE_B}.json`;
  assert.ok(adapter.files.has(pathA));
  assert.ok(adapter.files.has(pathB));
  assert.equal(JSON.parse(adapter.files.get(pathA)).modules.sidebar.x, 1);
  assert.equal(JSON.parse(adapter.files.get(pathB)).modules.sidebar.x, 3);
});

test('save writes the versioned device document with injected clock', async () => {
  const adapter = new MemoryAdapter();
  const store = createStore({ adapter });
  await store.save({ sidebar: { x: 9, y: 10, scale: 1 }, future: { x: 1, y: 2, scale: 1 } });

  const document = JSON.parse(adapter.files.get(store.layoutPath()));
  assert.equal(document.schemaVersion, 2);
  assert.equal(document.deviceId, DEVICE_A);
  assert.equal(document.canvasWidth, 1640);
  assert.equal(document.updatedAt, '2026-08-09T00:00:00.000Z');
  assert.equal(document.modules.sidebar.x, 9);
  assert.deepEqual(document.modules.future, { x: 1, y: 2, scale: 1 });
  assert.equal(adapter.files.has(`${store.layoutPath()}.tmp`), false);
});

test('save rejects a non-canonical timestamp from the injected clock', async () => {
  const adapter = new MemoryAdapter();
  const store = createStore({ adapter, now: () => 'not-a-timestamp' });

  await assert.rejects(() => store.save(DEFAULT_LAYOUT), /timestamp/);
  assert.equal(adapter.files.has(store.layoutPath()), false);
  assert.equal(adapter.files.has(`${store.layoutPath()}.tmp`), false);
});

test('existing-file replacement is one direct temp-to-final atomic rename', async () => {
  const adapter = new MemoryAdapter();
  const store = createStore({ adapter });
  await store.save({ sidebar: { x: 1, y: 2, scale: 1 } });
  const path = store.layoutPath();
  const renameCalls = [];
  const originalRename = adapter.rename.bind(adapter);
  adapter.rename = async (from, to) => {
    renameCalls.push([from, to]);
    assert.equal(adapter.files.has(path), true, 'official final must exist until atomic replacement');
    return originalRename(from, to);
  };

  await store.save({ sidebar: { x: 8, y: 8, scale: 1 } });

  assert.deepEqual(renameCalls, [[`${path}.tmp`, path]]);
  assert.equal(JSON.parse(adapter.files.get(path)).modules.sidebar.x, 8);
});

test('overwrite-refusing adapter replaces an existing final with verified temp bytes', async () => {
  const adapter = new MemoryAdapter({ refuseOverwrite: true });
  const store = createStore({ adapter });
  await store.save({ sidebar: { x: 1, y: 2, scale: 1 } });
  const path = store.layoutPath();

  await store.save({ sidebar: { x: 8, y: 8, scale: 1 } });

  assert.equal(JSON.parse(adapter.files.get(path)).modules.sidebar.x, 8);
  assert.doesNotThrow(() => JSON.parse(adapter.files.get(path)));
  assert.equal(adapter.files.has(`${path}.tmp`), false);
});

test('invalid temp bytes never replace the previous valid final', async () => {
  const adapter = new MemoryAdapter();
  const store = createStore({ adapter });
  await store.save({ sidebar: { x: 1, y: 2, scale: 1 } });
  const path = store.layoutPath();
  const previous = adapter.files.get(path);
  const originalWrite = adapter.write.bind(adapter);
  adapter.write = async (target, value) => originalWrite(target, target.endsWith('.tmp') ? '{bad' : value);

  await assert.rejects(() => store.save({ sidebar: { x: 8, y: 8, scale: 1 } }));
  assert.equal(adapter.files.get(path), previous);
  assert.equal(adapter.files.has(`${path}.tmp`), false);
});

test('parseable temp data with invalid module fields never replaces the valid final', async () => {
  const adapter = new MemoryAdapter();
  const store = createStore({ adapter });
  await store.save({ sidebar: { x: 1, y: 2, scale: 1 } });
  const path = store.layoutPath();
  const previous = adapter.files.get(path);
  const originalWrite = adapter.write.bind(adapter);
  adapter.write = async (target, value) => {
    if (!target.endsWith('.tmp')) return originalWrite(target, value);
    const tampered = JSON.parse(value);
    tampered.modules.sidebar.x = 'not-a-number';
    return originalWrite(target, JSON.stringify(tampered));
  };

  await assert.rejects(
    () => store.save({ sidebar: { x: 8, y: 8, scale: 1 } }),
    /invalid module layout/,
  );
  assert.equal(adapter.files.get(path), previous);
  assert.equal(adapter.files.has(`${path}.tmp`), false);
});

test('corrupt JSON writes exact raw recovery and returns defaults without changing source', async () => {
  const adapter = new MemoryAdapter();
  const store = createStore({ adapter });
  const raw = '{ definitely not JSON \n  原始值';
  adapter.files.set(store.layoutPath(), raw);

  const loaded = await store.load();

  assert.deepEqual(loaded, DEFAULT_LAYOUT);
  assert.equal(adapter.files.get(store.recoveryPath()), raw);
  assert.equal(adapter.files.get(store.layoutPath()), raw);
});

test('schema 0 migrates stepwise through schema 1 and shifts known content for schema 2', async () => {
  const adapter = new MemoryAdapter();
  const store = createStore({ adapter });
  const source = JSON.stringify({
    schemaVersion: 0,
    deviceId: DEVICE_A,
    modules: {
      ...Object.fromEntries(Object.entries(DEFAULT_LAYOUT)
        .filter(([id]) => id !== 'agent-panel')
        .map(([id, item]) => [id, id === 'sidebar' ? item : { ...item, x: item.x - 194 }])),
      sidebar: { x: 27, y: 16, scale: 1 },
      future: { x: 7, y: 11, scale: 1 },
    },
    updatedAt: '2025-01-02T03:04:05.000Z',
  });
  adapter.files.set(store.layoutPath(), source);

  const loaded = await store.load();

  assert.deepEqual(loaded.sidebar, { x: 27, y: 16, scale: 1 });
  assert.deepEqual(loaded['agent-panel'], DEFAULT_LAYOUT['agent-panel']);
  assert.deepEqual(loaded.future, { x: 7, y: 11, scale: 1 });
  assert.equal(adapter.files.get(store.layoutPath()), source);
});

test('schema 1 writes one original backup and shifts known modules without losing unknown payloads', async () => {
  const adapter = new MemoryAdapter();
  const store = createStore({ adapter });
  const source = JSON.stringify({
    schemaVersion: 1,
    deviceId: DEVICE_A,
    canvasWidth: 1440,
    modules: {
      ...Object.fromEntries(Object.entries(DEFAULT_LAYOUT)
        .filter(([id]) => id !== 'agent-panel')
        .map(([id, item]) => [id, id === 'sidebar' ? item : { ...item, x: item.x - 194 }])),
      header: { x: 144, y: 22, scale: 0.9 },
      future: { arbitrary: ['kept'] },
    },
    updatedAt: '2025-01-02T03:04:05.000Z',
  });
  adapter.files.set(store.layoutPath(), source);

  const loaded = await store.load();
  const backup = `.obsidian/hz-workbench/layouts/${DEVICE_A}.schema-v1.backup.json`;

  assert.deepEqual(loaded.header, { x: 338, y: 22, scale: 0.9 });
  assert.deepEqual(loaded.sidebar, DEFAULT_LAYOUT.sidebar);
  assert.deepEqual(loaded['agent-panel'], DEFAULT_LAYOUT['agent-panel']);
  assert.deepEqual(loaded.future, { arbitrary: ['kept'] });
  assert.equal(adapter.files.get(backup), source);
  adapter.files.set(store.layoutPath(), source.replace('03:04:05', '04:05:06'));
  await store.load();
  assert.equal(adapter.files.get(backup), source);
});

test('schema 1 migration aborts when its first recovery backup cannot be written', async () => {
  const adapter = new MemoryAdapter();
  const store = createStore({ adapter });
  const source = JSON.stringify({
    schemaVersion: 1,
    deviceId: DEVICE_A,
    canvasWidth: 1440,
    modules: DEFAULT_LAYOUT,
    updatedAt: '2025-01-02T03:04:05.000Z',
  });
  adapter.files.set(store.layoutPath(), source);
  const originalWrite = adapter.write.bind(adapter);
  adapter.write = async (path, value) => {
    if (path.endsWith('.schema-v1.backup.json')) throw new Error('backup denied');
    return originalWrite(path, value);
  };

  await assert.rejects(() => store.load(), /backup denied/);
  assert.equal(adapter.files.get(store.layoutPath()), source);
});

test('load rejects empty, invalid, and non-canonical update timestamps', async () => {
  for (const updatedAt of ['', 'not-a-timestamp', '2026-08-09T00:00:00Z']) {
    const adapter = new MemoryAdapter();
    const store = createStore({ adapter });
    const source = JSON.stringify({
      schemaVersion: 2,
      deviceId: DEVICE_A,
      canvasWidth: 1640,
      modules: DEFAULT_LAYOUT,
      updatedAt,
    });
    adapter.files.set(store.layoutPath(), source);

    await assert.rejects(() => store.load(), /timestamp/);
    assert.equal(adapter.files.get(store.layoutPath()), source);
  }
});
