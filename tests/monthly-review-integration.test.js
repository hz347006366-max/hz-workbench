const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.resolve(__dirname, '../src/main.js'), 'utf8');

function loadPluginHarness({ Notice = class {}, consoleRef = console, loadedData = { startOnLaunch: false } } = {}) {
  const registrations = [];
  const editorExtensions = [];
  class Component {
    load() { return this.onload?.(); }
    unload() { return this.onunload?.(); }
  }
  class Plugin {
    constructor(app) { this.app = app; this.manifest = { id: 'hz-workbench' }; }
    async loadData() { return loadedData; }
    async saveData() {}
    registerView() {}
    addRibbonIcon() {}
    addCommand() {}
    addSettingTab() {}
    registerEvent() {}
    registerEditorExtension(extensions) { editorExtensions.push(extensions); }
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
    Modal: class {},
    Notice,
    TFolder: class {},
    Platform: { isDesktopApp: true },
    normalizePath: (value) => value,
    setIcon: () => {},
  };
  const module = { exports: {} };
  const localRequire = (request) => request === 'obsidian'
    ? obsidian
    : require(path.resolve(__dirname, '../src', request));
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    require: localRequire,
    window: {},
    globalThis: {},
    console: consoleRef,
  });
  return { PluginClass: module.exports, registrations, editorExtensions };
}

test('monthly review automation is default-on, self-heals after layout ready, and follows create events', async () => {
  const created = [];
  const events = {};
  let layoutReady;
  const notices = [];
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const basename = `${year}年-${month}-${day}-星期${'日一二三四五六'[now.getDay()]}`;
  const daily = {
    path: `01 日记/${year}年/${Number(month)}月/${basename}.md`, basename, extension: 'md',
  };
  const files = [daily];
  const app = monthlyApp({ markdownFiles: files });
  app.vault.on = (name, callback) => { events[name] = callback; return {}; };
  app.vault.create = async (pathValue, content) => {
    created.push({ path: pathValue, content });
    const basenameValue = pathValue.split('/').pop().replace(/\.md$/, '');
    files.push({ path: pathValue, basename: basenameValue, extension: 'md' });
  };
  app.workspace.onLayoutReady = (callback) => { layoutReady = callback; };
  const { PluginClass } = loadPluginHarness({
    Notice: class { constructor(message) { notices.push(message); } },
  });
  const plugin = new PluginClass(app);

  await plugin.onload();
  assert.equal(plugin.settings.autoCreateMonthlyReview, true);
  assert.equal(typeof layoutReady, 'function');
  assert.equal(typeof events.create, 'function');

  layoutReady();
  await flushAsyncWork();
  assert.equal(created.length, 1);
  assert.equal(created[0].path, `01 日记/${year}年/${Number(month)}月/${year}年-${month}-00-月复盘.md`);
  assert.match(created[0].content, new RegExp(`month: ${year}-${month}`));
  assert.equal(notices.length, 1);

  events.create(daily);
  await flushAsyncWork();
  assert.equal(created.length, 1);

  await plugin.onunload();
  assert.equal(plugin.monthlyReviewEnsurer.active, false);
});

function createContainer() {
  const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>');
  const container = dom.window.document.querySelector('#root');
  container.empty = () => container.replaceChildren();
  return { dom, container };
}

function monthlyApp({ loadAllTasks = async () => [], markdownFiles = [], frontmatter = new Map(), cachedRead = async () => '' } = {}) {
  return {
    plugins: { getPlugin: () => ({ taskRepository: { loadAllTasks } }) },
    vault: {
      getAbstractFileByPath: (sourcePath) => markdownFiles.find((file) => file.path === sourcePath) || null,
      getMarkdownFiles: () => markdownFiles,
      cachedRead,
      on: () => ({}),
      create: new Proxy(function forbiddenCreate() {}, { apply() { throw new Error('Vault writes are forbidden'); } }),
      modify: new Proxy(function forbiddenModify() {}, { apply() { throw new Error('Vault writes are forbidden'); } }),
    },
    metadataCache: {
      getFileCache: (file) => ({ frontmatter: frontmatter.get(file) || {} }),
      on: () => ({}),
    },
    workspace: {
      onLayoutReady() {},
      detachLeavesOfType() {},
      getLeavesOfType: () => [],
      updateOptions() {},
    },
    commands: {
      executeCommandById() { throw new Error('commands are forbidden during monthly rendering'); },
    },
  };
}

