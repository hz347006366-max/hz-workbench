const test = require('node:test');
const assert = require('node:assert/strict');

const { DailyCaptureService } = require('../src/daily-capture-service');
const { extractMeditation } = require('../src/daily-capture-model');
const { extractJournalCover } = require('../src/core');

const MARKED_NOTE = `---
date: "2026-08-18"
type: 日记
---
## 今日照片
<!-- hz:daily-photo:start -->
<!-- hz:daily-photo:end -->
## 柳比歇夫时间记录
### 时间流水
<!-- hz:time-entries:start -->
<!-- hz:time-entries:end -->
### 时间汇总
<!-- hz:time-summary:start -->
<!-- hz:time-summary:end -->
## 随手记
<!-- hz:quick-notes:start -->
<!-- hz:quick-notes:end -->
## 今日收支
### 收支流水
<!-- hz:finance-entries:start -->
<!-- hz:finance-entries:end -->
### 收支汇总
<!-- hz:finance-summary:start -->
<!-- hz:finance-summary:end -->
`;

function noteFor(date) {
  return MARKED_NOTE.replace('2026-08-18', date);
}

function fixture(initial = { '01 日记/2026年/8月/2026年-08-18-星期二.md': noteFor('2026-08-18') }) {
  const template = `---\ndate: "{{date:YYYY-MM-DD}}"\ntype: 日记\n---\n${MARKED_NOTE.split('---\n').slice(2).join('---\n')}\n## 今日整理\n### 今日摘要\n### 重要决定与分流\n### 今日任务\n\`\`\`hz-tasks\nscope: today\nincludeCompleted: true\n\`\`\`\n### 明日行动\n\`\`\`hz-tasks\nscope: tomorrow\nincludeCompleted: false\n\`\`\`\n\n## 每日冥想\n<!-- hz:daily-meditation:start -->\n<!-- hz:daily-meditation:end -->\n`;
  const files = new Map([...Object.entries(initial), ['07 模板/每日模板.md', template]]);
  const binary = new Map();
  const folders = new Set();
  const calls = { commands: [], modify: [], create: [], cachedRead: [], writeBinary: [], open: [], saves: 0, mkdir: [] };
  const fileObject = (path) => ({ path, basename: path.split('/').pop().replace(/\.md$/, ''), stat: { ctime: 0 } });
  const app = {
    vault: {
      getMarkdownFiles: () => Array.from(files.keys()).filter((path) => path.endsWith('.md')).map(fileObject),
      cachedRead: async (file) => { calls.cachedRead.push(file.path); return files.get(file.path); },
      modify: async (file, content) => { calls.modify.push(file.path); files.set(file.path, content); },
      create: async (path, content) => { calls.create.push(path); files.set(path, content); return fileObject(path); },
      getAbstractFileByPath: (path) => files.has(path) ? fileObject(path) : null,
      adapter: {
        exists: async (path) => files.has(path) || binary.has(path) || folders.has(path) || Array.from(files.keys()).some((item) => item.startsWith(`${path}/`)),
        mkdir: async (path) => { calls.mkdir.push(path); folders.add(path); },
        writeBinary: async (path, value) => { calls.writeBinary.push(path); binary.set(path, Buffer.from(value)); },
        readBinary: async (path) => binary.get(path),
        remove: async (path) => binary.delete(path),
      },
    },
    metadataCache: {
      getFileCache: (file) => ({ frontmatter: { date: /\d{4}-\d{2}-\d{2}/.exec(files.get(file.path))?.[0], type: /type:\s*日记/.test(files.get(file.path)) ? '日记' : undefined } }),
    },
    commands: { executeCommandById: async (id) => { calls.commands.push(id); } },
    workspace: { getLeaf: () => ({ openFile: async (file) => calls.open.push(file.path) }) },
  };
  const settings = {
    dailyFolder: '01 日记', dailyTemplatePath: '07 模板/每日模板.md', dailyPhotoFolder: '06 附件/日记照片', currencySymbol: '¥', activeTimer: null,
  };
  const service = new DailyCaptureService({
    app, settings,
    saveSettings: async () => { calls.saves += 1; },
    now: () => new Date(2026, 7, 18, 14, 32),
    sleep: async () => {},
  });
  return { app, service, settings, template, files, binary, folders, calls, fileObject };
}

