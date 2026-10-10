const assert = require('node:assert/strict');
const test = require('node:test');

const { DEFAULT_INTERIOR_STAGES } = require('../src/project-catalog');
const {
  renderProjectHome,
  renderStageNote,
  buildProjectFilePlan,
  validateProjectFilePlan,
} = require('../src/project-template');

function createDraft(overrides = {}) {
  return {
    root: '02 项目',
    name: '省地勘局宿舍',
    projectId: 'project-20260902-001',
    projectStatus: '进行中',
    client: '',
    address: '',
    manager: '',
    planStart: '2026-09-01',
    planEnd: '2026-12-01',
    contractAmount: 0,
    budget: 0,
    amountReceived: 0,
    members: [],
    suppliers: [],
    stages: DEFAULT_INTERIOR_STAGES.map((stage) => ({
      ...stage,
      status: '未开始',
      plannedStart: '',
      plannedEnd: '',
      scheduleStatus: '草案',
      actualStart: '',
      actualEnd: '',
      owner: '',
    })),
    ...overrides,
  };
}

test('renders the complete project home frontmatter and fixed body sections', () => {
  const markdown = renderProjectHome(createDraft({
    client: '甲方',
    members: ['瀚中', '[[张工]]'],
    suppliers: ['[[品牌: #1]]'],
  }));

  assert.match(markdown, /^---\ntype: "项目"\nproject_id: "project-20260902-001"\nproject_status: "进行中"\n/m);
  assert.match(markdown, /client: "甲方"\naddress: ""\nmanager: ""\n/);
  assert.match(markdown, /plan_start: "2026-09-01"\nplan_end: "2026-12-01"\ncontract_amount: 0\nbudget: 0\namount_received: 0\n/);
  assert.match(markdown, /members:\n  - "瀚中"\n  - "\[\[张工\]\]"\n/);
  assert.match(markdown, /suppliers:\n  - "\[\[品牌: #1\]\]"\n/);
  assert.match(markdown, /tags:\n  - "项目"\n---/);
  const bodySections = ['## 项目信息', '## 重要事项与风险', '## 项目成员', '## 供应商', '## 附件入口'];
  assert.ok(bodySections.every((heading, index) => index === 0 || markdown.indexOf(bodySections[index - 1]) < markdown.indexOf(heading)));
  assert.equal(markdown.includes('项目进度'), false);
});

