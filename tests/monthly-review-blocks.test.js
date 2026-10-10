const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const { resolveMonthContext } = require('../src/month-context');
const { buildMonthlyTaskView } = require('../src/monthly-task-model');
const { buildMonthlyFinanceView } = require('../src/monthly-finance-model');
const {
  resolveMonthlySource,
  loadMonthlyFinanceNotes,
  renderMonthlyTaskBlock,
  renderMonthlyFinanceBlock,
} = require('../src/monthly-review-blocks');

const august = resolveMonthContext({
  frontmatter: { month: '2026-08' },
  basename: '2026年-08月复盘',
});

const financePath = '01 日记/2026年/8月/2026年-08-20-星期四.md';
const FINANCE_START = '<!-- hz:finance-entries:start -->';
const FINANCE_END = '<!-- hz:finance-entries:end -->';

function createContainer() {
  const dom = new JSDOM('<!doctype html><body></body>');
  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  return { dom, container };
}

function withInnerHtmlForbidden(dom, render) {
  const descriptor = Object.getOwnPropertyDescriptor(dom.window.Element.prototype, 'innerHTML');
  Object.defineProperty(dom.window.Element.prototype, 'innerHTML', {
    configurable: true,
    get: descriptor.get,
    set() { throw new Error('renderers must not assign innerHTML'); },
  });
  try {
    render();
  } finally {
    Object.defineProperty(dom.window.Element.prototype, 'innerHTML', descriptor);
  }
}

test('renders readonly monthly task totals and rows with textContent only', () => {
  const taskView = buildMonthlyTaskView([
    { id: 'done', title: '<strong>会议</strong>', scheduled: '2026-08-19', completed: true },
    { id: 'open', title: '复盘', scheduled: '2026-08-20', completed: false },
    { id: 'due', title: '整理', due: '2026-08-21', completed: false },
  ], august);
  const { dom, container } = createContainer();

  withInnerHtmlForbidden(dom, () => renderMonthlyTaskBlock(container, taskView, { available: true, context: august }));

  assert.equal(container.querySelectorAll('.hz-month-task-row').length, taskView.rows.length);
  assert.equal(container.querySelectorAll('.hz-month-task-day').length, taskView.groups.length);
  assert.match(container.querySelector('.hz-month-task-day-heading').textContent, /2026年-08-19-星期三.*1\/1/);
  const summary = container.querySelector('.hz-month-task-summary.hz-month-summary-grid');
  assert.equal(summary?.children.length, 4);
  assert.deepEqual(Array.from(summary.children, (item) => item.className), Array(4).fill('hz-month-summary-item'));
  const firstRow = container.querySelector('.hz-month-task-row');
  assert.equal(firstRow.children.length, 2);
  assert.equal(firstRow.querySelectorAll('.hz-month-task-status,.hz-month-task-time,.hz-month-task-title').length, 3);
  assert.equal(firstRow.querySelector('.hz-month-task-date'), null);
  const filters = Array.from(container.querySelectorAll('.hz-month-task-filter'));
  assert.deepEqual(filters.map((button) => button.textContent), ['全部', '已完成', '未完成']);
  filters[1].click();
  assert.equal(container.querySelectorAll('.hz-month-task-row:not([hidden])').length, 1);
  assert.match(container.querySelector('.hz-month-task-list').textContent, /会议/);
  assert.equal(container.querySelectorAll('input,a').length, 0);
  assert.match(container.textContent, /任务总数.*3.*已完成.*1.*完成率.*33%/s);
  assert.equal(container.querySelector('.hz-month-task-title strong'), null);
  assert.match(container.textContent, /<strong>会议<\/strong>/);
});

test('renders invalid month, unavailable TickTick, empty tasks, and unassigned task states', () => {
  const { container } = createContainer();
  const invalid = resolveMonthContext({ frontmatter: { month: '2026-8' }, basename: '2026年-08月复盘' });

  renderMonthlyTaskBlock(container, { rows: [] }, { context: invalid, available: true });
  assert.match(container.textContent, /month 属性必须使用 YYYY-MM。/);

  renderMonthlyTaskBlock(container, { rows: [] }, { context: august, available: false });
  assert.match(container.textContent, /TickTick 任务暂不可用，请检查 TickTickSync/);

  renderMonthlyTaskBlock(container, { total: 0, completed: 0, incomplete: 0, completionRate: 0, unassigned: 0, rows: [] }, { context: august, available: true });
  assert.match(container.textContent, /任务总数.*0.*已完成.*0.*完成率.*0%/s);
  assert.match(container.textContent, /本月暂无任务/);

  renderMonthlyTaskBlock(container, { total: 1, completed: 0, incomplete: 1, completionRate: 0, unassigned: 2, rows: [{ text: '未完成｜任务' }] }, { context: august, available: true });
  assert.doesNotMatch(container.textContent, /另有.*未归入本月/);
});

