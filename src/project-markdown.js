function asMarkdown(value) {
  return typeof value === 'string' ? value : '';
}

function checklistRecords(markdown) {
  const source = asMarkdown(markdown);
  const lines = source.split(/\n/);
  let offset = 0;
  let sectionStart = -1;
  let sectionEnd = -1;
  const records = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const normalizedLine = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (sectionStart === -1) {
      if (/^##\s+细项清单\s*$/.test(normalizedLine)) sectionStart = offset;
    } else if (/^#{1,2}\s+/.test(normalizedLine)) {
      sectionEnd = offset;
      break;
    } else {
      const match = normalizedLine.match(/^(\s*[-+*]\s+)\[([ xX])\]\s*(.*?)\s*$/);
      if (match) {
        records.push({
          index: records.length,
          text: match[3],
          checked: match[2].toLowerCase() === 'x',
          lineNumber: index + 1,
          lineOffset: offset,
          markerLength: match[1].length,
        });
      }
    }
    offset += line.length + (index < lines.length - 1 ? 1 : 0);
  }

  if (sectionStart === -1) return { found: false, start: -1, end: -1, records: [] };
  return {
    found: true,
    start: sectionStart,
    end: sectionEnd === -1 ? source.length : sectionEnd,
    records,
  };
}

function parseChecklistSection(markdown) {
  const section = checklistRecords(markdown);
  return {
    found: section.found,
    start: section.start,
    end: section.end,
    items: section.records.map(({ index, text, checked, lineNumber }) => ({ index, text, checked, lineNumber })),
  };
}

