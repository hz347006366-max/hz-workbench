const {
  Plugin,
  Component,
  ItemView,
  PluginSettingTab,
  Setting,
  Modal,
  Notice,
  Platform,
  normalizePath,
  requestUrl: obsidianRequestUrl,
  setIcon,
} = require('obsidian');
const {
  dateKey,
  buildHeatmap,
  extractJournalCover,
  journalStreak,
} = require('./core');
const { extractMeditation } = require('./daily-capture-model');
const { tasksForDate, nextLocalDate } = require('./ticktick-read-model');
const { TickTickReadAdapter } = require('./ticktick-read-adapter');
const {
  parseTaskBlockSource,
  resolveSourceDate,
  renderDailyTaskBlock,
} = require('./daily-task-block');
const { selectedTasksForDate, toggleFocusSelection } = require('./focus-selection');
const { CarouselController } = require('./carousel-controller');
const { RenderLifecycle, runRenderTransaction, renderSafely } = require('./render-lifecycle');
const { MODULE_DEFINITIONS, DEFAULT_LAYOUT, cloneLayout } = require('./layout-model');
const { LayoutStore } = require('./layout-store');
const { LayoutController } = require('./layout-controller');
const { LayoutView } = require('./layout-view');
const { resolveJournalDate } = require('./journal-date');
const { DailyCaptureService } = require('./daily-capture-service');
const { resolveJournalCaptureTarget } = require('./journal-capture-target');
const { normalizeCaptureSettings, routeCaptureAction, openDailyCaptureModal } = require('./daily-capture-modal');
const { resolveScheme, schemeClass, toggleSchemeClass } = require('./theme');
const { createDailyEditorGuidanceExtension } = require('./daily-editor-guidance-extension');
const { buildMonthlyTaskView } = require('./monthly-task-model');
const { buildMonthlyFinanceView } = require('./monthly-finance-model');
const {
  resolveMonthlySource,
  loadMonthlyFinanceNotes,
  renderMonthlyErrorBlock,
  renderMonthlyTaskBlock,
  renderMonthlyFinanceBlock,
} = require('./monthly-review-blocks');
const { createMonthlyEditorGuidanceExtension } = require('./monthly-editor-guidance-extension');
const { renderMonthlyReviewTemplate } = require('./monthly-review-template');
const { MonthlyReviewEnsurer } = require('./monthly-review-automation');
const {
  COPILOT_PLUGIN_ID,
  COPILOT_AGENT_COMMAND_ID,
  resolveCopilotAgentEntry,
} = require('./agent-entry');
const { ProjectRepository } = require('./project-repository');
const { WeatherClient } = require('./weather-client');
const {
  WeatherController,
  DEFAULT_WEATHER_LOCATION,
  MAX_RECENT_LOCATIONS,
} = require('./weather-controller');
const { buildProjectOverviewModel, buildProjectCockpitModel } = require('./project-view-model');
const { openProjectWizardModal } = require('./project-wizard');
const {
  buildDikanjuMigrationPreview,
  preflightDikanjuMigration,
  executeDikanjuMigration,
} = require('./project-migration');

const VIEW_TYPE = 'hz-workbench-view';
const VIEW_INACTIVE_REASON = 'view-inactive';
const THEME_LABELS = {
  emerald: '深林翡翠',
  ocean: '深海冰蓝',
  amber: '炭黑琥珀',
  violet: '午夜星紫',
  monochrome: '墨影黑白',
  'prism-blue-gold': '棱镜玻璃·蓝金',
};

const DEFAULT_SETTINGS = {
  dailyFolder: '01 日记',
  dailyTemplatePath: '07 模板/每日模板.md',
  scheduleFolder: '01 日记/日程',
  projectFolder: '02 项目',
  attachmentFolder: '06 附件',
  dailyHeading: '今日必完成',
  journalType: '日记',
  projectType: '项目',
  scheduleType: '日程',
  inProgressStatuses: '进行中,推进中,Active',
  theme: 'emerald',
  themeFollowsScheme: false,
  carouselSeconds: 6,
  reducedMotion: false,
  startOnLaunch: true,
  focusSelections: {},
  dailyPhotoFolder: '06 附件/日记照片',
  dailyPhotoMaxEdge: 2048,
  dailyPhotoQuality: 0.85,
  timeCategories: '工作,学习,沟通,生活,运动,通勤,休息,娱乐,其他',
  expenseCategories: '餐饮,交通,购物,居住,医疗,娱乐,学习,项目,其他',
  incomeCategories: '工资,设计费,报销,奖金,其他',
  currencySymbol: '¥',
  openDailyAfterCapture: false,
  showDailyGuidance: true,
  showDailyTechnicalMarkers: false,
  showMonthlyGuidance: true,
  autoCreateMonthlyReview: true,
  activeTimer: null,
  // 天气系统已停用（默认关闭）：保留该区域作为空占位，将来有新想法再启用。
  // 置为 true 即可恢复天气功能；下方 weather* 字段与 weather-client/controller/model 模块完整保留。
  weatherEnabled: false,
  weatherLocation: { ...DEFAULT_WEATHER_LOCATION },
  weatherRecentLocations: [],
  weatherCache: {},
  weatherRefreshMinutes: 30,
};

const MAX_WEATHER_CACHE_ENTRIES = 6;

function validWeatherLocation(value) {
  return value && typeof value === 'object'
    && Number.isFinite(value.latitude)
    && Number.isFinite(value.longitude)
    && typeof value.timezone === 'string'
    && value.timezone.trim();
}

function normalizeWeatherSettings(settings) {
  const normalized = { ...settings };
  normalized.weatherLocation = validWeatherLocation(settings?.weatherLocation)
    ? { ...settings.weatherLocation }
    : { ...DEFAULT_WEATHER_LOCATION };
  const seen = new Set();
  normalized.weatherRecentLocations = [];
  for (const location of Array.isArray(settings?.weatherRecentLocations) ? settings.weatherRecentLocations : []) {
    if (!validWeatherLocation(location)) continue;
    const key = String(location.id || `${location.latitude},${location.longitude}:${location.timezone}`);
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.weatherRecentLocations.push({ ...location });
    if (normalized.weatherRecentLocations.length === MAX_RECENT_LOCATIONS) break;
  }
  const entries = Object.entries(settings?.weatherCache && typeof settings.weatherCache === 'object'
    ? settings.weatherCache : {})
    .sort((a, b) => Number(b[1]?.fetchedAt || 0) - Number(a[1]?.fetchedAt || 0))
    .slice(0, MAX_WEATHER_CACHE_ENTRIES);
  normalized.weatherCache = Object.fromEntries(entries);
  normalized.weatherRefreshMinutes = 30;
  return normalized;
}

