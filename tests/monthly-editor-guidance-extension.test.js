const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { EditorState } = require('@codemirror/state');
const { EditorView } = require('@codemirror/view');
const { createMonthlyEditorGuidanceExtension } = require('../src/monthly-editor-guidance-extension');

function monthlyReview() {
  return `---
type: 月复盘
---

### 本月完成了什么


### 最重要的收获


### 遇到的问题


### 下月最重要的三件事

`;
}

function mount(doc = monthlyReview(), settings = { showMonthlyGuidance: true }) {
  const dom = new JSDOM('<main id="editor"></main>', { pretendToBeVisual: true });
  global.window = dom.window;
  global.document = dom.window.document;
  global.MutationObserver = dom.window.MutationObserver;
  global.requestAnimationFrame = (callback) => setTimeout(callback, 0);
  global.cancelAnimationFrame = clearTimeout;
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  const buttonListenerTypes = [];
  const addButtonListener = dom.window.HTMLButtonElement.prototype.addEventListener;
  dom.window.HTMLButtonElement.prototype.addEventListener = function addEventListener(type, ...args) {
    buttonListenerTypes.push(type);
    return addButtonListener.call(this, type, ...args);
  };
  let view;
  try {
    view = new EditorView({
      state: EditorState.create({ doc, extensions: [createMonthlyEditorGuidanceExtension({ settings })] }),
      parent: dom.window.document.querySelector('#editor'),
    });
  } finally {
    dom.window.HTMLButtonElement.prototype.addEventListener = addButtonListener;
  }
  return {
    buttonListenerTypes, dom, view,
    destroy: () => { view.destroy(); dom.window.close(); },
  };
}

test('renders four native monthly prompt buttons with approved labels', () => {
  const context = mount();
  try {
    const buttons = [...context.dom.window.document.querySelectorAll('button.hz-month-editor-placeholder')];
    assert.deepEqual(buttons.map((button) => button.textContent), [
      '这个月真正完成了哪些重要事情？',
      '这个月最值得带走的经验或认识是什么？',
      '什么事情没有做好，原因是什么？',
      '下个月最重要的三件事是什么？',
    ]);
    assert.ok(buttons.every((button) => button instanceof context.dom.window.HTMLButtonElement && button.type === 'button'));
    assert.equal(context.buttonListenerTypes.includes('keydown'), false);
  } finally { context.destroy(); }
});

test('a click focuses the current descriptor blank line without changing markdown', () => {
  const context = mount();
  try {
    const before = context.view.state.doc.toString();
    const button = context.dom.window.document.querySelector('[data-hz-guidance-id="problems"]');
    button.click();
    assert.equal(context.view.state.doc.toString(), before);
    assert.equal(context.view.state.selection.main.head, before.indexOf('### 遇到的问题') + '### 遇到的问题\n'.length);
    assert.equal(context.dom.window.document.activeElement, context.view.contentDOM);
  } finally { context.destroy(); }
});

test('content removes a monthly prompt and undoing that edit restores it', () => {
  const context = mount();
  try {
    const button = context.dom.window.document.querySelector('[data-hz-guidance-id="learning"]');
    button.click();
    const cursor = context.view.state.selection.main.head;
    context.view.dispatch({ changes: { from: cursor, insert: '先做重要的。' } });
    assert.equal(context.dom.window.document.querySelector('[data-hz-guidance-id="learning"]'), null);
    context.view.dispatch({ changes: { from: cursor, to: cursor + '先做重要的。'.length, insert: '' } });
    assert.ok(context.dom.window.document.querySelector('[data-hz-guidance-id="learning"]'));
  } finally { context.destroy(); }
});

test('a stale widget re-analyzes and never moves the selection to its old cursor', () => {
  const context = mount();
  try {
    const staleButton = context.dom.window.document.querySelector('[data-hz-guidance-id="next-three"]');
    const changed = context.view.state.doc.toString().replace(
      '### 下月最重要的三件事\n\n',
      '### 下月最重要的三件事\n写完计划。\n',
    );
    context.view.dispatch({ changes: { from: 0, to: context.view.state.doc.length, insert: changed } });
    const beforeClick = context.view.state.selection.main.head;
    staleButton.click();
    assert.equal(context.view.state.selection.main.head, beforeClick);
    assert.equal(context.view.state.doc.toString(), changed);
  } finally { context.destroy(); }
});

test('disabled guidance and non-monthly notes create no buttons', () => {
  for (const context of [
    mount(monthlyReview(), { showMonthlyGuidance: false }),
    mount(monthlyReview().replace('type: 月复盘', 'type: 日记')),
  ]) {
    try {
      assert.equal(context.dom.window.document.querySelectorAll('.hz-month-editor-placeholder').length, 0);
    } finally { context.destroy(); }
  }
});

test('destroying the extension leaves no monthly guidance DOM behind', () => {
  const context = mount();
  const root = context.dom.window.document.querySelector('#editor');
  assert.equal(root.querySelectorAll('.hz-month-editor-placeholder').length, 4);
  context.view.destroy();
  assert.equal(root.querySelectorAll('.hz-month-editor-placeholder').length, 0);
  context.dom.window.close();
});
