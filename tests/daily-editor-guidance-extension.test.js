const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { EditorState } = require('@codemirror/state');
const { EditorView, keymap } = require('@codemirror/view');
const { createDailyEditorGuidanceExtension } = require('../src/daily-editor-guidance-extension');

function journal() {
  return `---\ntype: 日记\n---\n\n## 今日照片\n\n<!-- hz:daily-photo:start -->\n<!-- hz:daily-photo:end -->\n\n## 今日整理\n\n### 今日摘要\n\n\n### 重要决定与分流\n\n`;
}

function journalWithAllPrompts() {
  return journal().replace('## 今日整理', '## 随手记\n\n<!-- hz:quick-notes:start -->\n<!-- hz:quick-notes:end -->\n\n### 时间流水\n\n<!-- hz:time-entries:start -->\n<!-- hz:time-entries:end -->\n\n### 收支流水\n\n<!-- hz:finance-entries:start -->\n<!-- hz:finance-entries:end -->\n\n## 今日整理');
}

function mount(
  doc = journal(),
  settings = { showDailyGuidance: true, showDailyTechnicalMarkers: false },
  extraExtensions = [],
) {
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
  const actions = [];
  let view;
  try {
    view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [
          createDailyEditorGuidanceExtension({ settings, onAction: (action) => actions.push(action) }),
          ...extraExtensions,
        ],
      }),
      parent: dom.window.document.querySelector('#editor'),
    });
  } finally {
    dom.window.HTMLButtonElement.prototype.addEventListener = addButtonListener;
  }
  return { actions, buttonListenerTypes, dom, view, destroy: () => { view.destroy(); dom.window.close(); } };
}

test('renders native prompt buttons and hides valid dedicated marker lines', () => {
  const context = mount();
  try {
    const buttons = [...context.dom.window.document.querySelectorAll('button.hz-daily-editor-placeholder')];
    assert.deepEqual(buttons.map((button) => button.textContent), [
      '为本篇日记添加最有意义的一张照片',
      '今天最值得记住的事情是什么？',
      '今天做了什么决定？后续应该放到哪里？',
    ]);
    assert.ok(buttons.every((button) => button.type === 'button'));
    assert.equal(context.dom.window.document.querySelectorAll('.cm-hz-technical-marker-line').length, 2);
  } finally { context.destroy(); }
});

test('every widget is an unmodified native button without a custom keydown handler', () => {
  const context = mount(journalWithAllPrompts());
  try {
    const buttons = [...context.dom.window.document.querySelectorAll('.hz-daily-editor-placeholder')];
    assert.equal(buttons.length, 6);
    for (const button of buttons) {
      assert.ok(button instanceof context.dom.window.HTMLButtonElement);
      assert.equal(button.type, 'button');
      assert.equal(button.tabIndex, 0);
      assert.equal(button.disabled, false);
      assert.equal(button.getAttribute('role'), null);
    }
    assert.equal(context.buttonListenerTypes.includes('keydown'), false);
    buttons[0].dispatchEvent(new context.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    buttons[0].dispatchEvent(new context.dom.window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    assert.deepEqual(context.actions, []);
  } finally { context.destroy(); }
});

test('native prompt buttons isolate Enter and Space from CodeMirror keymaps', () => {
  let editorKeymapRuns = 0;
  const interceptingKeymap = keymap.of([
    {
      key: 'Enter',
      run(view) {
        editorKeymapRuns += 1;
        view.dispatch({ changes: { from: 0, insert: 'UNEXPECTED' } });
        return true;
      },
    },
    {
      key: 'Space',
      run(view) {
        editorKeymapRuns += 1;
        view.dispatch({ changes: { from: 0, insert: 'UNEXPECTED' } });
        return true;
      },
    },
  ]);
  const context = mount(journalWithAllPrompts(), undefined, [interceptingKeymap]);
  try {
    const before = context.view.state.doc.toString();
    const button = context.dom.window.document.querySelector('[data-hz-guidance-id="daily-photo"]');
    button.focus();
    button.dispatchEvent(new context.dom.window.KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', bubbles: true, cancelable: true,
    }));
    button.dispatchEvent(new context.dom.window.KeyboardEvent('keydown', {
      key: ' ', code: 'Space', bubbles: true, cancelable: true,
    }));
    assert.equal(editorKeymapRuns, 0);
    assert.equal(context.view.state.doc.toString(), before);
  } finally { context.destroy(); }
});

