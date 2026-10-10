const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
const modalSource = fs.readFileSync(path.join(root, 'src/daily-capture-modal.js'), 'utf8');

const THEME_IDS = ['emerald', 'ocean', 'amber', 'violet', 'monochrome', 'prism-blue-gold'];
const LIGHT = 'hz-scheme-light';
const DARK = 'hz-scheme-dark';

test('scheme resolution follows the Obsidian light/dark body class', () => {
  const { JSDOM } = require('jsdom');
  const { resolveScheme, schemeClass, SCHEME_LIGHT, SCHEME_DARK } = require('../src/theme');

  const light = new JSDOM('<body class="theme-light"></body>').window.document;
  const dark = new JSDOM('<body class="theme-dark"></body>').window.document;
  const unknown = new JSDOM('<body></body>').window.document;

  assert.equal(resolveScheme(light), SCHEME_LIGHT);
  assert.equal(resolveScheme(dark), SCHEME_DARK);
  assert.equal(resolveScheme(unknown), SCHEME_DARK);
  assert.equal(resolveScheme(undefined), SCHEME_DARK);

  assert.equal(schemeClass(SCHEME_LIGHT), LIGHT);
  assert.equal(schemeClass(SCHEME_DARK), DARK);
  assert.equal(schemeClass(''), DARK);
});

test('modal theme applies the prism root and the resolved scheme, and can be removed', () => {
  const { JSDOM } = require('jsdom');
  const { applyModalTheme } = require('../src/theme');
  const document = new JSDOM('<div class="modal"><div class="modal-content"></div></div>').window.document;
  const modal = { contentEl: document.querySelector('.modal-content') };
  const modalEl = document.querySelector('.modal');

  applyModalTheme(modal, 'prism-blue-gold', 'light');
  assert.ok(modalEl.classList.contains('hz-prism-modal-root'));
  assert.ok(modalEl.classList.contains(LIGHT));
  assert.ok(modal.contentEl.classList.contains(LIGHT));
  assert.equal(document.body.className, '');

  applyModalTheme(modal, 'emerald', 'dark');
  assert.equal(modalEl.classList.contains('hz-prism-modal-root'), false);
  assert.equal(modalEl.classList.contains(LIGHT), false);
  assert.ok(modalEl.classList.contains(DARK));

  applyModalTheme(modal, 'emerald');
  assert.equal(modalEl.classList.contains(LIGHT), false);
  assert.equal(modalEl.classList.contains(DARK), false);
});

test('every built-in palette ships a light counterpart', () => {
  const tokens = ['--bg', '--surface', '--surface-2', '--surface-3', '--line', '--line-strong', '--text', '--muted', '--dim', '--accent', '--accent-text', '--accent-2', '--accent-soft', '--warning', '--success', '--danger'];
  for (const id of THEME_IDS) {
    const rule = css.match(new RegExp(`\\.hz-theme-${id}\\.${LIGHT}\\{([^}]*)\\}`))?.[1] || '';
    assert.ok(rule, `缺少浅色盘：${id}`);
    for (const token of tokens) {
      assert.match(rule, new RegExp(`${token}:`), `${id} 浅色盘缺少 ${token}`);
    }
  }
});

test('light palettes are declared after the dark palettes so they win on equal specificity', () => {
  const basePalette = css.indexOf('.hz-workbench{width:100%');
  const lightBlock = css.indexOf(`.hz-theme-emerald.${LIGHT}`);
  const prismDark = css.indexOf('.hz-theme-prism-blue-gold,.hz-prism-modal-root{');
  const prismLight = css.indexOf(`.hz-theme-prism-blue-gold.${LIGHT}{`);
  const polarOverride = css.indexOf('.hz-workbench.hz-theme-emerald{--warning');

  assert.ok(basePalette > -1 && lightBlock > basePalette, '浅色盘必须晚于基础深色盘');
  assert.ok(polarOverride > -1 && lightBlock > polarOverride, '浅色盘必须晚于 warning/success 覆盖');
  assert.ok(prismDark > -1 && prismLight > prismDark, '棱镜浅色盘必须晚于棱镜深色盘');
});

