const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

let ProjectRepository;
try {
  ({ ProjectRepository } = require('../src/project-repository'));
} catch (error) {
  ProjectRepository = undefined;
}

const { DEFAULT_INTERIOR_STAGES } = require('../src/project-catalog');

function file(filePath, content = '', frontmatter = {}) {
  const name = filePath.split('/').at(-1);
  return {
    path: filePath,
    basename: name.replace(/\.md$/, ''),
    extension: name.endsWith('.md') ? 'md' : '',
    content,
    frontmatter,
  };
}

function folder(folderPath) {
  return { path: folderPath, children: [] };
}

function createVault(files = [], folders = []) {
  const entries = new Map();
  for (const entry of [...files, ...folders]) entries.set(entry.path, entry);
  const calls = { events: [], read: [], modify: [], createFolder: [], create: [], delete: [] };
  const vault = {
    calls,
    getMarkdownFiles: () => [...entries.values()].filter((entry) => entry.extension === 'md'),
    getAllLoadedFiles: () => [...entries.values()],
    getAbstractFileByPath: (targetPath) => entries.get(targetPath) || null,
    async read(target) {
      calls.events.push({ operation: 'read', path: target.path });
      calls.read.push(target.path);
      if (target.readError) throw target.readError;
      return target.content;
    },
    async modify(target, content) {
      calls.events.push({ operation: 'modify', path: target.path });
      calls.modify.push({ path: target.path, content });
      if (target.modifyError) throw target.modifyError;
      target.content = content;
    },
    async createFolder(targetPath) {
      calls.events.push({ operation: 'createFolder', path: targetPath });
      calls.createFolder.push(targetPath);
      if (entries.has(targetPath)) throw new Error('目录已存在');
      entries.set(targetPath, folder(targetPath));
    },
    async create(targetPath, content) {
      calls.events.push({ operation: 'create', path: targetPath });
      calls.create.push({ path: targetPath, content });
      if (entries.has(targetPath)) throw new Error('文件已存在');
      const created = file(targetPath, content, {});
      entries.set(targetPath, created);
      return created;
    },
    async delete(target, recursive) {
      calls.events.push({ operation: 'delete', path: target.path });
      calls.delete.push({ path: target.path, recursive });
      if (target.deleteError) throw target.deleteError;
      entries.delete(target.path);
      if (recursive) {
        for (const entryPath of [...entries.keys()]) {
          if (entryPath.startsWith(`${target.path}/`)) entries.delete(entryPath);
        }
      }
    },
  };
  const metadataCache = {
    getFileCache(target) {
      if (target.cacheError) throw target.cacheError;
      return { frontmatter: target.frontmatter };
    },
  };
  return { app: { vault, metadataCache }, vault, entries };
}

function assertNoWriteCalls(vault) {
  for (const operation of ['createFolder', 'create', 'modify', 'delete']) {
    assert.equal(vault.calls[operation].length, 0, `${operation} must not run`);
  }
}

function stageMarkdown(items, extra = {}) {
  return [
    '---',
    `type: "项目阶段"`,
    `project_id: "${extra.projectId || 'p-1'}"`,
    `order: ${extra.order || 1}`,
    `status: "${extra.status || '进行中'}"`,
    `actual_end: "${extra.actualEnd || ''}"`,
    '---',
    '# 阶段',
    '## 细项清单',
    ...items.map((item) => `- [${item ? 'x' : ' '}] 项目${items.indexOf(item) + 1}`),
    '',
    '## 阶段记录',
    '- [ ] 这里不得被改写',
  ].join('\n');
}

function draft() {
  return {
    root: '02 项目', name: '项目甲', projectId: 'new-p', projectStatus: '进行中',
    client: '', address: '', manager: '', planStart: '2026-09-01', planEnd: '2026-12-01',
    contractAmount: 0, budget: 0, amountReceived: 0, members: [], suppliers: [],
    stages: DEFAULT_INTERIOR_STAGES.map((stage) => ({
      ...stage, status: '未开始', plannedStart: '', plannedEnd: '', scheduleStatus: '草案', actualStart: '', actualEnd: '', owner: '',
    })),
  };
}

function repositoryFrom(files = [], folders = [], settings = {}) {
  const memory = createVault(files, folders);
  return {
    ...memory,
    repository: new ProjectRepository(memory.app, {
      projectFolder: '02 项目', dailyFolder: '01 日记', scheduleFolder: '01 日记/日程',
      ...settings,
    }),
  };
}

