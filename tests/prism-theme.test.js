const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

test('native modal theme is scoped to its own root and can be removed', () => {
  const { JSDOM } = require('jsdom');
  const { applyModalTheme } = require('../src/theme');
  const document = new JSDOM('<div class="modal"><div class="modal-content"></div></div>').window.document;
  const modal = { contentEl: document.querySelector('.modal-content') };
  applyModalTheme(modal, 'prism-blue-gold');
  assert.ok(document.querySelector('.modal').classList.contains('hz-prism-modal-root'));
  assert.equal(document.body.className, '');
  applyModalTheme(modal, 'emerald');
  assert.equal(document.querySelector('.modal').classList.contains('hz-prism-modal-root'), false);
});

test('prism theme metadata exposes the stable id and Chinese label', () => {
  const { PRISM_THEME_ID, PRISM_THEME_LABEL, PRISM_THEME_CLASS } = require('../src/theme');
  assert.equal(PRISM_THEME_ID, 'prism-blue-gold');
  assert.equal(PRISM_THEME_LABEL, '棱镜玻璃·蓝金');
  assert.equal(PRISM_THEME_CLASS, 'hz-theme-prism-blue-gold');
});

test('prism root defines the approved palette and semantic glass tokens', () => {
  const rule = css.match(/\.hz-theme-prism-blue-gold,\.hz-prism-modal-root\{([^}]*)\}/)?.[1] || '';
  for (const color of ['#0A1335', '#163B7A', '#4B70BE', '#C89A55', '#F2D79E']) {
    assert.match(rule, new RegExp(color, 'i'));
  }
  for (const token of ['--bg', '--surface', '--surface-2', '--surface-3', '--line', '--text', '--muted', '--accent', '--warning', '--success', '--glass-bg', '--glass-border', '--glass-highlight', '--glass-shadow', '--glass-blur']) {
    assert.match(rule, new RegExp(`${token}:`));
  }
});

test('prism glass hierarchy reaches all workbench and native modal surfaces', () => {
  for (const selector of ['.hz-head-actions', '.hz-stat', '.hz-weather', '.hz-journal', '.hz-projects', '.hz-must', '.hz-tasks', '.hz-project-cockpit', '.hz-gantt', '.hz-finance', '.hz-capture-modal']) {
    assert.match(css, new RegExp(`hz-theme-prism-blue-gold[^}]*${selector.replace('.', '\\\.')}`));
  }
  assert.match(css, /\.hz-prism-modal-root \.modal-content/);
});

test('prism preserves media and icons and provides accessibility fallbacks', () => {
  assert.match(css, /\.hz-theme-prism-blue-gold :is\(\.hz-brand-logo,\.hz-jcard-cover,img,svg,\.hz-icon\)\{filter:none!important;opacity:1\}/);
  assert.match(css, /@supports not \(backdrop-filter:blur\(1px\)\)/);
  assert.match(css, /@media\(prefers-reduced-transparency:reduce\)/);
  assert.match(css, /\.hz-theme-prism-blue-gold :is\(button,input,select,summary,a\):focus-visible/);
  assert.match(css, /\.hz-theme-prism-blue-gold\.hz-reduced-motion/);
});

test('weather rail is 306px on desktop and remains a compact first-row card on mobile', () => {
  assert.match(css, /@media\(min-width:901px\)[\s\S]*\.hz-theme-prism-blue-gold \.hz-weather-rail\{[^}]*width:306px/);
  const mobile = css.slice(css.indexOf('@media(max-width:900px)', css.indexOf('/* Prism Glass-inspired')));
  assert.match(mobile, /\.hz-theme-prism-blue-gold \.hz-weather-rail\{[^}]*display:flex!important;[^}]*grid-row:1/);
  assert.match(mobile, /\.hz-theme-prism-blue-gold \.hz-weather-current\{[^}]*min-height:/);
  assert.doesNotMatch(mobile, /\.hz-theme-prism-blue-gold \.hz-weather-rail\{[^}]*display:none/);
});

test('third-party notices preserve Prism Glass licensing and independent attribution', () => {
  const thirdParty = fs.readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  const license = fs.readFileSync(path.join(root, 'LICENSE-prism-glass.txt'), 'utf8');
  const notice = fs.readFileSync(path.join(root, 'NOTICE-prism-glass.txt'), 'utf8');
  assert.match(thirdParty, /Prism Glass/i);
  assert.match(thirdParty, /https:\/\/github\.com\/csuyincs-creator\/prism-glass/);
  assert.match(thirdParty, /adapted|independent/i);
  assert.match(thirdParty, /Open-Meteo[\s\S]*CC BY 4\.0/i);
  assert.match(thirdParty, /carousel[\s\S]*independent/i);
  assert.match(license, /Apache License[\s\S]*Version 2\.0, January 2004/);
  assert.ok(notice.trim().length > 0);
});

test('weather responsive layout applies to every theme, not only prism', () => {
  const mobile = css.slice(css.lastIndexOf('@media(max-width:900px)'));
  assert.match(mobile, /\.hz-weather-rail\{display:flex!important;grid-column:1;grid-row:1/);
  assert.match(css, /\.hz-app:has\(>\.hz-weather-rail\)\{grid-template-columns:306px minmax\(0,1fr\)/);
});
