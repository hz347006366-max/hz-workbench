const test = require('node:test');
const assert = require('node:assert/strict');
const { ProjectRepository } = require('../src/project-repository');

let buildProjectOverviewModel;
let buildProjectCockpitModel;
try {
  ({ buildProjectOverviewModel, buildProjectCockpitModel } = require('../src/project-view-model'));
} catch (error) {
  // The RED run deliberately exercises the missing view-model module.
}

function project(path, name, projectStatus, planEnd = '2026-10-01', stages = []) {
  return {
    file: { path, basename: name },
    name,
    project_status: projectStatus,
    plan_end: planEnd,
    stages,
  };
}

function stage(path, name, order, status, items, dates = {}) {
  return {
    file: { path, basename: name },
    name,
    order,
    status,
    items,
    valid: true,
    ...dates,
  };
}

function repositoryFixtureWithReadDiagnostics() {
  const home = { path: '02 项目/项目甲/项目甲.md', basename: '项目甲', extension: 'md' };
  const unreadableStage = {
    path: '02 项目/项目甲/阶段/01.md', basename: '01 开工', extension: 'md', readError: new Error('repository-stage-error'),
  };
  const unreadableCashlog = {
    path: '04 财务/2026-09.md', basename: '2026-09', extension: 'md', readError: new Error('finance-read-error'),
  };
  const frontmatter = new Map([
    [home.path, { type: '项目', project_id: 'p-1', project_status: '进行中', plan_end: '2026-09-30' }],
    [unreadableStage.path, { type: '项目阶段', project_id: 'p-1', order: 1, status: '进行中' }],
    [unreadableCashlog.path, {}],
  ]);
  const files = [home, unreadableStage, unreadableCashlog];
  const app = {
    vault: {
      getMarkdownFiles: () => files,
      async read(file) {
        if (file.readError) throw file.readError;
        return '';
      },
    },
    metadataCache: { getFileCache: (file) => ({ frontmatter: frontmatter.get(file.path) || {} }) },
  };
  return {
    home,
    repository: new ProjectRepository(app, {
      projectFolder: '02 项目', dailyFolder: '01 日记', scheduleFolder: '01 日记/日程', cashlogFolder: '04 财务',
    }),
  };
}

test('overview defaults to active projects, derives metrics, and orders cards deterministically', () => {
  const runningStages = [
    stage('02 项目/乙/阶段/02.md', '收尾', 2, '未开始', [{ checked: false }], { planned_end: '2026-09-20' }),
    stage('02 项目/乙/阶段/01.md', '施工', 1, '进行中', [{ checked: true }, { checked: false }], { planned_end: '2026-09-10' }),
  ];
  const model = buildProjectOverviewModel([
    project('02 项目/甲/甲.md', '甲', '筹备中', ''),
    project('02 项目/乙/乙.md', '乙', '进行中', '2026-10-01', runningStages),
    project('02 项目/丙/丙.md', '丙', '暂停', '2026-08-01'),
  ], { today: '2026-09-15' });

  assert.equal(model.filter, 'active');
  assert.deepEqual(model.cards.map((card) => card.title), ['乙', '甲']);
  assert.deepEqual(model.cards[0], {
    file: runningStages && { path: '02 项目/乙/乙.md', basename: '乙' },
    path: '02 项目/乙/乙.md',
    title: '乙',
    projectStatus: '进行中',
    currentStage: '施工',
    progress: 25,
    planEnd: '2026-10-01',
    variance: { kind: 'late', days: 5, label: '延期' },
    diagnostics: [],
  });
  assert.equal(model.cards[1].currentStage, '暂无阶段');
  assert.equal(model.cards[1].progress, '暂无进度');
  assert.equal(model.cards[1].planEnd, '计划日期待完善');
  assert.equal(model.cards[1].variance.label, '排期待完善');
});

