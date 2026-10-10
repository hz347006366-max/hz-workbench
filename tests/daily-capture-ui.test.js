const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const {
  CAPTURE_ACTIONS,
  routeCaptureAction,
  normalizeCaptureSettings,
  compressImageToJpeg,
  openDailyCaptureModal,
} = require('../src/daily-capture-modal');

function modalFixture(action, service = {}, options = {}) {
  const dom = new JSDOM('<div id="modal"></div>');
  const { Element } = dom.window;
  Element.prototype.createEl = function createEl(tag, elementOptions = {}) {
    const element = this.ownerDocument.createElement(tag);
    if (elementOptions.cls) element.className = elementOptions.cls;
    if (elementOptions.text != null) element.textContent = String(elementOptions.text);
    for (const [name, value] of Object.entries(elementOptions.attr || {})) element.setAttribute(name, value);
    this.appendChild(element);
    return element;
  };
  Element.prototype.createDiv = function createDiv(elementOptions = {}) { return this.createEl('div', elementOptions); };
  Element.prototype.empty = function empty() { this.replaceChildren(); };
  Element.prototype.addClass = function addClass(...names) { this.classList.add(...names); };
  let modal;
  class FakeModal {
    constructor() { this.contentEl = dom.window.document.querySelector('#modal'); modal = this; }
    open() { this.onOpen(); }
    close() { this.closed = true; this.onClose?.(); }
  }
  const notices = [];
  const plugin = {
    app: {},
    settings: {
      timeCategories: '工作', expenseCategories: '餐饮', incomeCategories: '工资',
      currencySymbol: '¥', dailyPhotoMaxEdge: 2048, dailyPhotoQuality: 0.85,
      openDailyAfterCapture: false,
      ...options.settings,
    },
  };
  openDailyCaptureModal(plugin, action, service, {
    Modal: FakeModal,
    Notice: class { constructor(message) { notices.push(message); } },
    windowRef: dom.window,
    now: options.now || (() => new Date(2026, 7, 18, 14, 32)),
    target: options.target || null,
    compressImage: options.compressImage,
  });
  return { dom, modal, notices };
}

test('capture action contract exposes the eight exact iPhone menu routes', () => {
  assert.deepEqual(CAPTURE_ACTIONS, ['photo', 'start-time', 'finish-time', 'manual-time', 'quick-note', 'finance', 'meditation', 'open-today']);
});

test('direct actions call one service method while form actions open one modal', async () => {
  const calls = [];
  const service = {
    appendQuickNote: async (text) => calls.push(['quick', text]),
    finishTimer: async () => calls.push(['finish']),
    openToday: async () => calls.push(['open']),
  };
  const openModal = async (action) => calls.push(['modal', action]);
  await routeCaptureAction('quick-note', { text: '  想法  ' }, { service, openModal });
  await routeCaptureAction('finish-time', {}, { service, openModal });
  await routeCaptureAction('open-today', {}, { service, openModal });
  await routeCaptureAction('photo', {}, { service, openModal });
  await routeCaptureAction('start-time', {}, { service, openModal });
  await routeCaptureAction('manual-time', {}, { service, openModal });
  await routeCaptureAction('finance', {}, { service, openModal });
  await routeCaptureAction('meditation', {}, { service, openModal });
  assert.deepEqual(calls, [
    ['quick', '想法'], ['finish'], ['open'], ['modal', 'photo'], ['modal', 'start-time'], ['modal', 'manual-time'], ['modal', 'finance'], ['modal', 'meditation'],
  ]);
  await assert.rejects(() => routeCaptureAction('unknown', {}, { service, openModal }), /未知的记录动作/);
});

test('daily meditation form uses a textarea and submits exactly one replacement', async () => {
  const dom = new JSDOM('<div id="modal"></div>');
  const { Element } = dom.window;
  Element.prototype.createEl = function createEl(tag, options = {}) {
    const element = this.ownerDocument.createElement(tag);
    if (options.cls) element.className = options.cls;
    if (options.text != null) element.textContent = String(options.text);
    for (const [name, value] of Object.entries(options.attr || {})) element.setAttribute(name, value);
    this.appendChild(element);
    return element;
  };
  Element.prototype.createDiv = function createDiv(options = {}) { return this.createEl('div', options); };
  Element.prototype.empty = function empty() { this.replaceChildren(); };
  Element.prototype.addClass = function addClass(...names) { this.classList.add(...names); };
  let modal;
  class FakeModal {
    constructor(app) { this.app = app; this.contentEl = dom.window.document.querySelector('#modal'); modal = this; }
    open() { this.onOpen(); }
    close() { this.closed = true; }
  }
  const calls = [];
  const plugin = { app: {}, settings: { openDailyAfterCapture: false } };
  const service = { setMeditation: async (value) => calls.push(value) };
  openDailyCaptureModal(plugin, 'meditation', service, {
    Modal: FakeModal,
    Notice: class {},
    windowRef: dom.window,
  });
  const textarea = modal.contentEl.querySelector('textarea');
  assert.ok(textarea);
  textarea.value = '慢下来，再做决定。';
  modal.contentEl.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['慢下来，再做决定。']);
  assert.equal(modal.closed, true);
  dom.window.close();
});

