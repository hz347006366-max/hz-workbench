const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const { LayoutController } = require('../src/layout-controller');
const { LayoutView } = require('../src/layout-view');
const { LayoutStore } = require('../src/layout-store');
const {
  DEFAULT_LAYOUT,
  MODULE_DEFINITIONS,
  cloneLayout,
} = require('../src/layout-model');

const mainSource = fs.readFileSync(path.resolve(__dirname, '../src/main.js'), 'utf8');

function loadProductionMain({ Notice = class {}, consoleRef = console } = {}) {
  const module = { exports: {} };
  class ItemView {
    constructor(leaf) {
      this.leaf = leaf;
      this.app = leaf?.app;
      this.containerEl = leaf?.containerEl;
      this.contentEl = leaf?.contentEl;
    }

    registerEvent(eventRef) {
      this.registeredEvents ||= [];
      this.registeredEvents.push(eventRef);
      return eventRef;
    }
  }
  const obsidian = {
    Plugin: class {},
    ItemView,
    PluginSettingTab: class {},
    Setting: class {},
    Notice,
    TFile: class {},
    TFolder: class {},
    Platform: { isDesktopApp: true },
    normalizePath: (value) => value,
    setIcon: (element, name) => { element.dataset.icon = name; },
  };
  const localRequire = (request) => request === 'obsidian'
    ? obsidian
    : require(path.resolve(__dirname, '../src', request));
  vm.runInNewContext(mainSource, {
    module,
    exports: module.exports,
    require: localRequire,
    window: {},
    console: consoleRef,
  });
  return { exports: module.exports, obsidian };
}

test('production WorkbenchView is exposed to the executable integration harness', () => {
  const { exports } = loadProductionMain();
  assert.equal(typeof exports.WorkbenchView, 'function');
});

const MODULE_IDS = Object.keys(MODULE_DEFINITIONS);
const DEVICE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

class Scheduler {
  constructor() {
    this.now = 0;
    this.jobs = [];
  }

  setTimeout(fn, delay) {
    const job = { at: this.now + delay, fn, cancelled: false };
    this.jobs.push(job);
    return job;
  }

  clearTimeout(job) {
    if (job) job.cancelled = true;
  }

  advance(milliseconds) {
    this.now += milliseconds;
    for (;;) {
      const job = this.jobs
        .filter((candidate) => !candidate.cancelled && candidate.at <= this.now)
        .sort((a, b) => a.at - b.at)[0];
      if (!job) break;
      job.cancelled = true;
      job.fn();
    }
  }
}

class MemoryAdapter {
  constructor() {
    this.files = new Map();
    this.folders = new Set();
  }

  async exists(target) { return this.files.has(target) || this.folders.has(target); }
  async mkdir(target) { this.folders.add(target); }
  async read(target) {
    if (!this.files.has(target)) throw new Error(`missing ${target}`);
    return this.files.get(target);
  }
  async write(target, value) { this.files.set(target, value); }
  async rename(from, to) {
    this.files.set(to, this.files.get(from));
    this.files.delete(from);
  }
  async remove(target) { this.files.delete(target); }
  getResourcePath(target) { return target; }
}

function localStorageForDevice() {
  const values = new Map([['hz-workbench:device-id:v1', DEVICE_ID]]);
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
}

function dispatchPointer(windowRef, target, type, overrides = {}) {
  const event = new windowRef.Event(type, { bubbles: true, cancelable: true });
  const values = {
    pointerId: 17,
    pointerType: 'mouse',
    button: 0,
    clientX: 20,
    clientY: 20,
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

function layoutDom() {
  const shells = MODULE_IDS.map((id) => `
    <section class="hz-layout-module" data-module-id="${id}">
      <div class="hz-layout-content"><span>${id}</span></div>
    </section>`).join('');
  const dom = new JSDOM(`<div id="viewport"><div id="stage"><main data-layout-canvas>${shells}</main></div></div>`);
  const { document } = dom.window;
  const viewport = document.querySelector('#viewport');
  const stage = document.querySelector('#stage');
  const canvas = document.querySelector('[data-layout-canvas]');
  Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 1440 });
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1440, bottom: 900, width: 1440, height: 900 });
  dom.window.ResizeObserver = class {
    constructor(callback) { this.callback = callback; }
    observe() {}
    disconnect() {}
  };
  return { dom, viewport, stage, canvas };
}

