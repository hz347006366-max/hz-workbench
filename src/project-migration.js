const { DEFAULT_INTERIOR_STAGES } = require('./project-catalog');
const { parseChecklistSection } = require('./project-markdown');
const { validateProjectDraft, validateStageDraft } = require('./project-schema');
const { buildProjectFilePlan, validateProjectFilePlan } = require('./project-template');

const DIKANJU_PROJECT_FOLDER = '02 项目/省地勘局宿舍';
const DIKANJU_PROJECT_ID = 'project-20260902-001';
const SUPPORT_PATHS = Object.freeze([
  '07 模板/项目模板.md',
  '07 模板/项目阶段模板.md',
  '02 项目/项目索引.md',
]);
const LEGACY_MARKER_PATHS = Object.freeze([
  `${DIKANJU_PROJECT_FOLDER}/施工任务`,
  `${DIKANJU_PROJECT_FOLDER}/项目视图.components`,
]);

const STAGE_DATES = Object.freeze([
  ['2026-07-04', '2026-07-13'],
  ['2026-07-07', '2026-07-07'],
  ['2026-07-08', '2026-07-12'],
  ['2026-07-13', '2026-07-15'],
  ['2026-07-16', '2026-07-17'],
  ['2026-07-18', '2026-07-27'],
  ['2026-07-28', '2026-08-01'],
  ['2026-08-02', '2026-08-04'],
  ['2026-08-05', '2026-08-14'],
  ['2026-08-15', '2026-08-15'],
  ['2026-08-16', '2026-08-25'],
  ['2026-08-26', '2026-08-29'],
  ['2026-08-30', '2026-09-03'],
  ['2026-09-04', '2026-09-08'],
  ['2026-09-09', '2026-09-12'],
]);

function freezeStage(stage) {
  return Object.freeze({
    ...stage,
    checklist: Object.freeze([...stage.checklist]),
    materialReminders: Object.freeze([...stage.materialReminders]),
  });
}

const DIKANJU_STAGES = Object.freeze(DEFAULT_INTERIOR_STAGES.map((stage, index) => freezeStage({
  ...stage,
  status: index === 5 ? '进行中' : index === 8 ? '等待' : '未开始',
  plannedStart: STAGE_DATES[index][0],
  plannedEnd: STAGE_DATES[index][1],
  scheduleStatus: '草案',
  actualStart: '',
  actualEnd: '',
  owner: '',
})));

const PROJECT_TEMPLATE_CONTENT = `---
type: 项目
project_id: ""
project_status: 筹备中
client: ""
address: ""
manager: ""
plan_start: ""
plan_end: ""
contract_amount: 0
budget: 0
amount_received: 0
members: []
suppliers: []
tags:
  - 项目
---

# 项目名

## 项目信息

## 重要事项与风险

## 项目成员

## 供应商

## 附件入口
`;

const STAGE_TEMPLATE_CONTENT = `---
type: 项目阶段
project_id: ""
project: "[[项目名]]"
order: 1
status: 未开始
planned_start: ""
planned_end: ""
schedule_status: 草案
actual_start: ""
actual_end: ""
owner: ""
depends_on: ""
tags:
  - 项目
---

# 01 阶段名

## 细项清单

- [ ] 细项

## 材料 / 设备预定

## 等待原因

## 验收要点

## 阶段记录
`;

const PROJECT_INDEX_CONTENT = `---
type: 项目索引
tags:
  - 项目
---

# 项目索引

这里汇总按统一项目模板维护的室内设计项目。项目属性只写在项目主页，阶段进度由阶段笔记的细项复选框计算。

## 项目列表

\`\`\`dataview
TABLE project_status AS 状态, plan_end AS 计划完成
FROM "02 项目"
WHERE type = "项目"
SORT file.name ASC
\`\`\`
`;

function migrationDraft() {
  return {
    root: '02 项目',
    name: '省地勘局宿舍',
    projectId: DIKANJU_PROJECT_ID,
    projectStatus: '进行中',
    client: '',
    address: '省地勘局宿舍',
    manager: '',
    planStart: '2026-07-04',
    planEnd: '2026-09-12',
    contractAmount: 0,
    budget: 0,
    amountReceived: 0,
    members: [],
    suppliers: [],
    stages: DIKANJU_STAGES,
  };
}