test('historical capture forms expose the required local target controls with now defaults', () => {
  for (const action of ['photo', 'quick-note', 'finance', 'meditation']) {
    const { dom, modal } = modalFixture(action);
    const date = modal.contentEl.querySelector('input[type="date"]');
    assert.ok(date, `${action} should expose a date input`);
    assert.equal(date.value, '2026-08-18');
    assert.equal(date.max, '2026-08-18');
    const time = modal.contentEl.querySelector('input[type="time"]');
    if (action === 'photo') {
      assert.ok(time, 'photo should expose an exact time input');
      const nowButton = [...modal.contentEl.querySelectorAll('button')].find((button) => button.textContent === '现在');
      assert.ok(nowButton);
      time.value = '08:00';
      nowButton.click();
      assert.equal(time.value, '14:32');
    } else {
      assert.ok(time, `${action} should expose an exact time input`);
      assert.equal(time.value, '14:32');
    }
    dom.window.close();
  }

  const manual = modalFixture('manual-time');
  const range = [...manual.modal.contentEl.querySelectorAll('input[type="datetime-local"]')];
  assert.equal(range.length, 2);
  assert.deepEqual(range.map((input) => input.value), ['2026-08-18T13:32', '2026-08-18T14:32']);
  assert.deepEqual(range.map((input) => input.max), ['2026-08-18T14:32', '2026-08-18T14:32']);
  manual.dom.window.close();

  for (const action of ['start-time']) {
    const live = modalFixture(action);
    assert.equal(live.modal.contentEl.querySelector('input[type="date"]'), null);
    assert.equal(live.modal.contentEl.querySelector('input[type="time"]'), null);
    assert.equal(live.modal.contentEl.querySelector('input[type="datetime-local"]'), null);
    live.dom.window.close();
  }
});

test('journal-scoped target date remains locked to the exact source journal', () => {
  const target = Object.freeze({ path: '01 日记/2026年/8月/2026年-08-17-星期一.md', date: '2026-08-17' });
  const { dom, modal } = modalFixture('quick-note', {}, { target });
  const date = modal.contentEl.querySelector('input[type="date"]');
  assert.equal(date.value, target.date);
  assert.equal(date.disabled, true);
  dom.window.close();
});

test('manual-time form rejects a nonexistent local DST time before calling the service', async () => {
  const originalTimezone = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    const calls = [];
    const { dom, modal, notices } = modalFixture('manual-time', {
      addManualTime: async (input) => calls.push(input),
    }, { now: () => new Date(2026, 2, 8, 4, 0) });
    const [start, end] = modal.contentEl.querySelectorAll('input[type="datetime-local"]');
    start.value = '2026-03-08T02:30';
    end.value = '2026-03-08T03:30';
    modal.contentEl.querySelector('input[type="text"]').value = '夏令时测试';
    modal.contentEl.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(calls, []);
    assert.match(notices[0], /时间无效/);
    dom.window.close();
  } finally {
    if (originalTimezone == null) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});

test('photo submit freezes its date before asynchronous compression', async () => {
  let releaseCompression;
  const compression = new Promise((resolve) => { releaseCompression = resolve; });
  const calls = [];
  const service = {
    photoExists: async (at) => { calls.push(['exists', at]); return false; },
    createPhoto: async (binary, at) => calls.push(['create', binary, at]),
  };
  const { dom, modal } = modalFixture('photo', service, { compressImage: async () => compression });
  const date = modal.contentEl.querySelector('input[type="date"]');
  const file = modal.contentEl.querySelector('input[type="file"]');
  Object.defineProperty(file, 'files', { value: [{ name: 'photo.jpg' }] });
  date.value = '2026-08-17';
  modal.contentEl.querySelector('input[type="time"]').value = '09:45';
  modal.contentEl.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setImmediate(resolve));
  date.value = '2026-08-16';
  const binary = Uint8Array.from([1, 2, 3]).buffer;
  releaseCompression(binary);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(calls[0][0], 'exists');
  assert.equal(calls[0][1].getFullYear(), 2026);
  assert.equal(calls[0][1].getMonth(), 7);
  assert.equal(calls[0][1].getDate(), 17);
  assert.equal(calls[0][1].getHours(), 9);
  assert.equal(calls[0][1].getMinutes(), 45);
  assert.equal(calls[1][0], 'create');
  assert.equal(calls[1][2].getDate(), 17);
  assert.equal(modal.closed, true);
  dom.window.close();
});