test('exports a repository class without loading Obsidian at module scope', () => {
  assert.equal(typeof ProjectRepository, 'function');
});

if (typeof ProjectRepository === 'function') {
  test('lists only project home notes, sorts names, and isolates one unreadable note', async () => {
    const alpha = file('02 项目/Alpha/Alpha.md', '', { type: '项目', project_id: 'a', project_status: '进行中' });
    const zeta = file('02 项目/Zeta/Zeta.md', '', { type: '项目', project_id: 'z', project_status: '筹备中' });
    const stage = file('02 项目/Alpha/阶段/01.md', '', { type: '项目阶段', project_id: 'a' });
    const broken = file('02 项目/坏/坏.md', '', { type: '项目' });
    broken.cacheError = new Error('frontmatter corrupt');
    const { repository } = repositoryFrom([zeta, stage, broken, alpha]);

    const result = await repository.listProjects();

    assert.deepEqual(result.projects.map((project) => project.file.basename), ['Alpha', 'Zeta']);
    assert.equal(result.projects[0].project_id, 'a');
    assert.equal(result.diagnostics.length, 1);
    assert.match(result.diagnostics[0].message, /坏/);
  });

  test('loads matching stages in order and derives progress plus current stage', async () => {
    const home = file('02 项目/项目甲/项目甲.md', '', { type: '项目', project_id: 'p-1', project_status: '进行中' });
    const second = file('02 项目/项目甲/阶段/02.md', stageMarkdown([false, false], { order: 2, status: '未开始' }), { type: '项目阶段', project_id: 'p-1', order: 2, status: '未开始' });
    const first = file('02 项目/项目甲/阶段/01.md', stageMarkdown([true, true], { order: 1, status: '已完成' }), { type: '项目阶段', project_id: 'p-1', order: 1, status: '已完成' });
    const foreign = file('02 项目/别的/阶段.md', stageMarkdown([true]), { type: '项目阶段', project_id: 'p-2', order: 1 });
    const { repository } = repositoryFrom([home, second, foreign, first]);

    const result = await repository.loadProject(home);

    assert.deepEqual(result.stages.map((stage) => [stage.order, stage.progress]), [[1, 100], [2, 0]]);
    assert.equal(result.progress, 50);
    assert.equal(result.currentStage.file.path, second.path);
    assert.deepEqual(result.diagnostics, []);
  });

  test('toggle rereads before mutation, changes only the requested checklist item, and verifies completed status', async () => {
    const stage = file('02 项目/项目甲/阶段/01.md', stageMarkdown([false, true]), { type: '项目阶段', project_id: 'p-1', order: 1, status: '进行中', actual_end: '' });
    const { repository, vault } = repositoryFrom([stage]);

    const result = await repository.toggleStageItem(stage, 0, true, '2026-09-02');

    assert.equal(vault.calls.read.length, 2);
    assert.equal(vault.calls.modify.length, 1);
    assert.deepEqual(vault.calls.events, [
      { operation: 'read', path: stage.path },
      { operation: 'modify', path: stage.path },
      { operation: 'read', path: stage.path },
    ]);
    assert.match(vault.calls.modify[0].content, /- \[x\] 项目1/);
    assert.match(vault.calls.modify[0].content, /- \[x\] 项目2/);
    assert.match(vault.calls.modify[0].content, /## 阶段记录\n- \[ \] 这里不得被改写/);
    assert.equal(result.progress, 100);
    assert.equal(result.status, '已完成');
    assert.equal(result.actualEnd, '2026-09-02');
  });

  test('toggle reopens a completed stage when an item is unchecked', async () => {
    const stage = file('02 项目/项目甲/阶段/01.md', stageMarkdown([true], { status: '已完成', actualEnd: '2026-09-01' }), { type: '项目阶段', project_id: 'p-1', order: 1, status: '已完成', actual_end: '2026-09-01' });
    const { repository } = repositoryFrom([stage]);

    const result = await repository.toggleStageItem(stage, 0, false, '2026-09-02');

    assert.equal(result.progress, 0);
    assert.equal(result.status, '进行中');
    assert.equal(result.actualEnd, '');
  });

  test('toggle reconciles from freshly read Markdown rather than stale cached frontmatter', async () => {
    const stage = file('02 项目/项目甲/阶段/01.md', stageMarkdown([false], { status: '等待', actualEnd: '' }), {
      type: '项目阶段', project_id: 'p-1', order: 1, status: '已完成', actual_end: '2026-09-01',
    });
    const { repository } = repositoryFrom([stage]);

    const result = await repository.toggleStageItem(stage, 0, false, '2026-09-02');

    assert.equal(result.status, '等待');
    assert.equal(result.actualEnd, '');
    assert.match(result.markdown, /^status: 等待$/m);
    assert.match(result.markdown, /^actual_end: $/m);
  });

  test('toggle rejects paths outside the project folder and a failed write-after-read verification', async () => {
    const outside = file('01 日记/2026-09-02.md', stageMarkdown([false]), { type: '项目阶段' });
    const stage = file('02 项目/项目甲/阶段/01.md', stageMarkdown([false]), { type: '项目阶段', project_id: 'p-1', order: 1, status: '进行中' });
    const { repository, vault } = repositoryFrom([outside, stage]);
    await assert.rejects(() => repository.toggleStageItem(outside, 0, true, '2026-09-02'), /项目目录|Markdown/);
    vault.modify = async (target, content) => { target.content = content.replace('[x] 项目1', '[ ] 项目1'); };
    await assert.rejects(() => repository.toggleStageItem(stage, 0, true, '2026-09-02'), /写后核对/);
  });

  test('create performs no Vault writes when validation or a target file conflict fails', async () => {
    const conflict = file('02 项目/项目甲/项目甲.md');
    const invalid = repositoryFrom();
    await assert.rejects(() => invalid.repository.createProject({ ...draft(), name: '../escape' }), /校验|路径/);
    assertNoWriteCalls(invalid.vault);
    const existing = repositoryFrom([conflict]);
    await assert.rejects(() => existing.repository.createProject(draft()), /校验|存在/);
    assertNoWriteCalls(existing.vault);
  });

  test('create performs no Vault writes when the target project folder already exists', async () => {
    const existingFolder = folder('02 项目/项目甲');
    const { repository, vault } = repositoryFrom([], [existingFolder]);

    await assert.rejects(() => repository.createProject(draft()), /校验|存在/);

    assertNoWriteCalls(vault);
  });

  test('create makes parent folders before all sixteen planned files through Vault APIs', async () => {
    const { repository, vault } = repositoryFrom();
    const result = await repository.createProject(draft());

    assert.equal(result.files.length, 16);
    assert.deepEqual(vault.calls.createFolder, ['02 项目/项目甲', '02 项目/项目甲/阶段']);
    assert.equal(vault.calls.create.length, 16);
    assert.equal(vault.calls.create[0].path, '02 项目/项目甲/项目甲.md');
    assert.equal(vault.calls.create.at(-1).path, '02 项目/项目甲/阶段/15 软装进场.md');
  });

  test('create rolls back its project folder when creating the stage folder fails', async () => {
    const { repository, vault, entries } = repositoryFrom();
    const originalCreateFolder = vault.createFolder;
    vault.createFolder = async (targetPath) => {
      if (targetPath === '02 项目/项目甲/阶段') throw new Error('stage folder unavailable');
      return originalCreateFolder(targetPath);
    };

    await assert.rejects(() => repository.createProject(draft()), /stage folder unavailable/);
    assert.deepEqual([...entries.keys()].filter((path) => path.startsWith('02 项目/项目甲')), []);
    assert.deepEqual(vault.calls.delete, [{ path: '02 项目/项目甲', recursive: true }]);
  });

  test('create rolls back files and folders in reverse order when a file write fails', async () => {
    const existing = file('02 项目/已有项目/已有项目.md', 'must remain');
    const { repository, vault, entries } = repositoryFrom([existing]);
    const originalCreate = vault.create;
    vault.create = async (targetPath, content) => {
      if (targetPath.endsWith('/阶段/01 开工前准备.md')) throw new Error('stage file unavailable');
      return originalCreate(targetPath, content);
    };

    await assert.rejects(() => repository.createProject(draft()), /stage file unavailable/);
    assert.deepEqual([...entries.keys()].filter((path) => path.startsWith('02 项目/项目甲')), []);
    assert.equal(entries.get(existing.path), existing);
    assert.equal(existing.content, 'must remain');
    assert.deepEqual(vault.calls.delete, [
      { path: '02 项目/项目甲/项目甲.md', recursive: true },
      { path: '02 项目/项目甲/阶段', recursive: true },
      { path: '02 项目/项目甲', recursive: true },
    ]);
  });

  test('create reports rollback residuals when cleanup itself fails', async () => {
    const { repository, vault, entries } = repositoryFrom();
    const originalCreate = vault.create;
    vault.create = async (targetPath, content) => {
      if (targetPath.endsWith('/阶段/01 开工前准备.md')) throw new Error('stage file unavailable');
      return originalCreate(targetPath, content);
    };
    const originalDelete = vault.delete;
    vault.delete = async (target, recursive) => {
      if (target.path.endsWith('/项目甲.md') || target.path === '02 项目/项目甲') throw new Error('cleanup denied');
      return originalDelete(target, recursive);
    };

    await assert.rejects(
      () => repository.createProject(draft()),
      /stage file unavailable.*回滚失败.*残留路径：02 项目\/项目甲、02 项目\/项目甲\/项目甲\.md/s,
    );
    assert.ok(entries.has('02 项目/项目甲'));
    assert.ok(entries.has('02 项目/项目甲/项目甲.md'));
    assert.equal(entries.has('02 项目/项目甲/阶段'), false);
  });

  test('delete rejects every escaping or broad path and deletes only a direct project folder', async () => {
    const target = folder('02 项目/项目甲');
    const nested = folder('02 项目/项目甲/阶段');
    const { repository, vault } = repositoryFrom([], [target, nested]);
    for (const unsafe of ['', '.', '..', '02 项目', '02 项目/项目甲/阶段', '02 项目\\项目甲', '02 项目/*', '03 其他/项目']) {
      await assert.rejects(() => repository.deleteProjectFolder(unsafe), /删除|项目目录|路径/);
    }
    await repository.deleteProjectFolder('02 项目/项目甲');
    assert.deepEqual(vault.calls.delete, [{ path: '02 项目/项目甲', recursive: true }]);
  });

  test('loads both cashlog formats and an invalid count only from exact project links', async () => {
    const project = { file: file('02 项目/项目甲/项目甲.md'), basename: '项目甲' };
    const log = file('04 财务/2026-09.md', [
      '- #收入/项目 [[项目甲]] 首款 💴 +500 ➕2026-09-01',
      '- 12:00｜支出｜项目｜材料｜¥20｜[[项目甲]]',
      '- #支出/项目 [[项目甲]] 坏账',
      '- #支出/项目 [[项目甲二期]] 忽略 💴 -99 ➕2026-09-01',
    ].join('\n'));
    const { repository } = repositoryFrom([log], [], { cashlogFolder: '04 财务' });
    const result = await repository.loadProjectFinance(project);
    assert.equal(result.income, 500);
    assert.equal(result.expense, 20);
    assert.equal(result.invalidCount, 1);
  });

  test('loads only exact linked journal paragraphs outside schedules and sorts by frontmatter or filename date', async () => {
    const newer = file('01 日记/随记.md', '正文 [[项目甲]] 新记录', { date: '2026-09-03' });
    const older = file('01 日记/2026-09-01.md', '正文 [[项目甲]] 旧记录', {});
    const schedule = file('01 日记/日程/2026-09-04.md', '正文 [[项目甲]] 不得出现', { date: '2026-09-04' });
    const fuzzy = file('01 日记/2026-09-02.md', '正文 [[项目甲二期]] 不得出现', {});
    const { repository } = repositoryFrom([older, schedule, fuzzy, newer]);
    const result = await repository.loadProjectJournalRecords({ file: file('02 项目/项目甲/项目甲.md'), basename: '项目甲' });
    assert.deepEqual(result.map((record) => record.date), ['2026-09-03', '2026-09-01']);
    assert.deepEqual(result.map((record) => record.filePath), [newer.path, older.path]);
  });

  test('main initializes one repository without changing existing rendering boundaries', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../src/main.js'), 'utf8');
    assert.match(source, /require\('\.\/project-repository'\)/);
    assert.match(source, /await this\.loadSettings\(\);\s*this\.projectRepository = new ProjectRepository\(this\.app, this\.settings\);/);
    assert.equal((source.match(/new ProjectRepository\(/g) || []).length, 1);
  });
}
