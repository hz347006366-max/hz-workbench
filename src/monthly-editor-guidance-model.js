const MONTHLY_GUIDANCE_SECTIONS = Object.freeze([
  Object.freeze({ id: 'completed', heading: '本月完成了什么', label: '这个月真正完成了哪些重要事情？' }),
  Object.freeze({ id: 'learning', heading: '最重要的收获', label: '这个月最值得带走的经验或认识是什么？' }),
  Object.freeze({ id: 'problems', heading: '遇到的问题', label: '什么事情没有做好，原因是什么？' }),
  Object.freeze({ id: 'next-three', heading: '下月最重要的三件事', label: '下个月最重要的三件事是什么？' }),
]);

function lineRecords(text) {
  const records = [];
  let from = 0;
  for (const raw of String(text).split('\n')) {
    const to = from + raw.length;
    records.push({ raw: raw.endsWith('\r') ? raw.slice(0, -1) : raw, from, to, lineTo: to < text.length ? to + 1 : to });
    from = to + 1;
  }
  return records;
}

function isMonthlyFrontmatter(text) {
  const match = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return false;
  const types = match[1].split(/\r?\n/).filter((line) => /^type\s*:/.test(line));
  if (types.length !== 1) return false;
  const value = types[0].replace(/^type\s*:\s*/, '').trim();
  return value === '月复盘' || /^(['"])月复盘\1$/.test(value);
}

function headingRanges(lines) {
  const headings = [];
  let fence = null;
  lines.forEach((line, index) => {
    if (fence) {
      const closingFence = line.raw.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
      if (closingFence && closingFence[1][0] === fence.character && closingFence[1].length >= fence.length) {
        fence = null;
      }
      return;
    }
    const fenceMatch = line.raw.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      fence = { character: fenceMatch[1][0], length: fenceMatch[1].length };
      return;
    }
    const match = line.raw.match(/^(#{1,6})[ \t]+(.+?)\s*$/);
    if (match) headings.push({ index, level: match[1].length, title: match[2].trim(), line });
  });
  return headings;
}

function firstBlankLine(lines, afterIndex, boundary, includeBoundary) {
  return lines.find((line, index) => (
    index > afterIndex
    && (includeBoundary ? line.from <= boundary : line.from < boundary)
    && line.raw.trim() === ''
  )) || null;
}

function analyzeMonthlyEditor(text, options = {}) {
  const source = String(text || '');
  if (!isMonthlyFrontmatter(source)) return { isMonthly: false, placeholders: [] };
  if (options.showGuidance === false) return { isMonthly: true, placeholders: [] };

  const lines = lineRecords(source);
  const headings = headingRanges(lines);
  const placeholders = [];
  for (const section of MONTHLY_GUIDANCE_SECTIONS) {
    const matches = headings.filter((heading) => heading.level === 3 && heading.title === section.heading);
    if (matches.length !== 1) continue;
    const heading = matches[0];
    const next = headings.find((item) => item.index > heading.index && item.level <= 3);
    const bodyTo = next ? next.line.from : source.length;
    if (source.slice(heading.line.lineTo, bodyTo).trim().length > 0) continue;
    const blankLine = firstBlankLine(lines, heading.index, bodyTo, !next);
    if (!blankLine) continue;
    placeholders.push({ id: section.id, label: section.label, at: blankLine.from, cursor: blankLine.from });
  }
  return { isMonthly: true, placeholders };
}

module.exports = { MONTHLY_GUIDANCE_SECTIONS, analyzeMonthlyEditor };