test('overview supports every status filter and isolates malformed projects', () => {
  const source = [
    project('02 项目/进行/进行.md', '进行', '进行中'),
    project('02 项目/筹备/筹备.md', '筹备', '筹备中'),
    project('02 项目/暂停/暂停.md', '暂停', '暂停'),
    project('02 项目/完成/完成.md', '完成', '已完成'),
    project('02 项目/归档/归档.md', '归档', '已归档'),
    null,
  ];

  assert.deepEqual(buildProjectOverviewModel(source, { filter: '暂停' }).cards.map((card) => card.title), ['暂停']);
  assert.deepEqual(buildProjectOverviewModel(source, { filter: '已完成' }).cards.map((card) => card.title), ['完成']);
  assert.deepEqual(buildProjectOverviewModel(source, { filter: '已归档' }).cards.map((card) => card.title), ['归档']);
  assert.deepEqual(buildProjectOverviewModel(source, { filter: 'all' }).cards.map((card) => card.title), ['进行', '筹备', '归档', '完成', '暂停']);
  const fallback = buildProjectOverviewModel(source, { filter: 'unknown' });
  assert.equal(fallback.filter, 'active');
  assert.deepEqual(fallback.cards.map((card) => card.title), ['进行', '筹备']);
  assert.equal(fallback.diagnostics.length, 1);
  assert.match(fallback.diagnostics[0].message, /项目数据无效/);
});

test('cockpit sorts stages, selects the requested stage, and derives all three gantt ranges', () => {
  const first = stage('02 项目/甲/阶段/01.md', '准备', 1, '已完成', [{ checked: true }], {
    planned_start: '2026-09-01', planned_end: '2026-09-05', actual_end: '2026-09-04',
  });
  const second = stage('02 项目/甲/阶段/02.md', '施工', 2, '进行中', [{ checked: true }, { checked: false }], {
    planned_start: '2026-09-06', planned_end: '2026-09-12',
  });
  const input = {
    project: project('02 项目/甲/甲.md', '甲', '进行中', '2026-09-30'),
    stages: [second, first],
    selectedStagePath: second.file.path,
    today: '2026-09-10',
  };

  const month = buildProjectCockpitModel({ ...input, ganttRange: 'month' });
  const quarter = buildProjectCockpitModel({ ...input, ganttRange: 'quarter' });
  const all = buildProjectCockpitModel({ ...input, ganttRange: 'all' });

  assert.deepEqual(month.range, { start: '2026-09-01', end: '2026-09-30' });
  assert.deepEqual(quarter.range, { start: '2026-08-01', end: '2026-10-31' });
  assert.deepEqual(all.range, { start: '2026-09-01', end: '2026-09-12' });
  assert.equal(month.ganttRange, 'month');
  assert.deepEqual(month.stages.map((item) => item.title), ['准备', '施工']);
  assert.equal(month.selectedStage.path, second.file.path);
  assert.equal(month.currentStage.path, second.file.path);
  assert.equal(month.progress, 75);
  assert.deepEqual(month.stages[0].checklist, [{ checked: true }]);
  assert.equal(month.stages[0].progress, 100);
  assert.deepEqual(month.stages[0].variance, { kind: 'early', days: 1, label: '提前' });
  assert.equal(month.stages[1].bar.valid, true);
});

