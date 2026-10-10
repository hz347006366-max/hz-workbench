const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../src/main.js'), 'utf8');

function loadMainModule({ Notice = class {}, consoleRef = console } = {}) {
  const module = { exports: {} };
  const obsidian = {
    Plugin: class {},
    ItemView: class {},
    PluginSettingTab: class {},
    Setting: class {},
    Notice,
    TFile: class {},
    TFolder: class {},
    Platform: { isDesktopApp: true },
    normalizePath: (value) => value,
    setIcon: () => {},
  };
  const localRequire = (request) => {
    if (request === 'obsidian') return obsidian;
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

function methodSource(name, nextName) {
  const start = source.indexOf(`  ${name}(`);
  const end = source.indexOf(`\n  ${nextName}(`, start);
  return start === -1 || end === -1 ? '' : source.slice(start, end);
}

test('workbench delegates carousel movement instead of rerendering the whole view', () => {
  assert.match(source, /new CarouselController\(/);
  assert.doesNotMatch(source, /moveCarousel\([\s\S]*?this\.render\(\)/);
  assert.doesNotMatch(source, /startCarousel\(/);
});

test('view close destroys the carousel controller', () => {
  const onClose = methodSource('async onClose', 'scheduleRender');
  assert.match(onClose, /this\.renderLifecycle\.close\(\)/);
  assert.match(onClose, /this\.destroyInteractiveControllers\(\)/);
});

test('workbench no longer owns carousel index or timer state', () => {
  assert.doesNotMatch(source, /this\.carouselIndex/);
  assert.doesNotMatch(source, /this\.carouselTimer/);
  assert.doesNotMatch(source, /window\.clearInterval/);
});

test('business-data refresh retains the current journal when replacing the controller', () => {
  assert.match(source, /getCurrentPath: \(\) => this\.carouselController\?\.currentItem\(\)\?\.file\.path \|\| ''/);
  assert.match(source, /new CarouselController\(\{[\s\S]*?preferredPath,[\s\S]*?\}\)/);
});

test('journal activation has one exact production callback that opens a new tab', () => {
  const renderJournal = methodSource('renderJournal', 'renderProjects');
  const callback = 'openJournal: (journal) => { void this.openJournalInNewTab(journal); },';
  assert.equal((renderJournal.match(/openJournal:/g) || []).length, 1);
  assert.equal(renderJournal.includes(callback), true);
  assert.doesNotMatch(renderJournal, /getLeaf\(false\)/);
});

test('journal navigation rejection is consumed at the workbench boundary', async () => {
  const notices = [];
  const errors = [];
  const workspaceCalls = [];
  let workbenchCloses = 0;
  const journal = { file: { path: '01 日记/2026-08-13.md' } };
  const moduleExports = loadMainModule({
    Notice: class {
      constructor(message) { notices.push(message); }
    },
    consoleRef: {
      ...console,
      error: (...args) => errors.push(args),
    },
  });
  const view = {
    leaf: {
      detach: () => { workbenchCloses += 1; },
    },
    app: {
      workspace: {
        getLeaf: (mode) => {
          workspaceCalls.push(['getLeaf', mode]);
          return {
            openFile: async (file) => {
              workspaceCalls.push(['openFile', file]);
              throw new Error('navigation failed');
            },
          };
        },
      },
    },
  };

  await assert.doesNotReject(
    moduleExports.WorkbenchView.prototype.openJournalInNewTab.call(view, journal),
  );

  assert.deepEqual(workspaceCalls, [
    ['getLeaf', 'tab'],
    ['openFile', journal.file],
  ]);
  assert.deepEqual(notices, ['无法打开对应日记，请稍后重试']);
  assert.equal(errors.length, 1);
  assert.match(errors[0][0], /\[HZ Workbench\]/);
  assert.equal(workbenchCloses, 0);
});

for (const [name, fixture] of [
  ['throws', { command: async () => { throw new Error('command failed'); } }],
  ['returns false', { command: async () => false }],
]) {
  test(`Copilot agent command that ${name} is consumed once at the workbench boundary`, async () => {
    const notices = [];
    const errors = [];
    const commandCalls = [];
    const moduleExports = loadMainModule({
      Notice: class {
        constructor(message) { notices.push(message); }
      },
      consoleRef: {
        ...console,
        error: (...args) => errors.push(args),
      },
    });
    const view = Object.assign(Object.create(moduleExports.WorkbenchView.prototype), {
      app: {
        plugins: { enabledPlugins: new Set(['copilot']) },
        commands: {
          commands: { 'copilot:agent-chat-open-window': { id: 'copilot:agent-chat-open-window' } },
          executeCommandById: async (commandId) => {
            commandCalls.push(commandId);
            return fixture.command();
          },
        },
      },
    });

    const result = await view.openCopilotAgent();

    assert.equal(result, false);
    assert.deepEqual(commandCalls, ['copilot:agent-chat-open-window']);
    assert.deepEqual(notices, ['无法打开 Copilot 智能体，请检查 Copilot 与 OpenCode 设置']);
    assert.equal(errors.length, 1);
    assert.equal(errors[0][0], '[HZ Workbench] Failed to open Copilot Agent Chat');
  });
}

test('unavailable Copilot agent command returns false without command execution', async () => {
  const commandCalls = [];
  const moduleExports = loadMainModule();
  const view = Object.assign(Object.create(moduleExports.WorkbenchView.prototype), {
    app: {
      plugins: { enabledPlugins: new Set() },
      commands: {
        commands: { 'copilot:agent-chat-open-window': {} },
        executeCommandById: (commandId) => commandCalls.push(commandId),
      },
    },
  });
  const result = await view.openCopilotAgent();

  assert.equal(result, false);
  assert.deepEqual(commandCalls, []);
});

test('workbench delegates guarded orchestration to the production transaction helper', () => {
  const render = methodSource('render', 'async loadRenderData');
  assert.match(render, /return runRenderTransaction\(\{/);
  assert.match(render, /lifecycle: this\.renderLifecycle/);
  assert.match(render, /load: \(\) => this\.loadRenderPayload\(\)/);
  assert.match(render, /commit: \(payload, preferredPath\) => this\.commitRender\(root, payload, preferredPath\)/);

  const commitRender = methodSource('commitRender', 'renderSidebar');
  assert.doesNotMatch(commitRender, /await /);
  assert.match(commitRender, /root\.empty\(\)/);

  const renderMustDo = methodSource('renderMustDo', 'renderTasks');
  assert.doesNotMatch(renderMustDo, /async renderMustDo/);
  assert.doesNotMatch(renderMustDo, /const todayFile = await /);
});

test('background renders use one guarded rejection path', () => {
  const scheduleRender = methodSource('scheduleRender', 'renderSafely');
  assert.match(scheduleRender, /this\.requestRender\(\)/);
  assert.doesNotMatch(scheduleRender, /this\.render\(\)/);

  const safeRender = methodSource('renderSafely', 'requestRender');
  assert.match(safeRender, /return renderSafely\(\(\) => this\.render\(\), \(error\) => this\.reportRenderError\(error\)\)/);

  const requestRender = methodSource('requestRender', 'reportRenderError');
  assert.match(requestRender, /void this\.renderSafely\(\)/);

  const renderHeader = methodSource('renderHeader', 'renderStats');
  assert.match(renderHeader, /this\.requestRender\(\)/);
  assert.doesNotMatch(renderHeader, /await this\.render\(\)/);
  assert.equal((source.match(/this\.render\(\)/g) || []).length, 1);
});

const MODULE_IDS = [
  'sidebar', 'header', 'stat-today-tasks', 'stat-active-projects',
  'stat-today-schedule', 'stat-journal-streak', 'journal-carousel',
  'projects', 'must-do', 'today-tasks',
];

test('main view creates every stable layout module exactly once', () => {
  for (const id of MODULE_IDS) {
    const matches = source.match(new RegExp(`moduleShell\\([^,]+, ['"]${id}['"]`, 'g')) || [];
    assert.equal(matches.length, 1, `${id} must have one stable shell`);
  }
});

test('desktop layout is gated by Obsidian Platform.isDesktopApp', () => {
  assert.match(source, /Platform\.isDesktopApp/);
  assert.match(source, /renderResponsiveWorkbench\(/);
  assert.match(source, /renderDesktopWorkbench\(/);
});

test('desktop waits for both business data and the per-device layout before commit', () => {
  const render = methodSource('render', 'async loadRenderData');
  assert.match(render, /load: \(\) => this\.loadRenderPayload\(\)/);
  assert.match(render, /commit: \(payload, preferredPath\) => this\.commitRender\(root, payload, preferredPath\)/);

  const loadRenderPayload = methodSource('async loadRenderPayload', 'async loadRenderData');
  assert.match(loadRenderPayload, /Promise\.all\(\[/);
  assert.match(loadRenderPayload, /this\.loadRenderData\(\)/);
  assert.match(loadRenderPayload, /this\.layoutStore\.load\(\)/);
  assert.match(loadRenderPayload, /Platform\.isDesktopApp/);
  assert.match(loadRenderPayload, /uuid: \(\) => deviceUuid\(this\.windowRef\)/);
});

test('device UUID is generated only by the injected window crypto receiver', () => {
  const pluginModule = loadMainModule();
  assert.equal(typeof pluginModule.deviceUuid, 'function');
  const expected = '12345678-1234-4123-8123-123456789abc';
  let calls = 0;
  const cryptoRef = {
    randomUUID() {
      assert.equal(this, cryptoRef);
      calls += 1;
      return expected;
    },
  };

  assert.equal(pluginModule.deviceUuid({ crypto: cryptoRef }), expected);
  assert.equal(calls, 1);
  assert.throws(
    () => pluginModule.deviceUuid({ crypto: {} }),
    /安全设备标识生成器不可用/,
  );
  assert.throws(
    () => pluginModule.deviceUuid({}),
    /安全设备标识生成器不可用/,
  );
});

test('mobile keeps the responsive structure without creating layout runtime owners', () => {
  const responsive = methodSource('renderResponsiveWorkbench', 'renderDesktopWorkbench');
  assert.match(responsive, /hz-app/);
  assert.match(responsive, /hz-shell/);
  assert.doesNotMatch(responsive, /LayoutView|LayoutController|LayoutStore|layoutStore/);
});

test('mobile surfaces today focus above stats for single-screen reach', () => {
  const responsive = methodSource('renderResponsiveWorkbench', 'renderDesktopWorkbench');
  // 高频任务模块必须先于统计卡渲染（信息架构重排：今日必完成 / 今日任务提前）
  const focusEl = responsive.indexOf('hz-mobile-focus');
  const mustCall = responsive.indexOf('this.renderMustDo(focus');
  const tasksCall = responsive.indexOf('this.renderTasks(focus');
  const statsCall = responsive.indexOf('this.renderStats(shell');
  assert.ok(focusEl !== -1, '缺少 hz-mobile-focus 容器');
  assert.ok(mustCall !== -1 && mustCall < statsCall, '今日必完成未排在统计卡前');
  assert.ok(tasksCall !== -1 && tasksCall < statsCall, '今日任务未排在统计卡前');
  // 移动端不再渲染桌面端专用的右侧栏容器
  assert.doesNotMatch(responsive, /hz-right/);
});

test('mobile stat cards expose scroll targets and clean up their click listener', () => {
  const responsive = methodSource('renderResponsiveWorkbench', 'renderDesktopWorkbench');
  const stats = methodSource('renderStats', 'projectCount');
  // 统计卡渲染后打上 scroll-to 目标（触控补齐：点击跳转到对应模块）
  assert.match(stats, /dataset\.scrollTo/);
  assert.match(stats, /\.hz-mobile-focus/);
  assert.match(stats, /\.hz-projects/);
  // 点击委托 + 清理句柄
  assert.match(responsive, /data-scroll-to/);
  assert.match(responsive, /scrollIntoView/);
  assert.match(responsive, /disposeStatClick/);
  // 销毁时释放监听器
  const destroy = methodSource('destroyInteractiveControllers', 'commitRender');
  assert.match(destroy, /disposeStatClick/);
});

test('desktop owns one viewport canvas runtime and safely wires controller to view', () => {
  const desktop = methodSource('renderDesktopWorkbench', 'moduleShell');
  assert.match(desktop, /hz-layout-viewport/);
  assert.match(desktop, /hz-layout-stage/);
  assert.match(desktop, /data-layout-canvas/);
  assert.match(desktop, /new LayoutController\(\{/);
  assert.match(desktop, /carousel: this\.carouselController/);
  assert.match(desktop, /save: \(nextLayout\) => this\.layoutStore\.save\(nextLayout\)/);
  assert.match(desktop, /onChange: \(state, nextLayout\) => this\.handleLayoutChange\(state, nextLayout\)/);
  assert.match(desktop, /new LayoutView\(\{/);
  assert.match(desktop, /renderIcon: \(element, name\) => setIcon\(element, name\)/);
  assert.match(desktop, /this\.layoutView\.mount\(\)/);
});

test('editing or saving queues one refresh and consumes it after returning idle', () => {
  const scheduleRender = methodSource('scheduleRender', 'renderSafely');
  const requestRender = methodSource('requestRender', 'reportRenderError');
  const handleLayoutChange = methodSource('handleLayoutChange', 'consumePendingRefresh');
  const consumePendingRefresh = methodSource('consumePendingRefresh', 'destroyInteractiveControllers');
  assert.match(scheduleRender, /this\.queueRefreshWhileEditing\(\)/);
  assert.match(requestRender, /this\.queueRefreshWhileEditing\(\)/);
  assert.match(source, /state\.mode !== ['"]idle['"]|state\?\.mode !== ['"]idle['"]/);
  assert.match(source, /this\.layoutController\?\.saving/);
  assert.match(handleLayoutChange, /this\.layoutView\?\.render\(state, nextLayout\)/);
  assert.match(handleLayoutChange, /state\.mode === ['"]idle['"]/);
  assert.match(consumePendingRefresh, /this\.pendingRefresh = false/);
  assert.match(consumePendingRefresh, /this\.requestRender\(\)/);
});

test('one idempotent owner destroys view controller and carousel in order', () => {
  const onClose = methodSource('async onClose', 'scheduleRender');
  const destroy = methodSource('destroyInteractiveControllers', 'commitRender');
  assert.match(onClose, /this\.destroyInteractiveControllers\(\)/);
  assert.doesNotMatch(onClose, /carouselController\?\.destroy/);
  const viewIndex = destroy.indexOf('this.layoutView?.destroy()');
  const controllerIndex = destroy.indexOf('this.layoutController?.destroy()');
  const carouselIndex = destroy.indexOf('this.carouselController?.destroy()');
  assert.ok(viewIndex !== -1 && viewIndex < controllerIndex);
  assert.ok(controllerIndex < carouselIndex);
  assert.match(destroy, /this\.layoutView = null/);
  assert.match(destroy, /this\.layoutController = null/);
  assert.match(destroy, /this\.carouselController = null/);

  const commitRender = methodSource('commitRender', 'renderResponsiveWorkbench');
  assert.equal((commitRender.match(/destroyInteractiveControllers\(\)/g) || []).length, 1);
  assert.match(commitRender, /root\.empty\(\)/);
});

test('workbench production boundary contains no task writes, sync commands, quick input, or task navigation', () => {
  assert.doesNotMatch(source, /addMustDo\s*\(/);
  assert.doesNotMatch(source, /tickticksync:tts-sync/);
  assert.doesNotMatch(source, /hz-quick-input/);
  assert.doesNotMatch(source, /getLeaf\(false\)\.openFile\(task\.file\)/);
});

test('Copilot agent entry uses only the public command registry boundary', () => {
  assert.match(source, /require\(['"]\.\/agent-entry['"]\)/);
  const state = methodSource('copilotAgentEntryState', 'async openCopilotAgent');
  const open = methodSource('async openCopilotAgent', 'renderAgentPanel');
  assert.match(state, /Platform\.isDesktopApp/);
  assert.match(state, /enabledPlugins\?\.has\?\.\(COPILOT_PLUGIN_ID\) === true/);
  assert.match(state, /findCommand\?\.\(COPILOT_AGENT_COMMAND_ID\)/);
  assert.match(state, /commands\?\.\[COPILOT_AGENT_COMMAND_ID\]/);
  assert.match(open, /executeCommandById\(COPILOT_AGENT_COMMAND_ID\)/);
  assert.equal((open.match(/executeCommandById/g) || []).length, 1);
  assert.doesNotMatch(
    `${state}\n${open}`,
    /getPlugin\(['"]copilot['"]\)|data\.json|apiKey|fetch\s*\(|requestUrl|runtime/i,
  );
});

test('default focus selections are empty and detached when settings load', () => {
  assert.match(source, /focusSelections:\s*\{\s*\}/);
  const loadSettings = methodSource('async loadSettings', 'async saveSettings');
  assert.match(loadSettings, /focusSelections:\s*\{\s*\.\.\.\(loaded\.focusSelections \|\| \{\}\)\s*\}/);
});

test('monthly guidance defaults on and settings refresh both editor guidance fields', () => {
  const pluginModule = loadMainModule();
  assert.equal(pluginModule.DEFAULT_SETTINGS.showMonthlyGuidance, true);
  assert.match(source, /显示月复盘编辑提示/);
  assert.match(source, /createMonthlyEditorGuidanceExtension/);
  assert.match(source, /editorGuidanceExtensions\s*=\s*\[\s*this\.dailyEditorGuidanceExtension\(\),\s*this\.monthlyEditorGuidanceExtension\(\),?\s*\]/s);
  assert.equal((source.match(/this\.plugin\.refreshEditorGuidance\(\)/g) || []).length, 3);
  assert.doesNotMatch(source, /refreshDailyEditorGuidance/);
});

test('monthly review filenames below the daily folder never enter the journal carousel without relying on frontmatter', async () => {
  const pluginModule = loadMainModule();
  assert.equal(typeof pluginModule.WorkbenchIndex, 'function');
  const monthly = { path: '01 日记/2026年/8月/2026年-08月复盘.md', basename: '2026年-08月复盘' };
  const malformedMonthly = { path: '01 日记/2026年/8月/2026年-09月复盘.md', basename: '2026年-09月复盘' };
  const templateLike = { path: '01 日记/临时/月复盘草稿.md', basename: '月复盘草稿' };
  const daily = { path: '01 日记/2026年-08-20-星期四.md', basename: '2026年-08-20-星期四' };
  const reads = [];
  const index = new pluginModule.WorkbenchIndex({
    settings: { dailyFolder: '01 日记', scheduleFolder: '01 日记/日程', journalType: '日记' },
    app: {
      vault: {
        getMarkdownFiles: () => [monthly, malformedMonthly, templateLike, daily],
        cachedRead: async (file) => { reads.push(file.path); return '正文'; },
      },
      metadataCache: {
        getFileCache: (file) => ({ frontmatter: file === monthly
          ? {}
          : file === malformedMonthly
            ? { type: { broken: true } }
            : file === templateLike
              ? null
              : { type: '日记', date: '2026-08-20' } }),
        getFirstLinkpathDest: () => null,
      },
    },
  });

  const journals = await index.journals();

  assert.deepEqual(Array.from(journals, ({ file }) => file.path), [daily.path]);
  assert.deepEqual(reads, [daily.path]);
});

test('journal index exposes only cover date and managed daily meditation to the carousel', async () => {
  const pluginModule = loadMainModule();
  const daily = { path: '01 日记/2026年/8月/2026年-08-27-星期四.md', basename: '2026年-08-27-星期四' };
  const content = '## 每日冥想\n<!-- hz:daily-meditation:start -->\n**慢下来，再做决定。**\n<!-- hz:daily-meditation:end -->\n';
  const index = new pluginModule.WorkbenchIndex({
    settings: { dailyFolder: '01 日记', scheduleFolder: '01 日记/日程', journalType: '日记' },
    app: {
      vault: { getMarkdownFiles: () => [daily], cachedRead: async () => content },
      metadataCache: {
        getFileCache: () => ({ frontmatter: { type: '日记', date: '2026-08-27', title: '旧标题', summary: '旧摘要' } }),
        getFirstLinkpathDest: () => null,
      },
    },
  });

  const [journalItem] = await index.journals();

  assert.equal(journalItem.date, '2026-08-27');
  assert.equal(journalItem.meditation, '慢下来，再做决定。');
  assert.equal('title' in journalItem, false);
  assert.equal('summary' in journalItem, false);
  assert.equal('mood' in journalItem, false);
  assert.equal('weather' in journalItem, false);
});
