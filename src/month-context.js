const MONTH = /^(\d{4})-(\d{2})$/;
const MONTHLY_PREFERRED = /^(\d{4})年-(\d{2})-00-月复盘$/;
const MONTHLY_LEGACY = /^(\d{4})年-(\d{2})月复盘$/;

function validMonth(year, month) {
  const number = Number(month);
  return /^\d{4}$/.test(year) && number >= 1 && number <= 12 ? `${year}-${month}` : '';
}

function parseMonthValue(value) {
  const match = MONTH.exec(String(value ?? '').trim());
  return match ? validMonth(match[1], match[2]) : '';
}

function parseMonthlyFilename(basename) {
  const value = String(basename ?? '').trim();
  const match = MONTHLY_PREFERRED.exec(value) || MONTHLY_LEGACY.exec(value);
  return match ? validMonth(match[1], match[2]) : '';
}

function monthlyReviewBasenames(month) {
  const parsed = parseMonthValue(month);
  if (!parsed) return { preferred: '', legacy: '' };
  const [year, monthNumber] = parsed.split('-');
  return {
    preferred: `${year}年-${monthNumber}-00-月复盘`,
    legacy: `${year}年-${monthNumber}月复盘`,
  };
}

function pad(value) { return String(value).padStart(2, '0'); }

function resolveMonthContext({ frontmatter = {}, basename = '' } = {}) {
  const propertyPresent = Object.prototype.hasOwnProperty.call(frontmatter, 'month');
  const propertyMonth = parseMonthValue(frontmatter.month);
  const filenameMonth = parseMonthlyFilename(basename);
  if (propertyPresent && !propertyMonth) return { ok: false, month: '', error: 'month 属性必须使用 YYYY-MM。' };
  if (propertyMonth && filenameMonth && propertyMonth !== filenameMonth) {
    return { ok: false, month: '', error: 'month 属性与月复盘文件名不一致。' };
  }
  const month = propertyMonth || filenameMonth;
  if (!month) return { ok: false, month: '', error: '无法识别月复盘月份。' };
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  return {
    ok: true, month, year, monthNumber,
    startDate: `${month}-01`, endDate: `${month}-${pad(lastDay)}`, error: '',
  };
}

function formatChineseDate(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey));
  if (!match) return '';
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) return '';
  return `${match[1]}年-${match[2]}-${match[3]}-星期${'日一二三四五六'[date.getDay()]}`;
}

module.exports = { parseMonthValue, parseMonthlyFilename, monthlyReviewBasenames, resolveMonthContext, formatChineseDate };
