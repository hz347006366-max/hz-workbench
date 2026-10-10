const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const { dateKey } = require('../src/core');
const source = fs.readFileSync(path.resolve(__dirname, '../src/main.js'), 'utf8');
const styles = fs.readFileSync(path.resolve(__dirname, '../styles.css'), 'utf8');

function loadMainModule(notices = []) {
  const module = { exports: {} };
  class ItemView {
    constructor(leaf) {
      this.leaf = leaf;
      this.app = leaf.app;
      this.containerEl = leaf.containerEl;
      this.contentEl = leaf.contentEl;
    }
  }
  const obsidian = {
    Plugin: class {},
    ItemView,
    PluginSettingTab: class {},
    Setting: class {},
    Notice: class { constructor(message) { notices.push(message); } },
    TFile: class {},
    TFolder: class {},
    Platform: { isDesktopApp: true },
    normalizePath: (value) => value,
    setIcon: () => {},
  };
  const localRequire = (request) => request === 'obsidian'
    ? obsidian
    : require(path.resolve(__dirname, '../src', request));
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    require: localRequire,
    window: {},
    console,
  });
  return module.exports;
}

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

function todayTasks() {
  const today = dateKey(new Date());
  return [
    { id: 'one', title: '第一项', due: today, completed: false, priority: 1, file: { path: 'journal', basename: 'journal' } },
    { id: 'two', title: '已完成项', due: today, completed: true, priority: 1, file: { path: 'journal', basename: 'journal' } },
    { id: 'three', title: '第三项', due: today, completed: false, priority: 1, file: { path: 'journal', basename: 'journal' } },
    { id: 'four', title: '第四项', due: today, completed: false, priority: 1, file: { path: 'journal', basename: 'journal' } },
  ];
}

function fixture({ selections = {} } = {}) {
  const dom = new JSDOM('<div id="container"><div id="content"></div><div id="must"></div><div id="tasks"></div></div>');
  installDomHelpers(dom.window);
  const effects = { saves: [], writes: 0, syncs: 0, opens: 0 };
  const app = {
    vault: {
      getMarkdownFiles: () => [],
      modify: async () => { effects.writes += 1; },
      create: async () => { effects.writes += 1; },
      adapter: { getResourcePath: (value) => value },
    },
    metadataCache: { getFileCache: () => null, getFirstLinkpathDest: () => null },
    commands: { executeCommandById: (id) => { if (id.includes('ticktick')) effects.syncs += 1; } },
    workspace: { getLeaf: () => ({ openFile: () => { effects.opens += 1; } }) },
  };
  const plugin = {
    app,
    manifest: { id: 'hz-workbench', dir: '.obsidian/plugins/hz-workbench' },
    settings: { focusSelections: structuredClone(selections) },
    saveSettings: async () => { effects.saves.push(structuredClone(plugin.settings)); },
  };
  const leaf = {
    app,
    containerEl: dom.window.document.querySelector('#container'),
    contentEl: dom.window.document.querySelector('#content'),
  };
  const notices = [];
  const { WorkbenchView } = loadMainModule(notices);
  return {
    dom,
    view: new WorkbenchView(leaf, plugin, { windowRef: dom.window }),
    plugin,
    effects,
    notices,
    mustHost: dom.window.document.querySelector('#must'),
    taskHost: dom.window.document.querySelector('#tasks'),
  };
}

function renderTaskPanels(context, tasks = todayTasks(), taskSource = { available: true, reason: null, path: 'journal' }) {
  context.view.renderMustDo(context.mustHost, tasks, taskSource);
  context.view.renderTasks(context.taskHost, tasks, taskSource);
}

async function flushPromises() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

