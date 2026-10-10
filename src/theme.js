'use strict';

const PRISM_THEME_ID = 'prism-blue-gold';
const PRISM_THEME_LABEL = '棱镜玻璃·蓝金';
const PRISM_THEME_CLASS = `hz-theme-${PRISM_THEME_ID}`;
const PRISM_MODAL_ROOT_CLASS = 'hz-prism-modal-root';

const SCHEME_LIGHT = 'light';
const SCHEME_DARK = 'dark';
const SCHEME_LIGHT_CLASS = `hz-scheme-${SCHEME_LIGHT}`;
const SCHEME_DARK_CLASS = `hz-scheme-${SCHEME_DARK}`;

function resolveScheme(documentRef) {
  const doc = documentRef || (typeof document !== 'undefined' ? document : null);
  const body = doc && doc.body;
  if (!body || typeof body.classList?.contains !== 'function') return SCHEME_DARK;
  return body.classList.contains('theme-light') ? SCHEME_LIGHT : SCHEME_DARK;
}

function schemeClass(scheme) {
  return scheme === SCHEME_LIGHT ? SCHEME_LIGHT_CLASS : SCHEME_DARK_CLASS;
}

function toggleSchemeClass(element, scheme) {
  if (!element || typeof element.classList?.toggle !== 'function') return;
  const resolved = scheme === SCHEME_LIGHT ? SCHEME_LIGHT : scheme === SCHEME_DARK ? SCHEME_DARK : '';
  element.classList.toggle(SCHEME_LIGHT_CLASS, resolved === SCHEME_LIGHT);
  element.classList.toggle(SCHEME_DARK_CLASS, resolved === SCHEME_DARK);
}

function applyModalTheme(modal, theme, scheme) {
  const root = modal.modalEl || modal.contentEl?.closest?.('.modal');
  root?.classList.toggle(PRISM_MODAL_ROOT_CLASS, theme === PRISM_THEME_ID);
  toggleSchemeClass(root, scheme);
  toggleSchemeClass(modal.contentEl, scheme);
}

module.exports = {
  PRISM_THEME_ID,
  PRISM_THEME_LABEL,
  PRISM_THEME_CLASS,
  PRISM_MODAL_ROOT_CLASS,
  SCHEME_LIGHT,
  SCHEME_DARK,
  SCHEME_LIGHT_CLASS,
  SCHEME_DARK_CLASS,
  resolveScheme,
  schemeClass,
  toggleSchemeClass,
  applyModalTheme,
};