test('quick capture modifies one existing journal and preserves manual text', async () => {
  const context = fixture();
  const path = Array.from(context.files.keys())[0];
  context.files.set(path, context.files.get(path).replace('## 随手记', '手写前文\n## 随手记'));
  await context.service.appendQuickNote('一个想法');
  assert.deepEqual(context.calls.modify, [path]);
  assert.match(context.files.get(path), /手写前文/);
  assert.match(context.files.get(path), /- 14:32 一个想法/);
});

test('concurrent quick captures preserve both notes in invocation order', async () => {
  const context = fixture();
  const path = Array.from(context.files.keys())[0];

  await Promise.all([
    context.service.appendQuickNote('FIRST'),
    context.service.appendQuickNote('SECOND'),
  ]);

  const note = context.files.get(path);
  assert.match(note, /FIRST/);
  assert.match(note, /SECOND/);
  assert.ok(note.indexOf('FIRST') < note.indexOf('SECOND'));
});

test('concurrent photo and finance writes preserve both managed blocks', async () => {
  const context = fixture();
  await Promise.all([
    context.service.appendPhoto(Uint8Array.from([3]).buffer, new Date(2026, 7, 18, 9)),
    context.service.addFinance({ at: new Date(2026, 7, 18, 10), type: '支出', category: '餐饮', title: '早餐', amount: 12 }),
  ]);

  const note = Array.from(context.files.values())[0];
  assert.match(note, /!\[\[06 附件\/日记照片\/2026\/2026-08-18-2\.jpg\]\]/);
  assert.match(note, /早餐/);
});

test('a failed note mutation releases the shared queue for the next writer', async () => {
  const context = fixture();
  const originalModify = context.app.vault.modify;
  let fail = true;
  context.app.vault.modify = async (...args) => {
    if (fail) {
      fail = false;
      throw new Error('write denied');
    }
    return originalModify(...args);
  };

  await assert.rejects(context.service.appendQuickNote('FAIL'), /write denied/);
  await context.service.appendQuickNote('RECOVERED');

  assert.match(Array.from(context.files.values())[0], /RECOVERED/);
});

test('daily meditation writes one managed value and replaces it on a second capture', async () => {
  const context = fixture();
  await context.service.setMeditation('第一次冥想');
  await context.service.setMeditation('第二次冥想');
  const dailyPath = [...context.files.keys()].find((path) => path.startsWith('01 日记/'));
  assert.equal(context.calls.modify.length, 2);
  assert.equal((context.files.get(dailyPath).match(/hz:daily-meditation:start/g) || []).length, 1);
  assert.doesNotMatch(context.files.get(dailyPath), /第一次冥想/);
  assert.match(context.files.get(dailyPath), /第二次冥想/);
  assert.match(context.files.get(dailyPath), /hz:daily-meditation-at:2026-08-18T14:32/);
  assert.equal(extractMeditation(context.files.get(dailyPath)), '第二次冥想');
});

test('daily meditation rejects a same-day future exact time before reading or writing', async () => {
  const context = fixture();

  await assert.rejects(() => context.service.setMeditation('未来冥想', new Date(2026, 7, 18, 14, 33)), /未来/);

  assert.deepEqual(context.calls.cachedRead, []);
  assert.deepEqual(context.calls.create, []);
  assert.deepEqual(context.calls.modify, []);
});

test('daily meditation ignores a monthly review created on the target date', async () => {
  const monthlyPath = '01 日记/2026年/8月/2026年-08-00-月复盘.md';
  const dailyPath = '01 日记/2026年/8月/2026年-08-18-星期二.md';
  const monthly = '---\ntype: 月复盘\nmonth: 2026-08\n---\n\n## 每日冥想\n<!-- hz:daily-meditation:start -->\n<!-- hz:daily-meditation:end -->\n';
  const context = fixture({ [monthlyPath]: monthly, [dailyPath]: noteFor('2026-08-18') });
  const createdToday = new Date(2026, 7, 18, 8).getTime();
  context.app.vault.getMarkdownFiles = () => [
    { path: monthlyPath, basename: '2026年-08-00-月复盘', stat: { ctime: createdToday } },
    context.fileObject(dailyPath),
  ];

  await context.service.setMeditation('只写今日日记');

  assert.equal(context.files.get(monthlyPath), monthly);
  assert.match(context.files.get(dailyPath), /只写今日日记/);
  assert.deepEqual(context.calls.modify, [dailyPath]);
});

