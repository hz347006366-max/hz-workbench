const { DEFAULT_INTERIOR_STAGES } = require('./project-catalog');
const { PROJECT_STATUSES } = require('./project-schema');
const { buildProjectFilePlan, validateProjectFilePlan } = require('./project-template');

const SUBMISSION_TAILS = new WeakMap();

function dateStamp(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10).replace(/-/g, '');
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('无法生成项目编号：日期无效');
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) => index === 0 ? String(part) : String(part).padStart(2, '0'))
    .join('');
}

function nextProjectId(date, existingProjectIds = []) {
  const stamp = dateStamp(date);
  const pattern = new RegExp(`^project-${stamp}-(\\d{3})$`);
  let highest = 0;
  for (const projectId of existingProjectIds) {
    const match = String(projectId || '').match(pattern);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  if (highest >= 999) throw new Error(`无法生成项目编号：${stamp} 的编号已用尽`);
  return `project-${stamp}-${String(highest + 1).padStart(3, '0')}`;
}

function projectIdsFromApp(app) {
  const files = app?.vault?.getMarkdownFiles?.() || [];
  const ids = [];
  for (const file of files) {
    try {
      const frontmatter = app?.metadataCache?.getFileCache?.(file)?.frontmatter || {};
      if (typeof frontmatter.project_id === 'string') ids.push(frontmatter.project_id);
    } catch (error) {
      // One damaged cache entry must not block allocating against the remaining projects.
    }
  }
  return ids;
}

function existingPathsFromApp(app) {
  const entries = app?.vault?.getAllLoadedFiles?.() || app?.vault?.getMarkdownFiles?.() || [];
  return entries.map((entry) => entry?.path).filter((path) => typeof path === 'string');
}

async function scanProjectIds(app, projectFolder) {
  const ids = new Set(projectIdsFromApp(app));
  const root = String(projectFolder || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const files = app?.vault?.getMarkdownFiles?.() || [];
  const read = app?.vault?.cachedRead || app?.vault?.read;
  if (typeof read !== 'function') return [...ids];
  for (const file of files) {
    if (root && !String(file?.path || '').replace(/\\/g, '/').startsWith(`${root}/`)) continue;
    try {
      const cachedId = app?.metadataCache?.getFileCache?.(file)?.frontmatter?.project_id;
      if (typeof cachedId === 'string' && cachedId) ids.add(cachedId);
    } catch (error) {
      // The Markdown read below remains the source of truth while metadata is unavailable.
    }
    try {
      const markdown = await read.call(app.vault, file);
      const match = String(markdown || '').match(/^project_id:\s*(?:"([^"]+)"|'([^']+)'|([^\s#]+))/m);
      const projectId = match && (match[1] || match[2] || match[3]);
      if (projectId) ids.add(projectId);
    } catch (error) {
      // An unreadable note cannot safely contribute an ID, but must not block creation of unrelated projects.
    }
  }
  return [...ids];
}

async function withSubmissionLock(repository, operation) {
  const previous = SUBMISSION_TAILS.get(repository) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const tail = previous.then(() => gate);
  SUBMISSION_TAILS.set(repository, tail);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (SUBMISSION_TAILS.get(repository) === tail) SUBMISSION_TAILS.delete(repository);
  }
}

function cloneStage(stage, order = stage.order) {
  return {
    order,
    name: String(stage.name || ''),
    checklist: Array.isArray(stage.checklist) ? [...stage.checklist] : [],
    materialReminders: Array.isArray(stage.materialReminders) ? [...stage.materialReminders] : [],
    status: stage.status || '未开始',
    plannedStart: stage.plannedStart || '',
    plannedEnd: stage.plannedEnd || '',
    scheduleStatus: stage.scheduleStatus || '草案',
    actualStart: stage.actualStart || '',
    actualEnd: stage.actualEnd || '',
    owner: stage.owner || '',
  };
}

function renumberStages(stages) {
  return (Array.isArray(stages) ? stages : []).map((stage, index) => cloneStage(stage, index + 1));
}

function createInitialProjectDraft({ root = '02 项目', date = new Date(), existingProjectIds = [] } = {}) {
  return {
    root,
    name: '',
    projectId: nextProjectId(date, existingProjectIds),
    projectStatus: '筹备中',
    client: '',
    address: '',
    manager: '',
    planStart: '',
    planEnd: '',
    contractAmount: 0,
    budget: 0,
    amountReceived: 0,
    members: [],
    suppliers: [],
    stages: renumberStages(DEFAULT_INTERIOR_STAGES),
  };
}

function moveStage(stages, fromIndex, toIndex) {
  const result = renumberStages(stages);
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)
    || fromIndex < 0 || fromIndex >= result.length || toIndex < 0 || toIndex >= result.length
    || fromIndex === toIndex) return result;
  const [moved] = result.splice(fromIndex, 1);
  result.splice(toIndex, 0, moved);
  return renumberStages(result);
}