function parseScalarValue(rawValue) {
  const value = String(rawValue).trim();
  if (value.startsWith('"')) {
    try { return JSON.parse(value); } catch (error) { return undefined; }
  }
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

function scalar(markdown, field) {
  const match = String(markdown).match(new RegExp(`^${field}:\\s*(.*)$`, 'm'));
  return match ? parseScalarValue(match[1]) : undefined;
}

function legacyFrontmatterValues(markdown, field) {
  const lines = String(markdown).split(/\r?\n/);
  if (lines[0] !== '---') return [];
  const end = lines.indexOf('---', 1);
  if (end < 0) return [];
  return lines.slice(1, end)
    .map((line) => line.match(new RegExp(`^${field}:\\s*(.*)$`)))
    .filter(Boolean)
    .map((match) => parseScalarValue(match[1]));
}

function addError(errors, message) {
  if (!errors.includes(message)) errors.push(message);
}

function validateGeneratedMigration(draft, plan, supportFiles) {
  const errors = [...validateProjectFilePlan(plan).errors];
  const projectValidation = validateProjectDraft({
    name: draft.name,
    project_id: draft.projectId,
    project_status: draft.projectStatus,
    plan_start: draft.planStart,
    plan_end: draft.planEnd,
  });
  projectValidation.errors.forEach((error) => addError(errors, `项目 schema：${error}`));
  if (plan.projectFolder !== DIKANJU_PROJECT_FOLDER) addError(errors, '项目目录不是受限的省地勘局宿舍目录');
  if (plan.files.length !== 16) addError(errors, '项目输出必须严格包含 16 个 Markdown 文件');
  if (draft.stages.length !== 15) addError(errors, '阶段数量必须严格为 15');
  if (draft.stages.some((stage, index) => stage.order !== index + 1)) addError(errors, '阶段 order 必须连续为 1–15');

  const expectedPaths = [
    `${DIKANJU_PROJECT_FOLDER}/省地勘局宿舍.md`,
    ...draft.stages.map((stage) => `${DIKANJU_PROJECT_FOLDER}/阶段/${String(stage.order).padStart(2, '0')} ${stage.name}.md`),
  ];
  if (JSON.stringify(plan.files.map((entry) => entry.path)) !== JSON.stringify(expectedPaths)) {
    addError(errors, '项目文件路径或顺序与固定迁移清单不一致');
  }

  const home = plan.files[0]?.content || '';
  if (scalar(home, 'type') !== '项目' || scalar(home, 'project_id') !== DIKANJU_PROJECT_ID) {
    addError(errors, '项目主页 schema 或 project_id 无效');
  }
  const homeHeadings = ['## 项目信息', '## 重要事项与风险', '## 项目成员', '## 供应商', '## 附件入口'];
  if (homeHeadings.some((heading) => !home.includes(heading))) addError(errors, '项目主页缺少固定章节');

  draft.stages.forEach((stage, index) => {
    const output = plan.files[index + 1];
    const stageValidation = validateStageDraft({
      name: stage.name,
      project_id: DIKANJU_PROJECT_ID,
      order: stage.order,
      status: stage.status,
      planned_start: stage.plannedStart,
      planned_end: stage.plannedEnd,
      actual_start: stage.actualStart,
      actual_end: stage.actualEnd,
    });
    stageValidation.errors.forEach((error) => addError(errors, `阶段 ${stage.order} schema：${error}`));
    const markdown = output?.content || '';
    if (scalar(markdown, 'type') !== '项目阶段'
      || scalar(markdown, 'project_id') !== DIKANJU_PROJECT_ID
      || scalar(markdown, 'project') !== '[[省地勘局宿舍]]'
      || scalar(markdown, 'order') !== stage.order
      || scalar(markdown, 'status') !== stage.status
      || scalar(markdown, 'schedule_status') !== '草案') {
      addError(errors, `阶段 ${stage.order} frontmatter 或项目双链无效`);
    }
    const checklist = parseChecklistSection(markdown);
    if (!checklist.found || checklist.items.length !== stage.checklist.length
      || checklist.items.some((item, itemIndex) => item.checked || item.text !== stage.checklist[itemIndex])) {
      addError(errors, `阶段 ${stage.order} 细项 checkbox 与固定映射不一致`);
    }
    const headings = ['## 细项清单', '## 材料 / 设备预定', '## 等待原因', '## 验收要点', '## 阶段记录'];
    if (headings.some((heading, headingIndex) => !markdown.includes(heading)
      || (headingIndex > 0 && markdown.indexOf(headings[headingIndex - 1]) >= markdown.indexOf(heading)))) {
      addError(errors, `阶段 ${stage.order} 缺少固定章节或章节顺序错误`);
    }
    if (stage.materialReminders.some((reminder) => !markdown.includes(`- ${reminder}`))) {
      addError(errors, `阶段 ${stage.order} 缺少材料 / 设备提醒`);
    }
  });

  if (supportFiles.length !== 3
    || JSON.stringify(supportFiles.map((entry) => entry.path)) !== JSON.stringify(SUPPORT_PATHS)) {
    addError(errors, '配套模板与项目索引输出清单无效');
  }
  if (!supportFiles[2].content.includes('TABLE project_status AS 状态, plan_end AS 计划完成')) {
    addError(errors, '项目索引未使用 project_status 与 plan_end');
  }
  return { valid: errors.length === 0, errors };
}

function buildDikanjuMigrationPreview() {
  const draft = migrationDraft();
  const plan = buildProjectFilePlan(draft);
  const supportFiles = Object.freeze([
    Object.freeze({ path: SUPPORT_PATHS[0], content: PROJECT_TEMPLATE_CONTENT, kind: 'project-template' }),
    Object.freeze({ path: SUPPORT_PATHS[1], content: STAGE_TEMPLATE_CONTENT, kind: 'stage-template' }),
    Object.freeze({ path: SUPPORT_PATHS[2], content: PROJECT_INDEX_CONTENT, kind: 'project-index' }),
  ]);
  const validation = validateGeneratedMigration(draft, plan, supportFiles);
  const projectFiles = plan.files;
  const outputFiles = Object.freeze([...projectFiles, ...supportFiles]);
  return Object.freeze({
    valid: validation.valid,
    errors: Object.freeze(validation.errors),
    projectFolder: DIKANJU_PROJECT_FOLDER,
    projectFiles,
    supportFiles,
    outputFiles,
    samples: Object.freeze({ stage06: projectFiles[6], stage09: projectFiles[9] }),
  });
}

function vaultEntries(vault) {
  if (typeof vault?.getAllLoadedFiles !== 'function') return [];
  return vault.getAllLoadedFiles();
}

function isFolder(entry) {
  return !!entry && Array.isArray(entry.children);
}

function isInside(path, folderPath) {
  return path === folderPath || path.startsWith(`${folderPath}/`);
}

function legacyList(markdown, heading) {
  const lines = String(markdown).split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start < 0) return null;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start + 1, end)
    .map((line) => line.match(/^-\s+(.*)$/))
    .filter(Boolean)
    .map((match) => match[1]);
}

