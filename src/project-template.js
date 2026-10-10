const {
  PROJECT_STATUSES,
  STAGE_STATUSES,
  validateIsoDate,
} = require('./project-schema');

const ILLEGAL_PATH_CHARACTER = /[<>:"/\\|?*\x00-\x1f]/;
const PLAN_SOURCES = new WeakMap();

function valueOf(record, camelName, snakeName = camelName) {
  if (!record || typeof record !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(record, camelName)) return record[camelName];
  return record[snakeName];
}

function text(value) {
  return value === undefined || value === null ? '' : String(value);
}

function yamlString(value) {
  return JSON.stringify(text(value));
}

function yamlNumber(value) {
  return Number.isFinite(value) ? String(value) : yamlString(value);
}

function yamlList(field, values) {
  if (!Array.isArray(values) || values.length === 0) return `${field}: []`;
  return `${field}:\n${values.map((value) => `  - ${yamlString(value)}`).join('\n')}`;
}

function stageValue(stage, camelName, snakeName = camelName) {
  return valueOf(stage, camelName, snakeName);
}

function formattedOrder(order) {
  return String(order).padStart(2, '0');
}

function renderProjectHome(project = {}) {
  const name = text(valueOf(project, 'name'));
  const projectId = valueOf(project, 'projectId', 'project_id');
  const projectStatus = valueOf(project, 'projectStatus', 'project_status');
  const client = valueOf(project, 'client');
  const address = valueOf(project, 'address');
  const manager = valueOf(project, 'manager');
  const planStart = valueOf(project, 'planStart', 'plan_start');
  const planEnd = valueOf(project, 'planEnd', 'plan_end');
  const contractAmount = valueOf(project, 'contractAmount', 'contract_amount');
  const budget = valueOf(project, 'budget');
  const amountReceived = valueOf(project, 'amountReceived', 'amount_received');

  return [
    '---',
    `type: ${yamlString('项目')}`,
    `project_id: ${yamlString(projectId)}`,
    `project_status: ${yamlString(projectStatus)}`,
    `client: ${yamlString(client)}`,
    `address: ${yamlString(address)}`,
    `manager: ${yamlString(manager)}`,
    `plan_start: ${yamlString(planStart)}`,
    `plan_end: ${yamlString(planEnd)}`,
    `contract_amount: ${yamlNumber(contractAmount)}`,
    `budget: ${yamlNumber(budget)}`,
    `amount_received: ${yamlNumber(amountReceived)}`,
    yamlList('members', valueOf(project, 'members')),
    yamlList('suppliers', valueOf(project, 'suppliers')),
    'tags:',
    `  - ${yamlString('项目')}`,
    '---',
    '',
    `# ${name}`,
    '',
    '## 项目信息',
    '',
    '## 重要事项与风险',
    '',
    '## 项目成员',
    '',
    '## 供应商',
    '',
    '## 附件入口',
    '',
  ].join('\n');
}

function defaultDependency(project, stage) {
  const order = stageValue(stage, 'order');
  if (!Number.isInteger(order) || order <= 1) return '';
  const stages = Array.isArray(valueOf(project, 'stages')) ? valueOf(project, 'stages') : [];
  const predecessor = stages
    .filter((candidate) => Number.isInteger(stageValue(candidate, 'order')) && stageValue(candidate, 'order') < order)
    .sort((left, right) => stageValue(right, 'order') - stageValue(left, 'order'))[0];
  return predecessor ? `${formattedOrder(stageValue(predecessor, 'order'))} ${text(stageValue(predecessor, 'name'))}` : '';
}

function renderStageNote(project = {}, stage = {}) {
  const projectName = text(valueOf(project, 'name'));
  const stageName = text(stageValue(stage, 'name'));
  const order = stageValue(stage, 'order');
  const projectId = valueOf(project, 'projectId', 'project_id');
  const explicitDependency = stageValue(stage, 'dependsOn', 'depends_on');
  const dependency = explicitDependency === undefined || explicitDependency === null || explicitDependency === ''
    ? defaultDependency(project, stage)
    : explicitDependency;
  const checklist = Array.isArray(stageValue(stage, 'checklist')) ? stageValue(stage, 'checklist') : [];
  const reminders = Array.isArray(stageValue(stage, 'materialReminders', 'material_reminders'))
    ? stageValue(stage, 'materialReminders', 'material_reminders') : [];

  return [
    '---',
    `type: ${yamlString('项目阶段')}`,
    `project_id: ${yamlString(projectId)}`,
    `project: ${yamlString(`[[${projectName}]]`)}`,
    `order: ${Number.isFinite(order) ? order : yamlString(order)}`,
    `status: ${yamlString(stageValue(stage, 'status'))}`,
    `planned_start: ${yamlString(stageValue(stage, 'plannedStart', 'planned_start'))}`,
    `planned_end: ${yamlString(stageValue(stage, 'plannedEnd', 'planned_end'))}`,
    `schedule_status: ${yamlString(stageValue(stage, 'scheduleStatus', 'schedule_status'))}`,
    `actual_start: ${yamlString(stageValue(stage, 'actualStart', 'actual_start'))}`,
    `actual_end: ${yamlString(stageValue(stage, 'actualEnd', 'actual_end'))}`,
    `owner: ${yamlString(stageValue(stage, 'owner'))}`,
    `depends_on: ${yamlString(dependency)}`,
    'tags:',
    `  - ${yamlString('项目')}`,
    '---',
    '',
    `# ${formattedOrder(order)} ${stageName}`,
    '',
    '## 细项清单',
    '',
    ...checklist.map((item) => `- [ ] ${text(item)}`),
    '',
    '## 材料 / 设备预定',
    '',
    ...reminders.map((item) => `- ${text(item)}`),
    '',
    '## 等待原因',
    '',
    '## 验收要点',
    '',
    '## 阶段记录',
    '',
  ].join('\n');
}

function normalizePath(path) {
  return text(path).replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function validationSource(draft) {
  const stages = Array.isArray(valueOf(draft, 'stages')) ? valueOf(draft, 'stages') : [];
  return deepFreeze({
    root: text(valueOf(draft, 'root')),
    name: text(valueOf(draft, 'name')),
    projectId: text(valueOf(draft, 'projectId', 'project_id')),
    projectStatus: valueOf(draft, 'projectStatus', 'project_status'),
    planStart: valueOf(draft, 'planStart', 'plan_start'),
    planEnd: valueOf(draft, 'planEnd', 'plan_end'),
    contractAmount: valueOf(draft, 'contractAmount', 'contract_amount'),
    budget: valueOf(draft, 'budget'),
    amountReceived: valueOf(draft, 'amountReceived', 'amount_received'),
    stages: stages.map((stage) => ({
      order: stageValue(stage, 'order'),
      name: text(stageValue(stage, 'name')),
      status: stageValue(stage, 'status'),
      plannedStart: stageValue(stage, 'plannedStart', 'planned_start'),
      plannedEnd: stageValue(stage, 'plannedEnd', 'planned_end'),
      actualStart: stageValue(stage, 'actualStart', 'actual_start'),
      actualEnd: stageValue(stage, 'actualEnd', 'actual_end'),
    })),
  });
}

function buildProjectFilePlan(draft = {}) {
  const root = normalizePath(valueOf(draft, 'root'));
  const name = text(valueOf(draft, 'name'));
  const projectFolder = [root, name].filter((part) => part !== '').join('/');
  const stages = Array.isArray(valueOf(draft, 'stages')) ? valueOf(draft, 'stages') : [];
  const files = [
    {
      path: `${projectFolder}/${name}.md`,
      content: renderProjectHome(draft),
      kind: 'project-home',
    },
    ...stages.map((stage) => ({
      path: `${projectFolder}/阶段/${formattedOrder(stageValue(stage, 'order'))} ${text(stageValue(stage, 'name'))}.md`,
      content: renderStageNote(draft, stage),
      kind: 'stage',
    })),
  ];
  const source = validationSource(draft);
  const plan = Object.freeze({
    projectId: text(valueOf(draft, 'projectId', 'project_id')),
    projectFolder,
    files: deepFreeze(files),
  });
  PLAN_SOURCES.set(plan, source);
  return plan;
}

function addError(errors, message) {
  if (!errors.includes(message)) errors.push(message);
}

function invalidPathPart(value) {
  const source = text(value);
  return source === '' || source === '.' || source === '..' || ILLEGAL_PATH_CHARACTER.test(source);
}

function validatePathParts(root, name, stages, errors) {
  if (text(root).includes('\\')) addError(errors, '项目根路径含有非法路径字符');
  const rootParts = text(root).split(/[\\/]/);
  if (rootParts.length === 0 || rootParts.some(invalidPathPart)) addError(errors, '项目根路径含有非法路径字符');
  if (invalidPathPart(name)) addError(errors, '项目名称含有非法路径字符');
  stages.forEach((stage) => {
    if (invalidPathPart(stageValue(stage, 'name'))) addError(errors, '阶段名称含有非法路径字符');
  });
}

function validateDatePair(start, end, label, errors) {
  if (!validateIsoDate(start).valid || !validateIsoDate(end).valid) {
    addError(errors, `${label}必须为合法 ISO 日期`);
    return;
  }
  if (start && end && start > end) addError(errors, `${label}不能反向`);
}

function validateAmount(value, label, errors) {
  if (!Number.isFinite(value) || value < 0) addError(errors, `${label}必须为有限非负金额`);
}

function validateSourceMetadata(source, errors) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    addError(errors, '缺少验证元数据');
    return null;
  }
  const name = valueOf(source, 'name');
  const projectId = valueOf(source, 'projectId', 'project_id');
  const stages = Array.isArray(valueOf(source, 'stages')) ? valueOf(source, 'stages') : [];
  if (text(name).trim() === '') addError(errors, '项目名称不能为空');
  if (text(projectId).trim() === '') addError(errors, 'projectId 不能为空');
  validatePathParts(valueOf(source, 'root'), name, stages, errors);
  if (!PROJECT_STATUSES.includes(valueOf(source, 'projectStatus', 'project_status'))) addError(errors, '项目状态非法');
  validateDatePair(valueOf(source, 'planStart', 'plan_start'), valueOf(source, 'planEnd', 'plan_end'), '项目计划日期', errors);
  validateAmount(valueOf(source, 'contractAmount', 'contract_amount'), '合同金额', errors);
  validateAmount(valueOf(source, 'budget'), '预算金额', errors);
  validateAmount(valueOf(source, 'amountReceived', 'amount_received'), '已收金额', errors);
  if (stages.length === 0) addError(errors, '阶段列表不能为空');

  const orders = new Set();
  const names = new Set();
  stages.forEach((stage) => {
    const order = stageValue(stage, 'order');
    const stageName = text(stageValue(stage, 'name'));
    if (!Number.isInteger(order) || order <= 0) addError(errors, '阶段 order 必须为正整数');
    else if (orders.has(order)) addError(errors, '阶段 order 重复');
    else orders.add(order);
    if (names.has(stageName)) addError(errors, '阶段名称重复');
    else names.add(stageName);
    if (!STAGE_STATUSES.includes(stageValue(stage, 'status'))) addError(errors, '阶段状态非法');
    validateDatePair(stageValue(stage, 'plannedStart', 'planned_start'), stageValue(stage, 'plannedEnd', 'planned_end'), '阶段计划日期', errors);
    validateDatePair(stageValue(stage, 'actualStart', 'actual_start'), stageValue(stage, 'actualEnd', 'actual_end'), '阶段实际日期', errors);
  });
  return source;
}

