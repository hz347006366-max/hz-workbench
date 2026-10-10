const assert = require('node:assert/strict');
const test = require('node:test');

const { DEFAULT_INTERIOR_STAGES } = require('../src/project-catalog');
const { buildProjectFilePlan, validateProjectFilePlan } = require('../src/project-template');
const {
  createInitialProjectDraft,
  nextProjectId,
  moveStage,
  addStage,
  removeStage,
  validateProjectBasics,
  submitProjectDraft,
  openProjectWizardModal,
} = require('../src/project-wizard');
const { JSDOM } = require('jsdom');

function draft(overrides = {}) {
  return {
    root: '02 项目', name: '测试项目', projectId: 'project-test-001', projectStatus: '筹备中',
    client: '', address: '', manager: '', planStart: '', planEnd: '',
    contractAmount: 0, budget: 0, amountReceived: 0, members: [], suppliers: [],
    stages: DEFAULT_INTERIOR_STAGES.map((stage) => ({
      ...stage, status: '未开始', plannedStart: '', plannedEnd: '', scheduleStatus: '草案', actualStart: '', actualEnd: '', owner: '',
    })),
    ...overrides,
  };
}

test('rejects a blank name, blank project ID, empty stage selection, nonpositive order, and duplicate planned paths', () => {
  const blank = validateProjectFilePlan(buildProjectFilePlan(draft({ name: '', projectId: '', stages: [] })));
  assert.equal(blank.valid, false);
  assert.ok(blank.errors.some((error) => /项目名称/.test(error)));
  assert.ok(blank.errors.some((error) => /projectId/.test(error)));
  assert.ok(blank.errors.some((error) => /阶段列表/.test(error)));

  const invalidStages = buildProjectFilePlan(draft({ stages: [
    { ...DEFAULT_INTERIOR_STAGES[0], order: 0, name: '同名', status: '未开始', plannedStart: '', plannedEnd: '', scheduleStatus: '草案', actualStart: '', actualEnd: '', owner: '' },
    { ...DEFAULT_INTERIOR_STAGES[1], order: 0, name: '同名', status: '未开始', plannedStart: '', plannedEnd: '', scheduleStatus: '草案', actualStart: '', actualEnd: '', owner: '' },
  ] }));
  const invalidStageResult = validateProjectFilePlan(invalidStages);
  assert.ok(invalidStageResult.errors.some((error) => /正整数/.test(error)));

  const duplicatePath = JSON.parse(JSON.stringify(buildProjectFilePlan(draft())));
  duplicatePath.files.push({ ...duplicatePath.files[0] });
  const result = validateProjectFilePlan(duplicatePath);
  assert.ok(result.errors.some((error) => /文件路径.*重复/.test(error)));
});

test('detects an existing project folder or any target file before a caller writes anything', () => {
  const plan = buildProjectFilePlan(draft());
  const directoryConflict = validateProjectFilePlan(plan, { existingPaths: ['02 项目/测试项目'] });
  const fileConflict = validateProjectFilePlan(plan, { existingPaths: [plan.files[1].path] });

  assert.equal(directoryConflict.valid, false);
  assert.ok(directoryConflict.errors.some((error) => /目录已存在/.test(error)));
  assert.equal(fileConflict.valid, false);
  assert.ok(fileConflict.errors.some((error) => /文件已存在/.test(error)));
});

test('rejects a hand-constructed traversal file even when it starts with the project folder', () => {
  const plan = JSON.parse(JSON.stringify(buildProjectFilePlan(draft({ name: '甲' }))));
  plan.files.push({ path: '02 项目/甲/../escape.md', content: '', kind: 'stage' });

  const result = validateProjectFilePlan(plan);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => /路径/.test(error)));
});

test('allocates the next deterministic daily project ID after scanning collisions', () => {
  assert.equal(nextProjectId(new Date('2026-09-03T08:00:00+08:00'), [
    'project-20260903-001',
    'project-20260903-003',
    'project-20260902-009',
    'unrelated',
  ]), 'project-20260903-004');
  assert.equal(nextProjectId('2026-09-03', []), 'project-20260903-001');
});

