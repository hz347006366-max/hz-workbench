const MANAGED_MARKERS = [
  'daily-photo', 'time-entries', 'time-summary', 'quick-notes', 'finance-entries', 'finance-summary', 'daily-meditation',
];

const ORDERED_HEADINGS = [
  '## 今日照片',
  '## 柳比歇夫时间记录',
  '### 时间流水',
  '### 时间汇总',
  '## 随手记',
  '## 今日收支',
  '### 收支流水',
  '### 收支汇总',
  '## 今日整理',
  '### 今日摘要',
  '### 重要决定与分流',
  '### 今日任务',
  '### 明日行动',
  '## 每日冥想',
];

const NEW_DAILY_TEMPLATE_BODY = [
  '',
  '## 今日照片',
  '',
  '<!-- hz:daily-photo:start -->',
  '<!-- hz:daily-photo:end -->',
  '',
  '## 柳比歇夫时间记录',
  '',
  '### 时间流水',
  '',
  '<!-- hz:time-entries:start -->',
  '<!-- hz:time-entries:end -->',
  '',
  '### 时间汇总',
  '',
  '<!-- hz:time-summary:start -->',
  '- 总计：0分',
  '<!-- hz:time-summary:end -->',
  '',
  '## 随手记',
  '',
  '<!-- hz:quick-notes:start -->',
  '<!-- hz:quick-notes:end -->',
  '',
  '## 今日收支',
  '',
  '### 收支流水',
  '',
  '<!-- hz:finance-entries:start -->',
  '<!-- hz:finance-entries:end -->',
  '',
  '### 收支汇总',
  '',
  '<!-- hz:finance-summary:start -->',
  '- 收入：¥0.00',
  '- 支出：¥0.00',
  '- 净额：¥0.00',
  '<!-- hz:finance-summary:end -->',
  '',
  '## 今日整理',
  '',
  '### 今日摘要',
  '',
  '',
  '### 重要决定与分流',
  '',
  '',
  '### 今日任务',
  '',
  '```hz-tasks',
  'scope: today',
  'includeCompleted: true',
  '```',
  '',
  '### 明日行动',
  '',
  '```hz-tasks',
  'scope: tomorrow',
  'includeCompleted: false',
  '```',
  '',
  '## 每日冥想',
  '',
  '<!-- hz:daily-meditation:start -->',
  '<!-- hz:daily-meditation:end -->',
];

function linesWithOffsets(source) {
  const lines = [];
  const pattern = /[^\r\n]*(?:\r\n|\n|\r|$)/g;
  let match;
  while ((match = pattern.exec(source)) && match[0]) {
    const ending = /\r\n$|\n$|\r$/.exec(match[0])?.[0] || '';
    lines.push({ content: match[0].slice(0, match[0].length - ending.length), ending, start: match.index, end: match.index + match[0].length });
  }
  return lines;
}

function validateDailyTemplate(source) {
  const text = String(source ?? '');
  const errors = [];
  let prior = -1;
  for (const heading of ORDERED_HEADINGS) {
    const positions = [];
    let cursor = 0;
    while ((cursor = text.indexOf(heading, cursor)) >= 0) { positions.push(cursor); cursor += heading.length; }
    if (positions.length !== 1 || positions[0] <= prior) errors.push(`标题缺失、重复或顺序错误：${heading}`);
    if (positions.length === 1) prior = positions[0];
  }
  for (const marker of MANAGED_MARKERS) {
    const startToken = `<!-- hz:${marker}:start -->`;
    const endToken = `<!-- hz:${marker}:end -->`;
    const starts = text.split(startToken).length - 1;
    const ends = text.split(endToken).length - 1;
    const start = text.indexOf(startToken);
    const end = text.indexOf(endToken);
    if (starts !== 1 || ends !== 1 || start < 0 || end < 0 || start >= end) errors.push(`管理标记缺失、重复或顺序错误：${marker}`);
  }
  const markerPositions = MANAGED_MARKERS.flatMap((marker) => [
    text.indexOf(`<!-- hz:${marker}:start -->`),
    text.indexOf(`<!-- hz:${marker}:end -->`),
  ]);
  if (markerPositions.some((position, index) => position < 0 || (index > 0 && position <= markerPositions[index - 1]))) {
    errors.push('管理标记整体顺序错误');
  }
  if ((text.match(/```hz-tasks/g) || []).length !== 2) errors.push('hz-tasks 区块必须恰好为 2 个');
  if (!/```hz-tasks\r?\nscope: today\r?\nincludeCompleted: true\r?\n```/.test(text)) errors.push('今日任务只读区块无效');
  if (!/```hz-tasks\r?\nscope: tomorrow\r?\nincludeCompleted: false\r?\n```/.test(text)) errors.push('明日行动只读区块无效');
  return errors;
}

function isCurrentCalloutTemplate(text) {
  const required = [
    '<%* tR += await tp.user.journal_navigation.run(tp); %>',
    '> [!note]- 今日照片',
    '> [!note]- 柳比歇夫时间记录',
    '> [!note]- 随手记',
    '> [!note]- 今日收支',
    '> [!summary]- 今日整理',
    '> **今日任务**',
    '> **明日行动**',
  ];
  return required.every((token) => text.includes(token));
}

function updateDailyTemplate(source) {
  const text = String(source ?? '');
  if (validateDailyTemplate(text).length === 0) return text;
  if (!isCurrentCalloutTemplate(text)) return text;
  const lines = linesWithOffsets(text);
  const navigation = lines.find((line) => line.content === '<%* tR += await tp.user.journal_navigation.run(tp); %>');
  if (!navigation || !navigation.ending) return text;
  const newline = navigation.ending || text.match(/\r\n|\n|\r/)?.[0] || '\n';
  const hasFinalNewline = /\r\n$|\n$|\r$/.test(text);
  let body = NEW_DAILY_TEMPLATE_BODY.join(newline);
  if (hasFinalNewline) body += newline;
  return text.slice(0, navigation.start) + body.replace(new RegExp(`^${newline}`), '');
}

module.exports = { NEW_DAILY_TEMPLATE_BODY, validateDailyTemplate, updateDailyTemplate };