function relativePathSegments(path, label, errors) {
  if (typeof path !== 'string' || path === '' || path.includes('\\') || path.startsWith('/') || path.endsWith('/')) {
    addError(errors, `${label}必须使用相对正斜杠路径`);
    return null;
  }
  const segments = path.split('/');
  if (segments.some(invalidPathPart)) {
    addError(errors, `${label}含有非法路径字符`);
    return null;
  }
  return segments;
}

function hasFolderPrefix(fileSegments, folderSegments) {
  return folderSegments.length < fileSegments.length
    && folderSegments.every((segment, index) => fileSegments[index] === segment);
}

function validateProjectFilePlan(plan, options = {}) {
  const errors = [];
  if (!plan || typeof plan !== 'object') return { valid: false, errors: ['文件计划无效'] };
  const projectFolder = plan.projectFolder;
  const projectId = text(plan.projectId);
  const files = Array.isArray(plan.files) ? plan.files : [];
  if (projectId.trim() === '') addError(errors, 'projectId 不能为空');
  const folderSegments = relativePathSegments(projectFolder, '项目目录', errors);
  if (files.length === 0) addError(errors, '文件列表不能为空');
  const paths = new Set();
  files.forEach((file) => {
    const path = file && typeof file.path === 'string' ? file.path : '';
    const fileSegments = relativePathSegments(path, '项目文件路径', errors);
    if (!fileSegments || !folderSegments || !hasFolderPrefix(fileSegments, folderSegments) || !path.endsWith('.md')) {
      addError(errors, '项目文件路径必须严格位于项目目录下');
    }
    if (paths.has(path)) addError(errors, '文件路径重复');
    else paths.add(path);
  });
  const source = validateSourceMetadata(PLAN_SOURCES.get(plan), errors);
  if (source && folderSegments) {
    const expectedFolder = normalizePath(`${valueOf(source, 'root')}/${valueOf(source, 'name')}`);
    if (projectFolder !== expectedFolder) addError(errors, '项目目录与验证元数据不一致');
    if (projectId !== text(valueOf(source, 'projectId', 'project_id'))) addError(errors, 'projectId 与验证元数据不一致');
  }

  const existingPaths = Array.isArray(options.existingPaths) ? options.existingPaths.map(normalizePath) : [];
  const normalizedFolder = normalizePath(projectFolder);
  existingPaths.forEach((path) => {
    if (path === normalizedFolder || path.startsWith(`${normalizedFolder}/`)) {
      if (path === normalizedFolder) addError(errors, '目标项目目录已存在');
      else if (paths.has(path)) addError(errors, '目标项目文件已存在');
      else addError(errors, '目标项目目录已存在');
    }
  });
  return { valid: errors.length === 0, errors };
}

module.exports = {
  renderProjectHome,
  renderStageNote,
  buildProjectFilePlan,
  validateProjectFilePlan,
};