test('initial draft selects detached copies of all fifteen catalog stages', () => {
  const initial = createInitialProjectDraft({
    root: '02 项目',
    date: '2026-09-03',
    existingProjectIds: ['project-20260903-001'],
  });

  assert.equal(initial.projectId, 'project-20260903-002');
  assert.equal(initial.projectStatus, '筹备中');
  assert.equal(initial.stages.length, 15);
  assert.deepEqual(initial.stages.map((stage) => stage.name), DEFAULT_INTERIOR_STAGES.map((stage) => stage.name));
  assert.notEqual(initial.stages[0], DEFAULT_INTERIOR_STAGES[0]);
  assert.deepEqual(initial.stages.map((stage) => stage.order), Array.from({ length: 15 }, (_, index) => index + 1));
});

test('stage helpers add, remove, and reliably reorder while renumbering every row', () => {
  const initial = createInitialProjectDraft({ date: '2026-09-03' }).stages.slice(0, 3);
  const moved = moveStage(initial, 2, 0);
  assert.deepEqual(moved.map((stage) => stage.name), ['结构改造', '开工前准备', '开工交底']);
  assert.deepEqual(moved.map((stage) => stage.order), [1, 2, 3]);

  const added = addStage(moved, '  自定义收尾  ');
  assert.equal(added.at(-1).name, '自定义收尾');
  assert.equal(added.at(-1).order, 4);
  const removed = removeStage(added, 1);
  assert.deepEqual(removed.map((stage) => stage.order), [1, 2, 3]);
  assert.deepEqual(initial.map((stage) => stage.name), ['开工前准备', '开工交底', '结构改造']);
});

test('basic validation reports names, reverse dates, and invalid amounts without coercing them', () => {
  const initial = createInitialProjectDraft({ date: '2026-09-03' });
  const result = validateProjectBasics({
    ...initial,
    name: ' ',
    planStart: '2026-09-10',
    planEnd: '2026-09-01',
    contractAmount: -1,
    budget: Number.NaN,
    amountReceived: -2,
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => /项目名称/.test(error)));
  assert.ok(result.errors.some((error) => /计划日期.*反向/.test(error)));
  assert.ok(result.errors.some((error) => /合同金额/.test(error)));
  assert.ok(result.errors.some((error) => /预算金额/.test(error)));
  assert.ok(result.errors.some((error) => /已收金额/.test(error)));
});

function wizardApp({ existingIds = [], intermediateIds = [], existingPaths = [], uncachedIds = [], halfCachedIds = [] } = {}) {
  const files = existingPaths.map((filePath) => ({ path: filePath, extension: filePath.endsWith('.md') ? 'md' : '' }));
  existingIds.forEach((projectId, index) => files.push({
    path: `02 项目/已有${index + 1}/已有${index + 1}.md`,
    extension: 'md',
    frontmatter: { type: '项目', project_id: projectId },
  }));
  intermediateIds.forEach((projectId, index) => files.push({
    path: `02 项目/缓存中间态${index + 1}/缓存中间态${index + 1}.md`,
    extension: 'md',
    content: '',
    frontmatter: { project_id: projectId },
  }));
  uncachedIds.forEach((projectId, index) => files.push({
    path: `02 项目/待解析${index + 1}/待解析${index + 1}.md`,
    extension: 'md',
    content: `---\ntype: "项目"\nproject_id: "${projectId}"\n---\n`,
  }));
  halfCachedIds.forEach(({ cached, body }, index) => files.push({
    path: `02 项目/半缓存${index + 1}/半缓存${index + 1}.md`,
    extension: 'md',
    content: `---\ntype: "项目"\nproject_id: "${body}"\n---\n`,
    frontmatter: { project_id: cached },
  }));
  const app = {
    vault: {
      getMarkdownFiles: () => files.filter((file) => file.extension === 'md'),
      getAllLoadedFiles: () => files,
      cachedRead: async (file) => file.content || '',
    },
    metadataCache: { getFileCache: (file) => ({ frontmatter: file.frontmatter || {} }) },
  };
  app.addCreatedProject = (draftValue) => files.push({
    path: `02 项目/${draftValue.name}/${draftValue.name}.md`,
    extension: 'md',
    content: `---\ntype: "项目"\nproject_id: "${draftValue.projectId}"\n---\n`,
  });
  return app;
}