function mountLayoutRuntime({ initialLayout, store, saved, carousel, scheduler = new Scheduler() }) {
  const nodes = layoutDom();
  let view;
  const controller = new LayoutController({
    initialLayout,
    scheduler,
    save: async (layout) => {
      saved.push(cloneLayout(layout));
      await store.save(layout);
    },
    carousel,
    onChange: (state, layout) => view?.render(state, layout),
  });
  view = new LayoutView({
    ...nodes,
    controller,
    moduleDefinitions: MODULE_DEFINITIONS,
    renderIcon: (element, iconName) => { element.dataset.icon = iconName; },
    windowRef: nodes.dom.window,
  });
  view.mount();
  view.render(controller.state, controller.layout);
  return { ...nodes, scheduler, controller, view };
}

function shell(runtime, id) {
  return runtime.canvas.querySelector(`[data-module-id="${id}"]`);
}

async function flushPromises() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

test('real pointer workflow persists one valid snapped proportional layout and remounts it exactly', async () => {
  const adapter = new MemoryAdapter();
  const store = new LayoutStore({
    adapter,
    configDir: '.obsidian',
    localStorage: localStorageForDevice(),
    now: () => '2026-08-10T00:00:00.000Z',
  });
  const saved = [];
  const carousel = {
    pauses: [],
    resumes: [],
    pause(reason) { this.pauses.push(reason); },
    resume(reason) { this.resumes.push(reason); },
  };
  const runtime = mountLayoutRuntime({
    initialLayout: await store.load(),
    store,
    saved,
    carousel,
  });

  try {
    const sidebarBody = shell(runtime, 'sidebar').querySelector('.hz-layout-content span');
    dispatchPointer(runtime.dom.window, sidebarBody, 'pointerdown', { pointerId: 1, clientX: 20, clientY: 20 });
    runtime.scheduler.advance(500);
    assert.equal(runtime.controller.state.mode, 'idle');
    assert.equal(runtime.canvas.querySelectorAll('.hz-long-press-progress').length, 0);

    const lock = runtime.viewport.querySelector('.hz-layout-lock');
    assert.equal(lock.dataset.layoutState, 'locked');
    lock.click();
    assert.equal(runtime.controller.state.mode, 'editing');
    assert.equal(runtime.controller.state.selectedId, '');
    assert.deepEqual(carousel.pauses, ['layout-edit']);

    dispatchPointer(runtime.dom.window, sidebarBody, 'pointerdown', { pointerId: 2, clientX: 20, clientY: 20 });
    dispatchPointer(runtime.dom.window, runtime.dom.window, 'pointermove', { pointerId: 2, clientX: 4, clientY: 20 });
    dispatchPointer(runtime.dom.window, runtime.dom.window, 'pointerup', { pointerId: 2, clientX: 4, clientY: 20 });
    assert.deepEqual(runtime.controller.layout.sidebar, { x: 0, y: 16, scale: 1 });
    assert.equal(runtime.controller.layout.sidebar.x % 8, 0);

    const handle = shell(runtime, 'sidebar').querySelector('.hz-resize-handle');
    assert.ok(handle);
    dispatchPointer(runtime.dom.window, handle, 'pointerdown', { pointerId: 3, clientX: 112, clientY: 776 });
    dispatchPointer(runtime.dom.window, runtime.dom.window, 'pointermove', { pointerId: 3, clientX: 132, clientY: 796 });
    dispatchPointer(runtime.dom.window, runtime.dom.window, 'pointerup', { pointerId: 3, clientX: 132, clientY: 796 });
    assert.deepEqual(runtime.controller.layout.sidebar, { x: 0, y: 16, scale: 8 / 7 });
    const sidebarDefinition = MODULE_DEFINITIONS.sidebar;
    assert.equal(
      (sidebarDefinition.baseWidth * runtime.controller.layout.sidebar.scale)
        / (sidebarDefinition.baseHeight * runtime.controller.layout.sidebar.scale),
      sidebarDefinition.baseWidth / sidebarDefinition.baseHeight,
    );

    const headerBody = shell(runtime, 'header').querySelector('.hz-layout-content');
    dispatchPointer(runtime.dom.window, headerBody, 'pointerdown', { pointerId: 4, clientX: 200, clientY: 30 });
    dispatchPointer(runtime.dom.window, runtime.dom.window, 'pointermove', { pointerId: 4, clientX: -138, clientY: 30 });
    dispatchPointer(runtime.dom.window, runtime.dom.window, 'pointerup', { pointerId: 4, clientX: -138, clientY: 30 });
    assert.deepEqual(runtime.controller.layout.header, { x: 0, y: 16, scale: 1 });
    assert.deepEqual(new Set(runtime.controller.state.conflicts), new Set(['sidebar', 'header']));

    runtime.canvas.dispatchEvent(new runtime.dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await flushPromises();
    assert.equal(saved.length, 0);
    assert.equal(runtime.controller.state.mode, 'editing');

    runtime.viewport.querySelector('[data-layout-action="undo"]').click();
    assert.deepEqual(runtime.controller.layout.header, DEFAULT_LAYOUT.header);
    assert.deepEqual(runtime.controller.state.conflicts, []);
    lock.click();
    await flushPromises();
    assert.equal(saved.length, 1);
    assert.equal(runtime.controller.state.mode, 'idle');
    assert.deepEqual(carousel.resumes, ['layout-edit']);
    assert.equal(runtime.canvas.classList.contains('is-layout-editing'), false);
    assert.equal(runtime.viewport.querySelector('[data-layout-view-owned="true"]'), null);
    assert.ok([...runtime.canvas.querySelectorAll('.hz-layout-content')].every((content) => !content.hasAttribute('inert')));

    const loaded = await store.load();
    assert.deepEqual(loaded.sidebar, { x: 0, y: 16, scale: 8 / 7 });
    assert.deepEqual(loaded.header, DEFAULT_LAYOUT.header);

    const remounted = mountLayoutRuntime({ initialLayout: loaded, store, saved, carousel });
    try {
      assert.deepEqual(remounted.controller.layout.sidebar, { x: 0, y: 16, scale: 8 / 7 });
      assert.equal(shell(remounted, 'sidebar').style.left, '0px');
      assert.equal(shell(remounted, 'sidebar').querySelector('.hz-layout-content').style.transform, `scale(${8 / 7})`);

      remounted.controller.enterEdit('header');
      const originalHeader = cloneLayout(remounted.controller.layout).header;
      const originalSidebar = cloneLayout(remounted.controller.layout).sidebar;

      const assertInterruptionRollback = (eventName, pointerId) => {
        const body = shell(remounted, 'header').querySelector('.hz-layout-content');
        dispatchPointer(remounted.dom.window, body, 'pointerdown', { pointerId, clientX: 200, clientY: 30 });
        dispatchPointer(remounted.dom.window, remounted.dom.window, 'pointermove', { pointerId, clientX: 216, clientY: 46 });
        assert.notDeepEqual(remounted.controller.layout.header, originalHeader);
        if (eventName === 'pointercancel') {
          dispatchPointer(remounted.dom.window, remounted.dom.window, eventName, { pointerId, clientX: 216, clientY: 46 });
        } else {
          remounted.dom.window.dispatchEvent(new remounted.dom.window.Event(eventName));
        }
        assert.deepEqual(remounted.controller.layout.header, originalHeader);
        assert.deepEqual(remounted.controller.layout.sidebar, originalSidebar);
        assert.equal(remounted.controller.state.mode, 'editing');
        assert.equal(remounted.controller.undoStack.length, 0);
      };

      assertInterruptionRollback('resize', 5);
      assertInterruptionRollback('blur', 6);
      assertInterruptionRollback('pointercancel', 7);
      remounted.controller.cancelAndExit();
    } finally {
      remounted.view.destroy();
      remounted.controller.destroy();
      remounted.dom.window.close();
    }

    assert.deepEqual(carousel.pauses, ['layout-edit', 'layout-edit']);
    assert.deepEqual(carousel.resumes, ['layout-edit', 'layout-edit']);
  } finally {
    runtime.view.destroy();
    runtime.controller.destroy();
    runtime.dom.window.close();
  }
});

function installDomHelpers(windowRef) {
  const { Element } = windowRef;
  Element.prototype.createEl = function createEl(tag, options = {}) {
    const element = this.ownerDocument.createElement(tag);
    if (options.cls) element.className = options.cls;
    if (options.text != null) element.textContent = String(options.text);
    this.appendChild(element);
    return element;
  };
  Element.prototype.setText = function setText(value) { this.textContent = String(value); };
  Element.prototype.appendText = function appendText(value) { this.append(String(value)); };
  Element.prototype.empty = function empty() { this.replaceChildren(); };
  Element.prototype.addClass = function addClass(...names) { this.classList.add(...names); };
}

function emptyData() {
  return {
    journals: [],
    tasks: [],
    todayFile: null,
    projects: [],
    schedules: [],
    todayTasks: [],
    dates: [],
    counts: new Map(),
  };
}

function journal(date, suffix = date) {
  return {
    date,
    meditation: `Meditation ${suffix}`,
    cover: `https://example.test/${suffix}.jpg`,
    file: { path: `daily/${suffix}.md` },
  };
}

function journalsFor(year, month, count) {
  return Array.from({ length: count }, (_, index) => {
    const day = String(index + 1).padStart(2, '0');
    return journal(`${year}-${month}-${day}`);
  });
}

function workbenchFixture({
  desktop = true,
  copilotEnabled = true,
  commandAvailable = true,
  commandThrows = false,
  commandReturnsFalse = false,
} = {}) {
  const dom = new JSDOM('<div id="container"><div id="content"></div></div>');
  installDomHelpers(dom.window);
  Object.defineProperty(dom.window, 'ResizeObserver', {
    configurable: true,
    value: class { observe() {} disconnect() {} },
  });
  const adapter = new MemoryAdapter();
  const workspaceCallbacks = new Map();
  const commandCalls = [];
  const notices = [];
  const errors = [];
  const copilotCommand = commandAvailable ? { id: 'copilot:agent-chat-open-window' } : undefined;
  const app = {
    vault: {
      adapter,
      configDir: '.obsidian',
      getMarkdownFiles: () => [],
      getAbstractFileByPath: () => null,
      on: () => () => {},
    },
    metadataCache: {
      getFileCache: () => null,
      getFirstLinkpathDest: () => null,
      on: () => () => {},
    },
    plugins: {
      enabledPlugins: new Set(copilotEnabled ? ['copilot'] : []),
    },
    commands: {
      commands: copilotCommand ? { [copilotCommand.id]: copilotCommand } : {},
      executeCommandById: async (commandId) => {
        commandCalls.push(commandId);
        if (commandThrows) throw new Error('command failed');
        return commandReturnsFalse ? false : true;
      },
    },
    workspace: {
      getLeaf: () => ({ openFile: () => {} }),
      getLeavesOfType: () => [],
      on: (name, callback) => {
        workspaceCallbacks.set(name, callback);
        return { name, callback };
      },
    },
  };
  const plugin = {
    app,
    manifest: { id: 'hz-workbench', dir: '.obsidian/plugins/hz-workbench' },
    settings: {
      dailyFolder: '01 日记',
      scheduleFolder: '01 日记/日程',
      projectFolder: '02 项目',
      areaFolder: '03 领域',
      resourceFolder: '04 资源',
      archiveFolder: '05 归档',
      theme: 'emerald',
      carouselSeconds: 6,
      reducedMotion: true,
      tickTickEnabled: false,
      weatherEnabled: true,
      inProgressStatuses: '进行中',
      journalType: '日记',
      projectType: '项目',
      scheduleType: '日程',
    },
    saveSettings: async () => {},
  };
  const leaf = {
    app,
    containerEl: dom.window.document.querySelector('#container'),
    contentEl: dom.window.document.querySelector('#content'),
  };
  app.workspace.activeLeaf = leaf;
  const loaded = loadProductionMain({
    Notice: class {
      constructor(message) { notices.push(message); }
    },
    consoleRef: {
      ...console,
      error: (...args) => errors.push(args),
    },
  });
  loaded.obsidian.Platform.isDesktopApp = desktop;
  const view = new loaded.exports.WorkbenchView(leaf, plugin, { windowRef: dom.window });
  return {
    dom,
    adapter,
    app,
    plugin,
    leaf,
    view,
    Platform: loaded.obsidian.Platform,
    workspaceCallbacks,
    commandCalls,
    notices,
    errors,
  };
}

test('production WorkbenchView subscribes to active-leaf visibility changes on open', async () => {
  const context = workbenchFixture();
  context.view.renderSafely = async () => true;
  await context.view.onOpen();
  assert.equal(typeof context.workspaceCallbacks.get('active-leaf-change'), 'function');
  await context.view.onClose();
  context.dom.window.close();
});

test('header plus opens the existing record-today menu instead of creating a blank note', () => {
  const context = workbenchFixture();
  let opens = 0;
  context.plugin.openDailyCapture = () => { opens += 1; };
  const host = context.dom.window.document.createElement('div');

  context.view.renderHeader(host);
  const plus = host.querySelector('[aria-label="记录今日"]');
  assert.ok(plus);
  plus.click();
  assert.equal(opens, 1);
  context.dom.window.close();
});

test('production active-leaf callback rolls back only drag or resize and keeps layout editing paused', async () => {
  const context = workbenchFixture();
  context.view.renderSafely = async () => true;
  await context.view.onOpen();
  context.view.layoutStore = { save: async () => {} };
  context.view.renderDesktopWorkbench(context.view.contentEl, emptyData(), DEFAULT_LAYOUT, '');
  const activeLeafChange = context.workspaceCallbacks.get('active-leaf-change');
  const carousel = context.view.carouselController;
  const pauseCalls = [];
  const resumeCalls = [];
  const pause = carousel.pause.bind(carousel);
  const resume = carousel.resume.bind(carousel);
  carousel.pause = (reason) => { pauseCalls.push(reason); pause(reason); };
  carousel.resume = (reason) => { resumeCalls.push(reason); resume(reason); };

  context.view.layoutController.enterEdit('sidebar');
  assert.deepEqual([...carousel.pauses], ['layout-edit']);
  const sidebarBody = context.view.contentEl.querySelector('[data-module-id="sidebar"] .hz-layout-content');
  dispatchPointer(context.dom.window, sidebarBody, 'pointerdown', { pointerId: 31, clientX: 20, clientY: 20 });
  dispatchPointer(context.dom.window, context.dom.window, 'pointermove', { pointerId: 31, clientX: 4, clientY: 20 });
  assert.deepEqual(context.view.layoutController.layout.sidebar, { x: 0, y: 16, scale: 1 });

  const inactiveLeaf = { id: 'another-leaf' };
  assert.equal(activeLeafChange(inactiveLeaf), true);
  assert.deepEqual(context.view.layoutController.layout.sidebar, DEFAULT_LAYOUT.sidebar);
  assert.equal(context.view.layoutController.state.mode, 'editing');
  assert.deepEqual(new Set(carousel.pauses), new Set(['layout-edit', 'view-inactive']));
  assert.equal(activeLeafChange(inactiveLeaf), false);
  assert.equal(pauseCalls.filter((reason) => reason === 'view-inactive').length, 1);

  assert.equal(activeLeafChange(context.leaf), true);
  assert.deepEqual([...carousel.pauses], ['layout-edit']);
  assert.equal(activeLeafChange(context.leaf), false);
  assert.equal(resumeCalls.filter((reason) => reason === 'view-inactive').length, 1);

  const handle = context.view.contentEl.querySelector('[data-module-id="sidebar"] .hz-resize-handle');
  dispatchPointer(context.dom.window, handle, 'pointerdown', { pointerId: 32, clientX: 128, clientY: 776 });
  dispatchPointer(context.dom.window, context.dom.window, 'pointermove', { pointerId: 32, clientX: 148, clientY: 796 });
  assert.notDeepEqual(context.view.layoutController.layout.sidebar, DEFAULT_LAYOUT.sidebar);
  assert.equal(context.view.layoutController.state.mode, 'resizing');
  activeLeafChange(inactiveLeaf);
  assert.deepEqual(context.view.layoutController.layout.sidebar, DEFAULT_LAYOUT.sidebar);
  assert.equal(context.view.layoutController.state.mode, 'editing');
  assert.deepEqual(new Set(carousel.pauses), new Set(['layout-edit', 'view-inactive']));
  activeLeafChange(context.leaf);
  assert.deepEqual([...carousel.pauses], ['layout-edit']);

  context.view.layoutController.cancelAndExit();
  assert.deepEqual([...carousel.pauses], []);
  await context.view.onClose();
  assert.equal(activeLeafChange(inactiveLeaf), false, 'closed views ignore delayed workspace callbacks');
  context.dom.window.close();
});

test('a production carousel committed while its leaf is hidden starts paused until reactivated', async () => {
  const context = workbenchFixture();
  context.view.renderSafely = async () => true;
  await context.view.onOpen();
  const activeLeafChange = context.workspaceCallbacks.get('active-leaf-change');
  const gate = deferred();
  context.view.loadRenderPayload = () => gate.promise;

  const pending = context.view.render();
  assert.equal(activeLeafChange({ id: 'hidden-leaf' }), true);
  gate.resolve({ data: emptyData(), layout: DEFAULT_LAYOUT });
  assert.equal(await pending, true);
  assert.equal(context.view.viewActive, false);
  assert.equal(context.view.carouselController.pauses.has('view-inactive'), true);
  assert.equal(context.view.layoutController.state.mode, 'idle');

  assert.equal(activeLeafChange(context.leaf), true);
  assert.equal(context.view.carouselController.pauses.has('view-inactive'), false);
  await context.view.onClose();
  context.dom.window.close();
});

test('production carousel side-card clicks center first and later open once through the existing new-tab callback', async () => {
  const context = workbenchFixture();
  const opened = [];
  context.app.workspace.getLeaf = (type) => ({
    openFile: async (file) => { opened.push({ type, path: file.path }); },
  });

  context.view.renderDesktopWorkbench(
    context.view.contentEl,
    { ...emptyData(), journals: journalsFor('2026', '08', 8) },
    DEFAULT_LAYOUT,
    '',
  );

  const sideCard = context.view.contentEl.querySelector('.hz-slot-5');
  const targetPath = sideCard.dataset.path;
  sideCard.click();
  assert.deepEqual(opened, []);

  const currentCard = context.view.contentEl.querySelector('.hz-slot-3');
  assert.equal(currentCard.dataset.path, targetPath);
  currentCard.click();
  await Promise.resolve();
  assert.deepEqual(opened, [{ type: 'tab', path: targetPath }]);

  await context.view.onClose();
  context.dom.window.close();
});

test('production carousel expires side-card pointer intent before a later centered activation', async () => {
  const context = workbenchFixture();
  const opened = [];
  context.app.workspace.getLeaf = (type) => ({
    openFile: async (file) => { opened.push({ type, path: file.path }); },
  });

  context.view.renderDesktopWorkbench(
    context.view.contentEl,
    { ...emptyData(), journals: journalsFor('2026', '08', 8) },
    DEFAULT_LAYOUT,
    '',
  );

  const sideCard = context.view.contentEl.querySelector('.hz-slot-5');
  const currentCard = context.view.contentEl.querySelector('.hz-slot-3');
  const currentPath = currentCard.dataset.path;

  dispatchPointer(context.dom.window, sideCard, 'pointerdown', { pointerId: 41, clientX: 160, clientY: 120 });
  dispatchPointer(context.dom.window, context.dom.window, 'pointerup', { pointerId: 41, clientX: 160, clientY: 120 });
  assert.equal(context.view.carouselController.pendingActivationPath, sideCard.dataset.path);

  await new Promise((resolve) => context.dom.window.setTimeout(resolve, 0));
  assert.equal(context.view.carouselController.pendingActivationPath, '');

  currentCard.click();
  await Promise.resolve();
  assert.deepEqual(opened, [{ type: 'tab', path: currentPath }]);
  assert.equal(context.view.contentEl.querySelector('.hz-slot-3').dataset.path, currentPath);

  await context.view.onClose();
  context.dom.window.close();
});

test('available Copilot agent renders exact facts and opens its public command once', async () => {
  const context = workbenchFixture();
  const host = context.dom.window.document.createElement('div');

  context.view.renderAgentPanel(host);

  const panel = host.querySelector('.hz-agent-panel');
  assert.match(panel.textContent, /HZ 智能体.*Copilot 已接入.*OpenCode.*DeepSeek-V4-Flash.*修改前确认/s);
  assert.equal(
    panel.querySelector('.hz-agent-help').textContent,
    '对话与执行过程将在 Copilot Agent Chat 中进行',
  );
  assert.equal(panel.querySelector('input'), null);
  assert.equal(panel.querySelector('.hz-agent-send'), null);
  const button = panel.querySelector('.hz-agent-open');
  assert.equal(button.disabled, false);
  assert.equal(button.getAttribute('aria-label'), '进入 Copilot 智能体');
  assert.equal(panel.querySelector('.hz-agent-entry-icon')?.dataset.icon, 'bot');
  assert.equal(button.dataset.icon, 'external-link');

  button.click();
  await flushPromises();
  assert.deepEqual(context.commandCalls, ['copilot:agent-chat-open-window']);
  context.dom.window.close();
});

for (const [name, options, status] of [
  ['missing', { copilotEnabled: false }, '未检测到 Copilot'],
  ['setup', { commandAvailable: false }, 'Copilot 需要完成配置'],
  ['mobile', { desktop: false }, '请在桌面端使用 Copilot Agent'],
]) {
  test(`${name} Copilot agent state disables entry without executing a command`, async () => {
    const context = workbenchFixture(options);
    const host = context.dom.window.document.createElement('div');

    context.view.renderAgentPanel(host);

    const statusElement = host.querySelector(`.hz-agent-status.is-${name}`);
    const button = host.querySelector('.hz-agent-open');
    assert.equal(statusElement.textContent, status);
    assert.equal(button.disabled, true);
    assert.equal(button.getAttribute('aria-label'), status);
    button.click();
    assert.equal(await context.view.openCopilotAgent(), false);
    assert.deepEqual(context.commandCalls, []);
    context.dom.window.close();
  });
}

test('production WorkbenchView initializes real controller-view wiring and consumes one queued refresh on cancel and save', async () => {
  const context = workbenchFixture();
  const saves = [];
  context.view.layoutStore = { save: async (layout) => saves.push(cloneLayout(layout)) };
  context.view.renderDesktopWorkbench(context.view.contentEl, emptyData(), DEFAULT_LAYOUT, '');
  try {
    assert.equal(context.view.contentEl.querySelectorAll('[data-module-id]').length, 11);
    const agent = context.view.contentEl.querySelector('[data-module-id="agent-panel"]');
    assert.equal(agent.textContent, '');
    assert.ok(agent.querySelector('.hz-reserved-rail.hz-weather-rail'));
    assert.equal(agent.querySelector('.hz-reserved-rail .hz-brand-logo'), null);
    assert.equal(agent.querySelector('input'), null);
    assert.equal(agent.querySelector('.hz-agent-send'), null);
    assert.equal(agent.querySelector('.hz-agent-open'), null);
    assert.equal(context.view.contentEl.querySelector('.hz-nav'), null);
    assert.equal(context.view.contentEl.querySelector('.hz-profile'), null);
    assert.equal(context.view.layoutView.mounted, true);
    assert.equal(context.view.layoutView.layout.sidebar.x, DEFAULT_LAYOUT.sidebar.x);

    context.view.layoutController.enterEdit('sidebar');
    assert.equal(context.view.layoutView.state.mode, 'editing');
    assert.equal(context.view.contentEl.querySelector('[data-layout-canvas]').classList.contains('is-layout-editing'), true);

    let refreshes = 0;
    context.view.renderSafely = () => {
      refreshes += 1;
      return Promise.resolve(true);
    };
    assert.equal(context.view.requestRender(), false);
    assert.equal(context.view.requestRender(), false);
    assert.equal(context.view.pendingRefresh, true);
    context.view.layoutController.cancelAndExit();
    assert.equal(context.view.pendingRefresh, false);
    assert.equal(refreshes, 1);

    context.view.layoutController.enterEdit('sidebar');
    assert.equal(context.view.requestRender(), false);
    assert.equal(context.view.pendingRefresh, true);
    assert.equal(await context.view.layoutController.saveAndExit(), true);
    assert.equal(saves.length, 1);
    assert.equal(context.view.pendingRefresh, false);
    assert.equal(refreshes, 2);
    assert.equal(context.view.layoutView.state.mode, 'idle');
  } finally {
    context.view.destroyInteractiveControllers();
    context.dom.window.close();
  }
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, deny) => { resolve = accept; reject = deny; });
  return { promise, resolve, reject };
}

