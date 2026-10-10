const { resolveMonthContext } = require('./month-context');
const { resolveJournalDate } = require('./journal-date');
const { formatCents } = require('./daily-capture-model');

function clearContainer(container) {
  if (typeof container.empty === 'function') container.empty();
  else container.replaceChildren();
}

function appendTextElement(parent, tag, className, text) {
  const element = parent.ownerDocument.createElement(tag);
  if (className) element.className = className;
  element.textContent = String(text ?? '');
  parent.appendChild(element);
  return element;
}

function appendState(parent, message) {
  return appendTextElement(parent, 'div', 'hz-month-state', message);
}

function appendMetric(parent, label, value) {
  const item = appendTextElement(parent, 'div', 'hz-month-summary-item', '');
  appendTextElement(item, 'span', 'hz-month-summary-label', label);
  appendTextElement(item, 'strong', 'hz-month-summary-value', value);
  return item;
}

function renderMonthlyErrorBlock(container, message) {
  clearContainer(container);
  const root = appendTextElement(container, 'section', 'hz-month-block', '');
  appendState(root, message);
}

function sourceBasename(path) {
  return String(path || '').split('/').pop().replace(/\.md$/i, '');
}

function uniquePaths(paths) {
  return Array.from(new Set((Array.isArray(paths) ? paths : [])
    .map((path) => String(path || ''))
    .filter(Boolean)));
}

function validContext(state) {
  const context = state?.context;
  return context?.ok === false ? context : null;
}

function resolveMonthlySource(app, sourcePath) {
  const file = app?.vault?.getAbstractFileByPath?.(sourcePath) || null;
  const frontmatter = file
    ? app?.metadataCache?.getFileCache?.(file)?.frontmatter || {}
    : {};
  return {
    file,
    context: resolveMonthContext({ frontmatter, basename: file?.basename || '' }),
  };
}