function mountProcessor(registration, sourcePath, container) {
  const context = {
    sourcePath,
    child: null,
    addChild(child) { this.child = child; return child.load(); },
  };
  registration.processor('', container, context);
  return context;
}

async function flushAsyncWork() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

test('registers the daily and two monthly processors exactly once with one shared editor extension owner', async () => {
  const { PluginClass, registrations, editorExtensions } = loadPluginHarness();
  const plugin = new PluginClass(monthlyApp());

  await plugin.onload();

  assert.deepEqual(registrations.map(({ language }) => language), [
    'hz-tasks', 'hz-month-tasks', 'hz-month-finance',
  ]);
  assert.equal(new Set(registrations.map(({ language }) => language)).size, 3);
  assert.equal(editorExtensions.length, 1);
  assert.equal(editorExtensions[0].length, 2);
});

test('task processor resolves month first, skips TickTick for invalid context, and loads one historical snapshot when valid', async () => {
  const valid = { path: '01 日记/2025年-02月复盘.md', basename: '2025年-02月复盘' };
  const invalid = { path: '01 日记/月复盘.md', basename: '月复盘' };
  const frontmatter = new Map([[valid, { type: '月复盘', month: '2025-02' }], [invalid, { type: '月复盘' }]]);
  let taskReads = 0;
  const app = monthlyApp({
    markdownFiles: [valid, invalid],
    frontmatter,
    loadAllTasks: async () => {
      taskReads += 1;
      return [
        { id: 'target', title: '历史任务', dueDate: '2025-02-14', status: 0, priority: 0 },
        { id: 'other', title: '其他月份', dueDate: '2026-08-20', status: 0, priority: 0 },
      ];
    },
  });
  const { PluginClass, registrations } = loadPluginHarness();
  const plugin = new PluginClass(app);
  await plugin.onload();
  const processor = registrations.find(({ language }) => language === 'hz-month-tasks');
  const invalidTarget = createContainer();
  const validTarget = createContainer();

  mountProcessor(processor, invalid.path, invalidTarget.container);
  await flushAsyncWork();
  assert.equal(taskReads, 0);
  assert.match(invalidTarget.container.textContent, /无法识别月复盘月份/);

  mountProcessor(processor, valid.path, validTarget.container);
  await flushAsyncWork();
  assert.equal(taskReads, 1);
  assert.match(validTarget.container.textContent, /历史任务/);
  assert.doesNotMatch(validTarget.container.textContent, /其他月份/);
  assert.equal(validTarget.container.querySelectorAll('a,input').length, 0);
  assert.deepEqual(Array.from(validTarget.container.querySelectorAll('button'), (button) => button.textContent), ['全部', '已完成', '未完成']);
  invalidTarget.dom.window.close();
  validTarget.dom.window.close();
});

test('each monthly processor owns an independent child and suppresses late renders after child or plugin unload', async () => {
  const taskSource = { path: '01 日记/2026年-08月复盘.md', basename: '2026年-08月复盘' };
  const financeSource = { path: '01 日记/2026年/9月/2026年-09月复盘.md', basename: '2026年-09月复盘' };
  const frontmatter = new Map([[taskSource, { month: '2026-08' }], [financeSource, { month: '2026-09' }]]);
  let resolveTasks;
  let resolveRead;
  const app = monthlyApp({
    markdownFiles: [taskSource, financeSource, { path: '01 日记/2026年/9月/2026年-09-01-星期二.md', basename: '2026年-09-01-星期二' }],
    frontmatter,
    loadAllTasks: () => new Promise((resolve) => { resolveTasks = resolve; }),
    cachedRead: () => new Promise((resolve) => { resolveRead = resolve; }),
  });
  frontmatter.set(app.vault.getMarkdownFiles()[2], { type: '日记' });
  const { PluginClass, registrations } = loadPluginHarness();
  const plugin = new PluginClass(app);
  await plugin.onload();
  const taskTarget = createContainer();
  const financeTarget = createContainer();
  const taskContext = mountProcessor(
    registrations.find(({ language }) => language === 'hz-month-tasks'),
    taskSource.path,
    taskTarget.container,
  );
  const financeContext = mountProcessor(
    registrations.find(({ language }) => language === 'hz-month-finance'),
    financeSource.path,
    financeTarget.container,
  );

  assert.notEqual(taskContext.child, financeContext.child);
  taskContext.child.unload();
  await plugin.onunload();
  resolveTasks([{ id: 'late', title: '不得出现', dueDate: '2026-08-10', status: 0 }]);
  resolveRead('<!-- hz:finance-entries:start -->\n- 09:00｜收入｜其他｜不得出现｜¥1.00\n<!-- hz:finance-entries:end -->');
  await flushAsyncWork();

  assert.equal(taskTarget.container.textContent, '');
  assert.equal(financeTarget.container.textContent, '');
  taskTarget.dom.window.close();
  financeTarget.dom.window.close();
});