test('production render defers a commit when editing starts during its in-flight load', async () => {
  const context = workbenchFixture();
  const gate = deferred();
  context.view.renderLifecycle.open();
  context.view.loadRenderPayload = () => gate.promise;
  const oldCarousel = {
    currentItem: () => ({ file: { path: '01 日记/current.md' } }),
    destroy() {},
  };
  context.view.carouselController = oldCarousel;
  let mounts = 0;
  context.view.renderDesktopWorkbench = () => { mounts += 1; };

  const pending = context.view.render();
  context.view.layoutController = { state: { mode: 'editing' }, saving: false, destroy() {} };
  gate.resolve({ data: emptyData(), layout: DEFAULT_LAYOUT });
  assert.equal(await pending, true);
  assert.equal(mounts, 0);
  assert.equal(context.view.pendingRefresh, true);
  assert.equal(context.view.carouselController, oldCarousel);
  context.view.destroyInteractiveControllers();
  context.dom.window.close();
});

test('production owner teardown is idempotent and ordered view then layout then carousel on commit and close', async () => {
  const committed = workbenchFixture();
  const commitOrder = [];
  committed.view.layoutView = { destroy: () => commitOrder.push('view') };
  committed.view.layoutController = { state: { mode: 'idle' }, saving: false, destroy: () => commitOrder.push('layout') };
  committed.view.carouselController = { destroy: () => commitOrder.push('carousel'), currentItem: () => null };
  committed.view.renderDesktopWorkbench = () => commitOrder.push('mount');
  committed.view.commitRender(committed.view.contentEl, { data: emptyData(), layout: DEFAULT_LAYOUT }, '');
  committed.view.destroyInteractiveControllers();
  assert.deepEqual(commitOrder, ['view', 'layout', 'carousel', 'mount']);
  committed.dom.window.close();

  const closed = workbenchFixture();
  const closeOrder = [];
  closed.view.renderLifecycle.open();
  closed.view.layoutView = { destroy: () => closeOrder.push('view') };
  closed.view.layoutController = { state: { mode: 'idle' }, saving: false, destroy: () => closeOrder.push('layout') };
  closed.view.carouselController = { destroy: () => closeOrder.push('carousel') };
  await closed.view.onClose();
  await closed.view.onClose();
  assert.deepEqual(closeOrder, ['view', 'layout', 'carousel']);
  closed.dom.window.close();
});

test('production mobile payload never creates a layout store', async () => {
  const context = workbenchFixture({ desktop: false });
  context.view.loadRenderData = async () => emptyData();
  const payload = await context.view.loadRenderPayload();
  assert.equal(payload.layout, null);
  assert.equal(context.view.layoutStore, null);
  context.dom.window.close();
});

test('closing production WorkbenchView during an async load prevents the late mount', async () => {
  const context = workbenchFixture();
  const gate = deferred();
  let commits = 0;
  context.view.renderLifecycle.open();
  context.view.loadRenderPayload = () => gate.promise;
  context.view.commitRender = () => { commits += 1; };
  const pending = context.view.render();
  await context.view.onClose();
  gate.resolve({ data: emptyData(), layout: DEFAULT_LAYOUT });
  assert.equal(await pending, false);
  assert.equal(commits, 0);
  assert.equal(context.view.layoutView, null);
  assert.equal(context.view.layoutController, null);
  assert.equal(context.view.carouselController, null);
  context.dom.window.close();
});
