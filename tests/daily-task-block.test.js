const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const styles = fs.readFileSync(path.resolve(__dirname, '../styles.css'), 'utf8');

const {
  parseTaskBlockSource,
  resolveSourceDate,
  renderDailyTaskBlock,
} = require('../src/daily-task-block');

function installDomHelpers(windowRef) {
  const { Element } = windowRef;
  Element.prototype.empty = function empty() { this.replaceChildren(); };
}

function createContainer() {
  const dom = new JSDOM('<div id="tasks"></div>');
  installDomHelpers(dom.window);
  return { dom, container: dom.window.document.querySelector('#tasks') };
}

function sourceDateApp(file, frontmatter = {}) {
  return {
    vault: {
      getAbstractFileByPath(sourcePath) {
        return sourcePath === file.path ? file : null;
      },
    },
    metadataCache: {
      getFileCache(candidate) {
        return candidate === file ? { frontmatter } : null;
      },
    },
  };
}

test('parses YAML-like task block settings and derives scope defaults', () => {
  assert.deepEqual(parseTaskBlockSource('scope: today\nincludeCompleted: true'), {
    scope: 'today', includeCompleted: true,
  });
  assert.deepEqual(parseTaskBlockSource('scope: tomorrow\nincludeCompleted: false'), {
    scope: 'tomorrow', includeCompleted: false,
  });
  assert.deepEqual(parseTaskBlockSource('scope: tomorrow'), {
    scope: 'tomorrow', includeCompleted: false,
  });
  assert.deepEqual(parseTaskBlockSource(''), {
    scope: 'today', includeCompleted: true,
  });
});

test('rejects invalid scope and boolean values with readable errors', () => {
  assert.throws(() => parseTaskBlockSource('scope: week'), /scope.*today.*tomorrow/i);
  assert.throws(() => parseTaskBlockSource('includeCompleted: yes'), /includeCompleted.*true.*false/i);
});

test('source note frontmatter date wins over a Chinese filename date', () => {
  const file = {
    path: '01 日记/2024年-12-01-星期日.md',
    basename: '2024年-12-01-星期日',
    stat: { ctime: new Date(2026, 7, 12).getTime() },
  };
  assert.equal(resolveSourceDate(sourceDateApp(file, { date: '2025-04-05' }), file.path), '2025-04-05');
});

test('source note date falls back to a Chinese filename but never computer today or ctime', () => {
  const dated = {
    path: '01 日记/2024年-12-01-星期日.md',
    basename: '2024年-12-01-星期日',
    stat: { ctime: new Date(2026, 7, 12).getTime() },
  };
  assert.equal(resolveSourceDate(sourceDateApp(dated), dated.path), '2024-12-01');

  const ordinary = {
    path: '01 日记/普通笔记.md',
    basename: '普通笔记',
    stat: { ctime: new Date(2026, 7, 12).getTime() },
  };
  assert.equal(resolveSourceDate(sourceDateApp(ordinary), ordinary.path), '');
  assert.equal(resolveSourceDate(sourceDateApp(ordinary), '01 日记/不存在.md'), '');
});

test('renders native disabled checkboxes and noninteractive plain task titles', () => {
  const { dom, container } = createContainer();
  renderDailyTaskBlock(container, [
    { id: 'open', title: '未完成', due: '2026-08-12', completed: false, priority: 1 },
    { id: 'done', title: '已完成', due: '2026-08-12', completed: true, priority: 0 },
  ], { scope: 'today', date: '2026-08-12', available: true });

  const rows = [...container.querySelectorAll('.hz-daily-task-row')];
  assert.equal(rows.length, 2);
  assert.equal(container.querySelectorAll('a, button').length, 0);
  assert.deepEqual(rows.map((row) => row.querySelector('input').disabled), [true, true]);
  assert.deepEqual(rows.map((row) => row.querySelector('input').checked), [false, true]);
  assert.equal(rows[1].classList.contains('is-completed'), true);
  assert.equal(rows[1].querySelector('.hz-daily-task-title').textContent, '已完成');
  dom.window.close();
});