test('cockpit falls back from an unknown selection, preserves finance and journal data, and isolates bad schedules', () => {
  const current = stage('02 项目/甲/阶段/02.md', '当前', 2, '进行中', [{ checked: false }], {
    planned_start: '2026-09-20', planned_end: 'bad-date',
  });
  const first = stage('02 项目/甲/阶段/01.md', '第一步', 1, '未开始', [], {});
  const model = buildProjectCockpitModel({
    project: project('02 项目/甲/甲.md', '甲', '进行中', ''),
    stages: [current, first],
    selectedStagePath: 'missing.md',
    ganttRange: 'invalid',
    today: '2026-09-10',
    finance: { income: 100, expense: 40, balance: 60, categories: [{ name: '项目' }], entries: [{ amount: 100 }], invalidCount: 2 },
    journalRecords: [
      { filePath: '01 日记/旧.md', text: '旧', date: '2026-09-01', ignored: true },
      { filePath: '01 日记/新.md', text: '新', date: '2026-09-03' },
    ],
  });

  assert.equal(model.ganttRange, 'month');
  assert.equal(model.selectedStage.path, current.file.path);
  assert.equal(model.stages[1].bar.valid, false);
  assert.match(model.stages[1].diagnostics[0].message, /排期/);
  assert.deepEqual(model.finance, { income: 100, expense: 40, balance: 60, categories: [{ name: '项目', total: 0, entries: [] }], entries: [{ amount: 100 }], invalidCount: 2 });
  assert.deepEqual(model.journalRecords, [
    { filePath: '01 日记/新.md', text: '新', date: '2026-09-03' },
    { filePath: '01 日记/旧.md', text: '旧', date: '2026-09-01' },
  ]);

  const empty = buildProjectCockpitModel({ project: null, stages: [], today: '2026-09-10' });
  assert.equal(empty.selectedStage, null);
  assert.deepEqual(empty.finance, { income: 0, expense: 0, balance: 0, categories: [], entries: [], invalidCount: 0 });
  assert.deepEqual(empty.journalRecords, []);
});

test('models retain diagnostics from ProjectRepository load, finance, project, stage, and journal sources', async () => {
  const { home, repository } = repositoryFixtureWithReadDiagnostics();
  const loaded = await repository.loadProject(home);
  const finance = await repository.loadProjectFinance(loaded.project);
  loaded.project.diagnostics = [{ filePath: loaded.project.file.path, message: 'project-normalization-error' }];
  const stageWithDiagnostic = stage('02 项目/项目甲/阶段/02.md', '施工', 2, '进行中', [{ checked: false }]);
  stageWithDiagnostic.diagnostics = [{ filePath: stageWithDiagnostic.file.path, message: 'stage-normalization-error' }];
  const journalRecords = [{
    filePath: '01 日记/2026-09-02.md', text: '项目记录', date: '2026-09-02',
    diagnostics: [{ filePath: '01 日记/2026-09-02.md', message: 'journal-record-error' }],
  }];

  const overview = buildProjectOverviewModel([{ ...loaded, stages: [stageWithDiagnostic] }], { today: '2026-09-02' });
  const cockpit = buildProjectCockpitModel({
    ...loaded,
    stages: [stageWithDiagnostic],
    finance,
    journalRecords,
    diagnostics: loaded.diagnostics,
    today: '2026-09-02',
  });

  for (const message of ['repository-stage-error', 'project-normalization-error', 'stage-normalization-error']) {
    assert.ok(overview.cards[0].diagnostics.some((diagnostic) => diagnostic.message.includes(message)));
    assert.ok(overview.diagnostics.some((diagnostic) => diagnostic.message.includes(message)));
  }
  for (const message of ['repository-stage-error', 'finance-read-error', 'project-normalization-error', 'stage-normalization-error', 'journal-record-error']) {
    assert.ok(cockpit.diagnostics.some((diagnostic) => diagnostic.message.includes(message)));
  }
  assert.equal(cockpit.finance.invalidCount, finance.invalidCount);
  assert.deepEqual(cockpit.finance.entries, finance.entries);
  assert.ok(cockpit.stages[0].diagnostics.some((diagnostic) => diagnostic.message.includes('stage-normalization-error')));
});

test('cockpit retains project contract amount and category entries', () => {
  const model = buildProjectCockpitModel({
    project: { file: { path: 'p.md', basename: '项目' }, name: '项目', contract_amount: 12000 },
    finance: { income: 5000, expense: 1200, balance: 3800, categories: [{ category: '材料', total: 1200, entries: [{ date: '2026-09-01', title: '水泥', amount: 1200 }] }] },
  });
  assert.equal(model.project.contractAmount, 12000);
  assert.equal(model.finance.categories[0].total, 1200);
  assert.equal(model.finance.categories[0].entries[0].title, '水泥');
});
