function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '');
}

function validDateKey(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof value === 'string' ? value.trim() : '');
  if (!match) return '';
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return date.getFullYear() === Number(match[1])
    && date.getMonth() === Number(match[2]) - 1
    && date.getDate() === Number(match[3]) ? match[0] : '';
}

function filenameDate(file) {
  const match = /^(\d{4})年-(\d{2})-(\d{2})-星期[一二三四五六日]$/.exec(String(file?.basename || ''));
  return match ? validDateKey(`${match[1]}-${match[2]}-${match[3]}`) : '';
}

function resolveJournalCaptureTarget({ file, frontmatter = {}, dailyFolder }) {
  const path = normalizePath(file?.path);
  const folder = normalizePath(dailyFolder);
  if (!path.toLowerCase().endsWith('.md')) throw new Error('当前文件不是 Markdown 日记');
  if (!folder || !path.startsWith(`${folder}/`)) throw new Error('当前文件不在日记目录中');
  if (frontmatter?.type !== '日记') throw new Error('当前文件不是日记');
  const metadataDate = validDateKey(frontmatter?.date);
  if (frontmatter?.date != null && !metadataDate) throw new Error('日记 frontmatter 日期无效');
  const nameDate = filenameDate(file);
  if (metadataDate && nameDate && metadataDate !== nameDate) throw new Error('日记正文日期与文件名日期不一致');
  const date = metadataDate || nameDate;
  if (!date) throw new Error('无法确定本篇日记日期');
  return Object.freeze({ path, date });
}

module.exports = { resolveJournalCaptureTarget, validDateKey };