test('cursor buttons focus and re-analyze without changing markdown', () => {
  const context = mount(journalWithAllPrompts());
  try {
    const before = context.view.state.doc.toString();
    for (const [id, heading] of [['quick-notes', '## 随手记'], ['daily-summary', '### 今日摘要'], ['decisions', '### 重要决定与分流']]) {
      const button = context.dom.window.document.querySelector(`[data-hz-guidance-id="${id}"]`);
      button.focus();
      assert.equal(context.dom.window.document.activeElement, button);
      button.click();
      assert.equal(context.view.state.doc.toString(), before);
      assert.equal(context.view.state.selection.main.head, before.indexOf(heading) + `${heading}\n`.length);
    }
  } finally { context.destroy(); }
});

test('stale cursor widget safely exits after its writable blank line is removed', () => {
  const context = mount();
  try {
    const staleButton = context.dom.window.document.querySelector('[data-hz-guidance-id="daily-summary"]');
    const unsafe = context.view.state.doc.toString().replace(
      '### 今日摘要\n\n\n### 重要决定与分流',
      '### 今日摘要\n### 重要决定与分流',
    );
    context.view.dispatch({ changes: { from: 0, to: context.view.state.doc.length, insert: unsafe } });
    const selectionBeforeClick = context.view.state.selection.main.head;
    staleButton.click();
    assert.equal(context.view.state.doc.toString(), unsafe);
    assert.equal(context.view.state.selection.main.head, selectionBeforeClick);
  } finally { context.destroy(); }
});

test('each action button click calls its exact record action once', () => {
  const full = journalWithAllPrompts();
  const context = mount(full);
  try {
    for (const [id, action] of [['daily-photo', 'photo'], ['time-entries', 'record-today'], ['finance-entries', 'finance']]) {
      const beforeCount = context.actions.length;
      context.dom.window.document.querySelector(`[data-hz-guidance-id="${id}"]`).click();
      assert.deepEqual(context.actions.slice(beforeCount), [action]);
    }
    assert.deepEqual(context.actions, ['photo', 'record-today', 'finance']);
    assert.equal(context.view.state.doc.toString(), full);
  } finally { context.destroy(); }
});

test('typing removes only the populated prompt and undo restores it', () => {
  const context = mount();
  try {
    const button = context.dom.window.document.querySelector('[data-hz-guidance-id="daily-summary"]');
    button.click();
    const anchor = context.view.state.selection.main.head;
    context.view.dispatch({ changes: { from: anchor, insert: '今天完成方案。' } });
    assert.equal(context.dom.window.document.querySelector('[data-hz-guidance-id="daily-summary"]'), null);
    context.view.dispatch({ changes: { from: anchor, to: anchor + 7, insert: '' } });
    assert.ok(context.dom.window.document.querySelector('[data-hz-guidance-id="daily-summary"]'));
  } finally { context.destroy(); }
});

test('non-journal and disabled settings render no accidental UI', () => {
  for (const context of [
    mount(journal().replace('type: 日记', 'type: 项目')),
    mount(journal(), { showDailyGuidance: false, showDailyTechnicalMarkers: true }),
  ]) {
    try {
      assert.equal(context.dom.window.document.querySelectorAll('.hz-daily-editor-placeholder').length, 0);
      assert.equal(context.dom.window.document.querySelectorAll('.cm-hz-technical-marker-line').length, 0);
    } finally { context.destroy(); }
  }
});