test('today creation renders the configured template and writes the exact journal path without Daily Notes', async () => {
  const context = fixture({});
  const file = await context.service.ensureJournal(new Date(2026, 7, 18, 9));
  assert.equal(file.path, '01 日记/2026年/8月/2026年-08-18-星期二.md');
  assert.deepEqual(context.calls.commands, []);
  assert.deepEqual(context.calls.create, [file.path]);
  assert.match(context.files.get(file.path), /date: "2026-08-18"/);
  assert.doesNotMatch(context.files.get(file.path), /\{\{|<%/);
});

test('existing journal opens without reading the template or modifying the note', async () => {
  const context = fixture();
  await context.service.openToday();
  assert.deepEqual(context.calls.cachedRead, []);
  assert.deepEqual(context.calls.create, []);
  assert.deepEqual(context.calls.modify, []);
  assert.equal(context.calls.open.length, 1);
});

test('concurrent creation shares one in-flight operation and creates once', async () => {
  const context = fixture({});
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const originalCreate = context.app.vault.create;
  context.app.vault.create = async (...args) => { await gate; return originalCreate(...args); };
  const first = context.service.ensureJournal(new Date(2026, 7, 18, 9));
  const second = context.service.ensureJournal(new Date(2026, 7, 18, 10));
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.path, b.path);
  assert.equal(context.calls.create.length, 1);
});

test('template validation fails before folders or files and releases the creation lock', async () => {
  const context = fixture({});
  context.files.set('07 模板/每日模板.md', '<% invalid %>');
  await assert.rejects(() => context.service.ensureJournal(new Date(2026, 7, 18, 9)), /Templater/);
  assert.deepEqual(context.calls.mkdir, []);
  assert.deepEqual(context.calls.create, []);
  context.files.set('07 模板/每日模板.md', context.template);
  const file = await context.service.ensureJournal(new Date(2026, 7, 18, 9));
  assert.equal(file.path, '01 日记/2026年/8月/2026年-08-18-星期二.md');
  assert.equal(context.calls.create.length, 1);
});

test('starting a new timer finishes the previous one before persisting replacement state', async () => {
  const context = fixture();
  context.settings.activeTimer = { startedAt: new Date(2026, 7, 18, 9).toISOString(), category: '工作', title: '旧事项', project: '' };
  await context.service.startTimer({ category: '学习', title: '新事项', project: '学习计划' }, new Date(2026, 7, 18, 10));
  assert.equal(context.settings.activeTimer.category, '学习');
  assert.equal(context.settings.activeTimer.title, '新事项');
  assert.equal(context.calls.modify.length, 1);
  assert.match(Array.from(context.files.values())[0], /09:00–10:00｜工作｜旧事项/);
  assert.equal(context.calls.saves, 2);
});

test('finishing across midnight validates both notes then writes split entries and summaries', async () => {
  const context = fixture({
    '01 日记/2026年/8月/2026年-08-18-星期二.md': noteFor('2026-08-18'),
    '01 日记/2026年/8月/2026年-08-19-星期三.md': noteFor('2026-08-19'),
  });
  context.settings.activeTimer = { startedAt: new Date(2026, 7, 18, 23, 30).toISOString(), category: '学习', title: '阅读', project: '' };
  await context.service.finishTimer(new Date(2026, 7, 19, 0, 30));
  assert.equal(context.settings.activeTimer, null);
  assert.deepEqual(context.calls.modify, Array.from(context.files.keys()).filter((path) => path.startsWith('01 日记/')));
  assert.match(context.files.get(Array.from(context.files.keys())[0]), /23:30–00:00｜学习｜阅读/);
  assert.match(context.files.get(Array.from(context.files.keys())[1]), /00:00–00:30｜学习｜阅读/);
  assert.match(context.files.get(Array.from(context.files.keys())[0]), /总计：30分/);
});

test('manual time and finance refresh only their managed entries and summaries', async () => {
  const context = fixture();
  await context.service.addManualTime({ start: new Date(2026, 7, 18, 10), end: new Date(2026, 7, 18, 11, 15), category: '工作', title: '写报告', project: '' });
  await context.service.addFinance({ at: new Date(2026, 7, 18, 12), type: '支出', category: '餐饮', title: '午餐', amount: '28.5', project: '' });
  const content = Array.from(context.files.values())[0];
  assert.match(content, /10:00–11:15｜工作｜写报告/);
  assert.match(content, /总计：1小时15分/);
  assert.match(content, /12:00｜支出｜餐饮｜午餐｜¥28.50/);
  assert.match(content, /净额：-¥28.50/);
});

test('missing markers reject before any markdown modification', async () => {
  const context = fixture({ '01 日记/2026年/8月/bad.md': '---\ndate: 2026-08-18\ntype: 日记\n---\n## 随手记\n' });
  await assert.rejects(() => context.service.appendQuickNote('不能写入'), /模板结构不完整/);
  assert.deepEqual(context.calls.modify, []);
});

test('photo replacement uses fixed JPEG path and updates the photo block once', async () => {
  const context = fixture();
  await context.service.replacePhoto(Uint8Array.from([1, 2, 3]).buffer, new Date(2026, 7, 18, 14));
  assert.deepEqual(context.calls.writeBinary, ['06 附件/日记照片/2026/2026-08-18.jpg']);
  assert.match(Array.from(context.files.values())[0], /!\[\[06 附件\/日记照片\/2026\/2026-08-18\.jpg\]\]/);
  assert.match(Array.from(context.files.values())[0], /hz:daily-photo-at:2026-08-18T14:00/);
  assert.equal(extractJournalCover({}, Array.from(context.files.values())[0]), '06 附件/日记照片/2026/2026-08-18.jpg');
  assert.equal(context.calls.modify.length, 1);
});

test('implicit first-photo write rechecks conflict under the lock without modifying asset or note', async () => {
  const context = fixture();
  const target = '06 附件/日记照片/2026/2026-08-18.jpg';
  context.binary.set(target, Buffer.from([9]));

  await assert.rejects(
    () => context.service.createPhoto(Uint8Array.from([1]).buffer, new Date(2026, 7, 18, 9)),
    /照片已存在.*重试/,
  );

  assert.equal(context.binary.get(target)[0], 9);
  assert.deepEqual(context.calls.writeBinary, []);
  assert.deepEqual(context.calls.modify, []);
});

test('concurrent implicit first-photo writes allow only one no-conflict winner', async () => {
  const context = fixture();
  const at = new Date(2026, 7, 18, 9);

  const results = await Promise.allSettled([
    context.service.createPhoto(Uint8Array.from([1]).buffer, at),
    context.service.createPhoto(Uint8Array.from([2]).buffer, at),
  ]);

  assert.deepEqual(results.map((result) => result.status).sort(), ['fulfilled', 'rejected']);
  assert.match(results.find((result) => result.status === 'rejected').reason.message, /照片已存在.*重试/);
  assert.deepEqual(context.calls.writeBinary, ['06 附件/日记照片/2026/2026-08-18.jpg']);
  assert.equal(context.calls.modify.length, 1);
});

test('photo conflict query is read-only and validates the selected date', async () => {
  const context = fixture();
  const at = new Date(2026, 7, 18, 9);
  assert.equal(await context.service.photoExists(at), false);
  context.binary.set('06 附件/日记照片/2026/2026-08-18.jpg', Buffer.from([9]));
  assert.equal(await context.service.photoExists(at), true);
  await assert.rejects(() => context.service.photoExists(new Date(2026, 7, 19, 9)), /未来/);
  assert.deepEqual(context.calls.mkdir, []);
  assert.deepEqual(context.calls.create, []);
  assert.deepEqual(context.calls.modify, []);
  assert.deepEqual(context.calls.writeBinary, []);
});

test('photo append chooses deterministic collision-safe suffixes and appends only managed embeds', async () => {
  const context = fixture();
  const notePath = '01 日记/2026年/8月/2026年-08-18-星期二.md';
  const base = '06 附件/日记照片/2026/2026-08-18.jpg';
  const second = '06 附件/日记照片/2026/2026-08-18-2.jpg';
  context.binary.set(base, Buffer.from([1]));
  context.files.set(notePath, context.files.get(notePath)
    .replace('<!-- hz:daily-photo:end -->', `![[${base}]]\n![[${second}]]\n<!-- hz:daily-photo:end -->`)
    .replace('## 柳比歇夫时间记录', '手写照片说明\n## 柳比歇夫时间记录'));

  const result = await context.service.appendPhoto(Uint8Array.from([3]).buffer, new Date(2026, 7, 18, 9));

  assert.equal(result.path, '06 附件/日记照片/2026/2026-08-18-3.jpg');
  assert.deepEqual(context.calls.writeBinary, [result.path]);
  assert.match(context.files.get(notePath), /!\[\[06 附件\/日记照片\/2026\/2026-08-18-3\.jpg\]\]/);
  assert.match(context.files.get(notePath), /手写照片说明/);
  assert.equal((context.files.get(notePath).match(/hz:daily-photo:start/g) || []).length, 1);
});

test('invalid photo append validates before any vault write', async () => {
  const context = fixture();
  await assert.rejects(() => context.service.appendPhoto(new ArrayBuffer(0), new Date(2026, 7, 18, 9)), /照片数据无效/);
  assert.deepEqual(context.calls.mkdir, []);
  assert.deepEqual(context.calls.create, []);
  assert.deepEqual(context.calls.modify, []);
  assert.deepEqual(context.calls.writeBinary, []);

  const notePath = '01 日记/2026年/8月/2026年-08-18-星期二.md';
  context.files.set(notePath, context.files.get(notePath).replace('<!-- hz:daily-photo:end -->', ''));
  await assert.rejects(() => context.service.appendPhoto(Uint8Array.from([1]).buffer, new Date(2026, 7, 18, 9)), /模板结构不完整/);
  assert.deepEqual(context.calls.mkdir, []);
  assert.deepEqual(context.calls.writeBinary, []);
});

test('concurrent photo appends serialize suffix selection without overwriting', async () => {
  const context = fixture();
  const base = '06 附件/日记照片/2026/2026-08-18.jpg';
  context.binary.set(base, Buffer.from([1]));
  const at = new Date(2026, 7, 18, 9);

  const [first, second] = await Promise.all([
    context.service.appendPhoto(Uint8Array.from([2]).buffer, at),
    context.service.appendPhoto(Uint8Array.from([3]).buffer, at),
  ]);

  assert.deepEqual([first.path, second.path], [
    '06 附件/日记照片/2026/2026-08-18-2.jpg',
    '06 附件/日记照片/2026/2026-08-18-3.jpg',
  ]);
  assert.equal(context.binary.get(first.path)[0], 2);
  assert.equal(context.binary.get(second.path)[0], 3);
});

test('journal-scoped photo, finance, and manual time write only the exact historical note', async () => {
  const yesterdayPath = '01 日记/2026年/8月/2026年-08-17-星期一.md';
  const todayPath = '01 日记/2026年/8月/2026年-08-18-星期二.md';
  const context = fixture({ [yesterdayPath]: noteFor('2026-08-17'), [todayPath]: noteFor('2026-08-18') });
  const target = { path: yesterdayPath, date: '2026-08-17' };
  await context.service.replacePhotoForJournal(Uint8Array.from([4, 5]).buffer, target, new Date(2026, 7, 17, 8, 25));
  await context.service.addFinanceForJournal({ at: new Date(2026, 7, 17, 15), type: '支出', category: '餐饮', title: '补记午餐', amount: 20 }, target);
  await context.service.addManualTimeForJournal({ start: new Date(2026, 7, 17, 9), end: new Date(2026, 7, 17, 10), category: '工作', title: '补记工作' }, target);
  assert.deepEqual(context.calls.create, []);
  assert.deepEqual(new Set(context.calls.modify), new Set([yesterdayPath]));
  assert.deepEqual(context.calls.writeBinary, ['06 附件/日记照片/2026/2026-08-17.jpg']);
  assert.match(context.files.get(yesterdayPath), /15:00｜支出｜餐饮｜补记午餐/);
  assert.match(context.files.get(yesterdayPath), /09:00–10:00｜工作｜补记工作/);
  assert.match(context.files.get(yesterdayPath), /hz:daily-photo-at:2026-08-17T08:25/);
  assert.equal(context.files.get(todayPath), noteFor('2026-08-18'));
});

test('journal-scoped photo query and append preserve exact note identity', async () => {
  const yesterdayPath = '01 日记/2026年/8月/2026年-08-17-星期一.md';
  const todayPath = '01 日记/2026年/8月/2026年-08-18-星期二.md';
  const context = fixture({ [yesterdayPath]: noteFor('2026-08-17'), [todayPath]: noteFor('2026-08-18') });
  const target = { path: yesterdayPath, date: '2026-08-17' };
  const base = '06 附件/日记照片/2026/2026-08-17.jpg';
  context.binary.set(base, Buffer.from([1]));
  context.files.set(yesterdayPath, context.files.get(yesterdayPath)
    .replace('<!-- hz:daily-photo:end -->', `![[${base}]]\n<!-- hz:daily-photo:end -->`));

  assert.equal(await context.service.photoExistsForJournal(target), true);
  const result = await context.service.appendPhotoForJournal(Uint8Array.from([2]).buffer, target);

  assert.equal(result.path, '06 附件/日记照片/2026/2026-08-17-2.jpg');
  assert.match(context.files.get(yesterdayPath), /2026-08-17-2\.jpg/);
  assert.equal(context.files.get(todayPath), noteFor('2026-08-18'));
  assert.deepEqual(new Set(context.calls.modify), new Set([yesterdayPath]));
});

test('journal-scoped quick note and meditation preserve exact note identity and timestamp', async () => {
  const yesterdayPath = '01 日记/2026年/8月/2026年-08-17-星期一.md';
  const todayPath = '01 日记/2026年/8月/2026年-08-18-星期二.md';
  const context = fixture({ [yesterdayPath]: noteFor('2026-08-17'), [todayPath]: noteFor('2026-08-18') });
  const target = { path: yesterdayPath, date: '2026-08-17' };
  const at = new Date(2026, 7, 17, 9, 45);

  await context.service.appendQuickNoteForJournal('精确补记', at, target);
  await context.service.setMeditationForJournal('精确冥想', at, target);

  assert.match(context.files.get(yesterdayPath), /09:45 精确补记/);
  assert.match(context.files.get(yesterdayPath), /精确冥想/);
  assert.equal(context.files.get(todayPath), noteFor('2026-08-18'));
  assert.deepEqual(context.calls.modify, [yesterdayPath, yesterdayPath]);
});

test('journal-scoped capture revalidates identity and rejects cross-date manual time', async () => {
  const context = fixture();
  const path = '01 日记/2026年/8月/2026年-08-18-星期二.md';
  const target = { path, date: '2026-08-18' };
  context.files.set(path, noteFor('2026-08-17'));
  await assert.rejects(() => context.service.addFinanceForJournal({ title: '错写', amount: 1 }, target), /日期/);
  context.files.set(path, noteFor('2026-08-18'));
  await assert.rejects(() => context.service.addManualTimeForJournal({ start: new Date(2026, 7, 18, 23), end: new Date(2026, 7, 19, 1), category: '工作', title: '跨日' }, target), /同一天|本篇/);
  assert.deepEqual(context.calls.modify, []);
});

test('journal-scoped open targets the exact note and refuses a deleted target', async () => {
  const context = fixture();
  const path = '01 日记/2026年/8月/2026年-08-18-星期二.md';
  await context.service.openJournalTarget({ path, date: '2026-08-18' });
  assert.deepEqual(context.calls.open, [path]);
  context.files.delete(path);
  await assert.rejects(() => context.service.openJournalTarget({ path, date: '2026-08-18' }), /不存在/);
});

test('open today uses a new tab leaf and retains other views', async () => {
  const context = fixture();
  await context.service.openToday();
  assert.equal(context.calls.open.length, 1);
});

test('openJournalDate ensures and opens the selected historical journal in a new tab', async () => {
  const context = fixture();
  await context.service.openJournalDate('2026-08-17');
  assert.deepEqual(context.calls.open, ['01 日记/2026年/8月/2026年-08-17-星期一.md']);
});

test('journal-scoped photo rejects cross-date and future exact timestamps before mutation', async () => {
  const path = '01 日记/2026年/8月/2026年-08-18-星期二.md';
  const context = fixture();
  const target = { path, date: '2026-08-18' };
  await assert.rejects(
    () => context.service.replacePhotoForJournal(Uint8Array.from([1]).buffer, target, new Date(2026, 7, 17, 10)),
    /同一天|本篇/,
  );
  await assert.rejects(
    () => context.service.replacePhotoForJournal(Uint8Array.from([1]).buffer, target, new Date(2026, 7, 18, 14, 33)),
    /未来/,
  );
  assert.deepEqual(context.calls.cachedRead, []);
  assert.deepEqual(context.calls.modify, []);
  assert.deepEqual(context.calls.writeBinary, []);
});

test('open failure reports that the newly created journal was retained', async () => {
  const context = fixture({});
  context.app.workspace.getLeaf = () => ({ openFile: async () => { throw new Error('open denied'); } });

  await assert.rejects(() => context.service.openToday(), /日记已创建，但打开失败/);
  assert.equal(context.calls.create.length, 1);
  assert.equal(context.files.has(context.calls.create[0]), true);
});

test('create failure releases the date lock so a corrected retry can succeed', async () => {
  const context = fixture({});
  const originalCreate = context.app.vault.create;
  let attempts = 0;
  context.app.vault.create = async (...args) => {
    attempts += 1;
    if (attempts === 1) throw new Error('disk denied');
    return originalCreate(...args);
  };

  await assert.rejects(() => context.service.ensureJournal(new Date(2026, 7, 18, 9)), /disk denied/);
  const file = await context.service.ensureJournal(new Date(2026, 7, 18, 9));
  assert.equal(file.path, '01 日记/2026年/8月/2026年-08-18-星期二.md');
  assert.equal(attempts, 2);
});

test('historical quick note and meditation create and modify only their selected journal date', async () => {
  const context = fixture();
  const historicalAt = new Date(2026, 7, 17, 9, 45);
  const historicalPath = '01 日记/2026年/8月/2026年-08-17-星期一.md';
  const todayPath = '01 日记/2026年/8月/2026年-08-18-星期二.md';

  await context.service.appendQuickNote('昨天的想法', historicalAt);
  await context.service.setMeditation('昨天的冥想', historicalAt);

  assert.deepEqual(context.calls.create, [historicalPath]);
  assert.deepEqual(context.calls.modify, [historicalPath, historicalPath]);
  assert.match(context.files.get(historicalPath), /- 09:45 昨天的想法/);
  assert.match(context.files.get(historicalPath), /昨天的冥想/);
  assert.equal(context.files.get(todayPath), noteFor('2026-08-18'));
});

test('historical finance preserves its selected exact timestamp and manual time stays on valid dates', async () => {
  const context = fixture();
  const historicalPath = '01 日记/2026年/8月/2026年-08-17-星期一.md';
  const todayPath = '01 日记/2026年/8月/2026年-08-18-星期二.md';

  await context.service.addFinance({ at: new Date(2026, 7, 17, 9, 45), type: '收入', category: '兼职', title: '咨询', amount: 100 });
  await context.service.addManualTime({ start: new Date(2026, 7, 17, 10), end: new Date(2026, 7, 17, 11), category: '工作', title: '复盘' });

  assert.deepEqual(context.calls.create, [historicalPath]);
  assert.match(context.files.get(historicalPath), /09:45｜收入｜兼职｜咨询｜¥100.00/);
  assert.match(context.files.get(historicalPath), /10:00–11:00｜工作｜复盘/);
  assert.equal(context.files.get(todayPath), noteFor('2026-08-18'));
});

test('future historical captures reject before creating folders, files, or modifying notes', async () => {
  const context = fixture({});
  const future = new Date(2026, 7, 19, 9);

  await assert.rejects(() => context.service.appendQuickNote('未来想法', future), /未来/);
  await assert.rejects(() => context.service.setMeditation('未来冥想', future), /未来/);
  await assert.rejects(() => context.service.addFinance({ at: future, type: '支出', category: '餐饮', title: '未来午餐', amount: 20 }), /未来/);
  await assert.rejects(() => context.service.addManualTime({ start: new Date(2026, 7, 18, 13), end: future, category: '工作', title: '跨到未来' }), /未来/);
  await assert.rejects(() => context.service.replacePhoto(Uint8Array.from([1]).buffer, future), /未来/);

  assert.deepEqual(context.calls.mkdir, []);
  assert.deepEqual(context.calls.create, []);
  assert.deepEqual(context.calls.modify, []);
  assert.deepEqual(context.calls.writeBinary, []);
});

test('concurrent historical captures share the selected-date creation lock', async () => {
  const context = fixture({});
  const at = new Date(2026, 7, 17, 9);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const originalCreate = context.app.vault.create;
  context.app.vault.create = async (...args) => { await gate; return originalCreate(...args); };

  const quick = context.service.appendQuickNote('并发随手记', at);
  const meditation = context.service.setMeditation('并发冥想', at);
  release();
  await Promise.all([quick, meditation]);

  assert.equal(context.calls.create.length, 1);
  assert.deepEqual(new Set(context.calls.modify), new Set(['01 日记/2026年/8月/2026年-08-17-星期一.md']));
});

test('journal-scoped writes reject a future journal target before modifying it', async () => {
  const futurePath = '01 日记/2026年/8月/2026年-08-19-星期三.md';
  const context = fixture({ [futurePath]: noteFor('2026-08-19') });
  const target = { path: futurePath, date: '2026-08-19' };

  await assert.rejects(() => context.service.addFinanceForJournal({ type: '支出', category: '餐饮', title: '未来午餐', amount: 20 }, target), /未来/);
  await assert.rejects(() => context.service.addManualTimeForJournal({ start: new Date(2026, 7, 19, 9), end: new Date(2026, 7, 19, 10), category: '工作', title: '未来工作' }, target), /未来/);
  await assert.rejects(() => context.service.replacePhotoForJournal(Uint8Array.from([1]).buffer, target), /未来/);

  assert.deepEqual(context.calls.modify, []);
  assert.deepEqual(context.calls.writeBinary, []);
});

test('journal-scoped finance rejects future and cross-date timestamps before reading or modifying', async () => {
  const historicalPath = '01 日记/2026年/8月/2026年-08-17-星期一.md';
  const context = fixture({ [historicalPath]: noteFor('2026-08-17') });
  const target = { path: historicalPath, date: '2026-08-17' };
  const input = { type: '支出', category: '餐饮', title: '补记午餐', amount: 20 };

  await assert.rejects(() => context.service.addFinanceForJournal({ ...input, at: new Date(2026, 7, 18, 15) }, target), /同一天|本篇/);
  await assert.rejects(() => context.service.addFinanceForJournal({ ...input, at: new Date(2026, 7, 16, 10) }, target), /同一天|本篇/);

  assert.deepEqual(context.calls.cachedRead, []);
  assert.deepEqual(context.calls.modify, []);

  const todayPath = '01 日记/2026年/8月/2026年-08-18-星期二.md';
  const today = fixture({ [todayPath]: noteFor('2026-08-18') });
  await assert.rejects(() => today.service.addFinanceForJournal({ ...input, at: new Date(2026, 7, 18, 15) }, { path: todayPath, date: '2026-08-18' }), /未来/);
  assert.deepEqual(today.calls.cachedRead, []);
  assert.deepEqual(today.calls.modify, []);
});

test('journal-scoped manual time rejects a future interval before reading or modifying', async () => {
  const todayPath = '01 日记/2026年/8月/2026年-08-18-星期二.md';
  const context = fixture({ [todayPath]: noteFor('2026-08-18') });
  const target = { path: todayPath, date: '2026-08-18' };

  await assert.rejects(() => context.service.addManualTimeForJournal({
    start: new Date(2026, 7, 18, 15), end: new Date(2026, 7, 18, 16), category: '工作', title: '未来工作',
  }, target), /未来/);

  assert.deepEqual(context.calls.cachedRead, []);
  assert.deepEqual(context.calls.modify, []);
});
