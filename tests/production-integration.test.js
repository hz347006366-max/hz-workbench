const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../src/main.js'), 'utf8');

function loadMainModule(overrides = {}, obsidianOverrides = {}, consoleRef = console) {
  const module = { exports: {} };
  const obsidian = {
    Plugin: class {},
    ItemView: class {},
    PluginSettingTab: class {},
    Setting: class {},
    Notice: class {},
    TFile: class {},
    TFolder: class {},
    Platform: { isDesktopApp: true },
    normalizePath: (value) => value,
    setIcon: () => {},
    ...obsidianOverrides,
  };
  const localRequire = (request) => {
    if (request === 'obsidian') return obsidian;
    if (Object.prototype.hasOwnProperty.call(overrides, request)) return overrides[request];
    return require(path.resolve(__dirname, '../src', request));
  };
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    require: localRequire,
    window: {},
    console: consoleRef,
  });
  return module.exports;
}

function loadWorkbenchView() {
  return loadMainModule().WorkbenchView;
}

test('active leaf leave cancels the carousel gesture before pausing without journal activation', () => {
  const WorkbenchView = loadWorkbenchView();
  const workbenchLeaf = {};
  const calls = [];
  let journalActivations = 0;
  const view = {
    leaf: workbenchLeaf,
    viewActive: true,
    renderLifecycle: { active: true },
    layoutView: { interruptActiveGesture: () => calls.push('interrupt-layout') },
    carouselController: {
      cancelPointerGesture: () => calls.push('cancel-carousel'),
      pause: (reason) => calls.push(`pause:${reason}`),
      resume: (reason) => calls.push(`resume:${reason}`),
    },
    openJournalInNewTab: () => { journalActivations += 1; },
  };

  assert.equal(WorkbenchView.prototype.handleActiveLeafChange.call(view, {}), true);
  assert.deepEqual(calls, [
    'interrupt-layout',
    'cancel-carousel',
    'pause:view-inactive',
  ]);
  assert.equal(journalActivations, 0);

  calls.length = 0;
  assert.equal(WorkbenchView.prototype.handleActiveLeafChange.call(view, {}), false);
  assert.deepEqual(calls, []);
  assert.equal(journalActivations, 0);

  calls.length = 0;
  assert.equal(WorkbenchView.prototype.handleActiveLeafChange.call(view, workbenchLeaf), true);
  assert.deepEqual(calls, ['resume:view-inactive']);
  assert.equal(journalActivations, 0);
});

test('workbench project screen state changes without replacing the existing home renderer and opens notes in a tab leaf', async () => {
  const WorkbenchView = loadWorkbenchView();
  const calls = [];
  const file = { path: '02 项目/项目甲/阶段/01.md' };
  const app = {
    workspace: {
      getLeaf: (kind) => {
        calls.push(['getLeaf', kind]);
        return { openFile: async (opened) => calls.push(['openFile', opened]) };
      },
    },
  };
  const view = new WorkbenchView({}, { app });
  view.app = app;
  view.scheduleRender = () => calls.push(['scheduleRender']);

  assert.equal(view.screen.type, 'home');
  assert.equal(view.showProject('02 项目/项目甲/项目甲.md'), true);
  assert.equal(view.screen.type, 'project');
  assert.equal(view.screen.projectPath, '02 项目/项目甲/项目甲.md');
  assert.equal(view.screen.selectedStagePath, '');
  assert.equal(view.screen.ganttRange, 'month');
  assert.equal(view.selectProjectStage('02 项目/项目甲/阶段/01.md'), true);
  assert.equal(view.screen.selectedStagePath, '02 项目/项目甲/阶段/01.md');
  assert.equal(view.setProjectGanttRange('quarter'), true);
  assert.equal(view.screen.ganttRange, 'quarter');
  assert.equal(view.setProjectGanttRange('invalid'), false);
  assert.equal(view.screen.ganttRange, 'quarter');
  assert.equal(view.showHome(), true);
  assert.equal(view.screen.type, 'home');
  await view.openFileInNewTab(file);

  assert.deepEqual(calls, [
    ['scheduleRender'], ['scheduleRender'], ['scheduleRender'], ['scheduleRender'],
    ['getLeaf', 'tab'], ['openFile', file],
  ]);
});

