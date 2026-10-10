const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.resolve(__dirname, '../src/main.js'), 'utf8');

function installDomHelpers(window) {
  const { HTMLElement } = window;
  HTMLElement.prototype.createEl = function createEl(tag, options = {}) {
    const element = this.ownerDocument.createElement(tag);
    if (options.cls) element.className = options.cls;
    if (options.text != null) element.textContent = options.text;
    this.append(element);
    return element;
  };
  HTMLElement.prototype.setText = function setText(value) { this.textContent = value; };
  HTMLElement.prototype.appendText = function appendText(value) { this.append(String(value)); };
  HTMLElement.prototype.empty = function empty() { this.replaceChildren(); };
}

function loadMain({ WeatherController, WeatherClient } = {}) {
  const module = { exports: {} };
  class ItemView {
    constructor(leaf) {
      this.leaf = leaf;
      this.app = leaf?.app;
      this.containerEl = leaf?.containerEl;
      this.contentEl = leaf?.contentEl;
    }
  }
  const obsidian = {
    Plugin: class {}, Component: class {}, ItemView, PluginSettingTab: class {}, Setting: class {},
    Modal: class {}, Notice: class {}, Platform: { isDesktopApp: true }, normalizePath: (value) => value,
    setIcon: () => {}, requestUrl: async () => { throw new Error('network disabled in test'); },
  };
  const localRequire = (request) => {
    if (request === 'obsidian') return obsidian;
    if (request === './weather-controller' && WeatherController) {
      return { WeatherController, DEFAULT_WEATHER_LOCATION: require('../src/weather-controller').DEFAULT_WEATHER_LOCATION };
    }
    if (request === './weather-client' && WeatherClient) return { WeatherClient };
    return require(path.resolve(__dirname, '../src', request));
  };
  vm.runInNewContext(source, { module, exports: module.exports, require: localRequire, window: {}, console });
  return module.exports;
}

test('weather settings normalize to Jinan, preserve unrelated settings, and bound public cache and recents', () => {
  const main = loadMain();
  const normalized = main.normalizeWeatherSettings({
    theme: 'ocean',
    weatherLocation: { name: '坏坐标', latitude: '36', longitude: 117, timezone: '' },
    weatherRecentLocations: [
      ...Array.from({ length: 8 }, (_, index) => ({
        id: `city-${index}`, name: `城市${index}`, latitude: index, longitude: index + 1, timezone: 'Asia/Shanghai',
      })),
      { id: 'city-0', name: '重复', latitude: 0, longitude: 1, timezone: 'Asia/Shanghai' },
    ],
    weatherCache: Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`key-${index}`, { fetchedAt: index }])),
  });

  assert.equal(normalized.theme, 'ocean');
  assert.equal(normalized.weatherLocation.name, '济南');
  assert.equal(normalized.weatherRecentLocations.length, 5);
  assert.deepEqual(Object.keys(normalized.weatherCache), ['key-8', 'key-7', 'key-6', 'key-5', 'key-4', 'key-3']);
  assert.equal(normalized.weatherRefreshMinutes, 30);
});

test('agent-panel remains the saved layout id while its user-facing label becomes 天气', () => {
  const { MODULE_DEFINITIONS, DEFAULT_LAYOUT } = require('../src/layout-model');
  assert.equal(MODULE_DEFINITIONS['agent-panel'].label, '天气');
  assert.ok(DEFAULT_LAYOUT['agent-panel']);
});

test('production rail mounts one controller without adding another logo and destroys it on replacement', () => {
  const mounts = [];
  class WeatherController {
    constructor(options) { this.options = options; mounts.push(this); }
    mount() { this.mounted = true; }
    destroy() { this.destroyed = true; }
  }
  const { WorkbenchView } = loadMain({ WeatherController });
  const dom = new JSDOM('<main id="host"></main>');
  installDomHelpers(dom.window);
  const host = dom.window.document.querySelector('#host');
  const settings = { weatherEnabled: true, weatherLocation: {}, weatherRecentLocations: [], reducedMotion: true };
  const plugin = { settings, weatherClient: {}, saveSettings: async () => {}, manifest: { id: 'hz-workbench' } };
  const view = new WorkbenchView({ app: {} }, plugin, { windowRef: dom.window });

  view.renderReservedRail(host);
  assert.equal(mounts.length, 1);
  assert.equal(mounts[0].mounted, true);
  assert.equal(mounts[0].options.section.classList.contains('hz-reserved-rail'), true);
  assert.equal(mounts[0].options.client, plugin.weatherClient);
  assert.equal(mounts[0].options.reducedMotion, true);
  assert.equal(host.querySelectorAll('.hz-brand-logo').length, 0);

  view.renderReservedRail(host);
  assert.equal(mounts[0].destroyed, true);
  view.destroyInteractiveControllers();
  assert.equal(mounts[1].destroyed, true);
  dom.window.close();
});

test('responsive workbench places weather before stats and desktop mount errors do not block rendering', () => {
  class WeatherController { constructor() { throw new Error('weather failed'); } }
  const { WorkbenchView } = loadMain({ WeatherController });
  const dom = new JSDOM('<main id="root"></main>');
  installDomHelpers(dom.window);
  const root = dom.window.document.querySelector('#root');
  const view = new WorkbenchView({ app: {} }, {
    settings: { weatherEnabled: true, weatherLocation: {}, weatherRecentLocations: [], reducedMotion: false },
    weatherClient: {}, saveSettings: async () => {}, manifest: { id: 'hz-workbench' },
  }, { windowRef: dom.window });
  for (const method of ['renderHeader', 'renderJournal', 'renderProjects', 'renderMustDo', 'renderTasks']) {
    view[method] = () => {};
  }
  view.renderStats = (parent) => view.el(parent, 'section', 'hz-stats');

  assert.doesNotThrow(() => view.renderResponsiveWorkbench(root, {
    journals: [], projects: [], todayTasks: [], taskSource: {}, dates: [], schedules: [], counts: new Map(),
  }, ''));
  const app = root.querySelector('.hz-app');
  assert.equal(app.firstElementChild.classList.contains('hz-reserved-rail'), true);
  assert.ok(app.querySelector('.hz-weather-fallback'));
  assert.ok(app.querySelector('.hz-stats'));
  dom.window.close();
});

test('weather disabled by default renders an empty placeholder rail without mounting a controller', () => {
  const mounts = [];
  class WeatherController {
    constructor() { mounts.push(this); }
    mount() { this.mounted = true; }
    destroy() {}
  }
  const { WorkbenchView } = loadMain({ WeatherController });
  const dom = new JSDOM('<main id="host"></main>');
  installDomHelpers(dom.window);
  const host = dom.window.document.querySelector('#host');
  // 默认 weatherEnabled 未设置（undefined/falsy）→ 停用路径
  const settings = { weatherLocation: {}, weatherRecentLocations: [], reducedMotion: false };
  const plugin = { settings, weatherClient: {}, saveSettings: async () => {}, manifest: { id: 'hz-workbench' } };
  const view = new WorkbenchView({ app: {} }, plugin, { windowRef: dom.window });

  view.renderReservedRail(host);
  assert.equal(mounts.length, 0);
  const rail = host.querySelector('.hz-reserved-rail');
  assert.ok(rail, 'rail container still present');
  assert.ok(rail.querySelector('.hz-weather-placeholder'), 'placeholder rendered');
  assert.equal(rail.querySelector('.hz-weather-placeholder').textContent, '待扩展');
  dom.window.close();
});