function sameList(actual, expected) {
  return Array.isArray(actual) && JSON.stringify(actual) === JSON.stringify(expected);
}

function legacyStatus(stage) {
  if (stage.status === '未开始') return '待处理';
  if (stage.status === '等待') return '等待中';
  return stage.status;
}

function validateLegacyStages(snapshotEntries, errors) {
  const legacyFolder = `${DIKANJU_PROJECT_FOLDER}/施工任务`;
  const entriesByPath = new Map(snapshotEntries.map((entry) => [entry.path, entry]));
  const expectedPaths = DIKANJU_STAGES.map((stage) => (
    `${legacyFolder}/${String(stage.order).padStart(2, '0')} ${stage.name}.md`
  ));
  const numberedPaths = snapshotEntries
    .map((entry) => entry.path)
    .filter((path) => path.startsWith(`${legacyFolder}/`)
      && !path.slice(legacyFolder.length + 1).includes('/')
      && /^\d{2} .*\.md$/.test(path.slice(legacyFolder.length + 1)))
    .sort();
  const missing = expectedPaths.filter((path) => !numberedPaths.includes(path));
  const extra = numberedPaths.filter((path) => !expectedPaths.includes(path));
  if (numberedPaths.length !== 15 || missing.length || extra.length) {
    addError(errors, `旧阶段文件必须严格为 15 个；缺少：${missing.join('、') || '无'}；多出：${extra.join('、') || '无'}`);
  }

  for (const [index, expectedPath] of expectedPaths.entries()) {
    const expected = DIKANJU_STAGES[index];
    const entry = entriesByPath.get(expectedPath);
    if (!entry) continue;
    if (entry.folder) {
      addError(errors, `旧阶段路径必须是文件：${expectedPath}`);
      continue;
    }
    const markdown = entry.content;
    const fields = [
      ['type', '施工任务'],
      ['project', '省地勘局宿舍'],
      ['order', expected.order],
      ['status', legacyStatus(expected)],
      ['stage', expected.name],
      ['start', expected.plannedStart],
      ['due', expected.plannedEnd],
      ['schedule_status', '草案排期'],
    ];
    for (const [field, expectedValue] of fields) {
      const values = legacyFrontmatterValues(markdown, field);
      if (values.length !== 1 || values[0] !== expectedValue) {
        addError(errors, `旧阶段 ${String(expected.order).padStart(2, '0')} 的 ${field} 不一致`);
      }
    }
    if (!sameList(legacyList(markdown, '子项'), expected.checklist)) {
      addError(errors, `旧阶段 ${String(expected.order).padStart(2, '0')} 的细项不一致`);
    }
    if (!sameList(legacyList(markdown, '提醒'), expected.materialReminders)) {
      addError(errors, `旧阶段 ${String(expected.order).padStart(2, '0')} 的材料提醒不一致`);
    }
  }
}