test('historical save notice names the selected date and opens that date instead of today', async () => {
  const calls = [];
  const service = {
    appendQuickNote: async () => {},
    openJournalDate: async (date) => calls.push(date),
    openToday: async () => { throw new Error('must not open today'); },
  };
  const { dom, modal, notices } = modalFixture('quick-note', service, {
    settings: { openDailyAfterCapture: true },
  });
  modal.contentEl.querySelector('input[type="date"]').value = '2026-08-17';
  modal.contentEl.querySelector('input[type="time"]').value = '09:45';
  modal.contentEl.querySelector('input[type="text"]').value = '历史想法';
  modal.contentEl.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(calls, ['2026-08-17']);
  assert.ok(notices.some((message) => message.includes('2026-08-17')));
  dom.window.close();
});

test('photo captures the selected file before awaits and a closed modal cannot write after compression', async () => {
  let releaseExists;
  let releaseCompression;
  const exists = new Promise((resolve) => { releaseExists = resolve; });
  const compression = new Promise((resolve) => { releaseCompression = resolve; });
  const compressedFiles = [];
  const writes = [];
  const service = {
    photoExists: async () => exists,
    createPhoto: async (...args) => writes.push(args),
  };
  const { dom, modal } = modalFixture('photo', service, {
    compressImage: async (file) => { compressedFiles.push(file); return compression; },
  });
  const input = modal.contentEl.querySelector('input[type="file"]');
  const selected = { name: 'selected.jpg' };
  Object.defineProperty(input, 'files', { configurable: true, value: [selected] });
  modal.contentEl.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  Object.defineProperty(input, 'files', { configurable: true, value: [{ name: 'later.jpg' }] });
  releaseExists(false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(compressedFiles, [selected]);

  modal.close();
  releaseCompression(Uint8Array.from([1]).buffer);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(writes, []);
  dom.window.close();
});

test('capture modal receives only a safe configured theme class', () => {
  const safe = modalFixture('quick-note', {}, { settings: { theme: 'prism-blue-gold' } });
  assert.equal(safe.modal.contentEl.classList.contains('hz-theme-prism-blue-gold'), true);
  safe.dom.window.close();
  const unsafe = modalFixture('quick-note', {}, { settings: { theme: 'bad theme<script>' } });
  assert.equal([...unsafe.modal.contentEl.classList].some((name) => name.includes('<')), false);
  assert.equal(unsafe.modal.contentEl.classList.contains('hz-theme-emerald'), true);
  unsafe.dom.window.close();
});

test('existing photo offers replace append cancel while cancel preserves the form', async () => {
  const calls = [];
  const service = {
    photoExists: async () => true,
    appendPhoto: async (...args) => calls.push(args),
  };
  const { dom, modal } = modalFixture('photo', service, { compressImage: async () => Uint8Array.from([4]).buffer });
  const file = modal.contentEl.querySelector('input[type="file"]');
  Object.defineProperty(file, 'files', { value: [{ name: 'photo.jpg' }] });
  modal.contentEl.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setImmediate(resolve));

  const choices = [...modal.contentEl.querySelectorAll('.hz-daily-photo-conflict button')];
  assert.deepEqual(choices.map((button) => button.textContent), ['替换', '新增', '取消']);
  choices[2].click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 0);
  assert.equal(modal.closed, undefined);
  assert.equal(modal.contentEl.querySelector('button[type="submit"]').disabled, false);

  modal.contentEl.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setImmediate(resolve));
  [...modal.contentEl.querySelectorAll('.hz-daily-photo-conflict button')][1].click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].getDate(), 18);
  assert.equal(modal.closed, true);
  dom.window.close();
});

