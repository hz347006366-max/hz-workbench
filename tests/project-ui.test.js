const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const main = fs.readFileSync(path.resolve(__dirname, '../src/main.js'), 'utf8');
const css = fs.readFileSync(path.resolve(__dirname, '../styles.css'), 'utf8');

test('project cockpit is rendered through repository-backed overview and semantic controls', () => {
  assert.match(main, /buildProjectOverviewModel/);
  assert.match(main, /buildProjectCockpitModel/);
  assert.match(main, /renderProjectCockpit/);
  assert.match(main, /toggleStageItem/);
  assert.match(main, /aria-live/);
  assert.match(main, /type = 'checkbox'/);
});

test('project workspace CSS is leaf-adaptive, accessible, and has a mobile timeline', () => {
  assert.match(css, /\.hz-reserved-rail\{/);
  assert.match(css, /\.hz-gantt-desktop\{/);
  assert.match(css, /\.hz-stage-timeline-mobile\{/);
  assert.match(css, /@media\(max-width:900px\)/);
  assert.match(css, /min-height:44px/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.doesNotMatch(css, /grayscale\(/);
});

test('project overview opens a native two-step wizard and only enters the cockpit after creation', () => {
  assert.match(main, /openProjectWizardModal/);
  assert.match(main, /openProjectWizard\(\)/);
  assert.match(main, /onCreated:.*showProject/s);
  assert.doesNotMatch(main, /新建项目向导将在下一步启用/);
  assert.doesNotMatch(main, /(?:window\.)?alert\(/);
});

test('project wizard CSS keeps every interactive target mobile-safe and exposes focus states', () => {
  assert.match(css, /\.hz-project-wizard-modal/);
  assert.match(css, /\.hz-project-wizard-(?:button|move|delete|add)[^}]*min-height:44px/s);
  assert.match(css, /\.hz-project-wizard-stage[^}]*touch-action:/s);
  assert.match(css, /\.hz-project-wizard-modal[^}]*:focus-visible/s);
  const mobile = css.slice(css.lastIndexOf('@media(max-width:480px)'));
  assert.match(mobile, /\.hz-project-wizard-grid\{grid-template-columns:1fr\}/);
});

test('cockpit shares the app rail/header shell and themes expose semantic status tokens', () => {
  assert.match(main, /renderReservedRail\(app\)/);
  assert.match(main, /hz-project-shell/);
  assert.match(main, /now\.getHours\(\).*padStart\(2, '0'\)/);
  assert.match(main, /now\.getMinutes\(\).*padStart\(2, '0'\)/);
  for (const theme of ['hz-workbench', 'hz-theme-ocean', 'hz-theme-amber', 'hz-theme-violet', 'hz-theme-monochrome']) {
    assert.match(css, new RegExp(`\\.${theme}\\{[^}]*--warning:[^;]+;[^}]*--success:`));
  }
});

test('desktop project shell reserves a rail column and mobile collapses to one column', () => {
  assert.match(css, /\.hz-app\{[^}]*grid-template-columns:clamp\([^}]+minmax\(0,1fr\)/);
  assert.match(css, /\.hz-reserved-rail\{[^}]*grid-column:1/);
  assert.match(css, /\.hz-project-shell\{[^}]*grid-column:2/);
  const mobile = css.slice(css.lastIndexOf('@media(max-width:900px)'));
  assert.match(mobile, /\.hz-weather-rail\{display:flex!important;grid-column:1;grid-row:1/);
  assert.match(mobile, /\.hz-app>\.hz-weather-rail\+\.hz-shell\{grid-row:2/);
});

test('final responsive rail rules explicitly cover both sides of 900px', () => {
  const desktop = css.slice(css.lastIndexOf('@media(min-width:901px)'));
  assert.match(desktop, /\.hz-app:has\(>\.hz-weather-rail\)\{grid-template-columns:306px minmax\(0,1fr\)/);
  assert.match(css, /\.hz-app \.hz-shell,\.hz-app \.hz-project-shell\{grid-column:2;grid-row:1/);
  const mobile = css.slice(css.lastIndexOf('@media(max-width:900px)'));
  assert.match(css, /\.hz-app\{grid-template-columns:minmax\(0,1fr\)/);
  assert.match(mobile, /\.hz-app>\.hz-weather-rail\+\.hz-shell\{grid-row:2/);
});

test('theme semantic tokens override the base through later higher-specificity selectors', () => {
  const base = css.lastIndexOf('.hz-workbench{--warning:');
  assert.ok(base >= 0);
  for (const theme of ['emerald', 'ocean', 'amber', 'violet', 'monochrome']) {
    const selector = `.hz-workbench.hz-theme-${theme}{--warning:`;
    assert.ok(css.indexOf(selector) > base, `${theme} must override base after it`);
  }
});

test('renderProjectCockpit mounts the shared rail and clock into one DOM tree', () => {
  const dom = new JSDOM('<div id="root"></div>'); domHelpers(dom); const WorkbenchView = loadView(dom);
  const app = { vault: { adapter: { getResourcePath: () => 'logo.png' } }, commands: { executeCommandById: () => {} } };
  const plugin = { app, manifest: { dir: '.obsidian/plugins/hz-workbench' }, settings: { theme: 'emerald' } };
  const view = new WorkbenchView({}, plugin, { windowRef: dom.window }); view.app = app;
  const root = dom.window.document.querySelector('#root'); view.renderProjectCockpit(root, { missing: true });
  assert.ok(root.querySelector('.hz-app > .hz-reserved-rail'));
  assert.ok(root.querySelector('.hz-app > .hz-project-shell'));
  assert.match(root.querySelector('.hz-header small').textContent, /\b\d{2}:\d{2}\b/);
  dom.window.close();
});

function loadView(dom) {
  const module = { exports: {} };
  const obsidian = { Plugin: class {}, ItemView: class {}, PluginSettingTab: class {}, Setting: class {}, Modal: class {}, Notice: class {}, Platform: { isDesktopApp: false }, normalizePath: (value) => value, setIcon: () => {} };
  vm.runInNewContext(main, { module, exports: module.exports, require: (request) => request === 'obsidian' ? obsidian : require(path.resolve(__dirname, '../src', request)), window: dom.window, console });
  return module.exports.WorkbenchView;
}

function domHelpers(dom) {
  const { Element } = dom.window;
  Element.prototype.createEl = function createEl(tag, options = {}) { const el = this.ownerDocument.createElement(tag); if (options.cls) el.className = options.cls; this.appendChild(el); return el; };
  Element.prototype.setText = function setText(value) { this.textContent = String(value); };
  Element.prototype.appendText = function appendText(value) { this.append(String(value)); };
}

test('finance uses contract amount and category entry details while a pending checkbox sends one repository write', async () => {
  const dom = new JSDOM('<div id="root"></div>'); domHelpers(dom);
  const WorkbenchView = loadView(dom); const root = dom.window.document.querySelector('#root');
  let resolveWrite; let calls = 0;
  const view = new WorkbenchView({}, { app: {}, settings: {} }, { windowRef: dom.window });
  view.projectRepository = () => ({ toggleStageItem: () => { calls += 1; return new Promise((resolve) => { resolveWrite = resolve; }); } });
  view.requestRender = () => {};
  view.renderFinance(root, { income: 5, expense: 2, balance: 3, categories: [{ category: '材料', total: 2, entries: [{ date: '2026-09-01', title: '水泥', amount: 2 }] }], invalidCount: 0 }, 99);
  assert.match(root.textContent, /合同金额：99/); assert.match(root.textContent, /材料：2/); assert.match(root.textContent, /水泥/);
  const live = root.createEl('div');
  view.renderStageDetail(root, { path: 'stage.md', file: { path: 'stage.md' }, title: '施工', checklist: [{ text: '检查', checked: false }], materials: [], waitingReasons: [], acceptanceCriteria: [] }, live);
  const checkbox = root.querySelector('input[type="checkbox"]'); checkbox.checked = true; checkbox.dispatchEvent(new dom.window.Event('change'));
  checkbox.dispatchEvent(new dom.window.Event('change')); assert.equal(calls, 1);
  resolveWrite(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(view.pendingStageItems.size, 0); dom.window.close();
});

test('pending stage write survives a replaced DOM and reject unlocks then rerenders once', async () => {
  const dom = new JSDOM('<div id="root"></div>'); domHelpers(dom); const WorkbenchView = loadView(dom); const root = dom.window.document.querySelector('#root');
  let rejectWrite; let writes = 0; let renders = 0; const view = new WorkbenchView({}, { app: {}, settings: {} }, { windowRef: dom.window });
  view.projectRepository = () => ({ toggleStageItem: () => { writes += 1; return new Promise((_, reject) => { rejectWrite = reject; }); } });
  view.requestRender = () => { renders += 1; };
  const stage = { path: 'stage.md', file: { path: 'stage.md' }, title: '施工', checklist: [{ text: '检查', checked: false }], materials: [], waitingReasons: [], acceptanceCriteria: [] };
  view.renderStageDetail(root, stage, root.createEl('div')); const first = root.querySelector('input'); first.checked = true; first.dispatchEvent(new dom.window.Event('change'));
  root.replaceChildren(); view.renderStageDetail(root, stage, root.createEl('div')); const replacement = root.querySelector('input'); assert.equal(replacement.disabled, true); replacement.dispatchEvent(new dom.window.Event('change')); assert.equal(writes, 1);
  rejectWrite(new Error('no')); await new Promise((resolve) => setImmediate(resolve)); assert.equal(view.pendingStageItems.size, 0); assert.equal(renders, 1); dom.window.close();
});