function parseStageDetails(markdown) {
  const result = { materials: [], waitingReasons: [], acceptanceCriteria: [] };
  const headings = new Map([['材料 / 设备预定', 'materials'], ['等待原因', 'waitingReasons'], ['验收要点', 'acceptanceCriteria']]);
  let active = '';
  for (const rawLine of asMarkdown(markdown).split(/\r?\n/)) {
    const heading = rawLine.match(/^##\s+(.+?)\s*$/);
    if (heading) { active = headings.get(heading[1]) || ''; continue; }
    if (!active || /^#\s+/.test(rawLine)) continue;
    const value = rawLine.replace(/^\s*[-*]\s+/, '').trim();
    if (value) result[active].push(value);
  }
  return result;
}

function setChecklistItemChecked(markdown, { index, checked } = {}) {
  if (typeof checked !== 'boolean') throw new Error('checked 必须为布尔值');
  const source = asMarkdown(markdown);
  const section = checklistRecords(source);
  if (!section.found) throw new Error('未找到二级标题“细项清单”章节');
  if (!Number.isInteger(index) || index < 0 || index >= section.records.length) {
    throw new Error('细项清单索引越界');
  }

  const item = section.records[index];
  const markerOffset = item.lineOffset + item.markerLength;
  return `${source.slice(0, markerOffset)}[${checked ? 'x' : ' '}]${source.slice(markerOffset + 3)}`;
}

function updateFrontmatterField(lines, field, value) {
  const lineIndex = lines.findIndex((line) => new RegExp(`^${field}:`).test(line));
  const nextLine = `${field}: ${value}`;
  if (lineIndex === -1) lines.push(nextLine);
  else lines[lineIndex] = nextLine;
}

function updateStageFrontmatterAfterChecklist(markdown, { status, actualEnd } = {}) {
  const source = asMarkdown(markdown);
  const statusValue = status === undefined ? '' : String(status);
  const actualEndValue = actualEnd === undefined ? '' : String(actualEnd);
  const opening = source.match(/^---(\r?\n)/);

  if (!opening) {
    const newline = source.includes('\r\n') ? '\r\n' : '\n';
    return `---${newline}status: ${statusValue}${newline}actual_end: ${actualEndValue}${newline}---${newline}${source}`;
  }

  const newline = opening[1];
  const contentStart = opening[0].length;
  const remainder = source.slice(contentStart);
  const closing = /^---(\r?\n|$)/m.exec(remainder);
  if (!closing) {
    return `---${newline}status: ${statusValue}${newline}actual_end: ${actualEndValue}${newline}---${newline}${source}`;
  }

  const content = remainder.slice(0, closing.index).replace(/\r?\n$/, '');
  const lines = content === '' ? [] : content.split(/\r?\n/);
  updateFrontmatterField(lines, 'status', statusValue);
  updateFrontmatterField(lines, 'actual_end', actualEndValue);
  const body = remainder.slice(closing.index + closing[0].length);
  return `---${newline}${lines.join(newline)}${newline}---${closing[1]}${body}`;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasProjectLink(line, projectTarget) {
  if (typeof projectTarget !== 'string' || projectTarget === '') return false;
  const target = escapeRegex(projectTarget);
  return new RegExp(`\\[\\[${target}(?:\\|[^\\]]*)?\\]\\]`).test(line);
}

function projectLinkTarget(value) {
  const match = typeof value === 'string' && value.match(/^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/);
  return match ? match[1] : null;
}

function cashType(label) {
  if (label === '收入') return 'income';
  if (label === '支出') return 'expense';
  return null;
}

function normalizeAmount(value) {
  const amount = Number(String(value).replace(/[\s,]/g, ''));
  return Number.isFinite(amount) ? Math.abs(amount) : null;
}

function isIsoCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function invalidCashlog(raw) {
  return { valid: false, raw, reason: '无法识别账目格式' };
}

function parseCashlogLine(line, projectTarget) {
  const raw = typeof line === 'string' ? line : '';
  const taggedProject = raw.match(/^\s*-\s*#(?:收入|支出)(?:\/[^\s]+)+\s+\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/);
  if (taggedProject && taggedProject[1] !== projectTarget) return null;
  if (!hasProjectLink(raw, projectTarget)) return null;

  const amountPattern = '([+-]?\\s*(?:\\d+|\\d{1,3}(?:,\\d{3})+)(?:\\.\\d+)?)';
  const tagged = raw.match(new RegExp(`^\\s*-\\s*#(收入|支出)((?:/[^\\s]+)+)\\s+\\[\\[([^\\]|]+)(?:\\|[^\\]]*)?\\]\\]\\s*(.*?)\\s*💴\\s*${amountPattern}\\s*➕\\s*(\\d{4}-\\d{2}-\\d{2})\\s*$`));
  if (tagged) {
    const amount = normalizeAmount(tagged[5]);
    if (tagged[3] !== projectTarget || amount === null || !isIsoCalendarDate(tagged[6])) return invalidCashlog(raw);
    return {
      valid: true,
      type: cashType(tagged[1]),
      amount,
      date: tagged[6],
      time: '',
      categoryPath: tagged[2].slice(1),
      item: tagged[4],
      project: projectTarget,
      raw,
    };
  }

  const pipeMatch = raw.match(/^\s*-\s*(.*?)\s*$/);
  const parts = pipeMatch ? pipeMatch[1].split('｜').map((part) => part.trim()) : [];
  if (parts.length === 6) {
    const [time, label, categoryPath, item, currency, link] = parts;
    const type = cashType(label);
    const amountMatch = currency.match(new RegExp(`^[¥￥]\\s*${amountPattern}$`));
    if (type && amountMatch && projectLinkTarget(link) === projectTarget) {
      const amount = normalizeAmount(amountMatch[1]);
      if (amount !== null) {
        return {
          valid: true,
          type,
          amount,
          date: '',
          time,
          categoryPath,
          item,
          project: projectTarget,
          raw,
        };
      }
    }
  }

  return invalidCashlog(raw);
}

function summarizeProjectCashlog(lines, projectTarget) {
  const entries = [];
  const categoriesByKey = new Map();
  let income = 0;
  let expense = 0;
  let invalidCount = 0;

  for (const line of Array.isArray(lines) ? lines : []) {
    const parsed = parseCashlogLine(line, projectTarget);
    if (parsed === null) continue;
    if (!parsed.valid) {
      invalidCount += 1;
      continue;
    }

    entries.push(parsed);
    if (parsed.type === 'income') income += parsed.amount;
    else expense += parsed.amount;

    const key = `${parsed.type}\u0000${parsed.categoryPath}`;
    if (!categoriesByKey.has(key)) {
      categoriesByKey.set(key, {
        name: parsed.categoryPath,
        type: parsed.type,
        total: 0,
        entries: [],
      });
    }
    const category = categoriesByKey.get(key);
    category.total += parsed.amount;
    category.entries.push(parsed);
  }

  return {
    income,
    expense,
    balance: income - expense,
    categories: [...categoriesByKey.values()],
    entries,
    invalidCount,
  };
}

function stripLeadingFrontmatter(markdown) {
  if (!markdown.startsWith('---\n') && !markdown.startsWith('---\r\n')) return markdown;
  const lines = markdown.split(/\r?\n/);
  const end = lines.findIndex((line, index) => index > 0 && (line === '---' || line === '...'));
  return end === -1 ? markdown : lines.slice(end + 1).join('\n');
}

function extractLinkedJournalParagraphs(markdown, projectTarget, source = {}) {
  const paragraphs = [];
  const lines = stripLeadingFrontmatter(asMarkdown(markdown)).split(/\r?\n/);
  let current = [];
  let currentKind = '';

  function flush() {
    if (current.length > 0) {
      const text = current.join('\n');
      if (hasProjectLink(text, projectTarget)) {
        paragraphs.push({ date: source.date || '', filePath: source.filePath || '', text });
      }
    }
    current = [];
    currentKind = '';
  }

  for (const line of lines) {
    if (line.trim() === '') {
      flush();
      continue;
    }
    if (/^\s*>/.test(line)) {
      if (currentKind && currentKind !== 'quote') flush();
      currentKind = 'quote';
      current.push(line);
      continue;
    }
    if (/^\s*(?:[-+*]|\d+[.)])\s+/.test(line)) {
      flush();
      currentKind = 'list';
      current.push(line);
      flush();
      continue;
    }
    if (currentKind && currentKind !== 'paragraph') flush();
    currentKind = 'paragraph';
    current.push(line);
  }
  flush();
  return paragraphs;
}

module.exports = {
  parseChecklistSection,
  parseStageDetails,
  setChecklistItemChecked,
  updateStageFrontmatterAfterChecklist,
  parseCashlogLine,
  summarizeProjectCashlog,
  extractLinkedJournalParagraphs,
};
