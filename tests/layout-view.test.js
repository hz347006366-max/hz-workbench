const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const { LayoutView } = require('../src/layout-view');
const { DEFAULT_LAYOUT, MODULE_DEFINITIONS } = require('../src/layout-model');

function dispatchPointer(windowRef, target, type, overrides = {}) {
  const event = new windowRef.Event(type, { bubbles: true, cancelable: true });
  const values = {
    pointerId: 7,
    pointerType: 'mouse',
    button: 0,
    clientX: 120,
    clientY: 90,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  };
  for (const [name, value] of Object.entries(values)) {
    Object.defineProperty(event, name, { configurable: true, value });
  }
  target.dispatchEvent(event);
  return event;
}

function assertPoint(actual, expected) {
  assert.ok(Math.abs(actual.x - expected.x) < 1e-9, `${actual.x} != ${expected.x}`);
  assert.ok(Math.abs(actual.y - expected.y) < 1e-9, `${actual.y} != ${expected.y}`);
}

function fakeController() {
  const calls = {
    enterEdit: 0,
    arm: [],
    startDrag: [],
    startResize: [],
    pointerMove: [],
    endGesture: 0,
    interrupt: 0,
    saveAndExit: 0,
    undo: 0,
    restoreDefault: 0,
    cancelAndExit: 0,
    escape: 0,
  };
  return {
    state: { mode: 'idle', selectedId: '', conflicts: [], guides: [] },
    layout: DEFAULT_LAYOUT,
    saving: false,
    calls,
    enterEdit() { calls.enterEdit += 1; return true; },
    arm(value) { calls.arm.push(value); return true; },
    startDrag(id, point) { calls.startDrag.push([id, point]); return true; },
    startResize(id, point) { calls.startResize.push([id, point]); return true; },
    pointerMove(point) { calls.pointerMove.push(point); return true; },
    endGesture() { calls.endGesture += 1; return true; },
    handleWindowInterruption() { calls.interrupt += 1; return true; },
    saveAndExit() { calls.saveAndExit += 1; return Promise.resolve(true); },
    undo() { calls.undo += 1; },
    restoreDefault() { calls.restoreDefault += 1; },
    cancelAndExit() { calls.cancelAndExit += 1; },
    handleEscape() { calls.escape += 1; },
  };
}

function setup() {
  const dom = new JSDOM(`
    <div id="viewport">
      <div id="stage">
        <main data-layout-canvas>
          <section data-module-id="sidebar">
            <div class="hz-layout-content">
              <div class="module-body">body</div>
              <button>interactive</button>
              <div class="task-list-item">task</div>
              <div data-layout-scrollbar>scrollbar</div>
              <div class="native-scroll">native scrollbar</div>
            </div>
          </section>
          <section data-module-id="header">
            <div class="hz-layout-content"><div class="header-body">header</div></div>
          </section>
        </main>
      </div>
    </div>
  `);
  const { document } = dom.window;
  const viewport = document.querySelector('#viewport');
  const stage = document.querySelector('#stage');
  const canvas = document.querySelector('[data-layout-canvas]');
  const controller = fakeController();
  const icons = [];
  Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 900 });
  canvas.getBoundingClientRect = () => ({ left: 20, top: 10, width: 1440, height: 900 });

  const observers = [];
  dom.window.ResizeObserver = class FakeResizeObserver {
    constructor(callback) { this.callback = callback; this.observed = []; this.disconnected = false; observers.push(this); }
    observe(element) { this.observed.push(element); }
    disconnect() { this.disconnected = true; }
    fire() { this.callback([{ target: viewport }]); }
  };

  const view = new LayoutView({
    viewport,
    stage,
    canvas,
    controller,
    moduleDefinitions: {
      sidebar: MODULE_DEFINITIONS.sidebar,
      header: MODULE_DEFINITIONS.header,
    },
    renderIcon(element, iconName) {
      icons.push({ element, iconName });
      element.dataset.renderedIcon = iconName;
    },
    windowRef: dom.window,
  });
  view.mount();
  return {
    dom,
    viewport,
    stage,
    canvas,
    controller,
    view,
    observers,
    icons,
    body: document.querySelector('.module-body'),
    button: document.querySelector('button'),
    task: document.querySelector('.task-list-item'),
    scrollbar: document.querySelector('[data-layout-scrollbar]'),
    nativeScroll: document.querySelector('.native-scroll'),
    sidebar: document.querySelector('[data-module-id="sidebar"]'),
  };
}