test('finance processor inventories once, reads only target diaries, and forwards read failures to the renderer', async () => {
  const sourceFile = { path: '01 日记/2026年-08月复盘.md', basename: '2026年-08月复盘' };
  const readable = { path: '01 日记/2026年/8月/2026年-08-20-星期四.md', basename: '2026年-08-20-星期四' };
  const broken = { path: '01 日记/2026年/8月/2026年-08-21-星期五.md', basename: '2026年-08-21-星期五' };
  const otherMonth = { path: '01 日记/2026年/9月/2026年-09-01-星期二.md', basename: '2026年-09-01-星期二' };
  const frontmatter = new Map([
    [sourceFile, { type: '月复盘', month: '2026-08' }],
    [readable, { type: '日记' }],
    [broken, { type: '日记' }],
    [otherMonth, { type: '日记' }],
  ]);
  let inventoryReads = 0;
  const noteReads = [];
  const app = monthlyApp({
    markdownFiles: [sourceFile, readable, broken, otherMonth],
    frontmatter,
    cachedRead: async (file) => {
      noteReads.push(file.path);
      if (file === broken) throw new Error('locked');
      return '<!-- hz:finance-entries:start -->\n- 09:10｜收入｜其他｜退款｜¥88.00\n<!-- hz:finance-entries:end -->';
    },
  });
  const inventory = app.vault.getMarkdownFiles;
  app.vault.getMarkdownFiles = () => { inventoryReads += 1; return inventory(); };
  const { PluginClass, registrations } = loadPluginHarness();
  const plugin = new PluginClass(app);
  await plugin.onload();
  const target = createContainer();

  mountProcessor(
    registrations.find(({ language }) => language === 'hz-month-finance'),
    sourceFile.path,
    target.container,
  );
  await flushAsyncWork();

  assert.equal(inventoryReads, 1);
  assert.deepEqual(noteReads, [readable.path, broken.path]);
  assert.match(target.container.textContent, /本月收入.*¥88\.00/s);
  assert.match(target.container.textContent, /有 1 篇日记读取失败/);
  assert.equal(target.container.querySelector('.hz-month-finance-source').textContent, broken.basename);
  target.dom.window.close();
});

test('invalid finance context performs no Vault inventory', async () => {
  const invalid = { path: '01 日记/月复盘.md', basename: '月复盘' };
  let inventoryReads = 0;
  const app = monthlyApp({ markdownFiles: [invalid] });
  app.vault.getMarkdownFiles = () => { inventoryReads += 1; return [invalid]; };
  const { PluginClass, registrations } = loadPluginHarness();
  const plugin = new PluginClass(app);
  await plugin.onload();
  const target = createContainer();

  mountProcessor(
    registrations.find(({ language }) => language === 'hz-month-finance'),
    invalid.path,
    target.container,
  );
  await flushAsyncWork();

  assert.equal(inventoryReads, 0);
  assert.match(target.container.textContent, /无法识别月复盘月份/);
  target.dom.window.close();
});