function uniqueSnapshotPaths(entries, label, errors) {
  const paths = entries.map((entry) => entry.path);
  if (new Set(paths).size !== paths.length) addError(errors, `${label}含有重复路径`);
}

function validateDikanjuMigrationSnapshot(snapshot) {
  const errors = [];
  if (!snapshot || !Array.isArray(snapshot.projectEntries)
    || !Array.isArray(snapshot.supportEntries) || !Array.isArray(snapshot.parentEntries)) {
    return { valid: false, errors: ['迁移快照结构无效'] };
  }
  uniqueSnapshotPaths(snapshot.projectEntries, '项目快照', errors);
  uniqueSnapshotPaths(snapshot.supportEntries, '配套文件快照', errors);
  const project = new Map(snapshot.projectEntries.map((entry) => [entry.path, entry]));
  const target = project.get(DIKANJU_PROJECT_FOLDER);
  if (!target || !target.folder) addError(errors, '旧项目目录不存在或不是目录');
  if (project.has(`${DIKANJU_PROJECT_FOLDER}/阶段`) || project.has(`${DIKANJU_PROJECT_FOLDER}/省地勘局宿舍.md`)) {
    addError(errors, '目标项目已经重建，一次性迁移不得重复执行');
  }
  const legacyFolder = project.get(LEGACY_MARKER_PATHS[0]);
  if (!legacyFolder) addError(errors, `旧版标记不完整：${LEGACY_MARKER_PATHS[0]}`);
  else if (!legacyFolder.folder) addError(errors, `旧施工任务路径必须是目录：${LEGACY_MARKER_PATHS[0]}`);
  const componentsMarker = project.get(LEGACY_MARKER_PATHS[1]);
  if (!componentsMarker) addError(errors, `旧版标记不完整：${LEGACY_MARKER_PATHS[1]}`);
  else if (componentsMarker.folder) addError(errors, `旧 components 标记必须是文件：${LEGACY_MARKER_PATHS[1]}`);
  validateLegacyStages(snapshot.projectEntries, errors);

  const parents = new Map(snapshot.parentEntries.map((entry) => [entry.path, entry]));
  for (const parentPath of ['02 项目', '07 模板']) {
    if (!parents.get(parentPath)?.folder) addError(errors, `迁移父目录不存在：${parentPath}`);
  }
  const support = new Map(snapshot.supportEntries.map((entry) => [entry.path, entry]));
  for (const supportPath of SUPPORT_PATHS) {
    const entry = support.get(supportPath);
    if (!entry) addError(errors, `配套文件快照缺少路径：${supportPath}`);
    else if (entry.exists && entry.folder) addError(errors, `配套文件路径必须是文件：${supportPath}`);
  }
  return { valid: errors.length === 0, errors };
}