test('light palette block does not disturb the trailing responsive anchors', () => {
  const lightBlock = css.indexOf(`.hz-theme-emerald.${LIGHT}`);
  const last480 = css.lastIndexOf('@media(max-width:480px)');
  const last900 = css.lastIndexOf('@media(max-width:900px)');
  const last901 = css.lastIndexOf('@media(min-width:901px)');

  assert.ok(lightBlock < last480, '浅色盘块必须位于最后一个 480px 媒体块之前');
  assert.ok(lightBlock < last900, '浅色盘块必须位于最后一个 900px 媒体块之前');
  assert.ok(lightBlock < last901, '浅色盘块必须位于最后一个 901px 媒体块之前');
  assert.match(css.slice(last480), /\.hz-project-wizard-grid\{grid-template-columns:1fr\}/);
  assert.match(css.slice(last900), /\.hz-weather-rail\{display:flex!important;grid-column:1;grid-row:1/);
});

test('host view background is lifted in light mode and prism glass has a light variant', () => {
  assert.match(css, /\.hz-workbench-host\.hz-scheme-light \.view-content\{background:transparent\}/);
  assert.match(css, /\.hz-theme-prism-blue-gold\.hz-scheme-light\{--bg:#eef2fb/);
  assert.match(css, /\.hz-prism-modal-root\.hz-scheme-light \.modal-content\{--background-primary:#ffffff/);
  assert.match(css, /@supports not \(backdrop-filter:blur\(1px\)\)\{\.hz-theme-prism-blue-gold\.hz-scheme-light/);
  assert.match(css, /@media\(prefers-reduced-transparency:reduce\)\{\.hz-theme-prism-blue-gold\.hz-scheme-light/);
});

test('workbench and modal wire the follow-scheme setting through the settings and view', () => {
  assert.match(mainSource, /themeFollowsScheme: false/);
  assert.match(mainSource, /activeScheme\(\)/);
  assert.match(mainSource, /applySchemeToHost\(\)/);
  assert.match(mainSource, /workspace\.on\('css-change'/);
  assert.match(mainSource, /配色跟随 Obsidian 明暗/);
  assert.match(mainSource, /schemeClass\(scheme\)/);
  assert.match(modalSource, /themeFollowsScheme \? resolveScheme\(globalThis\.document\)/);
});

test('four standalone capture commands and the quick capture bar are registered', () => {
  for (const [id, name] of [['capture-manual-time', '补记时间'], ['capture-finance', '记录收支'], ['capture-quick-note', '随手记'], ['capture-meditation', '今日冥想']]) {
    assert.match(mainSource, new RegExp(`id: '${id}', name: '${name}'`), `缺少命令 ${id}`);
  }
  assert.match(mainSource, /renderQuickCapture\(root\)/);
  assert.match(mainSource, /renderQuickCapture\(root\) \{/);
  assert.match(css, /\.hz-quick-capture\{position:sticky/);
  assert.match(css, /@media\(max-width:900px\)\{\.hz-quick-capture\{display:flex\}\}/);
});

test('quick capture commands route to the existing capture actions', async () => {
  const { routeCaptureAction } = require('../src/daily-capture-modal');
  const opened = [];
  const service = {
    appendQuickNote: async () => 'noted',
    finishTimer: async () => 'finished',
    openToday: async () => 'today',
  };
  const options = { service, openModal: async (value) => { opened.push(value); return value; } };

  assert.equal(await routeCaptureAction('manual-time', {}, options), 'manual-time');
  assert.equal(await routeCaptureAction('finance', {}, options), 'finance');
  assert.equal(await routeCaptureAction('meditation', {}, options), 'meditation');
  assert.equal(await routeCaptureAction('quick-note', { text: '想法' }, options), 'noted');
  assert.deepEqual(opened, ['manual-time', 'finance', 'meditation']);
});