test('renders readable empty, unavailable, invalid-date, and error states', () => {
  const cases = [
    { tasks: [], options: { scope: 'today', date: '2026-08-12', available: true }, copy: /没有任务/ },
    { tasks: [], options: { scope: 'today', date: '2026-08-12', available: false, reason: 'database unavailable' }, copy: /TickTickSync.*不可用.*database unavailable/ },
    { tasks: [], options: { scope: 'today', date: '', available: true }, copy: /无法识别.*笔记日期/ },
    { tasks: [], options: { scope: 'today', date: '2026-08-12', error: new Error('boom') }, copy: /任务加载失败.*boom/ },
  ];
  for (const fixture of cases) {
    const { dom, container } = createContainer();
    renderDailyTaskBlock(container, fixture.tasks, fixture.options);
    assert.match(container.textContent, fixture.copy);
    assert.ok(container.querySelector('.hz-daily-task-state'));
    dom.window.close();
  }
});

function loadPluginHarness() {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/main.js'), 'utf8');
  const registrations = [];
  class Component {
    constructor() { this.loaded = false; }
    load() { this.loaded = true; return this.onload?.(); }
    unload() { this.loaded = false; return this.onunload?.(); }
  }
  class Plugin {
    constructor(app) { this.app = app; this.manifest = { id: 'hz-workbench' }; }
    async loadData() { return { startOnLaunch: false }; }
    registerView() {}
    addRibbonIcon() {}
    addCommand() {}
    addSettingTab() {}
    registerEvent() {}
    registerMarkdownCodeBlockProcessor(language, processor) {
      registrations.push({ language, processor });
    }
  }
  const obsidian = {
    Plugin,
    Component,
    ItemView: class {},
    PluginSettingTab: class {},
    Setting: class {},
    Notice: class {},
    TFolder: class {},
    Platform: { isDesktopApp: true },
    normalizePath: (value) => value,
    setIcon: () => {},
  };
  const module = { exports: {} };
  const localRequire = (request) => request === 'obsidian'
    ? obsidian
    : require(path.resolve(__dirname, '../src', request));
  vm.runInNewContext(source, { module, exports: module.exports, require: localRequire, window: {}, console });
  return { PluginClass: module.exports, registrations };
}

function processorApp(loadAllTasks) {
  const file = {
    path: '01 日记/2026年-08-12-星期三.md',
    basename: '2026年-08-12-星期三',
    stat: { ctime: new Date(2030, 0, 1).getTime() },
  };
  const forbidden = new Proxy({}, { get() { throw new Error('Vault task scan/write is forbidden'); } });
  return {
    plugins: { getPlugin: () => ({ taskRepository: { loadAllTasks } }) },
    vault: {
      getAbstractFileByPath: (sourcePath) => (sourcePath === file.path ? file : null),
      on: () => ({}),
      modify: forbidden,
      create: forbidden,
      getMarkdownFiles: forbidden,
    },
    metadataCache: { getFileCache: () => ({ frontmatter: {} }), on: () => ({}) },
    workspace: {
      onLayoutReady() {},
      detachLeavesOfType() {},
      getLeavesOfType: () => [],
    },
    sourcePath: file.path,
  };
}

async function flushAsyncWork() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

