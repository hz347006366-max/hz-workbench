function validDate(year, month, day) {
  const value = new Date(Number(year), Number(month) - 1, Number(day));
  if (value.getFullYear() !== Number(year)
    || value.getMonth() !== Number(month) - 1
    || value.getDate() !== Number(day)) return '';
  return year + '-' + month + '-' + day;
}

function dateIn(value) {
  const text = Array.isArray(value) ? value.join(' ') : String(value ?? '');
  const match = text.match(/(\d{4})(?:年-|-)(\d{1,2})-(\d{1,2})/);
  if (!match) return '';
  return validDate(match[1], match[2].padStart(2, '0'), match[3].padStart(2, '0'));
}

function folderDate(file) {
  const folder = String(file?.path || '').match(/(?:^|\/)(\d{4})年\/(\d{1,2})月\//);
  const day = String(file?.basename || '').match(/^(\d{1,2})(?:日|$)/);
  if (!folder || !day) return '';
  return validDate(folder[1], folder[2].padStart(2, '0'), day[1].padStart(2, '0'));
}

function ctimeDate(file) {
  const value = new Date(Number(file?.stat?.ctime));
  if (!Number.isFinite(value.getTime())) return '';
  return validDate(
    String(value.getFullYear()),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  );
}

function resolveJournalDate(file, frontmatter = {}) {
  for (const value of [frontmatter.date, frontmatter.day, frontmatter.created]) {
    const resolved = dateIn(value);
    if (resolved) return resolved;
  }
  return dateIn(file?.basename) || folderDate(file) || ctimeDate(file);
}

module.exports = { resolveJournalDate };