test('resolves a monthly source from the Vault and preserves exact month-context errors', () => {
  const file = { path: '01 日记/2026年-08月复盘.md', basename: '2026年-08月复盘' };
  let lookupCalls = 0;
  let cacheCalls = 0;
  const app = {
    vault: { getAbstractFileByPath(path) { lookupCalls += 1; return path === file.path ? file : null; } },
    metadataCache: { getFileCache(candidate) { cacheCalls += 1; return candidate === file ? { frontmatter: { month: '2026-09' } } : null; } },
  };

  const resolved = resolveMonthlySource(app, file.path);

  assert.equal(resolved.file, file);
  assert.deepEqual(resolved.context, {
    ok: false, month: '', error: 'month 属性与月复盘文件名不一致。',
  });
  assert.equal(lookupCalls, 1);
  assert.equal(cacheCalls, 1);
});

test('loads only target-month diary finance notes with one inventory read and no ctime fallback', async () => {
  const target = { path: financePath, basename: '2026年-08-20-星期四' };
  const targetFromFolder = { path: '01 日记/2026年/8月/21日.md', basename: '21日' };
  const ctimeOnly = { path: '01 日记/other.md', basename: '普通笔记', stat: { ctime: new Date(2026, 7, 22).getTime() } };
  const otherType = { path: '01 日记/2026年/8月/2026年-08-23-星期日.md', basename: '2026年-08-23-星期日' };
  const otherMonth = { path: '01 日记/2026年/9月/2026年-09-01-星期二.md', basename: '2026年-09-01-星期二' };
  let inventoryCalls = 0;
  const cachedReads = [];
  const metadataReads = [];
  const frontmatter = new Map([
    [target, { type: '日记' }],
    [targetFromFolder, { type: '日记' }],
    [ctimeOnly, { type: '日记' }],
    [otherType, { type: '笔记' }],
    [otherMonth, { type: '日记' }],
  ]);
  const app = {
    vault: {
      getMarkdownFiles() { inventoryCalls += 1; return [target, targetFromFolder, ctimeOnly, otherType, otherMonth]; },
      async cachedRead(file) { cachedReads.push(file.path); return `${file.basename} content`; },
    },
    metadataCache: { getFileCache(file) { metadataReads.push(file.path); return { frontmatter: frontmatter.get(file) }; } },
  };

  const result = await loadMonthlyFinanceNotes(app, august, '01 日记');

  assert.equal(inventoryCalls, 1);
  assert.deepEqual(cachedReads, [target.path, targetFromFolder.path]);
  assert.deepEqual(result, {
    notes: [
      { path: target.path, basename: target.basename, date: '2026-08-20', type: '日记', content: `${target.basename} content` },
      { path: targetFromFolder.path, basename: targetFromFolder.basename, date: '2026-08-21', type: '日记', content: `${targetFromFolder.basename} content` },
    ],
    readErrors: [],
  });
  assert.deepEqual(metadataReads, [target.path, targetFromFolder.path, otherType.path]);
});

test('returns individual finance read errors without scanning an invalid month', async () => {
  const readable = { path: financePath, basename: '2026年-08-20-星期四' };
  const broken = { path: '01 日记/2026年/8月/2026年-08-21-星期五.md', basename: '2026年-08-21-星期五' };
  let inventoryCalls = 0;
  const app = {
    vault: {
      getMarkdownFiles() { inventoryCalls += 1; return [readable, broken]; },
      async cachedRead(file) {
        if (file === broken) throw new Error('locked');
        return 'readable';
      },
    },
    metadataCache: { getFileCache() { return { frontmatter: { type: '日记' } }; } },
  };

  assert.deepEqual(await loadMonthlyFinanceNotes(app, { ok: false, month: '' }, '01 日记'), { notes: [], readErrors: [] });
  assert.equal(inventoryCalls, 0);
  assert.deepEqual(await loadMonthlyFinanceNotes(app, august, '01 日记'), {
    notes: [{ path: readable.path, basename: readable.basename, date: '2026-08-20', type: '日记', content: 'readable' }],
    readErrors: [broken.path],
  });
});