test('submission validates the in-memory sixteen-file plan before one repository create', async () => {
  const calls = [];
  const repository = { createProject: async (value) => { calls.push(value); return { projectFolder: `02 项目/${value.name}`, files: [`02 项目/${value.name}/${value.name}.md`] }; } };
  const input = { ...createInitialProjectDraft({ date: '2026-09-03' }), name: '项目甲' };

  const result = await submitProjectDraft(input, {
    app: wizardApp({ existingIds: ['project-20260903-001'] }),
    repository,
    now: () => new Date('2026-09-03T08:00:00+08:00'),
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].projectId, 'project-20260903-002');
  assert.equal(result.plan.files.length, 16);
  assert.equal(result.projectPath, '02 项目/项目甲/项目甲.md');
});

test('submission scans uncached Markdown frontmatter before allocating an ID', async () => {
  const calls = [];
  const repository = { createProject: async (value) => { calls.push(value); return {}; } };
  const input = { ...createInitialProjectDraft({ date: '2026-09-03' }), name: '项目乙' };

  await submitProjectDraft(input, {
    app: wizardApp({ uncachedIds: ['project-20260903-001'] }),
    repository,
    now: () => new Date('2026-09-03T08:00:00+08:00'),
  });

  assert.equal(calls[0].projectId, 'project-20260903-002');
});

test('submission reserves valid project IDs from metadata even before type is cached', async () => {
  const calls = [];
  const repository = { createProject: async (value) => { calls.push(value); return {}; } };
  const input = { ...createInitialProjectDraft({ date: '2026-09-03' }), name: '项目丙' };

  await submitProjectDraft(input, {
    app: wizardApp({ intermediateIds: ['project-20260903-001'] }),
    repository,
    now: () => new Date('2026-09-03T08:00:00+08:00'),
  });

  assert.equal(calls[0].projectId, 'project-20260903-002');
});

test('submission still scans Markdown when a half-updated cache exposes another project ID', async () => {
  const calls = [];
  const repository = { createProject: async (value) => { calls.push(value); return {}; } };
  const input = { ...createInitialProjectDraft({ date: '2026-09-03' }), name: '项目丁' };

  await submitProjectDraft(input, {
    app: wizardApp({ halfCachedIds: [{ cached: 'project-20260902-009', body: 'project-20260903-001' }] }),
    repository,
    now: () => new Date('2026-09-03T08:00:00+08:00'),
  });

  assert.equal(calls[0].projectId, 'project-20260903-002');
});

test('one repository mutex serializes scan validate and create across concurrent wizards', async () => {
  const app = wizardApp();
  const assigned = [];
  let activeCreates = 0;
  let maxActiveCreates = 0;
  const repository = {
    async createProject(value) {
      activeCreates += 1;
      maxActiveCreates = Math.max(maxActiveCreates, activeCreates);
      await new Promise((resolve) => setImmediate(resolve));
      assigned.push(value.projectId);
      app.addCreatedProject(value);
      activeCreates -= 1;
      return {};
    },
  };
  const base = createInitialProjectDraft({ date: '2026-09-03' });

  await Promise.all([
    submitProjectDraft({ ...base, name: '并发甲' }, { app, repository, now: () => new Date('2026-09-03T08:00:00+08:00') }),
    submitProjectDraft({ ...base, name: '并发乙' }, { app, repository, now: () => new Date('2026-09-03T08:00:00+08:00') }),
  ]);

  assert.deepEqual(assigned, ['project-20260903-001', 'project-20260903-002']);
  assert.equal(maxActiveCreates, 1);
});

test('duplicate project validation prevents every repository write', async () => {
  let createCalls = 0;
  const repository = { createProject: async () => { createCalls += 1; } };
  const input = { ...createInitialProjectDraft({ date: '2026-09-03' }), name: '项目甲' };

  await assert.rejects(() => submitProjectDraft(input, {
    app: wizardApp({ existingPaths: ['02 项目/项目甲'] }),
    repository,
    now: () => new Date('2026-09-03T08:00:00+08:00'),
  }), /目标项目目录已存在/);

  assert.equal(createCalls, 0);
});

