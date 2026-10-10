const MARKERS = Object.freeze({
  photo: 'daily-photo',
  timeEntries: 'time-entries',
  timeSummary: 'time-summary',
  quickNotes: 'quick-notes',
  financeEntries: 'finance-entries',
  financeSummary: 'finance-summary',
  meditation: 'daily-meditation',
});

const MEDITATION_HEADING = '## 每日冥想';

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseCaptureDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim());
  if (!match) throw new Error('日期无效');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error('日期无效');
  }
  return date;
}

function combineCaptureDateTime(dateValue, timeValue) {
  let date;
  if (dateValue instanceof Date) {
    if (!Number.isFinite(dateValue.getTime())) throw new Error('日期无效');
    date = dateValue;
  } else {
    date = parseCaptureDate(dateValue);
  }
  const match = /^(\d{2}):(\d{2})$/.exec(String(timeValue ?? '').trim());
  if (!match) throw new Error('时间无效');
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new Error('时间无效');
  const combined = new Date(0);
  combined.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
  combined.setHours(hours, minutes, 0, 0);
  if (combined.getFullYear() !== date.getFullYear()
    || combined.getMonth() !== date.getMonth()
    || combined.getDate() !== date.getDate()
    || combined.getHours() !== hours
    || combined.getMinutes() !== minutes) {
    throw new Error('时间无效');
  }
  return combined;
}

function assertNotFuture(target, now = new Date()) {
  if (!(target instanceof Date) || !Number.isFinite(target.getTime())) throw new Error('时间无效');
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('当前时间无效');
  if (target > now) throw new Error('目标时间不能选择未来时间');
  return target;
}