function normalizeFolderPath(folder) {
  return String(folder || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

async function loadMonthlyFinanceNotes(app, monthContext, dailyFolder) {
  const month = monthContext?.ok === false ? '' : String(monthContext?.month || '');
  if (!month) return { notes: [], readErrors: [] };

  const [year, monthNumber] = month.split('-').map(Number);
  const folder = normalizeFolderPath(dailyFolder);
  if (!folder || !Number.isInteger(year) || !Number.isInteger(monthNumber)) {
    return { notes: [], readErrors: [] };
  }
  const monthPrefix = `${folder}/${year}年/${monthNumber}月/`;

  const candidates = app.vault.getMarkdownFiles()
    .filter((file) => String(file?.path || '').replace(/\\/g, '/').startsWith(monthPrefix))
    .map((file) => {
    const frontmatter = app?.metadataCache?.getFileCache?.(file)?.frontmatter || {};
    const date = resolveJournalDate({ basename: file.basename, path: file.path }, frontmatter);
      return { file, frontmatter, date };
    }).filter(({ frontmatter, date }) => frontmatter.type === '日记' && date.slice(0, 7) === month);

  const results = await Promise.all(candidates.map(async ({ file, date }) => {
    try {
      return {
        note: {
          path: file.path,
          basename: file.basename,
          date,
          type: '日记',
          content: await app.vault.cachedRead(file),
        },
        readError: '',
      };
    } catch (error) {
      return { note: null, readError: file.path };
    }
  }));

  return {
    notes: results.flatMap(({ note }) => note ? [note] : []),
    readErrors: results.flatMap(({ readError }) => readError ? [readError] : []),
  };
}

function renderMonthlyTaskBlock(container, view = {}, state = {}) {
  clearContainer(container);
  const root = appendTextElement(container, 'section', 'hz-month-block', '');
  const context = validContext(state);
  if (context) {
    appendState(root, context.error);
    return;
  }
  if (state.available === false) {
    appendState(root, 'TickTick 任务暂不可用，请检查 TickTickSync');
    return;
  }

  const summary = appendTextElement(root, 'div', 'hz-month-task-summary hz-month-summary-grid', '');
  appendMetric(summary, '任务总数', Number(view.total) || 0);
  appendMetric(summary, '已完成', Number(view.completed) || 0);
  appendMetric(summary, '未完成', Number(view.incomplete) || 0);
  appendMetric(summary, '完成率', `${Number(view.completionRate) || 0}%`);
  const rows = Array.isArray(view.rows) ? view.rows : [];
  if (!rows.length) appendState(root, '本月暂无任务');
  else {
    const filters = appendTextElement(root, 'div', 'hz-month-task-filters', '');
    const list = appendTextElement(root, 'div', 'hz-month-task-list', '');
    const rowElements = [];
    const groups = Array.isArray(view.groups) && view.groups.length
      ? view.groups
      : [{ date: '', dateLabel: '', rows }];
    const dayElements = [];
    for (const group of groups) {
      const day = appendTextElement(list, 'section', 'hz-month-task-day', '');
      if (group.dateLabel) appendTextElement(day, 'h4', 'hz-month-task-day-heading', `${group.dateLabel} · ${group.progress}`);
      const dayRows = [];
      for (const row of group.rows) {
        const item = appendTextElement(day, 'div', 'hz-month-task-row', '');
        item.dataset.status = row.completed ? 'completed' : 'incomplete';
        appendTextElement(item, 'span', 'hz-month-task-status', row.status);
        const details = appendTextElement(item, 'div', 'hz-month-task-details', '');
        appendTextElement(details, 'span', 'hz-month-task-time', row.timeLabel);
        appendTextElement(details, 'span', 'hz-month-task-title', row.title);
        rowElements.push(item);
        dayRows.push(item);
      }
      dayElements.push({ day, rows: dayRows });
    }
    for (const [label, filter] of [['全部', 'all'], ['已完成', 'completed'], ['未完成', 'incomplete']]) {
      const button = filters.ownerDocument.createElement('button');
      button.type = 'button';
      button.className = 'hz-month-task-filter';
      button.textContent = label;
      button.setAttribute('aria-pressed', filter === 'all' ? 'true' : 'false');
      button.addEventListener('click', () => {
        filters.querySelectorAll('.hz-month-task-filter').forEach((candidate) => {
          candidate.setAttribute('aria-pressed', candidate === button ? 'true' : 'false');
        });
        for (const item of rowElements) item.hidden = filter !== 'all' && item.dataset.status !== filter;
        for (const group of dayElements) group.day.hidden = group.rows.every((item) => item.hidden);
      });
      filters.appendChild(button);
    }
  }
}

function appendSourceButtons(parent, paths, openSource) {
  for (const path of uniquePaths(paths)) {
    const button = parent.ownerDocument.createElement('button');
    button.className = 'hz-month-finance-source';
    button.type = 'button';
    button.textContent = sourceBasename(path);
    button.setAttribute('aria-label', button.textContent);
    button.addEventListener('click', () => openSource(path));
    parent.appendChild(button);
  }
}

function renderMonthlyFinanceBlock(container, view = {}, state = {}, openSource = () => {}) {
  clearContainer(container);
  const root = appendTextElement(container, 'section', 'hz-month-block', '');
  const context = validContext(state);
  if (context) {
    appendState(root, context.error);
    return;
  }

  const summary = appendTextElement(root, 'div', 'hz-month-finance-summary hz-month-summary-grid', '');
  appendMetric(summary, '本月收入', formatCents(Number(view.incomeCents) || 0));
  appendMetric(summary, '本月支出', formatCents(Number(view.expenseCents) || 0));
  appendMetric(summary, '本月结余', formatCents(Number(view.netCents) || 0));
  const categories = Array.isArray(view.categories) ? view.categories : [];
  if (categories.length) {
    const categoryList = appendTextElement(root, 'div', 'hz-month-finance-categories', '');
    for (const category of categories) {
      const item = appendTextElement(categoryList, 'div', 'hz-month-finance-category-bar', '');
      appendTextElement(item, 'span', 'hz-month-finance-category-label', category.category);
      const track = appendTextElement(item, 'span', 'hz-month-finance-category-track', '');
      const fill = appendTextElement(track, 'span', 'hz-month-finance-category-fill', '');
      fill.style.width = `${Math.max(0, Math.min(100, Number(category.barPercentage) || 0))}%`;
      appendTextElement(item, 'span', 'hz-month-finance-category-value', `${formatCents(category.cents)} · ${category.percentage}%`);
    }
  }

  const rows = Array.isArray(view.rows) ? view.rows : [];
  if (!rows.length) appendState(root, '本月暂无收支记录');
  else {
    const panel = appendTextElement(root, 'details', 'hz-month-finance-detail-panel', '');
    appendTextElement(panel, 'summary', 'hz-month-finance-detail-summary', `查看全部明细（${rows.length} 笔）`);
    const list = appendTextElement(panel, 'div', 'hz-month-finance-list', '');
    const groups = Array.isArray(view.detailGroups) && view.detailGroups.length
      ? view.detailGroups
      : [{ date: '', dateLabel: '', rows }];
    for (const group of groups) {
      const day = appendTextElement(list, 'section', 'hz-month-finance-day', '');
      if (group.dateLabel) appendTextElement(day, 'h4', 'hz-month-finance-day-heading', group.dateLabel);
      for (const row of group.rows) {
        const item = appendTextElement(day, 'div', 'hz-month-finance-row', '');
        const details = appendTextElement(item, 'div', 'hz-month-finance-details', '');
        appendTextElement(details, 'span', 'hz-month-finance-time', row.clock);
        appendTextElement(details, 'span', 'hz-month-finance-type', row.type);
        appendTextElement(details, 'span', 'hz-month-finance-category', row.category);
        appendTextElement(details, 'span', 'hz-month-finance-title', row.title);
        appendTextElement(details, 'span', 'hz-month-finance-amount', row.amountLabel);
      }
    }
  }

  const invalidSources = uniquePaths(view.invalidSources);
  if (Number(view.invalidCount) > 0) {
    appendState(root, `发现 ${view.invalidCount} 条无法统计的收支记录`);
    appendSourceButtons(root, invalidSources, openSource);
  }

  const readErrors = uniquePaths([...(view.readErrors || []), ...(state.readErrors || [])]);
  if (readErrors.length) {
    appendState(root, `有 ${readErrors.length} 篇日记读取失败`);
    appendSourceButtons(root, readErrors.filter((path) => !invalidSources.includes(path)), openSource);
  }
}

module.exports = {
  resolveMonthlySource,
  loadMonthlyFinanceNotes,
  renderMonthlyErrorBlock,
  renderMonthlyTaskBlock,
  renderMonthlyFinanceBlock,
};