test('idle module pointerdown never arms layout editing', () => {
  const context = setup();
  try {
    for (const target of [context.button, context.task, context.scrollbar, context.body]) {
      dispatchPointer(context.dom.window, target, 'pointerdown');
    }
    assert.equal(context.controller.calls.arm.length, 0);
    assert.equal(context.controller.calls.enterEdit, 0);
  } finally {
    context.view.destroy();
    context.dom.window.close();
  }
});

test('viewport lock unlocks explicitly then requests save and renders stateful icons', () => {
  const context = setup();
  try {
    const lock = context.viewport.querySelector(':scope > .hz-layout-lock');
    assert.ok(lock);
    assert.equal(context.canvas.contains(lock), false);
    assert.equal(lock.dataset.layoutState, 'locked');
    assert.equal(lock.getAttribute('aria-pressed'), 'false');
    assert.equal(lock.getAttribute('aria-label'), '解锁自由布局');
    assert.equal(lock.title, '解锁自由布局');
    assert.equal(lock.dataset.renderedIcon, 'lock');

    lock.click();
    assert.equal(context.controller.calls.enterEdit, 1);
    context.controller.state.mode = 'editing';
    context.view.render(context.controller.state, DEFAULT_LAYOUT);
    assert.equal(lock.dataset.layoutState, 'unlocked');
    assert.equal(lock.getAttribute('aria-pressed'), 'true');
    assert.equal(lock.getAttribute('aria-label'), '锁定并保存自由布局');
    assert.equal(lock.dataset.renderedIcon, 'lock-open');

    lock.click();
    assert.equal(context.controller.calls.saveAndExit, 1);
  } finally {
    context.view.destroy();
    context.dom.window.close();
  }
});

