const { resolveJournalDate } = require('./journal-date');

function parseTaskBlockSource(source) {
  let scope = 'today';
  let includeCompleted;

  for (const line of String(source ?? '').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z]+)\s*:\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const [, key, value] = match;
    if (key === 'scope') {
      if (value !== 'today' && value !== 'tomorrow') {
        throw new Error('scope 必须是 today 或 tomorrow');
      }
      scope = value;
    }
    if (key === 'includeCompleted') {
      if (value !== 'true' && value !== 'false') {
        throw new Error('includeCompleted 必须是 true 或 false');
      }
      includeCompleted = value === 'true';
    }
  }

  return {
    scope,
    includeCompleted: includeCompleted ?? scope === 'today',
  };
}

function resolveSourceDate(app, sourcePath) {
  const file = app?.vault?.getAbstractFileByPath?.(sourcePath);
  if (!file) return '';
  const frontmatter = app?.metadataCache?.getFileCache?.(file)?.frontmatter || {};
  return resolveJournalDate({
    basename: file.basename,
    path: file.path,
  }, frontmatter);
}

function clearContainer(container) {
  if (typeof container.empty === 'function') container.empty();
  else container.replaceChildren();
}

function appendTextElement(parent, tag, className, text) {
  const element = parent.ownerDocument.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  parent.appendChild(element);
  return element;
}

function renderState(root, message) {
  appendTextElement(root, 'div', 'hz-daily-task-state', message);
}

function renderDailyTaskBlock(container, tasks, options = {}) {
  clearContainer(container);
  const root = container.ownerDocument.createElement('section');
  root.className = 'hz-daily-task-block';
  container.appendChild(root);

  const scopeLabel = options.scope === 'tomorrow' ? '明日任务' : '今日任务';
  appendTextElement(root, 'div', 'hz-daily-task-heading', `${scopeLabel}${options.date ? ` · ${options.date}` : ''}`);

  if (options.error) {
    renderState(root, `任务加载失败：${options.error.message || String(options.error)}`);
    return;
  }
  if (!options.date) {
    renderState(root, '无法识别当前笔记日期，请在 frontmatter 中设置 date。');
    return;
  }
  if (options.available === false) {
    renderState(root, `TickTickSync 本地缓存不可用${options.reason ? `：${options.reason}` : ''}`);
    return;
  }
  if (!Array.isArray(tasks) || tasks.length === 0) {
    renderState(root, `${options.date} 没有任务。`);
    return;
  }

  const list = root.ownerDocument.createElement('div');
  list.className = 'hz-daily-task-list';
  root.appendChild(list);
  for (const task of tasks) {
    const row = list.ownerDocument.createElement('div');
    row.className = `hz-daily-task-row${task.completed ? ' is-completed' : ''}`;
    row.dataset.taskId = task.id;
    list.appendChild(row);

    const checkbox = row.ownerDocument.createElement('input');
    checkbox.className = 'hz-daily-task-checkbox';
    checkbox.type = 'checkbox';
    checkbox.checked = Boolean(task.completed);
    checkbox.disabled = true;
    checkbox.setAttribute('aria-label', task.completed ? '已完成' : '未完成');
    row.appendChild(checkbox);
    appendTextElement(row, 'span', 'hz-daily-task-title', task.title || '未命名任务');
  }
}

module.exports = {
  parseTaskBlockSource,
  resolveSourceDate,
  renderDailyTaskBlock,
};