test('renders stage note frontmatter, default dependency, and fixed sections in order', () => {
  const project = createDraft();
  const stage = project.stages[1];
  const markdown = renderStageNote(project, stage);

  assert.match(markdown, /^---\ntype: "项目阶段"\nproject_id: "project-20260902-001"\nproject: "\[\[省地勘局宿舍\]\]"\norder: 2\nstatus: "未开始"\n/m);
  assert.match(markdown, /planned_start: ""\nplanned_end: ""\nschedule_status: "草案"\nactual_start: ""\nactual_end: ""\nowner: ""\ndepends_on: "01 开工前准备"\n/);
  assert.match(markdown, /# 02 开工交底\n\n## 细项清单\n\n- \[ \] 拆除/);
  assert.ok(markdown.indexOf('## 细项清单') < markdown.indexOf('## 材料 / 设备预定'));
  assert.ok(markdown.indexOf('## 材料 / 设备预定') < markdown.indexOf('## 等待原因'));
  assert.ok(markdown.indexOf('## 等待原因') < markdown.indexOf('## 验收要点'));
  assert.ok(markdown.indexOf('## 验收要点') < markdown.indexOf('## 阶段记录'));
});

test('uses an explicit stage dependency and quotes YAML-sensitive strings safely', () => {
  const project = createDraft({ name: '项目: #1 "样板"' });
  const markdown = renderStageNote(project, {
    ...project.stages[0],
    name: '阶段: #1 "样板"',
    owner: '[[王: #工]]',
    dependsOn: '前置: #1',
  });

  assert.match(markdown, /project: "\[\[项目: #1 \\\"样板\\\"\]\]"/);
  assert.match(markdown, /owner: "\[\[王: #工\]\]"/);
  assert.match(markdown, /depends_on: "前置: #1"/);
});

test('serializes all YAML strings as JSON-quoted values without changing scalar meaning', () => {
  const markdown = renderProjectHome(createDraft({
    projectId: 'true', projectStatus: 'null', client: '.nan', address: '.inf', manager: '2026-09-01',
    planStart: 'false', planEnd: '[[双链]]', members: ['#tag'], suppliers: ['"quoted"'],
  }));
  const stage = renderStageNote(createDraft(), {
    ...createDraft().stages[0], status: 'true', plannedStart: '2026-09-01', scheduleStatus: 'null', owner: '[[王工]]',
  });
  const scalar = (source, field) => JSON.parse(source.match(new RegExp(`^${field}: (.*)$`, 'm'))[1]);

  for (const field of ['type', 'project_id', 'project_status', 'client', 'address', 'manager', 'plan_start', 'plan_end']) {
    assert.match(markdown, new RegExp(`^${field}: "`, 'm'));
  }
  assert.equal(scalar(markdown, 'project_id'), 'true');
  assert.equal(scalar(markdown, 'project_status'), 'null');
  assert.equal(scalar(markdown, 'client'), '.nan');
  assert.equal(scalar(markdown, 'manager'), '2026-09-01');
  assert.equal(scalar(markdown, 'plan_end'), '[[双链]]');
  assert.match(markdown, /^  - "#tag"$/m);
  assert.match(markdown, /^  - "\\"quoted\\""$/m);
  for (const field of ['type', 'project_id', 'project', 'status', 'planned_start', 'schedule_status', 'owner', 'depends_on']) {
    assert.match(stage, new RegExp(`^${field}: "`, 'm'));
  }
  assert.equal(scalar(stage, 'status'), 'true');
  assert.equal(scalar(stage, 'owner'), '[[王工]]');
});

test('uses the nearest preceding selected order as the default dependency', () => {
  const project = createDraft({ stages: [
    { ...DEFAULT_INTERIOR_STAGES[0], order: 1, status: '未开始', plannedStart: '', plannedEnd: '', scheduleStatus: '草案', actualStart: '', actualEnd: '', owner: '' },
    { ...DEFAULT_INTERIOR_STAGES[2], order: 3, status: '未开始', plannedStart: '', plannedEnd: '', scheduleStatus: '草案', actualStart: '', actualEnd: '', owner: '' },
  ] });

  assert.match(renderStageNote(project, project.stages[1]), /^depends_on: "01 开工前准备"$/m);
});

test('builds the default sixteen-file plan with normalized slash paths', () => {
  const plan = buildProjectFilePlan(createDraft());

  assert.equal(plan.projectId, 'project-20260902-001');
  assert.equal(plan.projectFolder, '02 项目/省地勘局宿舍');
  assert.deepEqual(Object.keys(plan), ['projectId', 'projectFolder', 'files']);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.files), true);
  assert.equal(Reflect.set(plan.files[0], 'path', '02 项目/省地勘局宿舍/../escape.md'), false);
  assert.equal(plan.files.length, 16);
  assert.deepEqual(plan.files.slice(0, 2).map(({ path, kind }) => ({ path, kind })), [
    { path: '02 项目/省地勘局宿舍/省地勘局宿舍.md', kind: 'project-home' },
    { path: '02 项目/省地勘局宿舍/阶段/01 开工前准备.md', kind: 'stage' },
  ]);
  assert.equal(plan.files[15].path, '02 项目/省地勘局宿舍/阶段/15 软装进场.md');
  assert.equal(validateProjectFilePlan(plan).valid, true);
});