test('monthly processors catch full-pipeline async failures and render scoped visible errors', async () => {
  const errors = [];
  const sourceFile = { path: '01 日记/2026年/8月/2026年-08月复盘.md', basename: '2026年-08月复盘' };
  const validFrontmatter = new Map([[sourceFile, { type: '月复盘', month: '2026-08' }]]);

  async function renderFailure({ kind, configure, breakFirstCreate = false }) {
    const app = monthlyApp({ markdownFiles: [sourceFile], frontmatter: validFrontmatter });
    configure(app);
    const { PluginClass, registrations } = loadPluginHarness({
      consoleRef: { ...console, error: (...args) => errors.push(args) },
    });
    const plugin = new PluginClass(app);
    await plugin.onload();
    const target = createContainer();
    if (breakFirstCreate) {
      const original = target.dom.window.document.createElement.bind(target.dom.window.document);
      let first = true;
      target.dom.window.document.createElement = (...args) => {
        if (first) { first = false; throw new Error('final renderer failed'); }
        return original(...args);
      };
    }
    mountProcessor(registrations.find(({ language }) => language === kind), sourceFile.path, target.container);
    await flushAsyncWork();
    const text = target.container.textContent;
    target.dom.window.close();
    return text;
  }

  const sourceError = await renderFailure({
    kind: 'hz-month-tasks',
    configure(app) { app.metadataCache.getFileCache = () => { throw new Error('metadata failed'); }; },
  });
  const normalizationError = await renderFailure({
    kind: 'hz-month-tasks',
    configure(app) {
      app.plugins.getPlugin = () => ({ taskRepository: { loadAllTasks: async () => [{ get id() { throw new Error('normalize failed'); } }] } });
    },
  });
  const inventoryError = await renderFailure({
    kind: 'hz-month-finance',
    configure(app) { app.vault.getMarkdownFiles = () => { throw new Error('inventory failed'); }; },
  });
  const rendererError = await renderFailure({
    kind: 'hz-month-tasks',
    configure() {},
    breakFirstCreate: true,
  });

  assert.match(sourceError, /月复盘任务加载失败/);
  assert.match(normalizationError, /TickTick 任务暂不可用/);
  assert.match(inventoryError, /月复盘收支加载失败/);
  assert.match(rendererError, /月复盘任务加载失败/);
  assert.equal(errors.length, 3);
  assert.ok(errors.every(([label]) => /^\[HZ Workbench\]/.test(label)));
});

test('a rejected monthly load after child unload produces no late DOM write or error log', async () => {
  const errors = [];
  const sourceFile = { path: '01 日记/2026年/8月/2026年-08月复盘.md', basename: '2026年-08月复盘' };
  let rejectTasks;
  const app = monthlyApp({
    markdownFiles: [sourceFile],
    frontmatter: new Map([[sourceFile, { type: '月复盘', month: '2026-08' }]]),
    loadAllTasks: () => new Promise((resolve, reject) => { rejectTasks = reject; }),
  });
  const { PluginClass, registrations } = loadPluginHarness({
    consoleRef: { ...console, error: (...args) => errors.push(args) },
  });
  const plugin = new PluginClass(app);
  await plugin.onload();
  const target = createContainer();
  const context = mountProcessor(
    registrations.find(({ language }) => language === 'hz-month-tasks'),
    sourceFile.path,
    target.container,
  );

  context.child.unload();
  rejectTasks(new Error('late failure'));
  await flushAsyncWork();

  assert.equal(target.container.textContent, '');
  assert.equal(errors.length, 0);
  target.dom.window.close();
});

test('monthly finance source navigation awaits an exact new-tab open and consumes rejection once', async () => {
  const notices = [];
  const errors = [];
  const calls = [];
  const file = { path: '01 日记/2026年-08-20-星期四.md' };
  const { PluginClass } = loadPluginHarness({
    Notice: class { constructor(message) { notices.push(message); } },
    consoleRef: { ...console, error: (...args) => errors.push(args) },
  });
  const receiver = {
    app: {
      vault: { getAbstractFileByPath: (pathValue) => pathValue === file.path ? file : null },
      workspace: {
        getLeaf(mode) {
          calls.push(['getLeaf', mode]);
          return {
            async openFile(opened) {
              calls.push(['openFile', opened]);
              throw new Error('navigation failed');
            },
          };
        },
      },
    },
  };

  await assert.doesNotReject(PluginClass.prototype.openMonthlySourceInNewTab.call(receiver, file.path));

  assert.deepEqual(calls, [['getLeaf', 'tab'], ['openFile', file]]);
  assert.equal(errors.length, 1);
  assert.match(errors[0][0], /^\[HZ Workbench\]/);
  assert.deepEqual(notices, ['无法打开对应日记，请检查文件是否仍然存在。']);
});