test('today task checkboxes control only HZ focus while must-do stays display-only', async () => {
  const today = dateKey(new Date());
  const context = fixture({ selections: { [today]: ['one'] } });
  renderTaskPanels(context, todayTasks().slice(0, 3));

  const rows = [...context.taskHost.querySelectorAll('.hz-task')];
  assert.equal(rows.length, 3);
  for (const row of rows) {
    const checkbox = row.querySelector('.hz-focus-checkbox');
    assert.ok(checkbox);
    assert.equal(checkbox.disabled, false);
    assert.equal(row.querySelectorAll('a').length, 0);
    assert.equal(row.querySelectorAll('button').length, 0);
  }
  assert.equal(rows[0].querySelector('input').checked, true);
  assert.equal(rows[1].querySelector('input').checked, false);
  assert.equal(rows[1].classList.contains('is-completed'), true);
  assert.match(rows[1].querySelector('small').textContent, /已完成/);
  assert.equal(context.mustHost.querySelectorAll('button,input,form').length, 0);
  assert.equal(context.mustHost.querySelectorAll('[data-task-id="one"]').length, 1);
  assert.doesNotMatch(context.mustHost.textContent, /TickTickSync 本地缓存 · 仅展示/);
  assert.doesNotMatch(context.taskHost.textContent, /TickTickSync 本地缓存 · 仅展示/);
  rows[1].querySelector('.hz-focus-checkbox').click();
  await flushPromises();
  assert.deepEqual(context.plugin.settings.focusSelections[today], ['one', 'two']);
  assert.deepEqual({ writes: context.effects.writes, syncs: context.effects.syncs, opens: context.effects.opens }, { writes: 0, syncs: 0, opens: 0 });
  context.dom.window.close();
});

test('focus checkboxes persist only HZ selections, enforce three items, and refresh both task panels', async () => {
  const context = fixture();
  renderTaskPanels(context);

  for (const id of ['one', 'two', 'three']) {
    context.taskHost.querySelector(`[data-task-id="${id}"] .hz-focus-checkbox`).click();
    await flushPromises();
  }

  const fourth = context.taskHost.querySelector('[data-task-id="four"] .hz-focus-checkbox');
  assert.equal(fourth.disabled, false);
  fourth.click();
  await flushPromises();
  assert.equal(fourth.checked, false);
  assert.equal(context.notices.at(-1), '今日必完成最多 3 项');
  assert.deepEqual(context.plugin.settings.focusSelections[dateKey(new Date())], ['one', 'two', 'three']);
  assert.equal(context.mustHost.querySelectorAll('.hz-must-item').length, 3);
  const completedFocus = context.mustHost.querySelector('[data-task-id="two"]');
  assert.equal(completedFocus.classList.contains('is-completed'), true);
  assert.equal(completedFocus.querySelector('input,button'), null);

  context.taskHost.querySelector('[data-task-id="two"] .hz-focus-checkbox').click();
  await flushPromises();

  assert.deepEqual(context.plugin.settings.focusSelections[dateKey(new Date())], ['one', 'three']);
  assert.equal(context.mustHost.querySelectorAll('.hz-must-item').length, 2);
  assert.equal(context.taskHost.querySelector('[data-task-id="two"] .hz-focus-checkbox').checked, false);
  assert.equal(context.taskHost.querySelector('[data-task-id="four"] .hz-focus-checkbox').disabled, false);
  assert.equal(context.effects.saves.length, 4);
  assert.deepEqual(
    context.effects.saves.map((saved) => Object.keys(saved)),
    [
      ['focusSelections'], ['focusSelections'], ['focusSelections'], ['focusSelections'],
    ],
  );
  assert.deepEqual({ writes: context.effects.writes, syncs: context.effects.syncs, opens: context.effects.opens }, { writes: 0, syncs: 0, opens: 0 });
  context.dom.window.close();
});

test('stale stored selections do not consume the three-item focus limit', async () => {
  const today = dateKey(new Date());
  const context = fixture({ selections: { [today]: ['stale-one', 'stale-two', 'stale-three'] } });
  renderTaskPanels(context);

  const first = context.taskHost.querySelector('[data-task-id="one"] .hz-focus-checkbox');
  assert.equal(first.disabled, false);
  assert.equal(first.checked, false);

  first.click();
  await flushPromises();

  assert.deepEqual(context.plugin.settings.focusSelections[today], ['one']);
  assert.equal(context.effects.saves.length, 1);
  context.dom.window.close();
});

