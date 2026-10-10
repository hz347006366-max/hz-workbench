const { formatCents } = require('./daily-capture-model');
const { formatChineseDate } = require('./month-context');

const START = '<!-- hz:finance-entries:start -->';
const END = '<!-- hz:finance-entries:end -->';
const ENTRY = /^- (\d{2}:\d{2})｜(收入|支出)｜([^｜]+)｜([^｜]+)｜¥([\d,]+\.\d{2})(?:｜\[\[([^\]]+)\]\])?$/;

function parseFinanceBlock(markdown) {
  const sourceLines = String(markdown ?? '').split(/\r\n|\n|\r/);
  const starts = sourceLines.reduce((indexes, line, index) => (line === START ? [...indexes, index] : indexes), []);
  const ends = sourceLines.reduce((indexes, line, index) => (line === END ? [...indexes, index] : indexes), []);
  if (starts.length !== 1 || ends.length !== 1 || starts[0] >= ends[0]) return { lines: [], structuralError: true };
  return {
    lines: sourceLines.slice(starts[0] + 1, ends[0]).filter((line) => line.trim()),
    structuralError: false,
  };
}

function clockMinutes(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

function parseCents(value) {
  const normalized = String(value).replace(/,/g, '');
  if (!/^\d+\.\d{2}$/.test(normalized)) return null;
  const [whole, fraction] = normalized.split('.');
  const cents = Number(whole) * 100 + Number(fraction);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

function parseFinanceLine(line) {
  const match = ENTRY.exec(line);
  if (!match) return null;
  const minutes = clockMinutes(match[1]);
  const cents = parseCents(match[5]);
  if (minutes == null || cents == null) return null;
  return {
    clock: match[1], minutes, type: match[2], category: match[3], title: match[4], cents,
  };
}

function compareRows(left, right) {
  return left.date.localeCompare(right.date)
    || left.minutes - right.minutes
    || left.path.localeCompare(right.path, 'zh-Hans-CN')
    || left.lineNumber - right.lineNumber;
}

function buildMonthlyFinanceView(notes, monthContext) {
  const month = String(monthContext?.month ?? '');
  const rows = [];
  const invalidSources = new Set();
  const readErrors = new Set();
  let incomeCents = 0;
  let expenseCents = 0;
  let invalidCount = 0;

  for (const note of Array.isArray(notes) ? notes : []) {
    const date = String(note?.date ?? '');
    if (note?.type !== '日记' || date.slice(0, 7) !== month) continue;

    const path = String(note?.path ?? '');
    const block = parseFinanceBlock(note?.content);
    if (block.structuralError) {
      readErrors.add(path);
      continue;
    }
    for (const [lineNumber, line] of block.lines.entries()) {
      const entry = parseFinanceLine(line);
      if (!entry) {
        invalidCount += 1;
        invalidSources.add(path);
        continue;
      }
      if (entry.type === '收入') incomeCents += entry.cents;
      if (entry.type === '支出') expenseCents += entry.cents;
      rows.push({
        ...entry,
        date,
        dateLabel: formatChineseDate(date),
        amountLabel: formatCents(entry.cents),
        path,
        lineNumber,
        text: `${formatChineseDate(date)} ${entry.clock}｜${entry.type}｜${entry.category}｜${entry.title}｜${formatCents(entry.cents)}`,
      });
    }
  }

  rows.sort(compareRows);
  const categoryCents = new Map();
  for (const row of rows) {
    if (row.type === '支出') categoryCents.set(row.category, (categoryCents.get(row.category) || 0) + row.cents);
  }
  const rankedCategories = Array.from(categoryCents, ([category, cents]) => ({ category, cents }))
    .sort((left, right) => right.cents - left.cents || left.category.localeCompare(right.category, 'zh-Hans-CN'));
  const categoryTotals = rankedCategories.slice(0, 5);
  const otherCents = rankedCategories.slice(5).reduce((sum, item) => sum + item.cents, 0);
  if (otherCents) categoryTotals.push({ category: '其他', cents: otherCents });
  const largestCategoryCents = categoryTotals[0]?.cents || 0;
  const categories = categoryTotals.map(({ category, cents }) => {
    const percentage = expenseCents === 0 ? 0 : Math.round(cents / expenseCents * 100);
    const barPercentage = largestCategoryCents === 0 ? 0 : Math.round(cents / largestCategoryCents * 100);
    return { category, cents, percentage, barPercentage, text: `${category}｜${formatCents(cents)}｜${percentage}%` };
  });

  const publicRows = rows.map(({ minutes, lineNumber, ...row }) => row);
  const detailGroups = [];
  for (const row of publicRows) {
    let group = detailGroups[detailGroups.length - 1];
    if (!group || group.date !== row.date) {
      group = { date: row.date, dateLabel: row.dateLabel, rows: [] };
      detailGroups.push(group);
    }
    group.rows.push(row);
  }

  return {
    incomeCents,
    expenseCents,
    netCents: incomeCents - expenseCents,
    categories,
    rows: publicRows,
    detailGroups,
    invalidCount,
    invalidSources: Array.from(invalidSources),
    readErrors: Array.from(readErrors),
  };
}

module.exports = { parseFinanceBlock, buildMonthlyFinanceView };