test('trusts only the original private plan and rejects JSON, spread, or manual copies', () => {
  const plan = buildProjectFilePlan(createDraft());
  const cloned = JSON.parse(JSON.stringify(plan));
  const spread = { ...plan };
  const manual = { projectId: plan.projectId, projectFolder: plan.projectFolder, files: plan.files };

  assert.equal(validateProjectFilePlan(plan).valid, true);
  for (const copy of [cloned, spread, manual]) {
    const result = validateProjectFilePlan(copy);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => /验证元数据/.test(error)));
  }
});

test('rejects every unsafe path segment and traversal in cloned or manually edited plans', () => {
  for (const name of ['.', '..', '含\u0001控制']) {
    const result = validateProjectFilePlan(buildProjectFilePlan(createDraft({ name })));
    assert.equal(result.valid, false, name);
    assert.ok(result.errors.some((error) => /路径|非法/.test(error)), name);
  }
  const escaped = buildProjectFilePlan(createDraft({ name: '../escape' }));
  const result = validateProjectFilePlan(escaped);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => /路径/.test(error)));
});

test('rejects invalid project paths, duplicate stages, dates, statuses, and amounts', () => {
  const invalidPlan = buildProjectFilePlan(createDraft({
    name: '坏/名字',
    projectStatus: '未知',
    planStart: '2026-12-02',
    planEnd: '2026-12-01',
    contractAmount: -1,
    budget: Infinity,
    stages: [
      { ...DEFAULT_INTERIOR_STAGES[0], order: 1, status: '未知', plannedStart: '2026-09-10', plannedEnd: '2026-09-01', actualStart: '2026-13-01', actualEnd: '', scheduleStatus: '草案' },
      { ...DEFAULT_INTERIOR_STAGES[0], order: 1, status: '未开始', plannedStart: '', plannedEnd: '', actualStart: '', actualEnd: '', scheduleStatus: '草案' },
    ],
  }));
  const result = validateProjectFilePlan(invalidPlan);

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => /路径|非法/.test(error)));
  assert.ok(result.errors.some((error) => /项目状态/.test(error)));
  assert.ok(result.errors.some((error) => /计划.*日期|日期.*反/.test(error)));
  assert.ok(result.errors.some((error) => /金额/.test(error)));
  assert.ok(result.errors.some((error) => /阶段.*状态/.test(error)));
  assert.ok(result.errors.some((error) => /order.*重复/.test(error)));
  assert.ok(result.errors.some((error) => /阶段名称.*重复/.test(error)));
});

test('independently rejects malformed and reversed project and stage date ranges', () => {
  const malformedProject = validateProjectFilePlan(buildProjectFilePlan(createDraft({ planStart: '2026-02-30' })));
  const reversedProject = validateProjectFilePlan(buildProjectFilePlan(createDraft({ planStart: '2026-12-02', planEnd: '2026-12-01' })));
  const malformedStage = validateProjectFilePlan(buildProjectFilePlan(createDraft({ stages: [{
    ...DEFAULT_INTERIOR_STAGES[0], status: '未开始', plannedStart: '2026-13-01', plannedEnd: '', scheduleStatus: '草案', actualStart: '', actualEnd: '', owner: '',
  }] })));
  const reversedStage = validateProjectFilePlan(buildProjectFilePlan(createDraft({ stages: [{
    ...DEFAULT_INTERIOR_STAGES[0], status: '未开始', plannedStart: '2026-09-10', plannedEnd: '2026-09-01', scheduleStatus: '草案', actualStart: '', actualEnd: '', owner: '',
  }] })));

  assert.ok(malformedProject.errors.some((error) => /项目计划日期.*ISO/.test(error)));
  assert.ok(reversedProject.errors.some((error) => /项目计划日期.*反向/.test(error)));
  assert.ok(malformedStage.errors.some((error) => /阶段计划日期.*ISO/.test(error)));
  assert.ok(reversedStage.errors.some((error) => /阶段计划日期.*反向/.test(error)));
});