function addStage(stages, name) {
  const stageName = String(name || '').trim();
  if (!stageName) return renumberStages(stages);
  return renumberStages([...(Array.isArray(stages) ? stages : []), cloneStage({ name: stageName }, 1)]);
}

function removeStage(stages, index) {
  const result = Array.isArray(stages) ? stages.filter((stage, stageIndex) => stageIndex !== index) : [];
  return renumberStages(result);
}

function validateProjectBasics(draft) {
  return validateProjectFilePlan(buildProjectFilePlan(draft));
}

async function preparedDraft(draft, { app, projectFolder, now }) {
  return {
    ...draft,
    root: projectFolder || draft.root || '02 项目',
    name: String(draft.name || '').trim(),
    projectId: nextProjectId(now(), await scanProjectIds(app, projectFolder)),
    members: Array.isArray(draft.members) ? draft.members.map(String).map((value) => value.trim()).filter(Boolean) : [],
    suppliers: Array.isArray(draft.suppliers) ? draft.suppliers.map(String).map((value) => value.trim()).filter(Boolean) : [],
    stages: renumberStages(draft.stages),
  };
}

async function submitProjectDraft(draft, {
  app,
  repository,
  projectFolder = draft?.root || '02 项目',
  now = () => new Date(),
} = {}) {
  if (!repository || typeof repository.createProject !== 'function') throw new Error('项目仓储不可用，请刷新工作台后重试');
  return withSubmissionLock(repository, async () => {
    const ready = await preparedDraft(draft || {}, { app, projectFolder, now });
    const plan = buildProjectFilePlan(ready);
    const validation = validateProjectFilePlan(plan, { existingPaths: existingPathsFromApp(app) });
    if (!validation.valid) throw new Error(validation.errors.join('；'));
    const created = await repository.createProject(ready);
    return {
      ...created,
      draft: ready,
      plan,
      projectPath: plan.files[0].path,
    };
  });
}

function listValue(value) {
  return String(value || '').split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
}

function inputNumber(value) {
  if (String(value).trim() === '') return 0;
  return Number(value);
}