function textValue(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

function deviceUuid(windowRef) {
  const cryptoRef = windowRef?.crypto;
  if (!cryptoRef || typeof cryptoRef.randomUUID !== 'function') {
    throw new Error('安全设备标识生成器不可用，请更新 Obsidian 后重试');
  }
  return cryptoRef.randomUUID.call(cryptoRef);
}

class WorkbenchIndex {
  constructor(plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
  }

  frontmatter(file) {
    return this.app.metadataCache.getFileCache(file)?.frontmatter || {};
  }

  filesIn(folder) {
    const prefix = normalizePath(folder).replace(/\/$/, '') + '/';
    return this.app.vault.getMarkdownFiles().filter((file) => file.path.startsWith(prefix));
  }

  dateFor(file, frontmatter = this.frontmatter(file)) {
    return resolveJournalDate(file, frontmatter);
  }

  async journals() {
    const files = this.filesIn(this.plugin.settings.dailyFolder)
      .filter((file) => !file.path.startsWith(normalizePath(this.plugin.settings.scheduleFolder) + '/'));
    const results = [];
    for (const file of files) {
      if (String(file.basename || '').includes('月复盘')) continue;
      const fm = this.frontmatter(file);
      if (fm.type && textValue(fm.type) !== this.plugin.settings.journalType) continue;
      const content = await this.app.vault.cachedRead(file);
      const cover = extractJournalCover(fm, content);
      results.push({
        file,
        date: this.dateFor(file, fm),
        cover: this.coverUrl(cover, file.path),
        meditation: extractMeditation(content),
      });
    }
    return results.sort((a, b) => b.date.localeCompare(a.date) || a.file.path.localeCompare(b.file.path));
  }

  coverUrl(cover, sourcePath) {
    if (!cover) return '';
    if (/^https?:\/\//i.test(cover)) return cover;
    const target = this.app.metadataCache.getFirstLinkpathDest(cover, sourcePath);
    return target ? this.app.vault.getResourcePath(target) : '';
  }

  projects() {
    const statuses = this.plugin.settings.inProgressStatuses.split(',').map((item) => item.trim()).filter(Boolean);
    return this.filesIn(this.plugin.settings.projectFolder)
      .map((file) => ({ file, fm: this.frontmatter(file) }))
      .filter(({ fm }) => (!fm.type || textValue(fm.type) === this.plugin.settings.projectType) && statuses.includes(textValue(fm.status)))
      .map(({ file, fm }) => ({
        file,
        title: textValue(fm.title) || file.basename,
        status: textValue(fm.status) || '进行中',
        next: textValue(fm.next) || '缺少下一步',
        progress: Math.max(0, Math.min(100, Number(fm.progress || 0))),
      }));
  }

  schedules() {
    const today = dateKey(new Date());
    return this.filesIn(this.plugin.settings.scheduleFolder)
      .map((file) => ({ file, fm: this.frontmatter(file) }))
      .filter(({ fm }) => textValue(fm.start).startsWith(today) && textValue(fm.status) !== '已取消');
  }

}

class WorkbenchView extends ItemView {
  constructor(leaf, plugin, { windowRef = window } = {}) {
    super(leaf);
    this.plugin = plugin;
    this.index = new WorkbenchIndex(plugin);
    this.windowRef = windowRef;
    this.refreshTimer = 0;
    this.pendingRefresh = false;
    this.carouselController = null;
    this.weatherController = null;
    this.layoutStore = null;
    this.layoutController = null;
    this.layoutView = null;
    this.viewActive = true;
    this.activeLeafEventRegistered = false;
    this.colorSchemeEventRegistered = false;
    this.mustDoPanel = null;
    this.tasksPanel = null;
    this.renderLifecycle = new RenderLifecycle();
    this.screen = { type: 'home' };
    this.projectFilter = 'active';
    this.pendingStageItems = new Set();
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return 'HZ 个人工作台'; }
  getIcon() { return 'layout-dashboard'; }

  async onOpen() {
    this.renderLifecycle.open();
    this.viewActive = !this.app.workspace.activeLeaf || this.app.workspace.activeLeaf === this.leaf;
    if (!this.activeLeafEventRegistered && typeof this.app.workspace.on === 'function') {
      this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => this.handleActiveLeafChange(leaf)));
      this.activeLeafEventRegistered = true;
    }
    if (!this.colorSchemeEventRegistered && typeof this.app.workspace.on === 'function') {
      this.registerEvent(this.app.workspace.on('css-change', () => this.handleColorSchemeChange()));
      this.colorSchemeEventRegistered = true;
    }
    this.containerEl.addClass('hz-workbench-host');
    this.applySchemeToHost();
    await this.renderSafely();
  }

  async onClose() {
    this.windowRef.clearTimeout(this.refreshTimer);
    this.renderLifecycle.close();
    this.pendingRefresh = false;
    this.destroyInteractiveControllers();
  }

  scheduleRender() {
    this.windowRef.clearTimeout(this.refreshTimer);
    if (this.queueRefreshWhileEditing()) return;
    this.refreshTimer = this.windowRef.setTimeout(() => this.requestRender(), 400);
  }

  showHome() {
    this.renderLifecycle.begin();
    this.screen = { type: 'home' };
    this.scheduleRender();
    return true;
  }

  showProject(projectPath) {
    if (typeof projectPath !== 'string' || projectPath.trim() === '') return false;
    this.renderLifecycle.begin();
    this.screen = {
      type: 'project',
      projectPath,
      selectedStagePath: '',
      ganttRange: 'month',
    };
    this.scheduleRender();
    return true;
  }

  selectProjectStage(stagePath) {
    if (this.screen?.type !== 'project' || typeof stagePath !== 'string') return false;
    this.renderLifecycle.begin();
    this.screen = { ...this.screen, selectedStagePath: stagePath };
    this.scheduleRender();
    return true;
  }

  setProjectGanttRange(range) {
    if (this.screen?.type !== 'project' || !['month', 'quarter', 'all'].includes(range)) return false;
    this.renderLifecycle.begin();
    this.screen = { ...this.screen, ganttRange: range };
    this.scheduleRender();
    return true;
  }

  async openFileInNewTab(file) {
    if (!file) return false;
    return this.app.workspace.getLeaf('tab').openFile(file);
  }

  handleActiveLeafChange(leaf) {
    if (!this.renderLifecycle.active) return false;
    const active = leaf === this.leaf;
    if (active === this.viewActive) return false;
    this.viewActive = active;
    if (active) {
      this.carouselController?.resume?.(VIEW_INACTIVE_REASON);
    } else {
      this.layoutView?.interruptActiveGesture?.();
      this.carouselController?.cancelPointerGesture?.();
      this.carouselController?.pause?.(VIEW_INACTIVE_REASON);
    }
    return true;
  }

  renderSafely() {
    return renderSafely(() => this.render(), (error) => this.reportRenderError(error));
  }

  requestRender() {
    if (this.queueRefreshWhileEditing()) return false;
    void this.renderSafely();
    return true;
  }

  reportRenderError(error) {
    new Notice(`工作台刷新失败：${error?.message || String(error)}`, 5000);
  }

  async openJournalInNewTab(journal) {
    try {
      await this.app.workspace.getLeaf('tab').openFile(journal.file);
    } catch (error) {
      console.error('[HZ Workbench] Failed to open journal', error);
      new Notice('无法打开对应日记，请稍后重试');
    }
  }

  el(parent, tag, cls, text) {
    const node = parent.createEl(tag, cls ? { cls } : undefined);
    if (text != null) node.setText(text);
    return node;
  }

  iconButton(parent, icon, label, handler) {
    const button = this.el(parent, 'button', 'hz-icon-button');
    button.setAttribute('aria-label', label);
    setIcon(button, icon);
    button.addEventListener('click', handler);
    return button;
  }

  renderQuickCapture(root) {
    const actions = [
      ['manual-time', 'history', '补记时间'],
      ['finance', 'wallet', '记录收支'],
      ['quick-note', 'pencil-line', '随手记'],
      ['meditation', 'sparkles', '今日冥想'],
    ];
    const bar = this.el(root, 'div', 'hz-quick-capture');
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', '快捷记录');
    for (const [action, icon, label] of actions) {
      const button = this.el(bar, 'button', 'hz-quick-capture-button');
      button.setAttribute('type', 'button');
      button.setAttribute('aria-label', label);
      button.title = label;
      setIcon(button, icon);
      this.el(button, 'span', 'hz-quick-capture-label', label);
      button.addEventListener('click', () => {
        if (action === 'quick-note') this.plugin.openDailyCapture('quick-note');
        else void this.plugin.handleDailyCapture({ action });
      });
    }
  }

  render() {
    const root = this.contentEl;
    if (!root) return Promise.resolve(false);
    return runRenderTransaction({
      lifecycle: this.renderLifecycle,
      getCurrentPath: () => this.carouselController?.currentItem()?.file.path || '',
      load: () => this.loadRenderPayload(),
      commit: (payload, preferredPath) => this.commitRender(root, payload, preferredPath),
    });
  }

  async loadRenderPayload() {
    if (this.screen?.type === 'project') {
      return { screen: 'project', cockpit: await this.loadProjectCockpitPayload() };
    }
    if (!Platform.isDesktopApp) {
      return { screen: 'home', data: await this.loadRenderData(), layout: null };
    }

    if (!this.layoutStore) {
      this.layoutStore = new LayoutStore({
        adapter: this.app.vault.adapter,
        configDir: this.app.vault.configDir,
        localStorage: this.windowRef.localStorage,
        uuid: () => deviceUuid(this.windowRef),
        onRecovery: (message) => new Notice(message),
      });
    }
    const [data, layout] = await Promise.all([
      this.loadRenderData(),
      this.layoutStore.load(),
    ]);
    return { screen: 'home', data, layout };
  }

  projectRepository() {
    return this.plugin.projectRepository || this.plugin.repository || null;
  }

  async loadProjectCockpitPayload() {
    const repository = this.projectRepository();
    const snapshot = { ...this.screen };
    const projectPath = snapshot.projectPath;
    const projectFile = this.app.vault?.getAbstractFileByPath?.(projectPath);
    if (!repository || !projectFile) return { missing: true, projectPath };
    try {
      const loaded = await repository.loadProject(projectFile);
      const [finance, journalRecords] = await Promise.all([
        repository.loadProjectFinance(loaded.project),
        repository.loadProjectJournalRecords(loaded.project),
      ]);
      return {
        missing: false,
        model: buildProjectCockpitModel({
          ...loaded,
          finance,
          journalRecords,
          selectedStagePath: snapshot.selectedStagePath,
          ganttRange: snapshot.ganttRange,
          today: dateKey(new Date()),
          diagnostics: loaded.diagnostics,
        }),
      };
    } catch (error) {
      return { missing: true, projectPath, error };
    }
  }

  async loadRenderData() {
    const [journals, taskSource] = await Promise.all([
      this.index.journals(),
      new TickTickReadAdapter(this.app).loadTasks(),
    ]);
    let projects = this.index.projects();
    const repository = this.projectRepository();
    if (repository) {
      try {
        const listed = await repository.listProjects();
        const entries = await Promise.all(listed.projects.map(async (project) => {
          try { return await repository.loadProject(project.file); } catch (error) { return { project, stages: [], diagnostics: [{ filePath: project.file.path, message: error.message }] }; }
        }));
        projects = { entries, diagnostics: listed.diagnostics || [] };
      } catch (error) { /* The existing index remains a safe home fallback. */ }
    }
    const schedules = this.index.schedules();
    const today = dateKey(new Date());
    const tasks = taskSource.tasks;
    const todayTasks = tasksForDate(tasks, today, { includeCompleted: true });
    if (taskSource.available) await this.normalizeFocusSelections(todayTasks, today);
    const dates = journals.map((journal) => journal.date);
    const counts = new Map();
    dates.forEach((date) => counts.set(date, (counts.get(date) || 0) + 1));
    return { journals, tasks, taskSource, projects, schedules, todayTasks, dates, counts };
  }

  queueRefreshWhileEditing() {
    const state = this.layoutController?.state;
    const busy = Boolean(this.layoutController)
      && (state?.mode !== 'idle' || this.layoutController?.saving);
    if (busy) this.pendingRefresh = true;
    return busy;
  }

  handleLayoutChange(state, nextLayout) {
    this.layoutView?.render(state, nextLayout);
    if (state.mode === 'idle') this.consumePendingRefresh();
  }

  consumePendingRefresh() {
    if (!this.pendingRefresh) return false;
    this.pendingRefresh = false;
    this.requestRender();
    return true;
  }

  destroyInteractiveControllers() {
    this.weatherController?.destroy();
    this.layoutView?.destroy();
    this.layoutController?.destroy();
    this.carouselController?.destroy();
    this.layoutView = null;
    this.layoutController = null;
    this.carouselController = null;
    this.weatherController = null;
    this.disposeStatClick?.();
    this.disposeStatClick = null;
  }

  commitRender(root, payload, preferredPath) {
    if (this.queueRefreshWhileEditing()) {
      return this.carouselController?.currentItem()?.file.path || preferredPath;
    }
    this.destroyInteractiveControllers();
    root.empty();
    this.applySchemeToHost();
    const scheme = this.activeScheme();
    root.className = `hz-workbench hz-theme-${this.plugin.settings.theme}${scheme ? ` ${schemeClass(scheme)}` : ''}${this.plugin.settings.reducedMotion ? ' hz-reduced-motion' : ''}`;
    if (payload.screen === 'project') {
      this.renderProjectCockpit(root, payload.cockpit);
      return '';
    }
    if (!Platform.isDesktopApp) {
      this.renderResponsiveWorkbench(root, payload.data, preferredPath);
    } else {
      this.renderDesktopWorkbench(root, payload.data, payload.layout, preferredPath);
    }
    this.renderQuickCapture(root);
    return this.carouselController?.currentItem()?.file.path || '';
  }

  activeScheme() {
    if (!this.plugin.settings.themeFollowsScheme) return '';
    return resolveScheme(this.windowRef?.document ?? globalThis.document);
  }

  applySchemeToHost() {
    toggleSchemeClass(this.containerEl, this.activeScheme());
  }

  handleColorSchemeChange() {
    this.applySchemeToHost();
    this.requestRender();
  }

  renderResponsiveWorkbench(root, data, preferredPath) {
    const app = this.el(root, 'div', 'hz-app');
    this.renderReservedRail(app);
    const shell = this.el(app, 'main', 'hz-shell');
    this.renderHeader(shell);
    // 移动端信息架构重排：高频「今日必完成 / 今日任务」提前到统计卡上方，
    // 让手机端一屏内即可看到当日焦点，减少纵向滚动。
    const focus = this.el(shell, 'div', 'hz-mobile-focus');
    this.renderMustDo(focus, data.todayTasks, data.taskSource);
    this.renderTasks(focus, data.todayTasks, data.taskSource);
    this.renderStats(shell, data);
    const left = this.el(shell, 'div', 'hz-left');
    this.renderJournal(left, data.journals, preferredPath);
    this.renderProjects(left, data.projects);

    // 移动端：统计卡点击平滑滚动到对应模块
    const onStatClick = (event) => {
      const card = event.target?.closest?.('[data-scroll-to]');
      if (!card) return;
      const target = shell.querySelector(card.dataset.scrollTo);
      target?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    };
    shell.addEventListener('click', onStatClick);
    this.disposeStatClick = () => shell.removeEventListener('click', onStatClick);
  }

  renderDesktopWorkbench(root, data, layout, preferredPath) {
    const viewport = this.el(root, 'div', 'hz-layout-viewport');
    const stage = this.el(viewport, 'div', 'hz-layout-stage');
    const canvas = this.el(stage, 'div', 'hz-layout-canvas');
    canvas.setAttribute('data-layout-canvas', '');

    this.moduleShell(canvas, 'sidebar', (content) => this.renderSidebar(content));
    this.moduleShell(canvas, 'agent-panel', (content) => this.renderReservedRail(content));
    this.moduleShell(canvas, 'header', (content) => this.renderHeader(content));
    this.moduleShell(canvas, 'stat-today-tasks', (content) => {
      this.statCard(content, '今日任务', String(data.todayTasks.length).padStart(2, '0'), '项任务', this.taskSourceCopy(data.taskSource));
    });
    this.moduleShell(canvas, 'stat-active-projects', (content) => {
      this.statCard(content, '进行中项目', String(this.projectCount(data.projects)).padStart(2, '0'), '个项目', '');
    });
    this.moduleShell(canvas, 'stat-today-schedule', (content) => {
      this.statCard(content, '今日日程', String(data.schedules.length).padStart(2, '0'), '项日程', '');
    });
    this.moduleShell(canvas, 'stat-journal-streak', (content) => this.renderHeatStat(content, data));
    this.moduleShell(canvas, 'journal-carousel', (content) => this.renderJournal(content, data.journals, preferredPath));
    this.moduleShell(canvas, 'projects', (content) => this.renderProjects(content, data.projects));
    this.moduleShell(canvas, 'must-do', (content) => this.renderMustDo(content, data.todayTasks, data.taskSource));
    this.moduleShell(canvas, 'today-tasks', (content) => this.renderTasks(content, data.todayTasks, data.taskSource));

    const initialLayout = cloneLayout(layout || DEFAULT_LAYOUT);
    this.layoutController = new LayoutController({
      initialLayout,
      scheduler: {
        setTimeout: (callback, delay) => this.windowRef.setTimeout(callback, delay),
        clearTimeout: (timer) => this.windowRef.clearTimeout(timer),
      },
      save: (nextLayout) => this.layoutStore.save(nextLayout),
      carousel: this.carouselController,
      onChange: (state, nextLayout) => this.handleLayoutChange(state, nextLayout),
      onNotice: (message) => new Notice(message),
    });
    this.layoutView = new LayoutView({
      viewport,
      stage,
      canvas,
      controller: this.layoutController,
      moduleDefinitions: MODULE_DEFINITIONS,
      renderIcon: (element, name) => setIcon(element, name),
      windowRef: this.windowRef,
    });
    this.layoutView.mount();
  }

  moduleShell(parent, moduleId, renderContent) {
    const shell = this.el(parent, 'section', 'hz-layout-module');
    shell.dataset.moduleId = moduleId;
    shell.dataset.moduleLabel = MODULE_DEFINITIONS[moduleId].label;
    const content = this.el(shell, 'div', 'hz-layout-content');
    content.style.width = `${MODULE_DEFINITIONS[moduleId].baseWidth}px`;
    content.style.height = `${MODULE_DEFINITIONS[moduleId].baseHeight}px`;
    renderContent(content);
    return shell;
  }

  renderSidebar(app) {
    const sidebar = this.el(app, 'aside', 'hz-sidebar');
    const brand = this.el(sidebar, 'div', 'hz-brand');
    const logo = this.el(brand, 'img', 'hz-brand-logo');
    logo.alt = 'HZ';
    logo.src = this.logoUrl();
    logo.addEventListener('error', () => { logo.remove(); });
    return sidebar;
  }

  logoUrl() {
    // 优先用 Obsidian 运行时注入的插件目录；社区市场移动端安装后 dir 通常有效。
    // 若解析失败（logo.png 未打包进 Release 附件），getResourcePath 会返回一个打不开的
    // 地址，交由调用方的 onerror 兜底隐藏，避免显示破图。
    const dir = this.plugin.manifest.dir || `.obsidian/plugins/${this.plugin.manifest.id}`;
    return this.app.vault.adapter.getResourcePath(normalizePath(`${dir}/logo.png`));
  }

  renderReservedRail(parent) {
    this.weatherController?.destroy();
    this.weatherController = null;
    const rail = this.el(parent, 'aside', 'hz-reserved-rail hz-weather-rail');
    // 天气系统已停用：保留该区域作为空占位，不初始化天气客户端/控制器。
    if (!this.plugin.settings.weatherEnabled) {
      this.el(rail, 'div', 'hz-weather-placeholder', '待扩展');
      return rail;
    }
    if (!this.plugin.weatherClient) return rail;
    try {
      this.weatherController = new WeatherController({
        section: rail,
        client: this.plugin.weatherClient,
        settings: this.plugin.settings,
        saveSettings: () => this.plugin.saveSettings(),
        scheduler: {
          setTimeout: (callback, delay) => this.windowRef.setTimeout(callback, delay),
          clearTimeout: (timer) => this.windowRef.clearTimeout(timer),
        },
        reducedMotion: this.plugin.settings.reducedMotion,
      });
      this.weatherController.mount();
    } catch (error) {
      console.error('[HZ Workbench] Failed to mount weather center', error);
      this.el(rail, 'p', 'hz-weather-fallback', '天气暂时不可用');
    }
    return rail;
  }

  copilotAgentEntryState() {
    const pluginEnabled = this.app.plugins?.enabledPlugins?.has?.(COPILOT_PLUGIN_ID) === true;
    const commandAvailable = Boolean(
      this.app.commands?.findCommand?.(COPILOT_AGENT_COMMAND_ID)
        || this.app.commands?.commands?.[COPILOT_AGENT_COMMAND_ID],
    );
    return resolveCopilotAgentEntry({
      desktop: Platform.isDesktopApp,
      pluginEnabled,
      commandAvailable,
    });
  }

  async openCopilotAgent() {
    if (!this.copilotAgentEntryState().available) return false;
    try {
      const result = await this.app.commands.executeCommandById(COPILOT_AGENT_COMMAND_ID);
      if (result === false) throw new Error('Copilot Agent Chat command returned false');
      return true;
    } catch (error) {
      console.error('[HZ Workbench] Failed to open Copilot Agent Chat', error);
      new Notice('无法打开 Copilot 智能体，请检查 Copilot 与 OpenCode 设置');
      return false;
    }
  }

  renderAgentPanel(parent) {
    const state = this.copilotAgentEntryState();
    const panel = this.el(parent, 'section', 'hz-agent-panel');
    const head = this.el(panel, 'div', 'hz-agent-head');
    this.el(head, 'h2', '', 'HZ 智能体');
    this.el(head, 'span', `hz-agent-status is-${state.kind}`, state.status);
    const entry = this.el(panel, 'div', 'hz-agent-entry');
    const icon = this.el(entry, 'span', 'hz-agent-entry-icon');
    setIcon(icon, 'bot');
    this.el(entry, 'strong', '', 'Copilot');
    const facts = this.el(entry, 'dl', 'hz-agent-facts');
    for (const [label, value] of [
      ['引擎', 'OpenCode'],
      ['默认模型', 'DeepSeek-V4-Flash'],
      ['权限', '修改前确认'],
    ]) {
      this.el(facts, 'dt', '', label);
      this.el(facts, 'dd', '', value);
    }
    this.el(entry, 'p', 'hz-agent-help', '对话与执行过程将在 Copilot Agent Chat 中进行');
    const open = this.el(entry, 'button', 'hz-agent-open');
    open.type = 'button';
    open.disabled = !state.available;
    open.setAttribute('aria-label', state.available ? '进入 Copilot 智能体' : state.status);
    setIcon(open, 'external-link');
    open.appendText('进入 Copilot 智能体');
    open.addEventListener('click', () => { void this.openCopilotAgent(); });
    return panel;
  }

  renderHeader(shell) {
    const header = this.el(shell, 'header', 'hz-header');
    const hello = this.el(header, 'div', 'hz-hello');
    const logo = this.el(hello, 'img', 'hz-header-logo');
    logo.alt = 'HZ';
    logo.src = this.logoUrl();
    logo.addEventListener('error', () => { logo.remove(); });
    const now = new Date();
    this.el(hello, 'small', '', `${dateKey(now)} · ${new Intl.DateTimeFormat('zh-CN', { weekday: 'long' }).format(now)} · ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
    const hour = now.getHours();
    const greeting = hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
    const title = this.el(hello, 'h1');
    title.appendText(`${greeting}，`);
    this.el(title, 'span', '', '瀚中');
    const actions = this.el(header, 'div', 'hz-head-actions');
    const search = this.el(actions, 'button', 'hz-search');
    setIcon(search, 'search');
    search.appendText('搜索笔记、项目或任务');
    search.addEventListener('click', () => this.app.commands.executeCommandById('switcher:open'));
    this.iconButton(actions, 'palette', '切换配色', () => {
      const keys = Object.keys(THEME_LABELS);
      const index = keys.indexOf(this.plugin.settings.theme);
      this.plugin.settings.theme = keys[(index + 1) % keys.length];
      void this.plugin.saveSettings().then(() => {
        this.requestRender();
        new Notice(`已切换为${THEME_LABELS[this.plugin.settings.theme]}`);
      }).catch((error) => this.reportRenderError(error));
    });
    this.iconButton(actions, 'plus', '记录今日', () => this.plugin.openDailyCapture());
  }

  renderStats(shell, data) {
    const stats = this.el(shell, 'section', 'hz-stats');
    const todayCard = this.statCard(stats, '今日任务', String(data.todayTasks.length).padStart(2, '0'), '项任务', this.taskSourceCopy(data.taskSource));
    const projectCard = this.statCard(stats, '进行中项目', String(this.projectCount(data.projects)).padStart(2, '0'), '个项目', '');
    this.statCard(stats, '今日日程', String(data.schedules.length).padStart(2, '0'), '项日程', '');
    this.renderHeatStat(stats, data);
    // 移动端：统计卡可点击跳转到对应模块
    todayCard.dataset.scrollTo = '.hz-mobile-focus';
    projectCard.dataset.scrollTo = '.hz-projects';
  }

  projectCount(projects) {
    const entries = Array.isArray(projects) ? projects : (projects?.entries || []);
    return entries.filter((entry) => {
      const project = entry.project || entry;
      return ['筹备中', '进行中'].includes(project.project_status || project.status);
    }).length;
  }

  renderHeatStat(parent, data) {
    const card = this.el(parent, 'article', 'hz-stat hz-heat-stat');
    card.dataset.scrollTo = '.hz-journal';
    const top = this.el(card, 'div', 'hz-stat-top');
    this.el(top, 'span', '', '连续日记');
    this.el(top, 'span', 'hz-trend', `${journalStreak(data.dates)} 天`);
    const summary = this.el(card, 'div', 'hz-heat-summary');
    this.el(summary, 'b', '', `连续 ${journalStreak(data.dates)} 天`);
    this.el(summary, 'span', '', `今年已记录 ${data.dates.filter((date) => date.startsWith(String(new Date().getFullYear()))).length} 篇`);
    const heatmap = this.el(card, 'div', 'hz-journal-heatmap');
    buildHeatmap(data.counts, new Date(), 13).forEach((cell) => {
      const dot = this.el(heatmap, 'i', `hz-heat-cell hz-level-${cell.level}`);
      dot.setAttribute('aria-label', `${cell.date}：${cell.count} 篇日记`);
      dot.title = `${cell.date} · ${cell.count} 篇`;
    });
  }

  statCard(parent, label, value, unit, foot) {
    const card = this.el(parent, 'article', 'hz-stat');
    const top = this.el(card, 'div', 'hz-stat-top');
    this.el(top, 'span', '', label);
    this.el(top, 'span', 'hz-trend', '实时');
    const valueEl = this.el(card, 'div', 'hz-stat-value');
    this.el(valueEl, 'b', '', value);
    this.el(valueEl, 'span', '', unit);
    if (foot) this.el(card, 'div', 'hz-stat-foot', foot);
    return card;
  }

  renderJournal(parent, journals, preferredPath = '') {
    const section = this.el(parent, 'section', 'hz-journal');
    const head = this.el(section, 'div', 'hz-section-head');
    const title = this.el(head, 'div', 'hz-section-title');
    this.el(title, 'small', '', 'JOURNAL MEMORY');
    this.el(title, 'h2', '', '日记回顾');
    this.carouselController = new CarouselController({
      section,
      journals,
      settings: this.plugin.settings,
      preferredPath,
      openJournal: (journal) => { void this.openJournalInNewTab(journal); },
    });
    this.carouselController.mount();
    if (!this.viewActive) this.carouselController.pause(VIEW_INACTIVE_REASON);
  }

  renderProjects(parent, projects) {
    const section = this.el(parent, 'section', 'hz-projects');
    const head = this.el(section, 'div', 'hz-projects-head');
    this.el(head, 'h2', '', '项目总览');
    const controls = this.el(head, 'div', 'hz-project-filters');
    ['active', '暂停', '已完成', '已归档', 'all'].forEach((filter) => {
      const button = this.el(controls, 'button', 'hz-project-filter', filter === 'active' ? '进行中' : filter === 'all' ? '全部' : filter);
      button.type = 'button';
      button.setAttribute('aria-pressed', String(this.projectFilter === filter));
      button.addEventListener('click', () => { this.projectFilter = filter; this.scheduleRender(); });
    });
    const create = this.el(head, 'button', 'hz-project-new', '新建项目');
    create.type = 'button';
    create.addEventListener('click', () => this.openProjectWizard());
    const grid = this.el(section, 'div', 'hz-project-grid');
    const source = Array.isArray(projects) ? projects.map((project) => ({ project, stages: [] })) : (projects?.entries || []);
    const overview = buildProjectOverviewModel(source, { filter: this.projectFilter, today: dateKey(new Date()) });
    if (!Array.isArray(projects)) overview.diagnostics.push(...(projects?.diagnostics || []));
    if (overview.diagnostics.length) { const diagnostics = this.el(section, 'p', 'hz-project-diagnostics', overview.diagnostics.map((item) => item.message).join('；')); diagnostics.setAttribute('aria-live', 'polite'); }
    if (!overview.cards.length) this.el(grid, 'div', 'hz-empty hz-project-empty', '没有匹配的项目');
    overview.cards.forEach((project, index) => {
      const card = this.el(grid, 'button', `hz-project${index === 0 ? ' is-primary' : ''}`);
      card.type = 'button';
      card.setAttribute('aria-label', `打开项目 ${project.title}`);
      const top = this.el(card, 'div', 'hz-project-top');
      this.el(top, 'b', '', project.title);
      this.el(top, 'span', 'hz-status', project.projectStatus);
      this.el(card, 'p', '', `当前阶段：${project.currentStage}`);
      this.el(card, 'small', '', `计划完成：${project.planEnd} · ${project.variance.label}`);
      const progress = this.el(card, 'div', 'hz-progress');
      progress.setAttribute('role', 'progressbar');
      progress.setAttribute('aria-valuemin', '0'); progress.setAttribute('aria-valuemax', '100');
      if (typeof project.progress === 'number') progress.setAttribute('aria-valuenow', String(project.progress));
      else progress.setAttribute('aria-valuetext', '待完善');
      const value = this.el(progress, 'i');
      value.style.width = `${typeof project.progress === 'number' ? project.progress : 0}%`;
      this.el(card, 'small', '', typeof project.progress === 'number' ? `${project.progress}%` : '待完善');
      if (project.diagnostics.length) this.el(card, 'small', 'hz-project-diagnostic', project.diagnostics[0].message);
      card.addEventListener('click', () => this.showProject(project.path));
    });
  }

  openProjectWizard() {
    const repository = this.projectRepository();
    if (!repository) {
      new Notice('项目仓储不可用，请刷新工作台后重试');
      return null;
    }
    return openProjectWizardModal({
      app: this.app,
      theme: this.plugin.settings.theme,
      repository,
      projectFolder: this.plugin.settings.projectFolder,
      onCreated: (result) => this.showProject(result.projectPath),
    }, { Modal, Notice, windowRef: this.windowRef });
  }

  renderProjectCockpit(root, payload) {
    const app = this.el(root, 'div', 'hz-app');
    this.renderReservedRail(app);
    const shell = this.el(app, 'main', 'hz-shell hz-project-shell');
    this.renderHeader(shell);
    const screen = this.el(shell, 'section', 'hz-project-cockpit');
    const live = this.el(screen, 'div', 'hz-project-live');
    live.setAttribute('aria-live', 'polite');
    if (payload?.missing) {
      this.el(screen, 'h1', '', '无法打开项目');
      this.el(screen, 'p', '', payload.error?.message || '项目不存在或已被移动。');
      const back = this.el(screen, 'button', 'hz-project-back', '返回首页'); back.type = 'button'; back.addEventListener('click', () => this.showHome());
      return;
    }
    const model = payload.model;
    const header = this.el(screen, 'header', 'hz-cockpit-header');
    const back = this.el(header, 'button', 'hz-project-back', '返回首页'); back.type = 'button'; back.addEventListener('click', () => this.showHome());
    const title = this.el(header, 'div', 'hz-cockpit-title'); this.el(title, 'h1', '', model.project.title); this.el(title, 'span', 'hz-status', model.project.projectStatus);
    this.el(header, 'p', '', `总体进度 ${typeof model.project.progress === 'number' ? `${model.project.progress}%` : '待完善'} · 当前阶段：${model.project.currentStage} · 计划完成：${model.project.planEnd} · ${model.project.variance.label}`);
    const ranges = this.el(screen, 'div', 'hz-gantt-ranges');
    [['month', '本月'], ['quarter', '三个月'], ['all', '全项目']].forEach(([range, label]) => {
      const button = this.el(ranges, 'button', 'hz-gantt-range', label); button.type = 'button'; button.setAttribute('aria-pressed', String(model.ganttRange === range)); button.addEventListener('click', () => this.setProjectGanttRange(range));
    });
    this.renderGantt(screen, model);
    this.renderStageDetail(screen, model.selectedStage, live);
    this.renderFinance(screen, model.finance, model.project.contractAmount);
    this.renderRecentRecords(screen, model.journalRecords);
    if (model.diagnostics.length) this.el(live, 'p', 'hz-project-diagnostics', model.diagnostics.map((item) => item.message).join('；'));
  }

  renderGantt(parent, model) {
    const gantt = this.el(parent, 'section', 'hz-gantt-desktop'); this.el(gantt, 'h2', '', '阶段甘特');
    const table = this.el(gantt, 'div', 'hz-gantt-table'); table.setAttribute('role', 'list');
    model.stages.forEach((stage) => {
      const row = this.el(table, 'div', `hz-gantt-row is-${stage.status}${stage.bar.draft ? ' is-draft' : ''}`); row.setAttribute('role', 'listitem'); row.addEventListener('click', () => this.selectProjectStage(stage.path));
      const select = this.el(row, 'button', 'hz-gantt-select', '选择'); select.type = 'button'; select.setAttribute('aria-label', `选择阶段 ${stage.title}`); select.addEventListener('click', (event) => { event.stopPropagation(); this.selectProjectStage(stage.path); });
      const open = this.el(row, 'button', 'hz-gantt-stage', stage.title); open.type = 'button'; open.setAttribute('aria-label', `在新标签打开阶段 ${stage.title}`); open.addEventListener('click', (event) => { event.stopPropagation(); void this.openFileInNewTab(stage.file); });
      const track = this.el(row, 'span', 'hz-gantt-track');
      if (!stage.bar.valid) this.el(track, 'span', 'hz-gantt-unscheduled', stage.bar.draft ? '草案排期' : '排期待完善');
      else { const bar = this.el(track, 'span', 'hz-gantt-plan'); bar.style.left = `${stage.bar.left}%`; bar.style.width = `${stage.bar.width}%`; if (stage.bar.actualLeft != null) { const actual = this.el(track, 'span', 'hz-gantt-actual'); actual.style.left = `${stage.bar.actualLeft}%`; actual.style.width = `${stage.bar.actualWidth}%`; } }
      if (stage.bar.draft) this.el(row, 'span', 'hz-gantt-draft', '草案排期');
      this.el(row, 'span', '', typeof stage.progress === 'number' ? `${stage.progress}%` : '待完善');
    });
    const today = dateKey(new Date()); const start = Date.parse(`${model.range?.start || ''}T00:00:00Z`); const end = Date.parse(`${model.range?.end || ''}T00:00:00Z`); const todayValue = Date.parse(`${today}T00:00:00Z`);
    if (Number.isFinite(start) && Number.isFinite(end) && todayValue >= start && todayValue <= end) { const line = this.el(table, 'i', 'hz-gantt-today', '今天'); line.style.left = `${end === start ? 0 : ((todayValue - start) / (end - start)) * 100}%`; }
    const mobile = this.el(parent, 'section', 'hz-stage-timeline-mobile'); this.el(mobile, 'h2', '', '阶段');
    model.stages.forEach((stage) => { const card = this.el(mobile, 'details', `hz-stage-mobile is-${stage.status}`); const summary = this.el(card, 'summary', '', `${stage.title} · ${stage.status} · ${typeof stage.progress === 'number' ? `${stage.progress}%` : '待完善'} · ${stage.planned_start || '日期待完善'}`); const open = this.el(card, 'button', 'hz-open-stage', '打开阶段笔记'); open.type = 'button'; open.addEventListener('click', () => void this.openFileInNewTab(stage.file)); this.renderStageDetail(card, stage, this.el(card, 'div', 'hz-project-live')); });
  }

  renderStageDetail(parent, stage, live) {
    const section = this.el(parent, 'section', 'hz-stage-detail'); this.el(section, 'h2', '', stage ? `当前阶段：${stage.title}` : '当前阶段');
    if (!stage) { this.el(section, 'p', '', '暂无阶段'); return; }
    if (stage.owner) this.el(section, 'p', '', `负责人：${stage.owner}`);
    [['材料/设备', stage.materials], ['等待原因', stage.waitingReasons], ['验收要点', stage.acceptanceCriteria]].forEach(([label, values]) => { if (values?.length) this.el(section, 'p', '', `${label}：${values.join('；')}`); });
    const checklist = this.el(section, 'div', 'hz-stage-checklist');
    stage.checklist.forEach((item, index) => {
      const label = this.el(checklist, 'label', 'hz-stage-item'); const input = this.el(label, 'input'); input.type = 'checkbox'; input.checked = Boolean(item.checked); input.setAttribute('aria-label', item.text || `细项 ${index + 1}`); label.appendText(item.text || `细项 ${index + 1}`);
      const pendingKey = `${stage.path}:${index}`; input.disabled = this.pendingStageItems.has(pendingKey);
      input.addEventListener('change', async () => { if (this.pendingStageItems.has(pendingKey)) { input.checked = !input.checked; return; } const wanted = input.checked; let failed = false; this.pendingStageItems.add(pendingKey); input.disabled = true; input.setAttribute('aria-busy', 'true'); try { await this.projectRepository().toggleStageItem(stage.file, index, wanted, dateKey(new Date())); live.setText('细项已保存'); this.requestRender(); } catch (error) { failed = true; input.checked = !wanted; new Notice(`保存细项失败：${error.message || error}`); } finally { this.pendingStageItems.delete(pendingKey); input.disabled = false; input.removeAttribute('aria-busy'); if (failed) this.requestRender(); } });
    });
  }

  renderFinance(parent, finance, contractAmount = 0) {
    const section = this.el(parent, 'section', 'hz-project-finance'); this.el(section, 'h2', '', '财务'); this.el(section, 'p', '', `合同金额：${contractAmount} · 累计收入：${finance.income} · 累计支出：${finance.expense} · 余额：${finance.balance}`);
    finance.categories.forEach((category) => { const details = this.el(section, 'details', 'hz-finance-category'); this.el(details, 'summary', '', `${category.category || category.name}：${category.total || 0}`); (category.entries || []).forEach((entry) => this.el(details, 'p', '', `${entry.date || entry.time || ''} · ${entry.item || entry.title || entry.name || ''} · ${entry.amount || 0}`)); });
    if (finance.invalidCount) this.el(section, 'p', 'hz-project-diagnostics', `有 ${finance.invalidCount} 条项目账目待检查`);
  }

  renderRecentRecords(parent, records) {
    const section = this.el(parent, 'section', 'hz-project-records'); this.el(section, 'h2', '', '最近记录'); if (!records.length) { this.el(section, 'p', '', '暂无项目记录'); return; }
    records.forEach((record) => { const row = this.el(section, 'div', 'hz-project-record'); this.el(row, 'span', '', `${record.date} · ${record.text}`); const button = this.el(row, 'button', 'hz-open-record', '打开日记'); button.type = 'button'; button.addEventListener('click', () => { const file = this.app.vault.getAbstractFileByPath(record.filePath); if (file) void this.openFileInNewTab(file); }); });
  }

  taskSourceCopy(taskSource) {
    return taskSource?.available
      ? ''
      : `TickTickSync 本地缓存不可用${taskSource?.reason ? ` · ${taskSource.reason}` : ''}`;
  }

  normalizedFocusSelections(tasks, today = dateKey(new Date())) {
    return toggleFocusSelection(
      this.plugin.settings.focusSelections,
      today,
      '',
      tasks.map((task) => task.id),
    ).selections;
  }

  async normalizeFocusSelections(tasks, today = dateKey(new Date())) {
    const current = Array.isArray(this.plugin.settings.focusSelections?.[today])
      ? this.plugin.settings.focusSelections[today]
      : [];
    const normalized = this.normalizedFocusSelections(tasks, today);
    const next = normalized[today] || [];
    if (current.length === next.length && current.every((taskId, index) => taskId === next[index])) return false;
    this.plugin.settings.focusSelections = normalized;
    await this.plugin.saveSettings();
    return true;
  }

  focusCheckbox(parent, task, tasks, taskSource, selections) {
    const today = dateKey(new Date());
    const selectedIds = selections[today] || [];
    const selected = selectedIds.includes(task.id);
    const checkbox = this.el(parent, 'input', 'hz-focus-checkbox');
    checkbox.type = 'checkbox';
    checkbox.checked = selected;
    checkbox.setAttribute('aria-label', selected ? `取消必完成：${task.title}` : `设为必完成：${task.title}`);
    checkbox.addEventListener('change', async () => {
      const result = toggleFocusSelection(
        this.normalizedFocusSelections(tasks, today),
        today,
        task.id,
        tasks.map((item) => item.id),
      );
      if (result.limitReached) {
        checkbox.checked = false;
        new Notice('今日必完成最多 3 项');
        return;
      }
      this.plugin.settings.focusSelections = result.selections;
      await this.plugin.saveSettings();
      this.refreshTaskPanels(tasks, taskSource);
    });
    return checkbox;
  }

  replaceTaskPanel(panel, renderer) {
    if (!panel?.parentElement) return null;
    const parent = panel.parentElement;
    const next = panel.nextSibling;
    panel.remove();
    const replacement = renderer(parent);
    if (next) parent.insertBefore(replacement, next);
    return replacement;
  }

  refreshTaskPanels(tasks, taskSource) {
    const mustDoPanel = this.mustDoPanel;
    const tasksPanel = this.tasksPanel;
    this.replaceTaskPanel(mustDoPanel, (parent) => this.renderMustDo(parent, tasks, taskSource));
    this.replaceTaskPanel(tasksPanel, (parent) => this.renderTasks(parent, tasks, taskSource));
  }

  renderMustDo(parent, tasks, taskSource) {
    const section = this.el(parent, 'section', 'hz-must');
    this.mustDoPanel = section;
    const head = this.el(section, 'div', 'hz-must-head');
    const title = this.el(head, 'div', 'hz-must-title');
    this.el(title, 'small', '', 'DAILY FOCUS');
    this.el(title, 'h2', '', '今日必完成');
    const today = dateKey(new Date());
    const selections = this.normalizedFocusSelections(tasks, today);
    const selectedIds = selections[today] || [];
    const mustTasks = selectedTasksForDate(tasks, selections, today);
    this.el(head, 'span', 'hz-count', `${mustTasks.length} / 3`);
    const list = this.el(section, 'div', 'hz-must-list');
    list.dataset.taskScroll = 'focus';
    mustTasks.forEach((task) => {
      const item = this.el(list, 'div', `hz-must-item${task.completed ? ' is-completed' : ''}`);
      item.dataset.taskId = task.id;
      const copy = this.el(item, 'div');
      this.el(copy, 'b', '', task.title);
      this.el(copy, 'small', '', task.completed ? '今日 · 已完成' : '今日 · 待完成');
    });
    if (!mustTasks.length) this.el(list, 'div', 'hz-must-empty', '从今日任务中选择最多 3 项');
    const sourceError = this.taskSourceCopy(taskSource);
    if (sourceError) {
      const sync = this.el(section, 'div', 'hz-sync-line');
      this.el(sync, 'i');
      sync.appendText(sourceError);
    }
    return section;
  }

  renderTasks(parent, tasks, taskSource) {
    const section = this.el(parent, 'section', 'hz-tasks');
    this.tasksPanel = section;
    const head = this.el(section, 'div', 'hz-tasks-head');
    this.el(head, 'h2', '', '今日任务');
    this.el(head, 'span', '', `${tasks.length} 项`);
    const tabs = this.el(section, 'div', 'hz-tabs');
    this.el(tabs, 'span', 'hz-tab is-active', '全部');
    const sourceError = this.taskSourceCopy(taskSource);
    if (sourceError) this.el(tabs, 'span', 'hz-tab', sourceError);
    const list = this.el(section, 'div', 'hz-task-list');
    list.dataset.taskScroll = 'today';
    const today = dateKey(new Date());
    const selections = this.normalizedFocusSelections(tasks, today);
    tasks.forEach((task) => {
      const item = this.el(list, 'div', `hz-task${task.completed ? ' is-completed' : ''}`);
      item.dataset.taskId = task.id;
      this.focusCheckbox(item, task, tasks, taskSource, selections);
      const copy = this.el(item, 'span');
      this.el(copy, 'b', '', task.title);
      this.el(copy, 'small', '', task.completed ? '已完成' : '待完成');
    });
    if (!tasks.length) this.el(list, 'div', 'hz-empty', taskSource?.available ? '今天没有任务' : this.taskSourceCopy(taskSource));
    return section;
  }

}

class WorkbenchSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'HZ 个人工作台设置' });
    containerEl.createEl('p', { text: '所有路径均相对于当前 Obsidian 仓库。修改后工作台会自动刷新。', cls: 'setting-item-description' });
    this.textSetting('日记目录', '用于日记轮播、连续天数和热力图。', 'dailyFolder');
    this.textSetting('日记模板路径', '今日日记不存在时，HZ 工作台直接读取此模板创建。', 'dailyTemplatePath');
    this.textSetting('日程目录', '统计今天 start 字段命中的日程。', 'scheduleFolder');
    this.textSetting('项目目录', '读取项目状态和下一步行动。', 'projectFolder');
    this.textSetting('进行中状态', '使用英文逗号分隔。', 'inProgressStatuses');
    containerEl.createEl('h3', { text: '每日记录' });
    this.textSetting('日记照片目录', '每日一张照片，保存为 YYYY-MM-DD.jpg。', 'dailyPhotoFolder');
    this.textSetting('时间分类', '使用逗号分隔。', 'timeCategories');
    this.textSetting('支出分类', '使用逗号分隔。', 'expenseCategories');
    this.textSetting('收入分类', '使用逗号分隔。', 'incomeCategories');
    this.textSetting('货币符号', '用于收支流水和汇总。', 'currencySymbol');

    new Setting(containerEl)
      .setName('显示日记填写提示')
      .setDesc('空栏目显示灰色填写引导；提示不会写入日记。')
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.showDailyGuidance).onChange(async (value) => {
        this.plugin.settings.showDailyGuidance = value;
        await this.plugin.saveSettings();
        this.plugin.refreshEditorGuidance();
      }));

    new Setting(containerEl)
      .setName('显示日记技术标记')
      .setDesc('排查问题时显示 hz:* 定位标记；默认隐藏。')
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.showDailyTechnicalMarkers).onChange(async (value) => {
        this.plugin.settings.showDailyTechnicalMarkers = value;
        await this.plugin.saveSettings();
        this.plugin.refreshEditorGuidance();
      }));

    new Setting(containerEl)
      .setName('显示月复盘编辑提示')
      .setDesc('月复盘空栏目显示灰色写作引导；提示不会写入笔记。')
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.showMonthlyGuidance).onChange(async (value) => {
        this.plugin.settings.showMonthlyGuidance = value;
        await this.plugin.saveSettings();
        this.plugin.refreshEditorGuidance();
      }));

    new Setting(containerEl)
      .setName('自动创建本月复盘')
      .setDesc('本月出现第一篇日记后，自动创建排在月初的月复盘文件。')
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.autoCreateMonthlyReview).onChange(async (value) => {
        this.plugin.settings.autoCreateMonthlyReview = value;
        await this.plugin.saveSettings();
        if (value) void this.plugin.monthlyReviewEnsurer.ensure();
      }));

    new Setting(containerEl)
      .setName('照片最长边')
      .setDesc('压缩后的像素尺寸。')
      .addSlider((slider) => slider.setLimits(640, 4096, 128).setValue(this.plugin.settings.dailyPhotoMaxEdge).setDynamicTooltip().onChange(async (value) => {
        this.plugin.settings.dailyPhotoMaxEdge = value;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName('照片质量')
      .setDesc('JPEG 压缩质量。')
      .addSlider((slider) => slider.setLimits(0.5, 1, 0.05).setValue(this.plugin.settings.dailyPhotoQuality).setDynamicTooltip().onChange(async (value) => {
        this.plugin.settings.dailyPhotoQuality = value;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName('记录后打开日记')
      .setDesc('保存成功后在新标签页打开今日日记。')
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.openDailyAfterCapture).onChange(async (value) => {
        this.plugin.settings.openDailyAfterCapture = value;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName('配色方案')
      .setDesc('可在工作台右上角快速轮换内置配色。')
      .addDropdown((dropdown) => {
        Object.entries(THEME_LABELS).forEach(([value, label]) => dropdown.addOption(value, label));
        dropdown.setValue(this.plugin.settings.theme).onChange(async (value) => {
          this.plugin.settings.theme = value;
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
        });
      });

    new Setting(containerEl)
      .setName('配色跟随 Obsidian 明暗')
      .setDesc('开启后，工作台与记录弹窗会自动跟随 Obsidian 的浅色/深色模式，为当前配色套用对应色调，无需手动切换。')
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.themeFollowsScheme).onChange(async (value) => {
        this.plugin.settings.themeFollowsScheme = value;
        await this.plugin.saveSettings();
        this.plugin.refreshViews();
      }));

    containerEl.createEl('h3', { text: '天气' });
    new Setting(containerEl)
      .setName('天气系统已停用')
      .setDesc('天气功能已关闭，工作台左侧保留空占位区域，将来有新想法再启用。天气相关代码与数据仍完整保留。')
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.weatherEnabled).onChange(async (value) => {
        this.plugin.settings.weatherEnabled = value;
        await this.plugin.saveSettings();
        this.plugin.refreshViews();
      }));

    new Setting(containerEl)
      .setName('日记自动轮播间隔')
      .setDesc('最短 3 秒。')
      .addSlider((slider) => slider.setLimits(3, 15, 1).setValue(this.plugin.settings.carouselSeconds).setDynamicTooltip().onChange(async (value) => {
        this.plugin.settings.carouselSeconds = value;
        await this.plugin.saveSettings();
        this.plugin.refreshViews();
      }));

    new Setting(containerEl)
      .setName('减少动态效果')
      .setDesc('关闭自动轮播、模糊和复杂过渡。')
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.reducedMotion).onChange(async (value) => {
        this.plugin.settings.reducedMotion = value;
        await this.plugin.saveSettings();
        this.plugin.refreshViews();
      }));

    new Setting(containerEl)
      .setName('启动时打开工作台')
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.startOnLaunch).onChange(async (value) => {
        this.plugin.settings.startOnLaunch = value;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName('任务数据源')
      .setDesc('TickTickSync 本地缓存 · 仅展示。今日必完成选择仅保存在 HZ 工作台数据中。');
  }

  textSetting(name, description, key) {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(description)
      .addText((text) => text.setValue(this.plugin.settings[key]).onChange(async (value) => {
        this.plugin.settings[key] = value.trim();
        await this.plugin.saveSettings();
        this.plugin.refreshViews();
      }));
  }
}

class HZWorkbenchPlugin extends Plugin {
  async onload() {
    this.pluginActive = true;
    await this.loadSettings();
    this.projectRepository = new ProjectRepository(this.app, this.settings);
    this.weatherClient = this.createWeatherClient();
    this.editorGuidanceExtensions = [
      this.dailyEditorGuidanceExtension(),
      this.monthlyEditorGuidanceExtension(),
    ];
    if (typeof this.registerEditorExtension === 'function') {
      this.registerEditorExtension(this.editorGuidanceExtensions);
    }
    this.markdownTaskProcessorActive = true;
    this.monthlyProcessorActive = true;
    this.monthlyReviewEnsurer = new MonthlyReviewEnsurer({
      vault: this.app.vault,
      dailyFolder: () => this.settings.dailyFolder,
      enabled: () => this.settings.autoCreateMonthlyReview,
      render: renderMonthlyReviewTemplate,
      onCreated: (month) => new Notice(`已自动创建 ${month.slice(0, 4)}年${month.slice(5)}月复盘`),
      onError: (error) => {
        console.error('[HZ Workbench] Failed to create monthly review', error);
        new Notice('自动创建本月复盘失败，请稍后手动创建。');
      },
      isActive: () => this.monthlyProcessorActive,
    });
    this.registerMarkdownCodeBlockProcessor('hz-tasks', (source, container, context) => {
      const child = new Component();
      let active = false;
      child.onload = () => {
        active = true;
        void this.renderDailyTaskProcessor(
          source,
          container,
          context.sourcePath,
          () => active && this.markdownTaskProcessorActive,
        );
      };
      child.onunload = () => {
        active = false;
        if (typeof container.empty === 'function') container.empty();
        else container.replaceChildren();
      };
      context.addChild(child);
    });
    this.registerMonthlyProcessor('hz-month-tasks', this.renderMonthlyTaskProcessor);
    this.registerMonthlyProcessor('hz-month-finance', this.renderMonthlyFinanceProcessor);
    this.registerView(VIEW_TYPE, (leaf) => new WorkbenchView(leaf, this));
    this.addRibbonIcon('layout-dashboard', '打开 HZ 个人工作台', () => this.activateView());
    this.addCommand({ id: 'open-workbench', name: '打开个人工作台', callback: () => this.activateView() });
    this.addCommand({ id: 'refresh-workbench', name: '刷新个人工作台数据', callback: () => this.refreshViews() });
    this.addCommand({ id: 'record-today', name: '记录今日', callback: () => this.openDailyCapture() });
    this.addCommand({ id: 'open-today-journal', name: '打开今日日记', callback: () => this.handleDailyCapture({ action: 'open-today' }) });
    this.addCommand({ id: 'finish-current-timer', name: '结束当前计时', callback: () => this.handleDailyCapture({ action: 'finish-time' }) });
    this.addCommand({ id: 'capture-manual-time', name: '补记时间', callback: () => this.handleDailyCapture({ action: 'manual-time' }) });
    this.addCommand({ id: 'capture-finance', name: '记录收支', callback: () => this.handleDailyCapture({ action: 'finance' }) });
    this.addCommand({ id: 'capture-quick-note', name: '随手记', callback: () => this.openDailyCapture('quick-note') });
    this.addCommand({ id: 'capture-meditation', name: '今日冥想', callback: () => this.handleDailyCapture({ action: 'meditation' }) });
    this.addCommand({
      id: 'preview-dikanju-project-rebuild',
      name: '预检一次性重建：省地勘局宿舍',
      callback: async () => {
        const preview = await preflightDikanjuMigration(this.app.vault);
        if (!preview.valid) {
          new Notice(`省地勘局宿舍重建预检失败：${preview.errors.join('；')}`);
          return;
        }
        console.info('[HZ Workbench] 省地勘局宿舍重建预览', buildDikanjuMigrationPreview());
        new Notice(`重建预检通过：${preview.projectFiles.length} 个项目文件与 ${preview.supportFiles.length} 个配套文件；未写入 Vault`);
      },
    });
    this.addCommand({
      id: 'execute-dikanju-project-rebuild',
      name: '执行一次性重建：省地勘局宿舍',
      callback: async () => {
        const preview = await preflightDikanjuMigration(this.app.vault);
        if (!preview.valid) {
          new Notice(`省地勘局宿舍重建预检失败：${preview.errors.join('；')}`);
          return;
        }
        const confirmed = window.confirm(
          '仅执行一次：删除“02 项目/省地勘局宿舍”旧目录并立即按新模板重建。已在内存中验证 16 个项目文件。确认继续？',
        );
        if (!confirmed) return;
        try {
          const result = await executeDikanjuMigration(this.app.vault);
          new Notice(`省地勘局宿舍重建完成：${result.projectFileCount} 个项目文件，${result.supportFileCount} 个配套文件`);
          this.refreshViews();
        } catch (error) {
          console.error('[HZ Workbench] 省地勘局宿舍重建失败', error);
          new Notice(`省地勘局宿舍重建失败：${error.message || error}`);
        }
      },
    });
    if (typeof this.registerObsidianProtocolHandler === 'function') {
      this.registerObsidianProtocolHandler('hz-workbench-capture', (params) => { void this.handleDailyCapture(params); });
    }
    this.addSettingTab(new WorkbenchSettingTab(this.app, this));
    this.registerEvent(this.app.vault.on('create', (file) => {
      this.refreshViews();
      void this.monthlyReviewEnsurer.handleCreate(file);
    }));
    this.registerEvent(this.app.vault.on('modify', () => this.refreshViews()));
    this.registerEvent(this.app.vault.on('delete', () => this.refreshViews()));
    this.registerEvent(this.app.metadataCache.on('changed', () => this.refreshViews()));
    this.app.workspace.onLayoutReady(() => {
      void this.monthlyReviewEnsurer.ensure();
      if (this.settings.startOnLaunch) void this.activateView();
    });
  }

  async onunload() {
    this.pluginActive = false;
    this.markdownTaskProcessorActive = false;
    this.monthlyProcessorActive = false;
    this.monthlyReviewEnsurer?.destroy();
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  registerMonthlyProcessor(language, render) {
    this.registerMarkdownCodeBlockProcessor(language, (source, container, context) => {
      const child = new Component();
      let active = false;
      child.onload = () => {
        active = true;
        void render.call(
          this,
          source,
          container,
          context.sourcePath,
          () => active && this.monthlyProcessorActive,
        ).catch(() => {});
      };
      child.onunload = () => {
        active = false;
        if (typeof container.empty === 'function') container.empty();
        else container.replaceChildren();
      };
      context.addChild(child);
    });
  }

  async renderDailyTaskProcessor(source, container, sourcePath, isActive) {
    try {
      const options = parseTaskBlockSource(source);
      const sourceDate = resolveSourceDate(this.app, sourcePath);
      const taskSource = await new TickTickReadAdapter(this.app).loadTasks();
      if (!isActive()) return;
      const targetDate = sourceDate && options.scope === 'tomorrow'
        ? nextLocalDate(sourceDate)
        : sourceDate;
      const includeCompleted = options.scope === 'today' && options.includeCompleted;
      const tasks = sourceDate
        ? tasksForDate(taskSource.tasks, targetDate, { includeCompleted })
        : [];
      renderDailyTaskBlock(container, tasks, {
        ...options,
        date: targetDate,
        available: taskSource.available,
        reason: taskSource.reason,
      });
    } catch (error) {
      if (!isActive()) return;
      renderDailyTaskBlock(container, [], {
        scope: 'today',
        date: resolveSourceDate(this.app, sourcePath),
        error,
      });
    }
  }

  async renderMonthlyTaskProcessor(source, container, sourcePath, isActive) {
    try {
      const resolved = resolveMonthlySource(this.app, sourcePath);
      if (!resolved.context.ok) {
        if (isActive()) renderMonthlyTaskBlock(container, {}, { context: resolved.context });
        return;
      }
      const taskSource = await new TickTickReadAdapter(this.app).loadTasks();
      if (!isActive()) return;
      const view = buildMonthlyTaskView(taskSource.tasks, resolved.context);
      renderMonthlyTaskBlock(container, view, {
        context: resolved.context,
        available: taskSource.available,
      });
    } catch (error) {
      if (!isActive()) return;
      console.error('[HZ Workbench] Failed to render monthly tasks', error);
      renderMonthlyErrorBlock(container, '月复盘任务加载失败，请稍后重试。');
    }
  }

  async renderMonthlyFinanceProcessor(source, container, sourcePath, isActive) {
    try {
      const resolved = resolveMonthlySource(this.app, sourcePath);
      if (!resolved.context.ok) {
        if (isActive()) renderMonthlyFinanceBlock(container, {}, { context: resolved.context });
        return;
      }
      const loaded = await loadMonthlyFinanceNotes(this.app, resolved.context, this.settings.dailyFolder);
      if (!isActive()) return;
      const view = buildMonthlyFinanceView(loaded.notes, resolved.context);
      renderMonthlyFinanceBlock(
        container,
        view,
        { context: resolved.context, readErrors: loaded.readErrors },
        (path) => { void this.openMonthlySourceInNewTab(path); },
      );
    } catch (error) {
      if (!isActive()) return;
      console.error('[HZ Workbench] Failed to render monthly finance', error);
      renderMonthlyErrorBlock(container, '月复盘收支加载失败，请稍后重试。');
    }
  }

  async openMonthlySourceInNewTab(path) {
    try {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!file) throw new Error(`Source note not found: ${path}`);
      await this.app.workspace.getLeaf('tab').openFile(file);
    } catch (error) {
      console.error('[HZ Workbench] Failed to open monthly finance source', error);
      new Notice('无法打开对应日记，请检查文件是否仍然存在。');
    }
  }

  async loadSettings() {
    const loaded = await this.loadData() || {};
    this.settings = normalizeWeatherSettings(normalizeCaptureSettings(Object.assign({}, DEFAULT_SETTINGS, loaded, {
      focusSelections: { ...(loaded.focusSelections || {}) },
    })));
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  refreshViews() {
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => leaf.view.scheduleRender?.());
  }

  createWeatherClient() {
    const request = typeof obsidianRequestUrl === 'function'
      ? obsidianRequestUrl
      : async () => { throw new Error('Obsidian requestUrl is unavailable'); };
    return new WeatherClient({
      requestUrl: request,
      store: {
        get: async (key) => this.settings.weatherCache?.[key],
        set: async (key, value) => {
          const next = { ...(this.settings.weatherCache || {}), [key]: value };
          this.settings.weatherCache = Object.fromEntries(Object.entries(next)
            .sort((a, b) => Number(b[1]?.fetchedAt || 0) - Number(a[1]?.fetchedAt || 0))
            .slice(0, MAX_WEATHER_CACHE_ENTRIES));
          await this.saveSettings();
        },
      },
    });
  }

  refreshWeather() {
    const refreshes = this.app.workspace.getLeavesOfType(VIEW_TYPE)
      .map((leaf) => leaf.view.weatherController?.refresh?.({ force: true }))
      .filter(Boolean);
    return Promise.allSettled(refreshes);
  }

  async openWeatherSearch() {
    await this.activateView();
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    const input = leaf?.view?.contentEl?.querySelector?.('.hz-weather-search input');
    input?.focus?.();
    return Boolean(input);
  }

  dailyEditorGuidanceExtension() {
    return createDailyEditorGuidanceExtension({
      settings: this.settings,
      onAction: (action) => this.handleDailyEditorGuidanceAction(action),
    });
  }

  monthlyEditorGuidanceExtension() {
    return createMonthlyEditorGuidanceExtension({ settings: this.settings });
  }

  handleDailyEditorGuidanceAction(action) {
    try {
      const file = this.app.workspace.getActiveFile?.();
      const target = resolveJournalCaptureTarget({
        file,
        frontmatter: file ? this.app.metadataCache.getFileCache(file)?.frontmatter || {} : {},
        dailyFolder: this.settings.dailyFolder,
      });
      const captureAction = action === 'record-today' ? 'manual-time' : action;
      if (['photo', 'manual-time', 'finance'].includes(captureAction)) this.openDailyCapture(captureAction, target);
    } catch (error) {
      new Notice(`无法补记：${error.message}`);
    }
  }

  refreshEditorGuidance() {
    if (!this.editorGuidanceExtensions) return;
    this.editorGuidanceExtensions.splice(
      0,
      this.editorGuidanceExtensions.length,
      this.dailyEditorGuidanceExtension(),
      this.monthlyEditorGuidanceExtension(),
    );
    this.app.workspace.updateOptions();
  }

  dailyCaptureClock() {
    return new Date();
  }

  dailyCaptureService() {
    if (!this.captureService) {
      this.captureService = new DailyCaptureService({
        app: this.app,
        settings: this.settings,
        saveSettings: () => this.saveSettings(),
        isActive: () => this.pluginActive === true,
        now: this.dailyCaptureClock,
      });
    }
    return this.captureService;
  }

  openDailyCapture(action = '', target = null) {
    openDailyCaptureModal(this, action, this.dailyCaptureService(), {
      Modal, Notice, windowRef: globalThis, target, now: this.dailyCaptureClock,
    });
  }

  async handleDailyCapture(params = {}) {
    try {
      const action = String(params.action || '').trim();
      if (!action) return this.openDailyCapture();
      return await routeCaptureAction(action, params, {
        service: this.dailyCaptureService(),
        openModal: async (value) => this.openDailyCapture(value),
      });
    } catch (error) {
      console.error('[HZ Workbench] daily capture failed', error);
      new Notice(`记录失败：${error.message}`);
      return null;
    }
  }

  async activateView() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf('tab');
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
  }
}

module.exports = HZWorkbenchPlugin;
module.exports.deviceUuid = deviceUuid;
module.exports.WorkbenchView = WorkbenchView;
module.exports.WorkbenchIndex = WorkbenchIndex;
module.exports.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
module.exports.normalizeWeatherSettings = normalizeWeatherSettings;