async function preflightDikanjuMigration(vault) {
  const preview = buildDikanjuMigrationPreview();
  const errors = [...preview.errors];
  let snapshot;
  try {
    snapshot = await captureDikanjuMigrationSnapshot(vault);
    validateDikanjuMigrationSnapshot(snapshot).errors.forEach((error) => addError(errors, error));
  } catch (error) {
    addError(errors, `无法捕获迁移快照：${error.message || error}`);
  }
  return Object.freeze({
    ...preview,
    snapshot,
    valid: errors.length === 0,
    errors: Object.freeze(errors),
  });
}

function textFile(entry) {
  return ['md', 'components', 'json', 'canvas', 'txt', 'css', 'csv', 'yaml', 'yml'].includes(String(entry.extension || '').toLowerCase());
}

async function snapshotFile(vault, entry) {
  if (!textFile(entry) && typeof vault.readBinary === 'function') {
    const content = await vault.readBinary(entry);
    return { path: entry.path, folder: false, binary: true, content: Array.from(new Uint8Array(content)) };
  }
  return { path: entry.path, folder: false, binary: false, content: await vault.read(entry) };
}

async function snapshotProject(vault) {
  const entries = vaultEntries(vault)
    .filter((entry) => isInside(entry.path, DIKANJU_PROJECT_FOLDER))
    .sort((left, right) => left.path.localeCompare(right.path));
  const snapshot = [];
  for (const entry of entries) {
    snapshot.push(isFolder(entry) ? { path: entry.path, folder: true } : await snapshotFile(vault, entry));
  }
  return snapshot;
}

async function snapshotSupport(vault) {
  const snapshot = [];
  for (const path of SUPPORT_PATHS) {
    const entry = vault.getAbstractFileByPath(path);
    if (!entry) snapshot.push({ path, exists: false });
    else if (isFolder(entry)) snapshot.push({ path, exists: true, folder: true });
    else snapshot.push({ exists: true, ...(await snapshotFile(vault, entry)) });
  }
  return snapshot;
}

function deepFreezeSnapshot(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreezeSnapshot);
  return Object.freeze(value);
}

async function captureDikanjuMigrationSnapshot(vault) {
  if (!vault || typeof vault.getAllLoadedFiles !== 'function'
    || typeof vault.getAbstractFileByPath !== 'function' || typeof vault.read !== 'function') {
    throw new Error('迁移必须通过 Obsidian Vault API 捕获快照');
  }
  const projectEntries = await snapshotProject(vault);
  const supportEntries = await snapshotSupport(vault);
  const parentEntries = ['02 项目', '07 模板'].map((path) => {
    const entry = vault.getAbstractFileByPath(path);
    return { path, exists: !!entry, folder: isFolder(entry) };
  });
  return deepFreezeSnapshot({ projectEntries, supportEntries, parentEntries });
}

async function createSnapshotFile(vault, item) {
  if (item.binary) {
    if (typeof vault.createBinary !== 'function') throw new Error(`Vault API 不支持恢复二进制文件：${item.path}`);
    await vault.createBinary(item.path, Uint8Array.from(item.content).buffer);
  } else {
    await vault.create(item.path, item.content);
  }
}

function addUnique(values, value) {
  if (!values.includes(value)) values.push(value);
}

function sameBinary(left, right) {
  const leftBytes = left instanceof Uint8Array ? left : new Uint8Array(left || []);
  const rightBytes = right instanceof Uint8Array ? right : new Uint8Array(right || []);
  return leftBytes.length === rightBytes.length && leftBytes.every((byte, index) => byte === rightBytes[index]);
}

async function currentMatches(vault, entry, expected) {
  if (!entry || isFolder(entry)) return false;
  if (expected.binary) {
    if (typeof vault.readBinary !== 'function') return false;
    return sameBinary(await vault.readBinary(entry), expected.content);
  }
  return await vault.read(entry) === expected.content;
}

function folderIsEmpty(vault, folderPath) {
  const descendants = vaultEntries(vault).filter((entry) => entry.path.startsWith(`${folderPath}/`));
  if (descendants.length > 0) return false;
  const folder = vault.getAbstractFileByPath(folderPath);
  return isFolder(folder) && folder.children.length === 0;
}