test('hub and protocol form routes share the injected capture clock with service validation', async () => {
  const captureNow = () => new Date(2026, 7, 18, 14, 32);
  const calls = [];
  class FakeCaptureService {
    constructor(options) {
      calls.push(['service', options]);
    }
  }
  const captureModal = (plugin, action, service, options) => calls.push(['modal', plugin, action, service, options]);
  const routeCaptureAction = async (action, params, dependencies) => {
    calls.push(['route', action, params, dependencies]);
    return dependencies.openModal(action);
  };
  const HZWorkbenchPlugin = loadMainModule({
    './daily-capture-service': { DailyCaptureService: FakeCaptureService },
    './daily-capture-modal': {
      normalizeCaptureSettings: (settings) => settings,
      routeCaptureAction,
      openDailyCaptureModal: captureModal,
    },
  });
  const plugin = new HZWorkbenchPlugin();
  plugin.app = {};
  plugin.settings = {};
  plugin.pluginActive = true;
  plugin.dailyCaptureClock = captureNow;

  plugin.openDailyCapture('finance');
  await plugin.handleDailyCapture({ action: 'manual-time' });

  const serviceOptions = calls.find(([kind]) => kind === 'service')[1];
  const modalCalls = calls.filter(([kind]) => kind === 'modal');
  const route = calls.find(([kind]) => kind === 'route');
  assert.equal(serviceOptions.now, captureNow);
  assert.equal(modalCalls.length, 2);
  assert.deepEqual(modalCalls.map(([, , action]) => action), ['finance', 'manual-time']);
  assert.ok(modalCalls.every(([, , , , options]) => options.now === captureNow));
  assert.equal(route[3].service, modalCalls[0][3]);
  assert.equal(typeof route[3].openModal, 'function');
});

test('registered capture protocol rejects a future quick-note timestamp before Vault mutation', async () => {
  const fixedNow = () => new Date(2026, 7, 18, 14, 32);
  const commands = new Map();
  const protocols = new Map();
  const notices = [];
  const modalCalls = [];
  const mutations = { exists: 0, mkdir: 0, create: 0, read: 0, modify: 0 };
  const dailyCaptureModal = require('../src/daily-capture-modal');
  const HZWorkbenchPlugin = loadMainModule({
    './daily-capture-modal': {
      ...dailyCaptureModal,
      openDailyCaptureModal: (...args) => modalCalls.push(args),
    },
  }, {
    Notice: class { constructor(message) { notices.push(message); } },
  }, { error: () => {} });
  const plugin = new HZWorkbenchPlugin();
  plugin.app = {
    vault: {
      getMarkdownFiles: () => [],
      getAbstractFileByPath: () => null,
      on: () => ({}),
      cachedRead: async () => { mutations.read += 1; return ''; },
      create: async () => { mutations.create += 1; },
      adapter: {
        exists: async () => { mutations.exists += 1; return false; },
        mkdir: async () => { mutations.mkdir += 1; },
      },
      modify: async () => { mutations.modify += 1; },
    },
    metadataCache: { on: () => ({}), getFileCache: () => ({ frontmatter: {} }) },
    workspace: { onLayoutReady: () => {}, updateOptions: () => {} },
  };
  plugin.loadData = async () => ({});
  plugin.saveData = async () => {};
  plugin.registerMarkdownCodeBlockProcessor = () => {};
  plugin.registerView = () => {};
  plugin.addRibbonIcon = () => {};
  plugin.addCommand = (command) => commands.set(command.id, command.callback);
  plugin.registerObsidianProtocolHandler = (name, callback) => protocols.set(name, callback);
  plugin.addSettingTab = () => {};
  plugin.registerEvent = () => {};
  plugin.dailyCaptureClock = fixedNow;

  await plugin.onload();
  commands.get('record-today')();
  protocols.get('hz-workbench-capture')({
    action: 'quick-note', text: '未来协议记录', date: '2026-08-19', time: '09:00',
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(modalCalls.length, 1);
  assert.equal(modalCalls[0][1], '');
  assert.match(notices.at(-1), /未来/);
  assert.deepEqual(mutations, { exists: 0, mkdir: 0, create: 0, read: 0, modify: 0 });
});
