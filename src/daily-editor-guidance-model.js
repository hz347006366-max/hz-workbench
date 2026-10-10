const GUIDANCE_SECTIONS = Object.freeze([
  Object.freeze({ id: 'daily-photo', marker: 'daily-photo', heading: '今日照片', level: 2, interaction: 'action', action: 'photo', label: '为本篇日记添加最有意义的一张照片' }),
  Object.freeze({ id: 'time-entries', marker: 'time-entries', heading: '时间流水', level: 3, interaction: 'action', action: 'record-today', label: '为本篇日记补记时间' }),
  Object.freeze({ id: 'quick-notes', marker: 'quick-notes', heading: '随手记', level: 2, interaction: 'cursor', action: null, label: '此刻有什么值得记下的想法？' }),
  Object.freeze({ id: 'finance-entries', marker: 'finance-entries', heading: '收支流水', level: 3, interaction: 'action', action: 'finance', label: '为本篇日记补记收入或支出' }),
  Object.freeze({ id: 'daily-summary', heading: '今日摘要', level: 3, interaction: 'cursor', action: null, label: '今天最值得记住的事情是什么？' }),
  Object.freeze({ id: 'decisions', heading: '重要决定与分流', level: 3, interaction: 'cursor', action: null, label: '今天做了什么决定？后续应该放到哪里？' }),
]);

const TECHNICAL_MARKERS = Object.freeze([
  'daily-photo', 'time-entries', 'time-summary', 'quick-notes', 'finance-entries', 'finance-summary', 'daily-meditation',
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

function isDailyFrontmatter(text) {
  const match = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return false;
  const types = match[1].split(/\r?\n/).filter((line) => /^type\s*:/.test(line));
  if (types.length !== 1) return false;
  const value = types[0].replace(/^type\s*:\s*/, '').trim();
  return value === '日记' || /^(['"])日记\1$/.test(value);
}

function meaningful(value) {
  return String(value).trim().length > 0;
}

function markerPair(lines, marker) {
  const startText = `<!-- hz:${marker}:start -->`;
  const endText = `<!-- hz:${marker}:end -->`;
  const starts = lines.filter((line) => line.raw.trim() === startText);
  const ends = lines.filter((line) => line.raw.trim() === endText);
  if (starts.length !== 1 || ends.length !== 1 || starts[0].from >= ends[0].from) return null;
  const foreignBoundaryInside = lines.some((line) => (
    line.from > starts[0].from
    && line.from < ends[0].from
    && /^<!-- hz:[a-z0-9-]+:(?:start|end) -->$/.test(line.raw.trim())
  ));
  if (foreignBoundaryInside) return null;
  return { start: starts[0], end: ends[0] };
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

function firstBlankLine(lines, afterIndex, boundary, includeBoundary = false) {
  return lines.find((line, index) => (
    index > afterIndex
    && (includeBoundary ? line.from <= boundary : line.from < boundary)
    && line.raw.trim() === ''
  )) || null;
}

function analyzeDailyEditor(text, options = {}) {
  const source = String(text || '');
  if (!isDailyFrontmatter(source)) return { isDaily: false, hiddenMarkers: [], placeholders: [] };
  const showGuidance = options.showGuidance !== false;
  const showTechnicalMarkers = options.showTechnicalMarkers === true;
  const lines = lineRecords(source);
  const headings = headingRanges(lines);
  const hiddenMarkers = [];
  const placeholders = [];
  const pairs = new Map(TECHNICAL_MARKERS.map((marker) => [marker, markerPair(lines, marker)]));

  if (!showTechnicalMarkers) {
    for (const marker of TECHNICAL_MARKERS) {
      const pair = pairs.get(marker);
      if (!pair) continue;
      hiddenMarkers.push(
        { id: marker, from: pair.start.from, to: pair.start.lineTo, wholeLine: true },
        { id: marker, from: pair.end.from, to: pair.end.lineTo, wholeLine: true },
      );
    }
  }

  for (const section of GUIDANCE_SECTIONS) {
    const matchingHeadings = headings.filter((item) => item.level === section.level && item.title === section.heading);
    if (matchingHeadings.length !== 1) continue;
    const [heading] = matchingHeadings;
    if (section.marker) {
      const pair = pairs.get(section.marker);
      if (!pair || heading.line.from >= pair.start.from) continue;
      const body = source.slice(heading.line.lineTo, pair.start.from) + source.slice(pair.start.lineTo, pair.end.from);
      if (showGuidance && !meaningful(body)) {
        const cursorInteraction = section.interaction === 'cursor';
        const blankLine = cursorInteraction
          ? firstBlankLine(lines, heading.index, pair.start.from)
          : null;
        if (cursorInteraction && !blankLine) continue;
        placeholders.push({
          id: section.id, label: section.label,
          interaction: section.interaction, action: section.action,
          at: cursorInteraction ? blankLine.from : pair.start.from,
          cursor: cursorInteraction ? blankLine.from : null,
          block: !cursorInteraction,
        });
      }
      continue;
    }

    const next = headings.find((item) => item.index > heading.index && item.level <= heading.level);
    const bodyFrom = heading.line.lineTo;
    const bodyTo = next ? next.line.from : source.length;
    if (showGuidance && !meaningful(source.slice(bodyFrom, bodyTo))) {
      const blankLine = firstBlankLine(lines, heading.index, bodyTo, !next);
      if (!blankLine) continue;
      placeholders.push({
        id: section.id, label: section.label,
        interaction: 'cursor', action: null,
        at: blankLine.from, cursor: blankLine.from, block: false,
      });
    }
  }

  return { isDaily: true, hiddenMarkers, placeholders };
}

module.exports = { GUIDANCE_SECTIONS, analyzeDailyEditor };