test('journal-scoped finance form writes and opens only its captured target', async () => {
  const dom = new JSDOM('<div id="modal"></div>');
  const { Element } = dom.window;
  Element.prototype.createEl = function createEl(tag, options = {}) {
    const element = this.ownerDocument.createElement(tag);
    if (options.cls) element.className = options.cls;
    if (options.text != null) element.textContent = String(options.text);
    for (const [name, value] of Object.entries(options.attr || {})) element.setAttribute(name, value);
    this.appendChild(element); return element;
  };
  Element.prototype.createDiv = function createDiv(options = {}) { return this.createEl('div', options); };
  Element.prototype.empty = function empty() { this.replaceChildren(); };
  Element.prototype.addClass = function addClass(...names) { this.classList.add(...names); };
  let modal;
  class FakeModal { constructor() { this.contentEl = dom.window.document.querySelector('#modal'); modal = this; } open() { this.onOpen(); } close() {} }
  const calls = [];
  const notices = [];
  const target = Object.freeze({ path: '01 日记/2026年/8月/2026年-08-17-星期一.md', date: '2026-08-17' });
  const plugin = { app: {}, settings: { expenseCategories: '餐饮', incomeCategories: '工资', currencySymbol: '¥', openDailyAfterCapture: true } };
  const service = {
    addFinanceForJournal: async (input, actual) => calls.push(['finance', input, actual]),
    openJournalTarget: async (actual) => calls.push(['open', actual]),
  };
  openDailyCaptureModal(plugin, 'finance', service, { Modal: FakeModal, Notice: class { constructor(message) { notices.push(message); } }, windowRef: dom.window, target });
  assert.match(modal.contentEl.querySelector('h2').textContent, /补记 2026-08-17/);
  modal.contentEl.querySelector('input[type="text"]').value = '午餐';
  modal.contentEl.querySelector('input[type="number"]').value = '20';
  modal.contentEl.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls[0][0], 'finance');
  assert.deepEqual(calls[0][2], target);
  assert.deepEqual(calls[1], ['open', target]);
  assert.deepEqual(notices, ['已写入 2026-08-17 日记']);
  dom.window.close();
});

test('capture settings normalize defaults list values bounds and detached timer state', () => {
  const loaded = {
    dailyPhotoMaxEdge: 99999,
    dailyPhotoQuality: 2,
    timeCategories: ' 工作,学习，工作 ',
    expenseCategories: ['餐饮', '交通', '餐饮'],
    incomeCategories: '',
    activeTimer: { startedAt: '2026-08-18T01:00:00.000Z', category: '工作', title: '写方案', project: '' },
  };
  const normalized = normalizeCaptureSettings(loaded);
  assert.equal(normalized.dailyPhotoMaxEdge, 4096);
  assert.equal(normalized.dailyPhotoQuality, 1);
  assert.equal(normalized.timeCategories, '工作,学习');
  assert.equal(normalized.expenseCategories, '餐饮,交通');
  assert.match(normalized.incomeCategories, /工资/);
  assert.notEqual(normalized.activeTimer, loaded.activeTimer);
  assert.equal(normalized.dailyTemplatePath, '07 模板/每日模板.md');
});

test('production registers one protocol and three capture commands without TickTick writes', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/main.js'), 'utf8');
  assert.equal((source.match(/registerObsidianProtocolHandler\('hz-workbench-capture'/g) || []).length, 1);
  assert.match(source, /id: 'record-today'/);
  assert.match(source, /id: 'open-today-journal'/);
  assert.match(source, /id: 'finish-current-timer'/);
  assert.doesNotMatch(source, /taskRepository\.(?:save|update|delete)|executeCommandById\([^)]*sync/i);
});

test('daily capture CSS is scoped and uses mobile-sized controls', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../styles.css'), 'utf8');
  assert.match(css, /\.hz-daily-capture-modal/);
  assert.match(css, /\.hz-daily-capture-action[^}]*min-height:44px/s);
  assert.match(css, /@media\(max-width:480px\)/);
  assert.match(css, /\.hz-daily-capture-target[^}]*min-width:\s*0/s);
  assert.match(css, /\.hz-daily-capture-modal[^}]*max-width:\s*100%/s);
  assert.match(css, /\.hz-daily-capture-field (?:input|input,)[\s\S]*?min-width:\s*0/s);
});

test('photo compression falls back to an image element when createImageBitmap cannot decode', async () => {
  const calls = [];
  const context = { drawImage: (...args) => calls.push(args) };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    toBlob: (callback, type, quality) => {
      calls.push([type, quality]);
      callback({ arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
    },
  };
  class FakeImage {
    set src(value) {
      this.naturalWidth = 4000;
      this.naturalHeight = 3000;
      calls.push(['src', value]);
      queueMicrotask(() => this.onload());
    }
  }
  const windowRef = {
    createImageBitmap: async () => { throw new Error('The source image could not be decoded.'); },
    document: { createElement: () => canvas },
    URL: {
      createObjectURL: () => 'blob:photo',
      revokeObjectURL: (value) => calls.push(['revoke', value]),
    },
    Image: FakeImage,
  };

  const result = await compressImageToJpeg({ type: 'image/jpeg', name: 'photo.jpg' }, {
    maxEdge: 2048,
    quality: 0.85,
    windowRef,
  });

  assert.deepEqual([...new Uint8Array(result)], [1, 2, 3]);
  assert.equal(canvas.width, 2048);
  assert.equal(canvas.height, 1536);
  assert.ok(calls.some((call) => call[0] === 'revoke' && call[1] === 'blob:photo'));
});