function migrationJournal() {
  return { createdFiles: [], modifiedFiles: [], createdFolders: [] };
}

async function restoreMigrationSnapshot(vault, projectSnapshot, supportSnapshot, journal) {
  const failedPaths = [];
  const conflicts = [];
  const snapshotPaths = new Set(projectSnapshot.map((item) => item.path));
  const ownedPaths = new Set([
    ...journal.createdFiles.map((item) => item.path),
    ...journal.createdFolders,
  ]);
  for (const entry of vaultEntries(vault)) {
    if (isInside(entry.path, DIKANJU_PROJECT_FOLDER)
      && !ownedPaths.has(entry.path) && !snapshotPaths.has(entry.path)) {
      addUnique(conflicts, entry.path);
    }
  }

  for (const item of [...journal.createdFiles].reverse()) {
    try {
      const current = vault.getAbstractFileByPath(item.path);
      if (!current) continue;
      if (await currentMatches(vault, current, item)) await vault.delete(current, true);
      else addUnique(conflicts, item.path);
    } catch (error) {
      addUnique(failedPaths, item.path);
    }
  }

  for (const item of [...journal.modifiedFiles].reverse()) {
    try {
      const current = vault.getAbstractFileByPath(item.path);
      if (!current) continue;
      if (await currentMatches(vault, current, item)) await vault.modify(current, item.previous.content);
      else addUnique(conflicts, item.path);
    } catch (error) {
      addUnique(failedPaths, item.path);
    }
  }

  for (const folderPath of [...journal.createdFolders].reverse()) {
    try {
      const current = vault.getAbstractFileByPath(folderPath);
      if (!current) continue;
      if (!isFolder(current)) {
        addUnique(conflicts, folderPath);
      } else if (folderIsEmpty(vault, folderPath)) {
        await vault.delete(current, true);
      } else {
        for (const entry of vaultEntries(vault)) {
          if (entry.path.startsWith(`${folderPath}/`) && !ownedPaths.has(entry.path) && !snapshotPaths.has(entry.path)) {
            addUnique(conflicts, entry.path);
          }
        }
      }
    } catch (error) {
      addUnique(failedPaths, folderPath);
    }
  }

  const folders = projectSnapshot.filter((item) => item.folder)
    .sort((left, right) => left.path.split('/').length - right.path.split('/').length || left.path.localeCompare(right.path));
  for (const item of folders) {
    try {
      const current = vault.getAbstractFileByPath(item.path);
      if (!current) await vault.createFolder(item.path);
      else if (!isFolder(current)) addUnique(conflicts, item.path);
    } catch (error) {
      addUnique(failedPaths, item.path);
    }
  }
  for (const item of projectSnapshot.filter((entry) => !entry.folder)) {
    try {
      const current = vault.getAbstractFileByPath(item.path);
      if (!current) await createSnapshotFile(vault, item);
      else addUnique(conflicts, item.path);
    } catch (error) {
      addUnique(failedPaths, item.path);
    }
  }

  for (const item of supportSnapshot) {
    try {
      const current = vault.getAbstractFileByPath(item.path);
      if (!item.exists) {
        if (current) addUnique(conflicts, item.path);
      } else if (!current) {
        await createSnapshotFile(vault, item);
      } else if (isFolder(current) || !(await currentMatches(vault, current, item))) {
        addUnique(conflicts, item.path);
      }
    } catch (error) {
      addUnique(failedPaths, item.path);
    }
  }
  return {
    restored: failedPaths.length === 0 && conflicts.length === 0,
    status: failedPaths.length === 0 && conflicts.length === 0 ? 'restored' : 'partial',
    failedPaths,
    conflicts,
  };
}

class ProjectMigrationError extends Error {
  constructor(message, missingPaths = [], rollback = { restored: false, status: 'not-attempted', failedPaths: [], conflicts: [] }) {
    const rollbackText = rollback.restored
      ? '已从内存快照恢复旧内容'
      : `恢复失败或不完整：${rollback.failedPaths.join('、') || '无操作失败'}；冲突：${rollback.conflicts?.join('、') || '无'}`;
    super(`${message}；未完成路径：${missingPaths.join('、') || '无'}；${rollbackText}`);
    this.name = 'ProjectMigrationError';
    this.missingPaths = missingPaths;
    this.rollback = rollback;
  }
}