test('plugin processor loads one readonly snapshot and applies historical today/tomorrow rules', async () => {
  let reads = 0;
  const app = processorApp(async () => {
    reads += 1;
    return [
      { id: 'today-open', title: '今日未完成', dueDate: '2026-08-12', status: 0, priority: 0 },
      { id: 'today-done', title: '今日已完成', dueDate: '2026-08-12', status: 2, priority: 0 },
      { id: 'tomorrow-open', title: '明日未完成', dueDate: '2026-08-13', status: 0, priority: 0 },
      { id: 'tomorrow-done', title: '明日已完成', dueDate: '2026-08-13', status: 2, priority: 0 },
    ];
  });
  const { PluginClass, registrations } = loadPluginHarness();
  const plugin = new PluginClass(app);
  await plugin.onload();
  assert.deepEqual(registrations.map(({ language }) => language), [
    'hz-tasks', 'hz-month-tasks', 'hz-month-finance',
  ]);

  const today = createContainer();
  const tomorrow = createContainer();
  const contexts = [];
  for (const [source, target] of [
    ['scope: today\nincludeCompleted: true', today],
    ['scope: tomorrow\nincludeCompleted: true', tomorrow],
  ]) {
    const context = {
      sourcePath: app.sourcePath,
      children: [],
      addChild(child) { this.children.push(child); return child.load(); },
    };
    contexts.push(context);
    registrations[0].processor(source, target.container, context);
  }
  await flushAsyncWork();

  assert.equal(reads, 2, 'one adapter load per rendered block');
  assert.match(today.container.textContent, /今日未完成/);
  assert.match(today.container.textContent, /今日已完成/);
  assert.match(tomorrow.container.textContent, /明日未完成/);
  assert.doesNotMatch(tomorrow.container.textContent, /明日已完成/);
  assert.equal(contexts.every((context) => context.children.length === 1), true);
  today.dom.window.close();
  tomorrow.dom.window.close();
});

test('processor suppresses late async render after its markdown child is disposed', async () => {
  let resolveTasks;
  const app = processorApp(() => new Promise((resolve) => { resolveTasks = resolve; }));
  const { PluginClass, registrations } = loadPluginHarness();
  const plugin = new PluginClass(app);
  await plugin.onload();
  const { dom, container } = createContainer();
  const context = {
    child: null,
    addChild(child) { this.child = child; return child.load(); },
  };

  registrations[0].processor('scope: today', container, { ...context, sourcePath: app.sourcePath, addChild: context.addChild.bind(context) });
  context.child.unload();
  resolveTasks([{ id: 'late', title: '不得出现', dueDate: '2026-08-12', status: 0, priority: 0 }]);
  await flushAsyncWork();

  assert.equal(container.textContent, '');
  dom.window.close();
});

test('processor suppresses late async render after the plugin unloads', async () => {
  let resolveTasks;
  const app = processorApp(() => new Promise((resolve) => { resolveTasks = resolve; }));
  const { PluginClass, registrations } = loadPluginHarness();
  const plugin = new PluginClass(app);
  await plugin.onload();
  const { dom, container } = createContainer();
  const context = {
    sourcePath: app.sourcePath,
    addChild(child) { return child.load(); },
  };

  registrations[0].processor('scope: today', container, context);
  await plugin.onunload();
  resolveTasks([{ id: 'late', title: '不得出现', dueDate: '2026-08-12', status: 0, priority: 0 }]);
  await flushAsyncWork();

  assert.equal(container.textContent, '');
  dom.window.close();
});

test('tomorrow processor renders an explicit invalid-note-date state without using ctime or computer today', async () => {
  const app = processorApp(async () => []);
  const ordinary = {
    path: '01 日记/普通笔记.md',
    basename: '普通笔记',
    stat: { ctime: new Date().getTime() },
  };
  app.sourcePath = ordinary.path;
  app.vault.getAbstractFileByPath = () => ordinary;
  const { PluginClass, registrations } = loadPluginHarness();
  const plugin = new PluginClass(app);
  await plugin.onload();
  const { dom, container } = createContainer();
  const context = {
    sourcePath: ordinary.path,
    addChild(child) { return child.load(); },
  };

  registrations[0].processor('scope: tomorrow', container, context);
  await flushAsyncWork();

  assert.match(container.textContent, /无法识别.*笔记日期/);
  assert.doesNotMatch(container.textContent, /NaN|2026-08-1[23]/);
  dom.window.close();
});

test('daily task block styles are scoped and long lists scroll vertically', () => {
  assert.match(styles, /\.hz-daily-task-block\{/);
  assert.match(styles, /\.hz-daily-task-block \.hz-daily-task-list\{[^}]*max-height:[^;}]+;[^}]*overflow-y:auto/);
  assert.doesNotMatch(styles, /(?:^|\})\s*(?:input|a|button|section|div)\s*\{/m);
});