test('finance discovery is physically restricted to the configured historical month folder', async () => {
  const target = { path: financePath, basename: '2026年-08-20-星期四' };
  const archivedCopy = { path: '09 知识库/归档/2026年-08-20-星期四.md', basename: target.basename };
  const copiedBelowDaily = { path: '01 日记/副本/2026年-08-20-星期四.md', basename: target.basename };
  const september = { path: '01 日记/2026年/9月/2026年-09-01-星期二.md', basename: '2026年-09-01-星期二' };
  const reads = [];
  const app = {
    vault: {
      getMarkdownFiles: () => [target, archivedCopy, copiedBelowDaily, september],
      cachedRead: async (file) => { reads.push(file.path); return file.path; },
    },
    metadataCache: { getFileCache: () => ({ frontmatter: { type: '日记' } }) },
  };

  const result = await loadMonthlyFinanceNotes(app, august, '01 日记');

  assert.deepEqual(reads, [target.path]);
  assert.deepEqual(result.notes.map(({ path }) => path), [target.path]);
});

test('renders finance rows and source buttons for invalid and read-error sources only', () => {
  const financeView = buildMonthlyFinanceView([
    {
      path: financePath, date: '2026-08-20', type: '日记',
      content: [FINANCE_START, '- 09:10｜收入｜其他｜退款｜¥88.00', '- 无效记录', FINANCE_END].join('\n'),
    },
    {
      path: '01 日记/2026年/8月/2026年-08-21-星期五.md', date: '2026-08-21', type: '日记',
      content: `${FINANCE_START}\n${FINANCE_START}\n${FINANCE_END}`,
    },
  ], august);
  const { dom, container } = createContainer();
  const opened = [];

  withInnerHtmlForbidden(dom, () => renderMonthlyFinanceBlock(container, financeView, {
    context: august,
    readErrors: [financePath, '01 日记/2026年/8月/2026年-08-22-星期六.md'],
  }, (path) => opened.push(path)));

  assert.equal(container.querySelectorAll('.hz-month-finance-row').length, financeView.rows.length);
  const detailPanel = container.querySelector('.hz-month-finance-detail-panel');
  assert.equal(detailPanel.open, false);
  assert.equal(detailPanel.querySelector('summary').textContent, '查看全部明细（1 笔）');
  const financeSummary = container.querySelector('.hz-month-finance-summary.hz-month-summary-grid');
  assert.equal(financeSummary?.children.length, 3);
  const financeRow = container.querySelector('.hz-month-finance-row');
  assert.equal(financeRow.children.length, 1);
  assert.equal(financeRow.querySelectorAll('.hz-month-finance-time,.hz-month-finance-type,.hz-month-finance-category,.hz-month-finance-title,.hz-month-finance-amount').length, 5);
  assert.equal(financeRow.querySelector('.hz-month-finance-date'), null);
  assert.equal(container.querySelectorAll('.hz-month-finance-category-bar').length, financeView.categories.length);
  const buttons = Array.from(container.querySelectorAll('.hz-month-finance-source'));
  assert.deepEqual(buttons.map((button) => button.textContent), [
    '2026年-08-20-星期四', '2026年-08-21-星期五', '2026年-08-22-星期六',
  ]);
  assert.ok(buttons.every((button) => button.type === 'button' && button.getAttribute('aria-label') === button.textContent));
  buttons[0].click();
  assert.deepEqual(opened, [financePath]);
  assert.match(container.textContent, /发现 1 条无法统计的收支记录/);
  assert.match(container.textContent, /有 3 篇日记读取失败/);
});

test('renders empty, invalid, and mixed finance states without other interactive controls', () => {
  const { container } = createContainer();
  const invalid = resolveMonthContext({ frontmatter: { month: '2026-8' }, basename: '2026年-08月复盘' });

  renderMonthlyFinanceBlock(container, {}, { context: invalid }, () => {});
  assert.match(container.textContent, /month 属性必须使用 YYYY-MM。/);

  renderMonthlyFinanceBlock(container, {
    incomeCents: 0, expenseCents: 0, netCents: 0, categories: [], rows: [], invalidCount: 0, invalidSources: [], readErrors: [],
  }, { context: august }, () => {});
  assert.match(container.textContent, /本月收入.*¥0.00.*本月支出.*¥0.00.*本月结余.*¥0.00/s);
  assert.match(container.textContent, /本月暂无收支记录/);
  assert.equal(container.querySelectorAll('input,a').length, 0);
});