async function verifyWrittenOutputs(vault, preview) {
  const missingPaths = [];
  for (const output of preview.outputFiles) {
    const entry = vault.getAbstractFileByPath(output.path);
    if (!entry || isFolder(entry)) {
      missingPaths.push(output.path);
      continue;
    }
    try {
      if (await vault.read(entry) !== output.content) missingPaths.push(output.path);
    } catch (error) {
      missingPaths.push(output.path);
    }
  }
  return missingPaths;
}

async function executeDikanjuMigration(vault) {
  const preview = buildDikanjuMigrationPreview();
  let snapshot;
  try {
    snapshot = await captureDikanjuMigrationSnapshot(vault);
  } catch (error) {
    throw new ProjectMigrationError(
      `迁移快照捕获失败：${error.message || error}`,
      preview.outputFiles.map((entry) => entry.path),
    );
  }
  const snapshotValidation = validateDikanjuMigrationSnapshot(snapshot);
  const validationErrors = [...preview.errors, ...snapshotValidation.errors];
  if (validationErrors.length > 0) {
    throw new ProjectMigrationError(`迁移预检失败：${validationErrors.join('；')}`, preview.outputFiles.map((entry) => entry.path));
  }
  const projectSnapshot = snapshot.projectEntries;
  const supportSnapshot = snapshot.supportEntries;
  const journal = migrationJournal();
  try {
    const target = vault.getAbstractFileByPath(DIKANJU_PROJECT_FOLDER);
    if (!target || !isFolder(target)) throw new Error('删除前目标项目目录已变化');
    await vault.delete(target, true);
    await vault.createFolder(DIKANJU_PROJECT_FOLDER);
    journal.createdFolders.push(DIKANJU_PROJECT_FOLDER);
    await vault.createFolder(`${DIKANJU_PROJECT_FOLDER}/阶段`);
    journal.createdFolders.push(`${DIKANJU_PROJECT_FOLDER}/阶段`);
    for (const output of preview.projectFiles) {
      await vault.create(output.path, output.content);
      journal.createdFiles.push({ path: output.path, content: output.content, binary: false });
    }
    for (const output of preview.supportFiles) {
      const existing = vault.getAbstractFileByPath(output.path);
      if (existing) {
        const previous = supportSnapshot.find((item) => item.path === output.path);
        if (!previous || !previous.exists || !(await currentMatches(vault, existing, previous))) {
          throw new Error(`配套文件在迁移期间已变化：${output.path}`);
        }
        await vault.modify(existing, output.content);
        journal.modifiedFiles.push({ path: output.path, content: output.content, binary: false, previous });
      } else {
        await vault.create(output.path, output.content);
        journal.createdFiles.push({ path: output.path, content: output.content, binary: false });
      }
    }
    const missingPaths = await verifyWrittenOutputs(vault, preview);
    if (missingPaths.length > 0) throw new Error(`写后核对失败：${missingPaths.join('、')}`);
    return {
      projectFolder: DIKANJU_PROJECT_FOLDER,
      projectFileCount: preview.projectFiles.length,
      supportFileCount: preview.supportFiles.length,
      files: preview.outputFiles.map((entry) => entry.path),
    };
  } catch (error) {
    const missingPaths = await verifyWrittenOutputs(vault, preview);
    const rollback = await restoreMigrationSnapshot(vault, projectSnapshot, supportSnapshot, journal);
    throw new ProjectMigrationError(`迁移写入失败：${error.message || error}`, missingPaths, rollback);
  }
}

module.exports = {
  DIKANJU_PROJECT_FOLDER,
  DIKANJU_STAGES,
  PROJECT_TEMPLATE_CONTENT,
  STAGE_TEMPLATE_CONTENT,
  PROJECT_INDEX_CONTENT,
  ProjectMigrationError,
  buildDikanjuMigrationPreview,
  captureDikanjuMigrationSnapshot,
  validateDikanjuMigrationSnapshot,
  preflightDikanjuMigration,
  executeDikanjuMigration,
};
