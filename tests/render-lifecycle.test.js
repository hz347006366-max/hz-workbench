const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('render lifecycle module exposes the transaction state owner', () => {
  const modulePath = path.resolve(__dirname, '../src/render-lifecycle.js');
  assert.equal(fs.existsSync(modulePath), true);
  const { RenderLifecycle, runRenderTransaction, renderSafely } = require(modulePath);
  assert.equal(typeof RenderLifecycle, 'function');
  assert.equal(typeof runRenderTransaction, 'function');
  assert.equal(typeof renderSafely, 'function');
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function createTransactionHarness(initialPath = '') {
  const { RenderLifecycle, runRenderTransaction } = require('../src/render-lifecycle');
  const lifecycle = new RenderLifecycle();
  lifecycle.open();
  let apps = initialPath ? [{ id: 'initial' }] : [];
  const controllers = [];
  let controller = initialPath ? createController(initialPath) : null;
  let mounts = 0;

  function createController(pathValue) {
    const created = {
      path: pathValue,
      live: true,
      destroy() { this.live = false; },
    };
    controllers.push(created);
    return created;
  }

  return {
    render(load) {
      return runRenderTransaction({
        lifecycle,
        getCurrentPath: () => controller?.path || '',
        load,
        commit(journalPaths, preferredPath) {
          controller?.destroy();
          apps = [];
          const selectedPath = journalPaths.includes(preferredPath)
            ? preferredPath
            : journalPaths[0] || '';
          controller = createController(selectedPath);
          apps.push({ id: `render-${mounts + 1}` });
          mounts += 1;
          return selectedPath;
        },
      });
    },
    open() { lifecycle.open(); },
    close() {
      lifecycle.close();
      controller?.destroy();
      controller = null;
    },
    navigate(pathValue) {
      if (controller) controller.path = pathValue;
    },
    snapshot() {
      return {
        apps: [...apps],
        controller,
        liveControllers: controllers.filter((item) => item.live),
        mounts,
      };
    },
  };
}

test('newest overlapping render commits once and retains the preferred journal', async () => {
  const harness = createTransactionHarness('daily/2026-07-02.md');
  const olderGate = deferred();
  const newerGate = deferred();
  const journals = ['daily/2026-08-03.md', 'daily/2026-07-02.md'];

  const olderRender = harness.render(() => olderGate.promise);
  const newerRender = harness.render(() => newerGate.promise);
  newerGate.resolve(journals);
  assert.equal(await newerRender, true);
  olderGate.resolve(journals);
  assert.equal(await olderRender, false);

  const snapshot = harness.snapshot();
  assert.equal(snapshot.apps.length, 1);
  assert.equal(snapshot.liveControllers.length, 1);
  assert.equal(snapshot.mounts, 1);
  assert.equal(snapshot.controller.live, true);
  assert.equal(snapshot.controller.path, 'daily/2026-07-02.md');
});

test('close invalidates an in-flight render before it can mount a controller', async () => {
  const harness = createTransactionHarness();
  const gate = deferred();
  const pendingRender = harness.render(() => gate.promise);

  harness.close();
  gate.resolve(['daily/2026-08-03.md']);

  assert.equal(await pendingRender, false);
  const snapshot = harness.snapshot();
  assert.equal(snapshot.mounts, 0);
  assert.equal(snapshot.liveControllers.length, 0);
  assert.equal(snapshot.controller, null);
});

test('navigation during loading is recaptured immediately before commit', async () => {
  const harness = createTransactionHarness('daily/a.md');
  const gate = deferred();
  const pendingRender = harness.render(() => gate.promise);

  harness.navigate('daily/b.md');
  gate.resolve(['daily/latest.md', 'daily/a.md', 'daily/b.md']);

  assert.equal(await pendingRender, true);
  assert.equal(harness.snapshot().controller.path, 'daily/b.md');
});

test('failed loading reports once, preserves live state, and permits a later commit', async () => {
  const { renderSafely } = require('../src/render-lifecycle');
  const harness = createTransactionHarness('daily/current.md');
  const reported = [];
  const failure = new Error('vault read failed');

  const failed = await renderSafely(
    () => harness.render(() => Promise.reject(failure)),
    (error) => reported.push(error),
  );

  let snapshot = harness.snapshot();
  assert.equal(failed, false);
  assert.deepEqual(reported, [failure]);
  assert.equal(snapshot.apps.length, 1);
  assert.equal(snapshot.liveControllers.length, 1);
  assert.equal(snapshot.controller.path, 'daily/current.md');
  assert.equal(snapshot.mounts, 0);

  const succeeded = await renderSafely(
    () => harness.render(() => Promise.resolve(['daily/new.md', 'daily/current.md'])),
    (error) => reported.push(error),
  );

  snapshot = harness.snapshot();
  assert.equal(succeeded, true);
  assert.deepEqual(reported, [failure]);
  assert.equal(snapshot.apps.length, 1);
  assert.equal(snapshot.liveControllers.length, 1);
  assert.equal(snapshot.controller.path, 'daily/current.md');
  assert.equal(snapshot.mounts, 1);
});

test('empty data clears stale preference and still commits exactly one controller', async () => {
  const harness = createTransactionHarness('daily/missing.md');

  assert.equal(await harness.render(() => Promise.resolve([])), true);

  const snapshot = harness.snapshot();
  assert.equal(snapshot.apps.length, 1);
  assert.equal(snapshot.liveControllers.length, 1);
  assert.equal(snapshot.controller.path, '');
  assert.equal(snapshot.mounts, 1);
});

test('open close and reopen invalidates old work but allows new work', async () => {
  const harness = createTransactionHarness();
  const oldGate = deferred();
  const oldRender = harness.render(() => oldGate.promise);

  harness.close();
  harness.open();
  oldGate.resolve(['daily/old.md']);
  assert.equal(await oldRender, false);

  assert.equal(await harness.render(() => Promise.resolve(['daily/new.md'])), true);

  const snapshot = harness.snapshot();
  assert.equal(snapshot.apps.length, 1);
  assert.equal(snapshot.liveControllers.length, 1);
  assert.equal(snapshot.controller.path, 'daily/new.md');
  assert.equal(snapshot.mounts, 1);
});

test('compound desktop load preserves old interactive owners until data and layout are both ready', async () => {
  const { RenderLifecycle, runRenderTransaction } = require('../src/render-lifecycle');
  const lifecycle = new RenderLifecycle();
  lifecycle.open();
  const dataGate = deferred();
  const layoutGate = deferred();
  const destroyed = [];
  const owners = {
    view: { destroy: () => destroyed.push('view') },
    layout: { destroy: () => destroyed.push('layout') },
    carousel: { path: 'daily/current.md', destroy: () => destroyed.push('carousel') },
  };
  let mounted = null;

  const pending = runRenderTransaction({
    lifecycle,
    getCurrentPath: () => owners.carousel.path,
    load: async () => {
      const [data, layout] = await Promise.all([dataGate.promise, layoutGate.promise]);
      return { data, layout };
    },
    commit(payload, preferredPath) {
      owners.view.destroy();
      owners.layout.destroy();
      owners.carousel.destroy();
      mounted = { payload, preferredPath };
      return preferredPath;
    },
  });

  dataGate.resolve({ journals: ['daily/current.md'] });
  await Promise.resolve();
  assert.deepEqual(destroyed, []);
  assert.equal(mounted, null);

  layoutGate.resolve({ sidebar: { x: 16, y: 16, scale: 1 } });
  assert.equal(await pending, true);
  assert.deepEqual(destroyed, ['view', 'layout', 'carousel']);
  assert.equal(mounted.preferredPath, 'daily/current.md');
  assert.deepEqual(mounted.payload.layout.sidebar, { x: 16, y: 16, scale: 1 });
});

test('a render that finishes after editing starts defers replacement and retains current path', async () => {
  const { RenderLifecycle, runRenderTransaction } = require('../src/render-lifecycle');
  const lifecycle = new RenderLifecycle();
  lifecycle.open();
  const gate = deferred();
  let editing = false;
  let pendingRefresh = false;
  let replacements = 0;
  let currentPath = 'daily/current.md';

  const render = (load) => runRenderTransaction({
    lifecycle,
    getCurrentPath: () => currentPath,
    load,
    commit(payload, preferredPath) {
      if (editing) {
        pendingRefresh = true;
        return preferredPath;
      }
      replacements += 1;
      currentPath = payload.journals.includes(preferredPath)
        ? preferredPath
        : payload.journals[0] || '';
      return currentPath;
    },
  });

  const first = render(() => gate.promise);
  editing = true;
  gate.resolve({ journals: ['daily/new.md', 'daily/current.md'] });
  assert.equal(await first, true);
  assert.equal(replacements, 0);
  assert.equal(pendingRefresh, true);
  assert.equal(currentPath, 'daily/current.md');

  editing = false;
  pendingRefresh = false;
  assert.equal(await render(() => Promise.resolve({ journals: ['daily/new.md', 'daily/current.md'] })), true);
  assert.equal(replacements, 1);
  assert.equal(pendingRefresh, false);
  assert.equal(currentPath, 'daily/current.md');
});
