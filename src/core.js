function pad(value) {
  return String(value).padStart(2, '0');
}

function dateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dailyPath(root, date) {
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = pad(date.getDate());
  return `${String(root).replace(/\/$/, '')}/${year}年/${month}月/${year}年-${pad(month)}-${day}-星期${weekdays[date.getDay()]}.md`;
}

function isTodayTask(task, today, todayFilePath = '') {
  if (!task) return false;
  if (task.due && task.due <= today) return true;
  if (todayFilePath && task.filePath === todayFilePath) return true;
  return /(?:⏫|🔺|priority::\s*(?:high|highest|1))/i.test(task.line || '');
}

function summarizeMarkdown(markdown, limit = 90) {
  return String(markdown || '')
    .replace(/^---[\s\S]*?---\s*/m, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^>.*$/gm, '')
    .replace(/<[^>]+>/g, '')
    .replace(/!\[\[[^\]]+\]\]|!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, alias) => alias || target)
    .replace(/[#*_`~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function startOfWeek(date) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() - result.getDay());
  return result;
}

function buildHeatmap(counts, endDate = new Date(), weeks = 13) {
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  const start = startOfWeek(end);
  start.setDate(start.getDate() - (weeks - 1) * 7);
  const cells = [];
  const totalDays = weeks * 7;

  for (let index = 0; index < totalDays; index += 1) {
    const current = new Date(start);
    current.setDate(start.getDate() + index);
    const key = dateKey(current);
    const count = Math.max(0, Number(counts.get(key) || 0));
    cells.push({
      date: key,
      count,
      level: Math.min(4, count),
    });
  }

  return cells;
}

function formatTickTickTask(text, dueDate) {
  const clean = String(text || '')
    .replace(/^\s*-\s*\[[ xX]\]\s*/, '')
    .replace(/#ticktick\b/gi, '')
    .replace(/#hzworkbench\b/gi, '')
    .replace(/📅\s*\d{4}-\d{2}-\d{2}/g, '')
    .trim()
    .replace(/\s+/g, ' ');

  return `- [ ] ${clean} 📅 ${dueDate} #ticktick #hzworkbench`;
}

function cleanTaskDisplayTitle(value) {
  return String(value || '')
    .replace(/%%\[ticktick_id::\s*[^\]]+\]%%/gi, '')
    .replace(/\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/#(?:ticktick|hzworkbench)\b/gi, '')
    .replace(/(?:📅|due::)\s*\d{4}-\d{2}-\d{2}/gi, '')
    .replace(/[⏬🔽🔼⏫🔺]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractJournalCover(frontmatter = {}, markdown = '') {
  if (frontmatter.cover) {
    return String(frontmatter.cover).replace(/^\[\[|\]\]$/g, '');
  }

  const wikiImage = markdown.match(/!\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/);
  if (wikiImage) return wikiImage[1].trim();

  const markdownImage = markdown.match(/!\[[^\]]*\]\(([^)]+)\)/);
  return markdownImage ? markdownImage[1].trim() : '';
}

function journalStreak(dateValues) {
  const unique = [...new Set(dateValues.filter(Boolean))].sort().reverse();
  if (!unique.length) return 0;
  let streak = 1;
  let cursor = new Date(`${unique[0]}T12:00:00`);

  for (let index = 1; index < unique.length; index += 1) {
    const expected = new Date(cursor);
    expected.setDate(expected.getDate() - 1);
    if (dateKey(expected) !== unique[index]) break;
    streak += 1;
    cursor = expected;
  }

  return streak;
}

function upsertMustDoSection(markdown, taskLine) {
  const source = String(markdown || '').replace(/\r\n/g, '\n');
  const headingPattern = /^## 今日必完成\s*$/m;
  const headingMatch = headingPattern.exec(source);

  if (headingMatch) {
    const sectionStart = headingMatch.index + headingMatch[0].length;
    const remainder = source.slice(sectionStart);
    const nextHeading = /^##\s+/m.exec(remainder);
    const sectionEnd = nextHeading ? sectionStart + nextHeading.index : source.length;
    const section = source.slice(sectionStart, sectionEnd);
    const incompleteCount = (section.match(/^\s*-\s*\[ \]\s+/gm) || []).length;
    if (incompleteCount >= 3) {
      throw new Error('今日必完成最多只能保留 3 项');
    }
    const prefix = source.slice(0, sectionEnd).replace(/\s*$/, '');
    const suffix = source.slice(sectionEnd).replace(/^\s*/, '');
    return `${prefix}\n${taskLine}\n\n${suffix}`.trimEnd() + '\n';
  }

  const firstSection = /^##\s+/m.exec(source);
  const insertAt = firstSection ? firstSection.index : source.length;
  const before = source.slice(0, insertAt).replace(/\s*$/, '');
  const after = source.slice(insertAt).replace(/^\s*/, '');
  return `${before}\n\n## 今日必完成\n${taskLine}\n\n${after}`.trimEnd() + '\n';
}

module.exports = {
  dateKey,
  dailyPath,
  isTodayTask,
  summarizeMarkdown,
  buildHeatmap,
  formatTickTickTask,
  cleanTaskDisplayTitle,
  extractJournalCover,
  journalStreak,
  upsertMustDoSection,
};