test('loading normalizes duplicate stale and over-limit selections and persists the cleanup once', async () => {
  const today = dateKey(new Date());
  const context = fixture({
    selections: { [today]: ['one', 'one', 'stale', 'two', 'three', 'four'] },
  });
  context.view.app.plugins = {
    getPlugin: () => ({
      taskRepository: {
        loadAllTasks: async () => todayTasks().map((task) => ({
          id: task.id,
          title: task.title,
          dueDate: today,
          status: task.completed ? 2 : 0,
          priority: task.priority,
        })),
      },
    }),
  };
  context.view.index.journals = async () => [];
  context.view.index.projects = () => [];
  context.view.index.schedules = () => [];

  await context.view.loadRenderData();
  await context.view.loadRenderData();

  assert.deepEqual(context.plugin.settings.focusSelections[today], ['one', 'two', 'three']);
  assert.equal(context.effects.saves.length, 1);
  context.dom.window.close();
});

test('an unavailable TickTick snapshot does not erase stored focus selections', async () => {
  const today = dateKey(new Date());
  const context = fixture({ selections: { [today]: ['one'] } });
  context.view.app.plugins = { getPlugin: () => null };
  context.view.index.journals = async () => [];
  context.view.index.projects = () => [];
  context.view.index.schedules = () => [];

  const data = await context.view.loadRenderData();

  assert.equal(data.taskSource.available, false);
  assert.deepEqual(context.plugin.settings.focusSelections[today], ['one']);
  assert.equal(context.effects.saves.length, 0);
  context.dom.window.close();
});

test('task panels keep every task in DOM and expose dedicated vertical scroll containers', () => {
  const today = dateKey(new Date());
  const tasks = Array.from({ length: 8 }, (_, index) => ({
    id: `task-${index + 1}`,
    title: `任务 ${index + 1}`,
    due: today,
    completed: false,
    priority: 0,
  }));
  const context = fixture({ selections: { [today]: ['task-1', 'task-2', 'task-3'] } });
  renderTaskPanels(context, tasks);

  const todayScroll = context.taskHost.querySelector('[data-task-scroll="today"]');
  const focusScroll = context.mustHost.querySelector('[data-task-scroll="focus"]');
  assert.ok(todayScroll);
  assert.ok(focusScroll);
  assert.equal(todayScroll.querySelectorAll('.hz-task').length, 8);
  assert.equal(focusScroll.querySelectorAll('.hz-must-item').length, 3);
  assert.match(styles, /\.hz-task-list\{[^}]*overflow-y:auto/);
  assert.match(styles, /\.hz-must-list\{[^}]*overflow-y:auto/);
  context.dom.window.close();
});

test('task panels show a readable unavailable source state', () => {
  const context = fixture();
  renderTaskPanels(context, [], { available: false, reason: 'database unavailable', path: 'journal' });
  assert.match(context.mustHost.textContent, /TickTickSync 本地缓存不可用/);
  assert.match(context.mustHost.textContent, /database unavailable/);
  assert.match(context.taskHost.textContent, /TickTickSync 本地缓存不可用/);
  context.dom.window.close();
});

test('loadRenderData reads one TickTick snapshot and includes completed tasks due today', async () => {
  const context = fixture();
  const today = dateKey(new Date());
  let adapterReads = 0;
  let vaultTaskScans = 0;
  context.view.app.plugins = {
    getPlugin: () => ({
      taskRepository: {
        loadAllTasks: async () => {
          adapterReads += 1;
          return [
            { id: 'one', title: '第一项', dueDate: today, status: 0, priority: 1 },
            { id: 'two', title: '已完成项', dueDate: today, status: 2, priority: 1 },
            { id: 'three', title: '第三项', dueDate: today, status: 0, priority: 1 },
          ];
        },
      },
    }),
  };
  context.view.index.journals = async () => [];
  context.view.index.tasks = async () => { vaultTaskScans += 1; return []; };
  context.view.index.todayFile = async () => null;
  context.view.index.projects = () => [];
  context.view.index.schedules = () => [];

  const data = await context.view.loadRenderData();

  assert.equal(adapterReads, 1);
  assert.equal(vaultTaskScans, 0);
  assert.deepEqual(new Set(data.todayTasks.map((task) => task.id)), new Set(['one', 'two', 'three']));
  assert.equal(data.taskSource.available, true);
  context.dom.window.close();
});