function timeKey(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function linesWithOffsets(source) {
  const lines = [];
  const pattern = /[^\r\n]*(?:\r\n|\n|\r|$)/g;
  let match;
  while ((match = pattern.exec(source)) && match[0]) {
    const ending = /\r\n$|\n$|\r$/.exec(match[0])?.[0] || '';
    lines.push({
      content: match[0].slice(0, match[0].length - ending.length),
      ending,
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return lines;
}

function markerPair(key) {
  const name = MARKERS[key];
  if (!name) throw new Error('未知的每日记录区域');
  return [`<!-- hz:${name}:start -->`, `<!-- hz:${name}:end -->`];
}

function managedBlock(source, key) {
  const text = String(source ?? '');
  const [startMarker, endMarker] = markerPair(key);
  const lines = linesWithOffsets(text);
  const starts = lines.filter((line) => line.content === startMarker);
  const ends = lines.filter((line) => line.content === endMarker);
  if (starts.length !== 1 || ends.length !== 1 || starts[0].start >= ends[0].start || !starts[0].ending) {
    throw new Error(`模板结构不完整：${MARKERS[key]}`);
  }
  const newline = starts[0].ending || text.match(/\r\n|\n|\r/)?.[0] || '\n';
  const interior = text.slice(starts[0].end, ends[0].start);
  const blockLines = interior
    .split(/\r\n|\n|\r/)
    .filter((line, index, all) => !(index === all.length - 1 && line === ''));
  return { text, start: starts[0].end, end: ends[0].start, newline, lines: blockLines };
}

function readManagedBlock(source, key) {
  return managedBlock(source, key).lines;
}

function replaceManagedBlock(source, key, lines) {
  const block = managedBlock(source, key);
  const normalized = Array.from(lines || [], (line) => String(line).replace(/[\r\n]+/g, ''));
  const replacement = normalized.length ? `${normalized.join(block.newline)}${block.newline}` : '';
  return block.text.slice(0, block.start) + replacement + block.text.slice(block.end);
}

function appendManagedLine(source, key, line) {
  const existing = readManagedBlock(source, key);
  return replaceManagedBlock(source, key, [...existing, String(line)]);
}

function meditationDisplayText(value) {
  return String(value ?? '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/!\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~>#-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMeditation(source) {
  try {
    return meditationDisplayText(readManagedBlock(source, 'meditation').join(' '));
  } catch (_) {
    return '';
  }
}

function upsertMeditation(source, value) {
  const text = String(source ?? '');
  const meditation = String(value ?? '').trim();
  if (!meditation) throw new Error('每日冥想不能为空');
  const [startMarker, endMarker] = markerPair('meditation');
  const hasAnyStructure = text.includes(MEDITATION_HEADING)
    || text.includes(startMarker)
    || text.includes(endMarker);
  if (hasAnyStructure) return replaceManagedBlock(text, 'meditation', meditation.split(/\r?\n/));
  const newline = text.match(/\r\n|\n|\r/)?.[0] || '\n';
  const separator = text && !text.endsWith(newline) ? newline : '';
  return `${text}${separator}${text ? newline : ''}${MEDITATION_HEADING}${newline}${newline}${startMarker}${newline}${meditation}${newline}${endMarker}${newline}`;
}

function normalizeList(value) {
  const values = Array.isArray(value) ? value : String(value ?? '').split(/[,，]/);
  const seen = new Set();
  return values.map((item) => String(item).trim()).filter((item) => item && !seen.has(item) && seen.add(item));
}

function cleanField(value, label) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!text) throw new Error(`${label}不能为空`);
  if (/[\r\n｜]/.test(text)) throw new Error(`${label}无效`);
  return text;
}

function cleanProject(value) {
  const project = String(value ?? '').trim();
  if (!project) return '';
  if (/[\r\n|]|\[\[|\]\]/.test(project)) throw new Error('关联项目无效');
  return project;
}

function photoVaultPath(folder, date) {
  const base = String(folder ?? '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!base || base.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('照片目录无效');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('日记日期无效');
  return `${base}/${date.slice(0, 4)}/${date}.jpg`;
}

function formatQuickNote(text, at = new Date()) {
  return `- ${timeKey(at)} ${cleanField(text, '内容')}`;
}

function formatTimeEntry({ start, end, category, title, project = '' }) {
  if (!(start instanceof Date) || Number.isNaN(start.getTime()) || !(end instanceof Date) || Number.isNaN(end.getTime())) throw new Error('时间无效');
  if (end <= start) throw new Error('结束时间必须晚于开始时间');
  const categoryText = cleanField(category, '类别');
  const titleText = cleanField(title, '事项');
  const projectText = cleanProject(project);
  return `- ${timeKey(start)}–${timeKey(end)}｜${categoryText}｜${titleText}${projectText ? `｜[[${projectText}]]` : ''}`;
}

function parseClock(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

function parseTimeEntries(lines) {
  const pattern = /^- (\d{2}:\d{2})–(\d{2}:\d{2})｜([^｜]+)｜([^｜]+?)(?:｜\[\[([^\]]+)\]\])?$/;
  const entries = [];
  for (const line of lines || []) {
    const match = pattern.exec(String(line));
    if (!match) continue;
    const startMinutes = parseClock(match[1]);
    let endMinutes = parseClock(match[2]);
    if (startMinutes == null || endMinutes == null) continue;
    if (endMinutes <= startMinutes) endMinutes += 24 * 60;
    entries.push({
      start: match[1], end: match[2], category: match[3], title: match[4], project: match[5] || '',
      minutes: endMinutes - startMinutes,
    });
  }
  return entries;
}

function durationText(minutes) {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const remainder = total % 60;
  if (!hours) return `${remainder}分`;
  if (!remainder) return `${hours}小时`;
  return `${hours}小时${remainder}分`;
}

function summarizeTimeEntries(entries) {
  const categories = new Map();
  let total = 0;
  for (const entry of entries || []) {
    const minutes = Number(entry.minutes) || 0;
    total += minutes;
    categories.set(entry.category, (categories.get(entry.category) || 0) + minutes);
  }
  return [`- 总计：${durationText(total)}`, ...Array.from(categories, ([category, minutes]) => `- ${category}：${durationText(minutes)}`)];
}

function splitIntervalByLocalDate(start, end) {
  if (!(start instanceof Date) || !(end instanceof Date) || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new Error('时间无效');
  if (end <= start) throw new Error('结束时间必须晚于开始时间');
  const segments = [];
  let cursor = new Date(start);
  while (cursor < end) {
    const nextMidnight = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
    const segmentEnd = end < nextMidnight ? new Date(end) : nextMidnight;
    segments.push({ date: dateKey(cursor), start: new Date(cursor), end: segmentEnd });
    cursor = new Date(segmentEnd);
  }
  return segments;
}

function amountToCents(value) {
  const text = String(value ?? '').trim().replace(/,/g, '');
  if (/^-/.test(text) || text === '0' || /^0\.0{1,2}$/.test(text)) throw new Error('金额必须大于 0');
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error('金额格式无效');
  const [whole, decimal = ''] = text.split('.');
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error('金额必须大于 0');
  return cents;
}

function formatCents(cents, currency = '¥') {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  const whole = Math.floor(absolute / 100).toLocaleString('en-US');
  return `${sign}${currency}${whole}.${String(absolute % 100).padStart(2, '0')}`;
}

function formatFinanceEntry({ at = new Date(), type, category, title, amount, project = '', currency = '¥' }) {
  if (type !== '收入' && type !== '支出') throw new Error('收支类型无效');
  const categoryText = cleanField(category, '分类');
  const titleText = cleanField(title, '事项');
  const projectText = cleanProject(project);
  const cents = amountToCents(amount);
  return `- ${timeKey(at)}｜${type}｜${categoryText}｜${titleText}｜${formatCents(cents, currency)}${projectText ? `｜[[${projectText}]]` : ''}`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseFinanceEntries(lines, currency = '¥') {
  const pattern = new RegExp(`^- (\\d{2}:\\d{2})｜(收入|支出)｜([^｜]+)｜([^｜]+)｜${escapeRegExp(currency)}([\\d,]+\\.\\d{2})(?:｜\\[\\[([^\\]]+)\\]\\])?$`);
  const entries = [];
  for (const line of lines || []) {
    const match = pattern.exec(String(line));
    if (!match) continue;
    try {
      entries.push({ at: match[1], type: match[2], category: match[3], title: match[4], cents: amountToCents(match[5]), project: match[6] || '' });
    } catch (_) { /* ignore noncanonical manual lines */ }
  }
  return entries;
}

function summarizeFinanceEntries(entries, currency = '¥') {
  let income = 0;
  let expense = 0;
  for (const entry of entries || []) {
    if (entry.type === '收入') income += entry.cents;
    if (entry.type === '支出') expense += entry.cents;
  }
  return [
    `- 收入：${formatCents(income, currency)}`,
    `- 支出：${formatCents(expense, currency)}`,
    `- 净额：${formatCents(income - expense, currency)}`,
  ];
}

module.exports = {
  MARKERS,
  readManagedBlock,
  replaceManagedBlock,
  appendManagedLine,
  extractMeditation,
  upsertMeditation,
  photoVaultPath,
  formatQuickNote,
  formatTimeEntry,
  parseTimeEntries,
  summarizeTimeEntries,
  splitIntervalByLocalDate,
  formatCents,
  formatFinanceEntry,
  parseFinanceEntries,
  summarizeFinanceEntries,
  normalizeList,
  dateKey,
  parseCaptureDate,
  combineCaptureDateTime,
  assertNotFuture,
};
