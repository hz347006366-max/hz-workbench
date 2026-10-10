const { validateIsoDate } = require('./project-schema');
const {
  calculateStageProgress,
  calculateProjectProgress,
  selectCurrentStage,
  calculateScheduleVariance,
  calculateGanttRange,
  positionStageBar,
} = require('./project-metrics');

const ACTIVE_PROJECT_STATUSES = new Set(['筹备中', '进行中']);
const PROJECT_FILTERS = new Set(['active', '暂停', '已完成', '已归档', 'all']);
const GANTT_RANGES = new Set(['month', 'quarter', 'all']);
const DEFAULT_FINANCE = Object.freeze({
  income: 0,
  expense: 0,
  balance: 0,
  categories: [],
  entries: [],
  invalidCount: 0,
});

function text(value, fallback = '') {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback;
}

function filePath(record) {
  return text(record?.file?.path, text(record?.path));
}

function titleFor(record, fallback) {
  return text(record?.name, text(record?.title, text(record?.file?.basename, fallback)));
}

function validDate(value) {
  return typeof value === 'string' && value !== '' && validateIsoDate(value).valid;
}

function normalizedFilter(value) {
  return PROJECT_FILTERS.has(value) ? value : 'active';
}

function normalizedGanttRange(value) {
  return GANTT_RANGES.has(value) ? value : 'month';
}

function appendDiagnostics(target, ...sources) {
  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    for (const diagnostic of source) {
      if (diagnostic && typeof diagnostic === 'object') target.push(diagnostic);
    }
  }
  return target;
}

function stageProgress(stage) {
  const calculated = calculateStageProgress(stage?.items);
  if (calculated !== null) return calculated;
  return Number.isFinite(stage?.progress) ? stage.progress : null;
}

function normalizedStages(stages, diagnostics) {
  if (!Array.isArray(stages)) return [];
  return stages.map((stage, index) => {
    if (!stage || typeof stage !== 'object') {
      diagnostics.push({ filePath: '', message: `阶段数据无效：第 ${index + 1} 项已忽略` });
      return null;
    }
    appendDiagnostics(diagnostics, stage.diagnostics, stage.normalizationDiagnostics);
    const progress = stageProgress(stage);
    return {
      ...stage,
      file: stage.file || null,
      path: filePath(stage),
      title: titleFor(stage, '未命名阶段'),
      status: text(stage.status, '未开始'),
      order: Number.isFinite(stage.order) ? stage.order : Number.POSITIVE_INFINITY,
      checklist: Array.isArray(stage.items) ? stage.items : [],
      materials: Array.isArray(stage.materials) ? stage.materials : [],
      owner: text(stage.owner),
      waitingReasons: Array.isArray(stage.waitingReasons) ? stage.waitingReasons : [],
      acceptanceCriteria: Array.isArray(stage.acceptanceCriteria) ? stage.acceptanceCriteria : [],
      progress,
      valid: stage.valid !== false && progress !== null,
    };
  }).filter(Boolean).sort((left, right) => left.order - right.order || left.path.localeCompare(right.path));
}

function currentStageFor(stages) {
  return selectCurrentStage(stages) || null;
}

function varianceFor(stage, today) {
  return stage ? calculateScheduleVariance(stage, today) : { kind: 'missing', days: 0, label: '排期待完善' };
}

function projectCard(entry, today, diagnostics) {
  const project = entry?.project && typeof entry.project === 'object' ? entry.project : entry;
  if (!project || typeof project !== 'object') {
    diagnostics.push({ filePath: '', message: '项目数据无效：已忽略' });
    return null;
  }
  const path = filePath(project);
  if (!path) {
    diagnostics.push({ filePath: '', message: '项目数据无效：缺少文件路径' });
    return null;
  }
  const cardDiagnostics = [];
  appendDiagnostics(cardDiagnostics, entry?.diagnostics, project.diagnostics, project.normalizationDiagnostics);
  const stages = normalizedStages(Array.isArray(entry?.stages) ? entry.stages : project.stages, cardDiagnostics);
  const currentStage = currentStageFor(stages);
  const projectProgress = calculateProjectProgress(stages);
  const planEnd = validDate(project.plan_end) ? project.plan_end : '计划日期待完善';
  return {
    file: project.file || null,
    path,
    title: titleFor(project, '未命名项目'),
    projectStatus: text(project.project_status, '筹备中'),
    currentStage: currentStage ? currentStage.title : '暂无阶段',
    progress: projectProgress === null ? '暂无进度' : projectProgress,
    planEnd,
    variance: varianceFor(currentStage, today),
    diagnostics: cardDiagnostics,
  };
}

function projectStatusRank(status) {
  if (status === '进行中') return 0;
  if (status === '筹备中') return 1;
  return 2;
}

function compareCards(left, right) {
  const statusDifference = projectStatusRank(left.projectStatus) - projectStatusRank(right.projectStatus);
  if (statusDifference !== 0) return statusDifference;
  if (left.projectStatus !== right.projectStatus) return left.projectStatus.localeCompare(right.projectStatus, 'zh-Hans-CN');
  const leftDate = validDate(left.planEnd) ? left.planEnd : '';
  const rightDate = validDate(right.planEnd) ? right.planEnd : '';
  if (leftDate !== rightDate) {
    if (!leftDate) return 1;
    if (!rightDate) return -1;
    return leftDate.localeCompare(rightDate);
  }
  return left.title.localeCompare(right.title, 'zh-Hans-CN');
}