function openProjectWizardModal(options, dependencies) {
  const {
    app,
    theme = 'emerald',
    repository,
    projectFolder = '02 项目',
    onCreated = () => {},
    now = () => new Date(),
  } = options || {};
  const { Modal, Notice } = dependencies || {};
  if (typeof Modal !== 'function') throw new Error('项目向导缺少 Modal 依赖');

  class ProjectWizardModal extends Modal {
    constructor() {
      super(app);
      this.step = 1;
      this.error = '';
      this.customStage = '';
      this.draggedIndex = -1;
      this.submitting = false;
      this.draft = createInitialProjectDraft({
        root: projectFolder,
        date: now(),
        existingProjectIds: projectIdsFromApp(app),
      });
    }

    onOpen() {
      require('./theme').applyModalTheme(this, theme);
      this.contentEl.classList.add('hz-project-wizard-modal');
      this.render();
    }

    heading(text) {
      const heading = this.contentEl.createEl('h2');
      heading.setText(text);
      return heading;
    }

    errorRegion() {
      const error = this.contentEl.createDiv({ cls: 'hz-project-wizard-error' });
      error.setAttribute('aria-live', 'assertive');
      error.setAttribute('role', 'alert');
      error.setText(this.error);
      return error;
    }

    button(parent, label, className, handler) {
      const button = parent.createEl('button', { cls: className });
      button.type = 'button';
      button.setText(label);
      button.addEventListener('click', handler);
      return button;
    }

    field(parent, { name, label, type = 'text', value = '', input = (next) => next }) {
      const wrapper = parent.createDiv({ cls: 'hz-project-wizard-field' });
      const labelEl = wrapper.createEl('label');
      labelEl.setText(label);
      const control = wrapper.createEl('input');
      control.type = type;
      control.name = name;
      control.value = value == null ? '' : String(value);
      if (type === 'number') {
        control.min = '0';
        control.step = '0.01';
        control.inputMode = 'decimal';
      }
      control.addEventListener('input', () => { this.draft = { ...this.draft, [name]: input(control.value) }; });
      labelEl.appendChild(control);
      return control;
    }

    render() {
      this.contentEl.empty();
      this.contentEl.classList.add('hz-project-wizard-modal');
      if (this.step === 1) this.renderBasics();
      else this.renderStages();
    }

    renderBasics() {
      this.heading('新建项目 · 1 / 2');
      const intro = this.contentEl.createEl('p', { cls: 'hz-project-wizard-intro' });
      intro.setText(`项目编号将在提交时自动分配 · ${this.draft.projectId}`);
      this.errorRegion();
      const form = this.contentEl.createEl('form', { cls: 'hz-project-wizard-form' });
      const grid = form.createDiv({ cls: 'hz-project-wizard-grid' });
      this.field(grid, { name: 'name', label: '项目名称（必填）', value: this.draft.name });
      const status = grid.createDiv({ cls: 'hz-project-wizard-field' });
      const statusLabel = status.createEl('label'); statusLabel.setText('项目状态');
      const select = statusLabel.createEl('select'); select.name = 'projectStatus';
      PROJECT_STATUSES.forEach((value) => { const option = select.createEl('option'); option.value = value; option.setText(value); });
      select.value = this.draft.projectStatus;
      select.addEventListener('change', () => { this.draft = { ...this.draft, projectStatus: select.value }; });
      this.field(grid, { name: 'client', label: '客户', value: this.draft.client });
      this.field(grid, { name: 'address', label: '地址', value: this.draft.address });
      this.field(grid, { name: 'manager', label: '负责人', value: this.draft.manager });
      this.field(grid, { name: 'planStart', label: '计划开始', type: 'date', value: this.draft.planStart });
      this.field(grid, { name: 'planEnd', label: '计划完成', type: 'date', value: this.draft.planEnd });
      this.field(grid, { name: 'contractAmount', label: '合同金额', type: 'number', value: this.draft.contractAmount, input: inputNumber });
      this.field(grid, { name: 'budget', label: '预算', type: 'number', value: this.draft.budget, input: inputNumber });
      this.field(grid, { name: 'amountReceived', label: '已收款', type: 'number', value: this.draft.amountReceived, input: inputNumber });
      this.field(grid, { name: 'membersText', label: '成员（逗号分隔）', value: this.draft.members.join('，'), input: (value) => { this.draft.members = listValue(value); return value; } });
      this.field(grid, { name: 'suppliersText', label: '供应商（逗号分隔）', value: this.draft.suppliers.join('，'), input: (value) => { this.draft.suppliers = listValue(value); return value; } });
      const actions = form.createDiv({ cls: 'hz-project-wizard-actions' });
      this.button(actions, '取消', 'hz-project-wizard-button is-secondary', () => this.close());
      const next = actions.createEl('button', { cls: 'hz-project-wizard-button is-primary' });
      next.type = 'submit'; next.setText('下一步：选择阶段');
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const result = validateProjectBasics(this.draft);
        if (!result.valid) {
          this.error = result.errors.join('；');
          this.render();
          return;
        }
        this.error = '';
        this.step = 2;
        this.render();
      });
    }

    updateStage(index, name) {
      this.draft = {
        ...this.draft,
        stages: this.draft.stages.map((stage, stageIndex) => stageIndex === index ? { ...stage, name } : stage),
      };
    }

    reorder(fromIndex, toIndex, restoreRowFocus = false) {
      this.draft = { ...this.draft, stages: moveStage(this.draft.stages, fromIndex, toIndex) };
      this.render();
      if (restoreRowFocus) {
        const destination = Math.max(0, Math.min(toIndex, this.draft.stages.length - 1));
        this.contentEl.querySelectorAll('.hz-project-wizard-stage')[destination]?.focus();
      }
    }

    renderStages() {
      this.heading('新建项目 · 2 / 2');
      const intro = this.contentEl.createEl('p', { cls: 'hz-project-wizard-intro' });
      intro.setText('已默认选择标准 15 阶段。可编辑名称、增删，并用按钮、Alt + 方向键或拖动调整顺序。');
      this.errorRegion();
      const list = this.contentEl.createDiv({ cls: 'hz-project-wizard-stages' });
      list.setAttribute('aria-label', '项目阶段排序');
      this.draft.stages.forEach((stage, index) => {
        const row = list.createDiv({ cls: 'hz-project-wizard-stage' });
        row.draggable = true;
        row.tabIndex = 0;
        row.setAttribute('aria-label', `阶段 ${index + 1}：${stage.name}`);
        const selected = row.createEl('input', { cls: 'hz-project-wizard-stage-select' });
        selected.type = 'checkbox';
        selected.checked = true;
        selected.setAttribute('aria-label', `选择阶段 ${stage.name}`);
        selected.addEventListener('change', () => {
          if (selected.checked) return;
          this.draft = { ...this.draft, stages: removeStage(this.draft.stages, index) };
          this.render();
        });
        const order = row.createEl('span', { cls: 'hz-project-wizard-order' }); order.setText(String(index + 1).padStart(2, '0'));
        const name = row.createEl('input', { cls: 'hz-project-wizard-stage-name' });
        name.type = 'text'; name.value = stage.name; name.setAttribute('aria-label', `阶段 ${index + 1} 名称`);
        name.addEventListener('input', () => this.updateStage(index, name.value));
        name.addEventListener('change', () => this.render());
        const up = this.button(row, '↑', 'hz-project-wizard-move', () => this.reorder(index, index - 1));
        up.setAttribute('aria-label', `上移 ${stage.name}`); up.disabled = index === 0;
        const down = this.button(row, '↓', 'hz-project-wizard-move', () => this.reorder(index, index + 1));
        down.setAttribute('aria-label', `下移 ${stage.name}`); down.disabled = index === this.draft.stages.length - 1;
        const remove = this.button(row, '删除', 'hz-project-wizard-delete', () => {
          this.draft = { ...this.draft, stages: removeStage(this.draft.stages, index) };
          this.render();
        });
        remove.setAttribute('aria-label', `删除阶段 ${stage.name}`);
        row.addEventListener('keydown', (event) => {
          if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
          event.preventDefault();
          this.reorder(index, index + (event.key === 'ArrowUp' ? -1 : 1), true);
        });
        row.addEventListener('dragstart', () => { this.draggedIndex = index; row.classList.add('is-dragging'); });
        row.addEventListener('dragend', () => { this.draggedIndex = -1; row.classList.remove('is-dragging'); });
        row.addEventListener('dragover', (event) => event.preventDefault());
        row.addEventListener('drop', (event) => {
          event.preventDefault();
          if (this.draggedIndex >= 0) this.reorder(this.draggedIndex, index);
        });
      });

      const add = this.contentEl.createDiv({ cls: 'hz-project-wizard-add-row' });
      const custom = add.createEl('input'); custom.type = 'text'; custom.name = 'customStage'; custom.value = this.customStage;
      custom.placeholder = '新增阶段名称'; custom.setAttribute('aria-label', '新增阶段名称');
      custom.addEventListener('input', () => { this.customStage = custom.value; });
      const addButton = this.button(add, '添加阶段', 'hz-project-wizard-add', () => {
        const stages = addStage(this.draft.stages, this.customStage);
        if (stages.length === this.draft.stages.length) {
          this.error = '请输入新增阶段名称';
        } else {
          this.draft = { ...this.draft, stages };
          this.customStage = '';
          this.error = '';
        }
        this.render();
      });
      addButton.setAttribute('aria-label', '添加阶段');

      const plan = buildProjectFilePlan(this.draft);
      const summary = this.contentEl.createEl('details', { cls: 'hz-project-wizard-summary' });
      summary.open = true;
      const summaryTitle = summary.createEl('summary'); summaryTitle.setText(`将创建 ${plan.files.length} 个文件`);
      const paths = summary.createEl('ul');
      plan.files.forEach((entry) => { const item = paths.createEl('li'); item.setText(entry.path); });

      const actions = this.contentEl.createDiv({ cls: 'hz-project-wizard-actions' });
      this.button(actions, '返回基本信息', 'hz-project-wizard-button is-secondary', () => { this.step = 1; this.error = ''; this.render(); });
      const create = this.button(actions, '创建项目', 'hz-project-wizard-button hz-project-wizard-create is-primary', () => { void this.submit(); });
      create.disabled = this.submitting;
      if (this.submitting) create.setText('正在创建…');
    }

    async submit() {
      if (this.submitting) return;
      this.submitting = true;
      this.error = '';
      this.render();
      try {
        const result = await submitProjectDraft(this.draft, { app, repository, projectFolder, now });
        this.draft = result.draft;
        if (typeof Notice === 'function') new Notice(`已创建项目：${result.draft.name}`);
        this.close();
        await onCreated(result);
      } catch (error) {
        this.error = `创建失败：${error?.message || String(error)}`;
        this.submitting = false;
        this.render();
      }
    }
  }

  const modal = new ProjectWizardModal();
  modal.open();
  return modal;
}

module.exports = {
  createInitialProjectDraft,
  nextProjectId,
  moveStage,
  addStage,
  removeStage,
  validateProjectBasics,
  submitProjectDraft,
  openProjectWizardModal,
};