function modalHarness() {
  const dom = new JSDOM('<div id="modal"></div>');
  const { Element } = dom.window;
  Element.prototype.createEl = function createEl(tag, options = {}) {
    const element = this.ownerDocument.createElement(tag);
    if (options.cls) element.className = options.cls;
    if (options.text != null) element.textContent = String(options.text);
    this.appendChild(element);
    return element;
  };
  Element.prototype.createDiv = function createDiv(options = {}) { return this.createEl('div', options); };
  Element.prototype.empty = function empty() { this.replaceChildren(); };
  Element.prototype.setText = function setText(value) { this.textContent = String(value); };
  let modal;
  class FakeModal {
    constructor(app) { this.app = app; this.contentEl = dom.window.document.querySelector('#modal'); modal = this; }
    open() { this.onOpen(); }
    close() { this.closed = true; }
  }
  return { dom, FakeModal, current: () => modal };
}

test('modal keeps first-step input on errors then previews fifteen selected stages and sixteen files', async () => {
  const harness = modalHarness();
  const repository = { createProject: async () => { throw new Error('should not create yet'); } };
  openProjectWizardModal({
    app: wizardApp(), repository, projectFolder: '02 项目', now: () => new Date('2026-09-03T08:00:00+08:00'),
  }, { Modal: harness.FakeModal, Notice: class {}, windowRef: harness.dom.window });
  const modal = harness.current();
  const name = modal.contentEl.querySelector('[name="name"]');
  name.value = '项目甲'; name.dispatchEvent(new harness.dom.window.Event('input', { bubbles: true }));
  const start = modal.contentEl.querySelector('[name="planStart"]');
  const end = modal.contentEl.querySelector('[name="planEnd"]');
  start.value = '2026-09-10'; end.value = '2026-09-01';
  start.dispatchEvent(new harness.dom.window.Event('input', { bubbles: true }));
  end.dispatchEvent(new harness.dom.window.Event('input', { bubbles: true }));
  modal.contentEl.querySelector('form').dispatchEvent(new harness.dom.window.Event('submit', { bubbles: true, cancelable: true }));
  assert.match(modal.contentEl.querySelector('[aria-live="assertive"]').textContent, /计划日期.*反向/);
  assert.equal(modal.contentEl.querySelector('[name="name"]').value, '项目甲');

  modal.contentEl.querySelector('[name="planEnd"]').value = '2026-09-20';
  modal.contentEl.querySelector('[name="planEnd"]').dispatchEvent(new harness.dom.window.Event('input', { bubbles: true }));
  modal.contentEl.querySelector('form').dispatchEvent(new harness.dom.window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(modal.contentEl.querySelectorAll('.hz-project-wizard-stage').length, 15);
  assert.equal(modal.contentEl.querySelectorAll('.hz-project-wizard-stage-select:checked').length, 15);
  assert.match(modal.contentEl.querySelector('.hz-project-wizard-summary').textContent, /将创建 16 个文件/);
  assert.ok(modal.contentEl.querySelector('.hz-project-wizard-stage[draggable="true"]'));
  assert.ok(modal.contentEl.querySelector('button[aria-label^="上移"]'));
  const firstStageName = modal.contentEl.querySelector('.hz-project-wizard-stage-name').value;
  const firstRow = modal.contentEl.querySelector('.hz-project-wizard-stage');
  firstRow.focus();
  firstRow.dispatchEvent(new harness.dom.window.KeyboardEvent('keydown', {
    key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true,
  }));
  assert.ok(harness.dom.window.document.activeElement.classList.contains('hz-project-wizard-stage'));
  assert.equal(harness.dom.window.document.activeElement.querySelector('.hz-project-wizard-stage-name').value, firstStageName);
  harness.dom.window.document.activeElement.dispatchEvent(new harness.dom.window.KeyboardEvent('keydown', {
    key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true,
  }));
  assert.equal(modal.contentEl.querySelectorAll('.hz-project-wizard-stage')[2].querySelector('.hz-project-wizard-stage-name').value, firstStageName);
  harness.dom.window.close();
});

test('successful modal submission closes and hands the created project home to the cockpit callback', async () => {
  const harness = modalHarness();
  const opened = [];
  const repository = {
    createProject: async (value) => ({
      projectFolder: `02 项目/${value.name}`,
      files: [`02 项目/${value.name}/${value.name}.md`],
    }),
  };
  openProjectWizardModal({
    app: wizardApp(),
    repository,
    projectFolder: '02 项目',
    now: () => new Date('2026-09-03T08:00:00+08:00'),
    onCreated: async (result) => opened.push(result.projectPath),
  }, { Modal: harness.FakeModal, Notice: class {}, windowRef: harness.dom.window });
  const modal = harness.current();
  const name = modal.contentEl.querySelector('[name="name"]'); name.value = '项目乙'; name.dispatchEvent(new harness.dom.window.Event('input', { bubbles: true }));
  modal.contentEl.querySelector('form').dispatchEvent(new harness.dom.window.Event('submit', { bubbles: true, cancelable: true }));
  modal.contentEl.querySelector('.hz-project-wizard-create').click();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(modal.closed, true);
  assert.deepEqual(opened, ['02 项目/项目乙/项目乙.md']);
  harness.dom.window.close();
});

test('modal supports add, remove, button reorder and retains stage input after duplicate submit failure', async () => {
  const harness = modalHarness();
  let createCalls = 0;
  const repository = { createProject: async () => { createCalls += 1; } };
  openProjectWizardModal({
    app: wizardApp({ existingPaths: ['02 项目/项目甲'] }), repository, projectFolder: '02 项目', now: () => new Date('2026-09-03T08:00:00+08:00'),
  }, { Modal: harness.FakeModal, Notice: class {}, windowRef: harness.dom.window });
  const modal = harness.current();
  const name = modal.contentEl.querySelector('[name="name"]'); name.value = '项目甲'; name.dispatchEvent(new harness.dom.window.Event('input', { bubbles: true }));
  modal.contentEl.querySelector('form').dispatchEvent(new harness.dom.window.Event('submit', { bubbles: true, cancelable: true }));

  const firstBefore = modal.contentEl.querySelector('.hz-project-wizard-stage-name').value;
  modal.contentEl.querySelectorAll('button[aria-label^="下移"]')[0].click();
  assert.notEqual(modal.contentEl.querySelector('.hz-project-wizard-stage-name').value, firstBefore);
  let rows = modal.contentEl.querySelectorAll('.hz-project-wizard-stage');
  const draggedName = rows[1].querySelector('.hz-project-wizard-stage-name').value;
  rows[1].dispatchEvent(new harness.dom.window.Event('dragstart', { bubbles: true }));
  rows[0].dispatchEvent(new harness.dom.window.Event('drop', { bubbles: true, cancelable: true }));
  assert.equal(modal.contentEl.querySelector('.hz-project-wizard-stage-name').value, draggedName);

  const renamed = modal.contentEl.querySelector('.hz-project-wizard-stage-name');
  renamed.value = '改名阶段';
  renamed.dispatchEvent(new harness.dom.window.Event('input', { bubbles: true }));
  renamed.dispatchEvent(new harness.dom.window.Event('change', { bubbles: true }));
  assert.match(modal.contentEl.querySelector('.hz-project-wizard-summary').textContent, /01 改名阶段\.md/);
  modal.contentEl.querySelector('button[aria-label^="删除阶段"]').click();
  assert.equal(modal.contentEl.querySelectorAll('.hz-project-wizard-stage').length, 14);
  const custom = modal.contentEl.querySelector('[name="customStage"]'); custom.value = '交付'; custom.dispatchEvent(new harness.dom.window.Event('input', { bubbles: true }));
  modal.contentEl.querySelector('.hz-project-wizard-add').click();
  assert.equal(modal.contentEl.querySelectorAll('.hz-project-wizard-stage').length, 15);

  modal.contentEl.querySelector('.hz-project-wizard-create').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(createCalls, 0);
  assert.match(modal.contentEl.querySelector('[aria-live="assertive"]').textContent, /目标项目目录已存在/);
  assert.ok([...modal.contentEl.querySelectorAll('.hz-project-wizard-stage-name')].some((input) => input.value === '交付'));
  assert.equal(modal.closed, undefined);
  harness.dom.window.close();
});
