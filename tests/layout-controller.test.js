const test = require('node:test');
const assert = require('node:assert/strict');

const { LayoutController } = require('../src/layout-controller');
const { DEFAULT_LAYOUT, cloneLayout, resizeFromPointer } = require('../src/layout-model');

class Scheduler {
  constructor() {
    this.now = 0;
    this.jobs = [];
  }

  setTimeout(fn, delay) {
    const job = { fn, at: this.now + delay, cancelled: false };
    this.jobs.push(job);
    return job;
  }

  clearTimeout(job) {
    if (job) job.cancelled = true;
  }

  advance(duration) {
    this.now += duration;
    for (const job of this.jobs.filter((candidate) => !candidate.cancelled && candidate.at <= this.now)) {
      job.cancelled = true;
      job.fn();
    }
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fixture(options = {}) {
  const scheduler = new Scheduler();
  const saved = [];
  const notices = [];
  const changes = [];
  const carousel = options.carousel || {
    pauses: [],
    resumes: [],
    pause(reason) { this.pauses.push(reason); },
    resume(reason) { this.resumes.push(reason); },
  };
  const save = options.save || (async (layout) => saved.push(layout));
  const controller = new LayoutController({
    initialLayout: cloneLayout(DEFAULT_LAYOUT),
    scheduler,
    save,
    carousel,
    onNotice: (message) => notices.push(message),
    onChange: (state, layout) => changes.push({ state, layout }),
  });
  return { scheduler, saved, notices, changes, carousel, controller };
}

test('explicit edit begins without preselecting a module', () => {
  const { controller, carousel } = fixture();
  const entry = cloneLayout(controller.layout);

  assert.equal(controller.enterEdit(), true);
  assert.equal(controller.state.mode, 'editing');
  assert.equal(controller.state.selectedId, '');
  assert.deepEqual(controller.entrySnapshot, entry);
  assert.notEqual(controller.entrySnapshot, controller.layout);
  assert.deepEqual(carousel.pauses, ['layout-edit']);
});

test('explicit edit rejects unknown preselection without pausing the carousel', () => {
  const { controller, carousel } = fixture();
  assert.equal(controller.enterEdit('unknown'), false);
  assert.equal(controller.state.mode, 'idle');
  assert.deepEqual(carousel.pauses, []);
});

test('repeated edit requests are ignored and carousel pauses once', () => {
  const { controller, carousel } = fixture();
  assert.equal(controller.enterEdit('sidebar'), true);
  assert.equal(controller.enterEdit('header'), false);
  assert.equal(controller.state.selectedId, 'sidebar');
  assert.deepEqual(carousel.pauses, ['layout-edit']);
});

test('a throwing carousel pause leaves the controller idle and compensates safely', () => {
  const carousel = {
    pauses: [],
    resumes: [],
    pause(reason) {
      this.pauses.push(reason);
      throw new Error('pause failed after mutation');
    },
    resume(reason) { this.resumes.push(reason); },
  };
  const { controller, notices } = fixture({ carousel });

  assert.equal(controller.enterEdit('sidebar'), false);
  assert.equal(controller.state.mode, 'idle');
  assert.equal(controller.editSessionActive, false);
  assert.deepEqual(carousel.pauses, ['layout-edit']);
  assert.deepEqual(carousel.resumes, ['layout-edit']);
  assert.deepEqual(notices, ['无法进入布局编辑，请重试']);
  assert.equal(controller.cancelAndExit(), false);
  assert.equal(controller.handleEscape(), false);
});

test('selection movement at 3px stays a click while movement above 3px begins a drag', () => {
  const { controller } = fixture();
  controller.enterEdit('sidebar');
  const before = cloneLayout(controller.layout);

  assert.equal(controller.startDrag('header', { x: 0, y: 0 }), true);
  assert.equal(controller.state.mode, 'editing');
  assert.equal(controller.state.selectedId, 'header');
  controller.pointerMove({ x: 3, y: 0 });
  controller.endGesture();
  assert.deepEqual(controller.layout, before);
  assert.equal(controller.undoStack.length, 0);

  controller.startDrag('header', { x: 0, y: 0 });
  controller.pointerMove({ x: 3.01, y: 0 });
  assert.equal(controller.state.mode, 'dragging');
  controller.pointerMove({ x: 20, y: 0 });
  controller.endGesture();
  assert.equal(controller.state.mode, 'editing');
  assert.equal(controller.undoStack.length, 1);
});

test('drag applies logical delta through snapMove and commits one undo snapshot only when changed', () => {
  const { controller } = fixture();
  controller.enterEdit('sidebar');
  const before = cloneLayout(controller.layout);

  controller.startDrag('sidebar', { x: 0, y: 0 });
  controller.pointerMove({ x: 80, y: 0 });
  controller.pointerMove({ x: 96, y: 16 });
  controller.endGesture();

  assert.deepEqual(controller.layout.sidebar, { x: 113, y: 32, scale: 1 });
  assert.equal(controller.undoStack.length, 1);
  controller.undo();
  assert.deepEqual(controller.layout, before);

  controller.startDrag('sidebar', { x: 0, y: 0 });
  controller.endGesture();
  assert.equal(controller.undoStack.length, 0);
});

test('resize delegates pointer delta to proportional resize math', () => {
  const { controller } = fixture();
  controller.enterEdit('journal-carousel');
  controller.startResize('journal-carousel', { x: 0, y: 0 });
  controller.pointerMove({ x: 186, y: 66 });

  assert.equal(controller.state.mode, 'resizing');
  assert.deepEqual(
    controller.layout['journal-carousel'],
    resizeFromPointer(
      'journal-carousel',
      DEFAULT_LAYOUT['journal-carousel'],
      { dx: 186, dy: 66 },
      DEFAULT_LAYOUT,
    ),
  );
  assert.equal(controller.layout['journal-carousel'].x, DEFAULT_LAYOUT['journal-carousel'].x);
  assert.equal(controller.layout['journal-carousel'].y, DEFAULT_LAYOUT['journal-carousel'].y);
  controller.endGesture();
  assert.equal(controller.undoStack.length, 1);
});

test('conflicts update during drag and resize previews', () => {
  const { controller } = fixture();
  controller.enterEdit('header');
  controller.startDrag('header', { x: 0, y: 0 });
  controller.pointerMove({ x: -338, y: 0 });
  assert.deepEqual(new Set(controller.state.conflicts), new Set(['sidebar', 'header']));
  controller.handleWindowInterruption();
  assert.deepEqual(controller.state.conflicts, []);

  controller.startResize('sidebar', { x: 0, y: 0 });
  controller.pointerMove({ x: 112, y: 760 });
  assert.ok(controller.state.conflicts.includes('sidebar'));
});

test('active snapping drag exposes exact renderable guides and clears them on completion', () => {
  const { controller, changes } = fixture();
  controller.enterEdit('sidebar');
  controller.startDrag('sidebar', { x: 0, y: 0 });
  controller.pointerMove({ x: -12, y: -12 });

  assert.deepEqual(controller.state.guides, [
    { axis: 'x', coordinate: 0, kind: 'boundary', targetId: 'canvas-x-start' },
    { axis: 'y', coordinate: 0, kind: 'boundary', targetId: 'canvas-y-start' },
  ]);
  const emitted = changes.at(-1).state.guides;
  emitted[0].coordinate = 999;
  assert.equal(controller.state.guides[0].coordinate, 0);

  controller.endGesture();
  assert.deepEqual(controller.state.guides, []);
});

test('active resize exposes the selected physical guide and interruptions clear it', () => {
  const { controller } = fixture();
  controller.enterEdit('header');
  controller.startResize('header', { x: 0, y: 0 });
  controller.pointerMove({ x: 16, y: 0 });

  assert.deepEqual(controller.state.guides, [{
    axis: 'x',
    coordinate: 1640,
    kind: 'boundary',
    targetId: 'canvas-x-end',
  }]);
  controller.handleWindowInterruption();
  assert.deepEqual(controller.state.guides, []);
});

test('gesture interruption rolls back only the current gesture and keeps editing', () => {
  const { controller, carousel } = fixture();
  controller.enterEdit('sidebar');
  controller.startDrag('sidebar', { x: 0, y: 0 });
  controller.pointerMove({ x: 80, y: 0 });
  controller.endGesture();
  const committed = cloneLayout(controller.layout);
  assert.equal(controller.undoStack.length, 1);

  controller.startDrag('sidebar', { x: 0, y: 0 });
  controller.pointerMove({ x: 160, y: 0 });
  controller.handleWindowInterruption();

  assert.equal(controller.state.mode, 'editing');
  assert.deepEqual(controller.layout, committed);
  assert.equal(controller.undoStack.length, 1);
  assert.deepEqual(carousel.resumes, []);
});

test('undo history is capped at 30 complete gestures', () => {
  const { controller } = fixture();
  controller.enterEdit('sidebar');

  for (let index = 0; index < 35; index += 1) {
    const startX = controller.layout.sidebar.x;
    controller.startDrag('sidebar', { x: 0, y: 0 });
    controller.pointerMove({ x: index % 2 === 0 ? 16 : -16, y: 0 });
    controller.endGesture();
    assert.notEqual(controller.layout.sidebar.x, startX);
  }

  assert.equal(controller.undoStack.length, 30);
});

test('restoreDefault adds one undo entry and stays editing', () => {
  const { controller, saved, carousel } = fixture();
  controller.enterEdit('sidebar');
  controller.startDrag('sidebar', { x: 0, y: 0 });
  controller.pointerMove({ x: 80, y: 0 });
  controller.endGesture();
  const adjusted = cloneLayout(controller.layout);
  const priorUndoCount = controller.undoStack.length;

  assert.equal(controller.restoreDefault(), true);
  assert.deepEqual(controller.layout, DEFAULT_LAYOUT);
  assert.equal(controller.state.mode, 'editing');
  assert.equal(controller.undoStack.length, priorUndoCount + 1);
  controller.undo();
  assert.deepEqual(controller.layout, adjusted);
  assert.deepEqual(saved, []);
  assert.deepEqual(carousel.resumes, []);
});

test('restoreDefault records the previous layout even when it already matches defaults', () => {
  const { controller } = fixture();
  controller.enterEdit('sidebar');

  assert.equal(controller.restoreDefault(), true);
  assert.equal(controller.undoStack.length, 1);
  assert.equal(controller.state.mode, 'editing');
});

test('cancel and Escape restore the entry snapshot, exit without saving, and resume once', () => {
  for (const exit of [
    (controller) => controller.cancelAndExit(),
    (controller) => controller.handleEscape(),
  ]) {
    const { controller, saved, carousel } = fixture();
    const entry = cloneLayout(controller.layout);
    controller.enterEdit('sidebar');
    controller.startDrag('sidebar', { x: 0, y: 0 });
    controller.pointerMove({ x: 80, y: 0 });
    exit(controller);

    assert.equal(controller.state.mode, 'idle');
    assert.deepEqual(controller.layout, entry);
    assert.deepEqual(saved, []);
    assert.deepEqual(carousel.resumes, ['layout-edit']);
    controller.cancelAndExit();
    controller.handleEscape();
    assert.deepEqual(carousel.resumes, ['layout-edit']);
  }
});

test('conflicts block save with the exact notice and keep editing', async () => {
  const { controller, saved, notices, carousel } = fixture();
  controller.enterEdit('sidebar');
  controller.layout.header = { ...controller.layout.sidebar };

  assert.equal(await controller.saveAndExit(), false);
  assert.equal(controller.state.mode, 'editing');
  assert.deepEqual(new Set(controller.state.conflicts), new Set(['sidebar', 'header']));
  assert.deepEqual(saved, []);
  assert.deepEqual(notices, ['存在重叠，无法保存']);
  assert.deepEqual(carousel.resumes, []);
});

test('invalid layout data blocks save after full validation', async () => {
  const { controller, saved, notices } = fixture();
  controller.enterEdit('sidebar');
  controller.layout.sidebar.x = Number.NaN;

  assert.equal(await controller.saveAndExit(), false);
  assert.equal(controller.state.mode, 'editing');
  assert.deepEqual(saved, []);
  assert.deepEqual(notices, ['布局数据无效，无法保存']);
});

test('successful save is awaited exactly once before exiting', async () => {
  const gate = deferred();
  let calls = 0;
  let received;
  const { controller, notices, carousel } = fixture({
    save: async (layout) => {
      calls += 1;
      received = layout;
      await gate.promise;
    },
  });
  controller.enterEdit('sidebar');
  const pending = controller.saveAndExit();

  assert.equal(calls, 1);
  assert.equal(controller.state.mode, 'editing');
  assert.deepEqual(carousel.resumes, []);
  gate.resolve();
  assert.equal(await pending, true);

  assert.equal(controller.state.mode, 'idle');
  assert.notEqual(received, controller.layout);
  assert.deepEqual(received, controller.layout);
  assert.deepEqual(notices, ['布局已保存到当前设备']);
  assert.deepEqual(carousel.resumes, ['layout-edit']);
});

test('successful persistence stays successful when notice resume and change callbacks throw', async () => {
  const scheduler = new Scheduler();
  const noticeAttempts = [];
  const carousel = {
    pause() {},
    resumeCalls: 0,
    resume() {
      this.resumeCalls += 1;
      throw new Error('resume view failed');
    },
  };
  let saves = 0;
  let changeAttempts = 0;
  const controller = new LayoutController({
    initialLayout: cloneLayout(DEFAULT_LAYOUT),
    scheduler,
    save: async () => { saves += 1; },
    carousel,
    onNotice(message) {
      noticeAttempts.push(message);
      throw new Error('notice view failed');
    },
    onChange() {
      changeAttempts += 1;
      throw new Error('render view failed');
    },
  });

  assert.equal(controller.enterEdit('sidebar'), true);
  assert.equal(await controller.saveAndExit(), true);
  assert.equal(saves, 1);
  assert.equal(controller.state.mode, 'idle');
  assert.equal(controller.editSessionActive, false);
  assert.equal(carousel.resumeCalls, 1);
  assert.deepEqual(noticeAttempts, ['布局已保存到当前设备']);
  assert.ok(changeAttempts >= 2);
});

test('duplicate concurrent save requests share one operation', async () => {
  const gate = deferred();
  let calls = 0;
  const { controller, carousel } = fixture({
    save: async () => {
      calls += 1;
      await gate.promise;
    },
  });
  controller.enterEdit('sidebar');

  const first = controller.saveAndExit();
  const second = controller.saveAndExit();
  assert.equal(first, second);
  assert.equal(calls, 1);
  gate.resolve();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.deepEqual(carousel.resumes, ['layout-edit']);
});

test('save rejection keeps the in-memory edit and allows a retry', async () => {
  let calls = 0;
  const { controller, notices, carousel } = fixture({
    save: async () => {
      calls += 1;
      if (calls === 1) throw new Error('disk full');
    },
  });
  controller.enterEdit('sidebar');
  controller.startDrag('sidebar', { x: 0, y: 0 });
  controller.pointerMove({ x: 0, y: 900 });
  controller.endGesture();
  const edited = cloneLayout(controller.layout);

  assert.equal(await controller.saveAndExit(), false);
  assert.equal(controller.state.mode, 'editing');
  assert.deepEqual(controller.layout, edited);
  assert.deepEqual(notices, ['布局保存失败，请重试或取消']);
  assert.deepEqual(carousel.resumes, []);

  assert.equal(await controller.saveAndExit(), true);
  assert.equal(calls, 2);
  assert.deepEqual(carousel.resumes, ['layout-edit']);
});

test('onChange receives useful detached state and layout snapshots', () => {
  const { controller, changes } = fixture();
  controller.enterEdit('sidebar');
  const latest = changes.at(-1);
  assert.equal(latest.state.mode, 'editing');
  assert.equal(latest.state.canUndo, false);
  assert.equal(latest.state.saving, false);
  assert.deepEqual(latest.layout, controller.layout);

  latest.state.conflicts.push('poison');
  latest.state.guides.push({ poison: true });
  latest.layout.sidebar.x = 999;
  assert.deepEqual(controller.state.conflicts, []);
  assert.deepEqual(controller.state.guides, []);
  assert.equal(controller.layout.sidebar.x, DEFAULT_LAYOUT.sidebar.x);
});

test('destroy rolls back an active gesture, balances carousel, and neutralizes callbacks', async () => {
  const { controller, saved, notices, changes, carousel } = fixture();
  controller.enterEdit('sidebar');
  controller.startDrag('sidebar', { x: 0, y: 0 });
  controller.pointerMove({ x: 80, y: 0 });
  const changeCount = changes.length;

  controller.destroy();
  controller.destroy();

  assert.equal(controller.state.mode, 'idle');
  assert.deepEqual(carousel.resumes, ['layout-edit']);
  controller.enterEdit('header');
  controller.pointerMove({ x: 300, y: 300 });
  controller.restoreDefault();
  controller.cancelAndExit();
  assert.equal(await controller.saveAndExit(), false);
  assert.equal(changes.length, changeCount);
  assert.deepEqual(saved, []);
  assert.deepEqual(notices, []);
});