test('save, conflict, and Escape states keep the lock lifecycle accurate', () => {
  const context = setup();
  try {
    const lock = context.viewport.querySelector('.hz-layout-lock');
    context.controller.state.mode = 'editing';
    context.controller.saving = true;
    context.view.render({ ...context.controller.state, saving: true }, DEFAULT_LAYOUT);
    assert.equal(lock.dataset.layoutState, 'saving');
    assert.equal(lock.disabled, true);
    assert.equal(lock.getAttribute('aria-label'), '正在保存自由布局');
    lock.click();
    assert.equal(context.controller.calls.saveAndExit, 0);

    context.controller.saving = false;
    context.view.render({ ...context.controller.state, conflicts: ['sidebar'] }, DEFAULT_LAYOUT);
    assert.equal(lock.dataset.layoutState, 'unlocked', 'save rejection or conflict keeps editing unlocked');
    assert.equal(lock.disabled, false);

    context.dom.window.dispatchEvent(new context.dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.equal(context.controller.calls.escape, 1);
    context.controller.state.mode = 'idle';
    context.view.render(context.controller.state, DEFAULT_LAYOUT);
    assert.equal(lock.dataset.layoutState, 'locked');
  } finally {
    context.view.destroy();
    context.dom.window.close();
  }
});

test('editing module starts pending drag while selected handle starts resize', () => {
  const context = setup();
  try {
    const captures = [];
    context.sidebar.setPointerCapture = (pointerId) => captures.push(['set', pointerId]);
    context.sidebar.releasePointerCapture = (pointerId) => captures.push(['release', pointerId]);
    context.controller.state.mode = 'editing';
    context.view.render({ ...context.controller.state, selectedId: 'sidebar' }, DEFAULT_LAYOUT);
    dispatchPointer(context.dom.window, context.body, 'pointerdown', { clientX: 88, clientY: 44 });
    assert.equal(context.controller.calls.startDrag.length, 1);
    assert.equal(context.controller.calls.startDrag[0][0], 'sidebar');
    assertPoint(context.controller.calls.startDrag[0][1], { x: 100, y: 50 });
    dispatchPointer(context.dom.window, context.canvas, 'pointerup');
    assert.deepEqual(captures, [['set', 7], ['release', 7]]);

    const handle = context.canvas.querySelector('.hz-resize-handle');
    dispatchPointer(context.dom.window, handle, 'pointerdown', { clientX: 156, clientY: 78, pointerId: 8 });
    assert.equal(context.controller.calls.startResize.length, 1);
    assert.equal(context.controller.calls.startResize[0][0], 'sidebar');
    assertPoint(context.controller.calls.startResize[0][1], { x: 200, y: 100 });
    dispatchPointer(context.dom.window, context.canvas, 'pointercancel', { pointerId: 8 });
    assert.equal(context.controller.calls.interrupt, 1);
    assert.deepEqual(captures, [
      ['set', 7], ['release', 7],
      ['set', 8], ['release', 8],
    ]);
  } finally {
    context.view.destroy();
    context.dom.window.close();
  }
});

test('canvas, module, child, chrome, guide, and viewport toolbar clicks never request save', () => {
  const context = setup();
  try {
    let businessClicks = 0;
    context.body.addEventListener('click', () => { businessClicks += 1; });
    context.body.click();
    assert.equal(businessClicks, 1, 'normal mode preserves business click bubbling');

    context.controller.state.mode = 'editing';
    context.view.render({
      ...context.controller.state,
      selectedId: 'sidebar',
      guides: [{ axis: 'x', coordinate: 32, kind: 'grid' }],
    }, DEFAULT_LAYOUT);

    context.body.click();
    assert.equal(businessClicks, 1, 'editing mode blocks business click bubbling');
    context.canvas.querySelector('.hz-layout-label').click();
    context.canvas.querySelector('.hz-snap-guide').click();
    const toolbar = context.viewport.querySelector(':scope > .hz-layout-toolbar');
    assert.ok(toolbar);
    assert.equal(context.canvas.contains(toolbar), false);
    toolbar.click();
    assert.equal(context.controller.calls.saveAndExit, 0);

    context.canvas.dispatchEvent(new context.dom.window.MouseEvent('click', { bubbles: true }));
    assert.equal(context.controller.calls.saveAndExit, 0);
  } finally {
    context.view.destroy();
    context.dom.window.close();
  }
});

test('editing chrome contains every label, one selected handle, viewport toolbar actions, guides, and conflict hooks', () => {
  const context = setup();
  try {
    context.view.render({
      mode: 'editing',
      selectedId: 'sidebar',
      conflicts: ['header'],
      guides: [
        { axis: 'x', coordinate: 144, kind: 'edge', label: '居中' },
        { axis: 'y', coordinate: 238, kind: 'gap', label: '16' },
      ],
      canUndo: true,
    }, DEFAULT_LAYOUT);
    assert.equal(context.canvas.querySelectorAll('.hz-layout-label').length, 2);
    assert.equal(context.canvas.querySelectorAll('.hz-resize-handle').length, 1);
    assert.equal(context.canvas.querySelector('.hz-resize-handle').closest('[data-module-id]').dataset.moduleId, 'sidebar');
    assert.ok(context.canvas.querySelector('[data-module-id="header"].is-conflicting'));
    assert.ok(context.canvas.querySelector('[data-module-id="header"] .hz-conflict-stripes'));
    assert.equal(context.canvas.querySelectorAll('.hz-snap-guide').length, 2);
    assert.match(context.canvas.querySelector('.hz-snap-guide-label').textContent, /居中|16/);

    const toolbar = context.viewport.querySelector(':scope > .hz-layout-toolbar');
    assert.ok(toolbar);
    assert.equal(toolbar.parentElement, context.viewport);
    assert.equal(toolbar.closest('[data-layout-canvas]'), null, 'toolbar must not inherit the canvas transform');
    const lock = context.viewport.querySelector(':scope > .hz-layout-lock');
    assert.equal(context.viewport.firstElementChild, lock, 'persistent lock stays first at viewport level');
    assert.equal(lock.nextElementSibling, toolbar);
    assert.equal(toolbar.nextElementSibling, context.stage);
    assert.equal(context.canvas.querySelector('.hz-layout-toolbar'), null);
    assert.match(toolbar.textContent, /关锁保存/);
    let viewportClicks = 0;
    context.viewport.addEventListener('click', () => { viewportClicks += 1; });
    toolbar.click();
    assert.equal(viewportClicks, 0, 'toolbar isolates overlay clicks from its scroll container');
    toolbar.querySelector('[data-layout-action="undo"]').click();
    toolbar.querySelector('[data-layout-action="default"]').click();
    toolbar.querySelector('[data-layout-action="cancel"]').click();
    assert.equal(context.controller.calls.undo, 1);
    assert.equal(context.controller.calls.restoreDefault, 1);
    assert.equal(context.controller.calls.cancelAndExit, 1);

    context.view.render({ mode: 'idle', selectedId: '', conflicts: [], guides: [] }, DEFAULT_LAYOUT);
    for (const selector of [
      '.hz-layout-label', '.hz-resize-handle', '.hz-layout-toolbar',
      '.hz-snap-guide', '.hz-conflict-stripes',
    ]) assert.equal(context.viewport.querySelector(selector), null, selector);
    assert.ok(context.viewport.querySelector('.hz-layout-lock'));
    assert.equal(context.canvas.querySelector('.is-conflicting'), null);
  } finally {
    context.view.destroy();
    context.dom.window.close();
  }
});

test('applyLayout uses logical rectangles and a single proportional content transform', () => {
  const context = setup();
  try {
    const layout = {
      ...DEFAULT_LAYOUT,
      sidebar: { x: 80, y: 96, scale: 1.25 },
      header: { x: 200, y: 20, scale: 0.8 },
    };
    context.view.applyLayout(layout);
    assert.equal(context.sidebar.style.left, '80px');
    assert.equal(context.sidebar.style.top, '96px');
    assert.equal(context.sidebar.style.width, '140px');
    assert.equal(context.sidebar.style.height, '140px');
    const content = context.sidebar.querySelector('.hz-layout-content');
    assert.equal(content.style.width, '112px');
    assert.equal(content.style.height, '112px');
    assert.equal(content.style.transform, 'scale(1.25)');
    assert.equal(content.style.transformOrigin, 'top left');
  } finally {
    context.view.destroy();
    context.dom.window.close();
  }
});

test('applyViewScale clamps at .68 and sizes stage from computed canvas height', () => {
  const context = setup();
  try {
    Object.defineProperty(context.viewport, 'clientWidth', { configurable: true, value: 600 });
    context.view.applyViewScale(DEFAULT_LAYOUT);
    assert.equal(context.canvas.style.width, '1640px');
    assert.equal(context.canvas.style.transform, 'scale(0.68)');
    assert.equal(context.canvas.style.getPropertyValue('--hz-layout-view-scale'), '0.68');
    assert.ok(Math.abs(Number(context.canvas.style.getPropertyValue('--hz-layout-inverse-scale')) - (1 / 0.68)) < 1e-12);
    assert.equal(context.stage.style.width, '1115.2px');
    assert.equal(context.stage.style.height, '636.48px');
  } finally {
    context.view.destroy();
    context.dom.window.close();
  }
});

test('applyViewScale keeps the desktop canvas at its logical width in wide viewports', () => {
  const context = setup();
  try {
    Object.defineProperty(context.viewport, 'clientWidth', { configurable: true, value: 1920 });
    context.view.applyViewScale(DEFAULT_LAYOUT);
    assert.equal(context.canvas.style.transform, 'scale(1)');
    assert.equal(context.stage.style.width, '1640px');
  } finally {
    context.view.destroy();
    context.dom.window.close();
  }
});

test('editing makes business contents inert and uses valid current-module semantics until exit', () => {
  const context = setup();
  try {
    const contents = [...context.canvas.querySelectorAll('.hz-layout-content')];
    assert.ok(contents.every((content) => !content.hasAttribute('inert')));

    context.view.render({ mode: 'editing', selectedId: 'sidebar', conflicts: [], guides: [] }, DEFAULT_LAYOUT);
    assert.ok(contents.every((content) => content.hasAttribute('inert')));
    assert.equal(context.sidebar.getAttribute('aria-current'), 'true');
    assert.equal(context.sidebar.hasAttribute('aria-selected'), false);
    assert.equal(context.canvas.querySelector('[data-module-id="header"]').hasAttribute('aria-current'), false);

    context.view.render({ mode: 'idle', selectedId: '', conflicts: [], guides: [] }, DEFAULT_LAYOUT);
    assert.ok(contents.every((content) => !content.hasAttribute('inert')));
    assert.equal(context.sidebar.hasAttribute('aria-current'), false);
  } finally {
    context.view.destroy();
    context.dom.window.close();
  }
});

test('resize observer and window events interrupt before rescaling, and Escape cancels', () => {
  const context = setup();
  try {
    context.controller.state.mode = 'editing';
    dispatchPointer(context.dom.window, context.body, 'pointerdown');
    context.controller.calls.interrupt = 0;
    const sequence = [];
    context.controller.handleWindowInterruption = () => { sequence.push('interrupt'); context.controller.calls.interrupt += 1; };
    const originalApply = context.view.applyViewScale.bind(context.view);
    context.view.applyViewScale = (layout) => { sequence.push('scale'); return originalApply(layout); };
    context.observers[0].fire();
    assert.deepEqual(sequence, ['interrupt', 'scale']);

    dispatchPointer(context.dom.window, context.body, 'pointerdown', { pointerId: 8 });
    context.dom.window.dispatchEvent(new context.dom.window.Event('resize'));
    assert.deepEqual(sequence.slice(-2), ['interrupt', 'scale']);
    dispatchPointer(context.dom.window, context.body, 'pointerdown', { pointerId: 9 });
    context.dom.window.dispatchEvent(new context.dom.window.Event('blur'));
    context.dom.window.dispatchEvent(new context.dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.equal(context.controller.calls.escape, 1);
    assert.equal(context.controller.calls.interrupt, 3);
  } finally {
    context.view.destroy();
    context.dom.window.close();
  }
});

test('editing Escape is captured before global hotkeys while idle Escape remains untouched', () => {
  const context = setup();
  try {
    let globalEscapeCalls = 0;
    context.dom.window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') globalEscapeCalls += 1;
    });

    context.controller.state.mode = 'editing';
    const editingEscape = new context.dom.window.KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    context.body.dispatchEvent(editingEscape);
    assert.equal(context.controller.calls.escape, 1);
    assert.equal(editingEscape.defaultPrevented, true);
    assert.equal(globalEscapeCalls, 0, 'editing Escape must not reach Obsidian global hotkeys');

    context.controller.state.mode = 'idle';
    const idleEscape = new context.dom.window.KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    context.body.dispatchEvent(idleEscape);
    assert.equal(context.controller.calls.escape, 1);
    assert.equal(idleEscape.defaultPrevented, false);
    assert.equal(globalEscapeCalls, 1, 'idle Escape remains available to Obsidian');
  } finally {
    context.view.destroy();
    context.dom.window.close();
  }
});

test('destroy is idempotent, interrupts an active gesture, removes only owned chrome and listeners', () => {
  const context = setup();
  context.controller.state.mode = 'editing';
  context.view.render({ ...context.controller.state, selectedId: 'sidebar' }, DEFAULT_LAYOUT);
  dispatchPointer(context.dom.window, context.body, 'pointerdown');
  const businessNode = context.body;
  const detachedLock = context.viewport.querySelector('.hz-layout-lock');
  context.controller.calls.interrupt = 0;

  context.view.destroy();
  context.view.destroy();

  assert.equal(context.controller.calls.interrupt, 1);
  assert.equal(context.observers[0].disconnected, true);
  assert.ok(context.canvas.contains(businessNode));
  assert.equal(context.viewport.querySelector('.hz-layout-toolbar'), null);
  assert.equal(context.viewport.querySelector('.hz-layout-lock'), null);
  assert.equal(context.sidebar.querySelector('.hz-layout-content').hasAttribute('inert'), false);
  dispatchPointer(context.dom.window, context.body, 'pointerdown');
  assert.equal(context.controller.calls.startDrag.length, 1);
  detachedLock.click();
  assert.equal(context.controller.calls.saveAndExit, 0);
  context.dom.window.close();
});
