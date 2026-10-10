const { parseMonthlyFilename } = require('./month-context');

function renderMonthlyReviewTemplate(basename) {
  const month = parseMonthlyFilename(basename);
  if (!month) throw new Error('月复盘文件名必须使用 YYYY年-MM-00-月复盘（兼容旧名称 YYYY年-MM月复盘）');
  const [year, monthNumber] = month.split('-');
  return [
    '---', 'type: 月复盘', `month: ${month}`, 'tags:', '  - 月复盘', '---', '',
    `# ${year}年${monthNumber}月复盘`, '',
    '## 本月任务', '', '```hz-month-tasks', '```', '',
    '## 本月收支', '', '```hz-month-finance', '```', '',
    '## 本月总结', '',
    '### 本月完成了什么', '',
    '### 最重要的收获', '',
    '### 遇到的问题', '',
    '### 下月最重要的三件事', '',
  ].join('\n');
}

function renderMonthlyReviewTemplaterArtifact() {
  return [
    '<%*',
    'const match = tp.file.title.match(/^(\\d{4})年-(\\d{2})(?:-00-)?月复盘$/);',
    "if (!match) throw new Error('月复盘文件名必须使用 YYYY年-MM-00-月复盘（兼容旧名称 YYYY年-MM月复盘）');",
    'const [, year, month] = match;',
    'tR += `---\\ntype: 月复盘\\nmonth: ${year}-${month}\\ntags:\\n  - 月复盘\\n---\\n\\n# ${year}年${month}月复盘`;',
    '%>',
    '',
    '## 本月任务',
    '',
    '```hz-month-tasks',
    '```',
    '',
    '## 本月收支',
    '',
    '```hz-month-finance',
    '```',
    '',
    '## 本月总结',
    '',
    '### 本月完成了什么',
    '',
    '### 最重要的收获',
    '',
    '### 遇到的问题',
    '',
    '### 下月最重要的三件事',
    '',
  ].join('\n');
}

module.exports = { renderMonthlyReviewTemplate, renderMonthlyReviewTemplaterArtifact };