function buildProjectOverviewModel(projects, options = {}) {
  const diagnostics = [];
  const filter = normalizedFilter(options.filter);
  const cards = (Array.isArray(projects) ? projects : [])
    .map((entry) => {
      const card = projectCard(entry, options.today, diagnostics);
      if (card) appendDiagnostics(diagnostics, card.diagnostics);
      return card;
    })
    .filter(Boolean)
    .filter((card) => filter === 'all'
      || (filter === 'active' ? ACTIVE_PROJECT_STATUSES.has(card.projectStatus) : card.projectStatus === filter))
    .sort(compareCards);
  return { filter, cards, diagnostics };
}

function financeModel(finance) {
  const source = finance && typeof finance === 'object' ? finance : {};
  return {
    income: Number.isFinite(source.income) ? source.income : DEFAULT_FINANCE.income,
    expense: Number.isFinite(source.expense) ? source.expense : DEFAULT_FINANCE.expense,
    balance: Number.isFinite(source.balance) ? source.balance : DEFAULT_FINANCE.balance,
    categories: Array.isArray(source.categories) ? source.categories.map((category) => ({
      ...category,
      total: Number.isFinite(category?.total) ? category.total : (Number.isFinite(category?.amount) ? category.amount : 0),
      entries: Array.isArray(category?.entries) ? category.entries : [],
    })) : [],
    entries: Array.isArray(source.entries) ? source.entries : [],
    invalidCount: Number.isFinite(source.invalidCount) ? source.invalidCount : DEFAULT_FINANCE.invalidCount,
  };
}

function journalSource(records) {
  if (Array.isArray(records)) return { records, diagnostics: records.diagnostics };
  if (!records || typeof records !== 'object') return { records: [], diagnostics: [] };
  return {
    records: Array.isArray(records.records) ? records.records : (Array.isArray(records.journalRecords) ? records.journalRecords : []),
    diagnostics: records.diagnostics,
  };
}

function journalModel(records, diagnostics) {
  const source = journalSource(records);
  appendDiagnostics(diagnostics, source.diagnostics);
  return source.records
    .filter((record) => record && typeof record === 'object')
    .map((record) => {
      appendDiagnostics(diagnostics, record.diagnostics, record.normalizationDiagnostics);
      return {
        filePath: text(record.filePath),
        text: text(record.text),
        date: text(record.date),
      };
    })
    .sort((left, right) => right.date.localeCompare(left.date) || right.filePath.localeCompare(left.filePath));
}

function stageModel(stage, range, today) {
  const diagnostics = [];
  appendDiagnostics(diagnostics, stage.diagnostics, stage.normalizationDiagnostics);
  const bar = positionStageBar(stage, range || {});
  if (!bar.valid) diagnostics.push({ filePath: stage.path, message: '阶段排期无效或待完善' });
  return {
    file: stage.file,
    path: stage.path,
    title: stage.title,
    order: stage.order,
    checklist: stage.checklist,
    materials: stage.materials,
    owner: stage.owner,
    waitingReasons: stage.waitingReasons,
    acceptanceCriteria: stage.acceptanceCriteria,
    planned_start: stage.planned_start,
    planned_end: stage.planned_end,
    progress: stage.progress === null ? '暂无进度' : stage.progress,
    status: stage.status,
    variance: calculateScheduleVariance(stage, today),
    bar,
    diagnostics,
  };
}

function topProjectMetrics(project, currentStage, stages, today, diagnostics) {
  const path = filePath(project);
  if (!project || typeof project !== 'object') diagnostics.push({ filePath: '', message: '项目数据无效：缺少项目主页' });
  return {
    file: project?.file || null,
    path,
    title: titleFor(project, '未命名项目'),
    projectStatus: text(project?.project_status, '筹备中'),
    currentStage: currentStage ? currentStage.title : '暂无阶段',
    progress: calculateProjectProgress(stages) ?? '暂无进度',
    planEnd: validDate(project?.plan_end) ? project.plan_end : '计划日期待完善',
    contractAmount: Number.isFinite(project?.contract_amount) ? project.contract_amount : 0,
    variance: varianceFor(currentStage, today),
  };
}

function buildProjectCockpitModel({
  project = null,
  stages = [],
  finance,
  journalRecords,
  selectedStagePath = '',
  ganttRange,
  today,
  diagnostics: inputDiagnostics,
} = {}) {
  const diagnostics = [];
  appendDiagnostics(diagnostics, inputDiagnostics, project?.diagnostics, project?.normalizationDiagnostics);
  const normalized = normalizedStages(stages, diagnostics);
  const currentStage = currentStageFor(normalized);
  const selectedStage = normalized.find((stage) => stage.path === selectedStagePath)
    || currentStage
    || normalized[0]
    || null;
  const rangeName = normalizedGanttRange(ganttRange);
  const range = calculateGanttRange(rangeName, normalized, today);
  const stageViews = normalized.map((stage) => stageModel(stage, range, today));
  stageViews.forEach((stage) => diagnostics.push(...stage.diagnostics));
  const projectMetrics = topProjectMetrics(project, currentStage, normalized, today, diagnostics);
  appendDiagnostics(diagnostics, finance?.diagnostics, finance?.normalizationDiagnostics);
  const journalView = journalModel(journalRecords, diagnostics);
  return {
    project: projectMetrics,
    topMetrics: projectMetrics,
    currentStage: currentStage ? stageViews.find((stage) => stage.path === currentStage.path) || null : null,
    stages: stageViews,
    selectedStage: selectedStage ? stageViews.find((stage) => stage.path === selectedStage.path) || null : null,
    ganttRange: rangeName,
    range,
    finance: financeModel(finance),
    journalRecords: journalView,
    diagnostics,
    progress: projectMetrics.progress,
  };
}

module.exports = { buildProjectOverviewModel, buildProjectCockpitModel };
