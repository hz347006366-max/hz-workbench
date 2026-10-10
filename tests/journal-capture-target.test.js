const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveJournalCaptureTarget } = require('../src/journal-capture-target');

const file = { path: '01 日记/2026年/8月/2026年-08-26-星期三.md', basename: '2026年-08-26-星期三' };

test('resolves and freezes an exact journal target', () => {
  const target = resolveJournalCaptureTarget({ file, frontmatter: { type: '日记', date: '2026-08-26' }, dailyFolder: '01 日记' });
  assert.deepEqual(target, { path: file.path, date: '2026-08-26' });
  assert.equal(Object.isFrozen(target), true);
});

test('accepts exactly one strict date source but rejects ambiguity or fallback', () => {
  assert.equal(resolveJournalCaptureTarget({ file: { ...file, basename: '补记' }, frontmatter: { type: '日记', date: '2026-08-26' }, dailyFolder: '01 日记' }).date, '2026-08-26');
  assert.equal(resolveJournalCaptureTarget({ file, frontmatter: { type: '日记' }, dailyFolder: '01 日记' }).date, '2026-08-26');
  assert.throws(() => resolveJournalCaptureTarget({ file, frontmatter: { type: '日记', date: '2026-08-25' }, dailyFolder: '01 日记' }), /日期不一致/);
  assert.throws(() => resolveJournalCaptureTarget({ file: { path: '01 日记/补记.md', basename: '补记', stat: { ctime: Date.now() } }, frontmatter: { type: '日记' }, dailyFolder: '01 日记' }), /无法确定/);
});

test('rejects non-daily, outside-folder, non-markdown, and invalid dates', () => {
  assert.throws(() => resolveJournalCaptureTarget({ file, frontmatter: { type: '项目', date: '2026-08-26' }, dailyFolder: '01 日记' }), /日记/);
  assert.throws(() => resolveJournalCaptureTarget({ file: { ...file, path: '02 项目/x.md' }, frontmatter: { type: '日记', date: '2026-08-26' }, dailyFolder: '01 日记' }), /目录/);
  assert.throws(() => resolveJournalCaptureTarget({ file: { ...file, path: file.path.replace('.md', '.txt') }, frontmatter: { type: '日记', date: '2026-08-26' }, dailyFolder: '01 日记' }), /Markdown/);
  assert.throws(() => resolveJournalCaptureTarget({ file: { ...file, basename: '补记' }, frontmatter: { type: '日记', date: '2026-02-30' }, dailyFolder: '01 日记' }), /日期/);
});
