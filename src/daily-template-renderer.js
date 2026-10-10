const { validateDailyTemplate } = require('./daily-template');

const DATE_TOKENS = ['dddd', 'YYYY', 'MM', 'DD'];
const SAFE_LITERAL = /^[\p{Script=Han}\s\-_/.:（）()]$/u;
const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

function pad(value) {
  return String(value).padStart(2, '0');
}

function renderDateFormat(format, date) {
  if (!format) throw new Error('日期格式不能为空');
  let cursor = 0;
  let output = '';
  while (cursor < format.length) {
    const token = DATE_TOKENS.find((candidate) => format.startsWith(candidate, cursor));
    if (token) {
      const values = {
        YYYY: String(date.getFullYear()),
        MM: pad(date.getMonth() + 1),
        DD: pad(date.getDate()),
        dddd: WEEKDAYS[date.getDay()],
      };
      output += values[token];
      cursor += token.length;
      continue;
    }
    const character = String.fromCodePoint(format.codePointAt(cursor));
    if (!SAFE_LITERAL.test(character)) throw new Error(`不支持的日期格式字符：${character}`);
    output += character;
    cursor += character.length;
  }
  return output;
}

function validateFrontmatter(source) {
  if (!source.startsWith('---\n') && !source.startsWith('---\r\n')) {
    throw new Error('日记模板 frontmatter 缺失或未闭合');
  }
  const closing = /\r?\n---(?:\r?\n|$)/g;
  closing.lastIndex = source.startsWith('---\r\n') ? 5 : 4;
  const match = closing.exec(source);
  if (!match) throw new Error('日记模板 frontmatter 缺失或未闭合');
  const body = source.slice(source.indexOf('\n') + 1, match.index);
  const lines = body.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim() || /^\s+-\s+.+$/.test(line)) continue;
    if (/^\s/.test(line) || !/^[^:#]+:\s*(?:.*)$/.test(line)) {
      throw new Error(`日记模板 frontmatter 无效：${line.trim() || '空行'}`);
    }
    const value = line.slice(line.indexOf(':') + 1).trim();
    if ((value.startsWith('"') && !value.endsWith('"'))
      || (value.startsWith("'") && !value.endsWith("'"))) {
      throw new Error(`日记模板 frontmatter 引号未闭合：${line.split(':')[0]}`);
    }
  }
  if (!/^date:\s*["']?\d{4}-\d{2}-\d{2}["']?\s*$/m.test(body)) {
    throw new Error('日记模板 frontmatter 缺少有效 date');
  }
  if (!/^type:\s*["']?日记["']?\s*$/m.test(body)) {
    throw new Error('日记模板 frontmatter 缺少 type: 日记');
  }
}

function renderDailyTemplate(source, date) {
  const text = String(source ?? '');
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new Error('日记日期无效');
  if (/<%[\s\S]*?%>|<%|%>/.test(text)) throw new Error('日记模板含 Templater 代码，已停止创建');

  const rendered = text.replace(/\{\{([\s\S]*?)\}\}/g, (_match, expression) => {
    if (!expression.startsWith('date:')) throw new Error(`不支持的模板变量：{{${expression}}}`);
    return renderDateFormat(expression.slice(5), date);
  });
  if (/\{\{|\}\}/.test(rendered)) throw new Error('不支持的模板变量或未闭合变量');
  validateFrontmatter(rendered);
  const errors = validateDailyTemplate(rendered);
  if (errors.length) throw new Error(`日记模板结构无效：${errors.join('；')}`);
  return rendered;
}

module.exports = { renderDailyTemplate, renderDateFormat, validateFrontmatter };
