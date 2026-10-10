const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { renderDailyTemplate } = require('../src/daily-template-renderer');

const template = () => fs.readFileSync(path.resolve(__dirname, '../assets/每日模板.md'), 'utf8');
const monday = new Date(2026, 7, 24, 12);

test('renders the four supported local date tokens with Chinese weekday text', () => {
  const rendered = renderDailyTemplate(template(), monday);
  assert.match(rendered, /date: "2026-08-24"/);
  assert.match(rendered, /# 2026年-08-24-星期一/);
  assert.doesNotMatch(rendered, /\{\{|<%/);
});

test('rejects unknown mustache variables templater code and unsupported date formats', () => {
  assert.throws(() => renderDailyTemplate(template().replace('{{date:YYYY-MM-DD}}', '{{title}}'), monday), /不支持的模板变量/);
  assert.throws(() => renderDailyTemplate(`${template()}\n<% tp.file.title %>`, monday), /Templater/);
  assert.throws(() => renderDailyTemplate(template().replace('YYYY-MM-DD', 'YY-MM-DD'), monday), /不支持的日期格式/);
  assert.throws(() => renderDailyTemplate(template().replace('YYYY-MM-DD', ''), monday), /日期格式不能为空/);
  assert.throws(() => renderDailyTemplate(template().replace('YYYY-MM-DD', 'YYYY[年]MM'), monday), /不支持的日期格式/);
});

test('rejects malformed frontmatter markers and readonly task contracts', () => {
  assert.throws(() => renderDailyTemplate(template().replace('\n---\n\n#', '\n\n#'), monday), /frontmatter/);
  assert.throws(() => renderDailyTemplate(template().replace('date: "{{date:YYYY-MM-DD}}"', 'date: "{{date:YYYY-MM-DD}}'), monday), /frontmatter/);
  assert.throws(() => renderDailyTemplate(template().replace('<!-- hz:quick-notes:end -->', ''), monday), /quick-notes/);
  assert.throws(() => renderDailyTemplate(template().replace('scope: tomorrow', 'scope: today'), monday), /明日行动/);
});

test('rejects crossed managed marker ranges before returning content', () => {
  const crossed = template()
    .replace('<!-- hz:daily-photo:end -->', 'TEMP_DAILY_END')
    .replace('<!-- hz:quick-notes:start -->', '<!-- hz:daily-photo:end -->')
    .replace('TEMP_DAILY_END', '<!-- hz:quick-notes:start -->');
  assert.throws(() => renderDailyTemplate(crossed, monday), /管理标记/);
});
