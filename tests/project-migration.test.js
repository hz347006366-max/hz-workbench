const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  DIKANJU_PROJECT_FOLDER,
  DIKANJU_STAGES,
  buildDikanjuMigrationPreview,
  captureDikanjuMigrationSnapshot,
  validateDikanjuMigrationSnapshot,
  preflightDikanjuMigration,
  executeDikanjuMigration,
} = require('../src/project-migration');

const EXPECTED_STAGES = [
  [1, '开工前准备', '2026-07-04', '2026-07-13', '未开始', ['开通水电', '办理装修手续', '地暖打压'], ['压力表带压施工']],
  [2, '开工交底', '2026-07-07', '2026-07-07', '未开始', ['拆除', '空调、新风', '水、电、暖', '净软水'], []],
  [3, '结构改造', '2026-07-08', '2026-07-12', '未开始', ['拆除墙体', '新建墙体', '钢结构'], []],
  [4, '门窗改造', '2026-07-13', '2026-07-15', '未开始', ['防盗门', '型材窗'], []],
  [5, '设备安装', '2026-07-16', '2026-07-17', '未开始', ['中央空调', '新风'], []],
  [6, '水电暖改造', '2026-07-18', '2026-07-27', '进行中', ['厨房', '卫生间', '洗衣间', '客厅卧室', '直饮水位置', '全屋智能'], [
    '厨房需提前预定：热水器、烟机炉灶、洗碗机、蒸烤箱、净软水、冰箱',
    '卫生间需提前预定：暗埋卫浴、地漏',
    '洗衣间需提前预定：洗衣机、烘干机、壁挂洗衣机',
    '客厅卧室需提前预定：电视尺寸、影音设备',
    '全屋智能需提前预定：设备类型',
  ]],
  [7, '木工', '2026-07-28', '2026-08-01', '未开始', ['隔音棉', '吊顶', '造型'], ['需要提前购买：暗藏灯具']],
  [8, '找平', '2026-08-02', '2026-08-04', '未开始', ['墙面冲筋找平', '卫生间地面找坡'], []],
  [9, '瓦工', '2026-08-05', '2026-08-14', '等待', ['防水', '闭水试验', '防水保护', '贴砖'], ['需提前预定：收口条']],
  [10, '成品定制量尺下单', '2026-08-15', '2026-08-15', '未开始', ['木门测量', '型材门测量', '衣柜测量', '橱柜测量'], []],
  [11, '油漆工', '2026-08-16', '2026-08-25', '未开始', ['腻子找平', '窗台板安装', '刷乳胶漆'], []],
  [12, '前期主材施工', '2026-08-26', '2026-08-29', '未开始', ['美缝', '开关插座', '集成吊顶'], []],
  [13, '安装定制产品', '2026-08-30', '2026-09-03', '未开始', ['安装橱柜', '安装衣柜', '安装木门、型材门', '安装踢脚线'], []],
  [14, '后期主材施工', '2026-09-04', '2026-09-08', '未开始', ['中央空调风口', '设备类安装', '小背篓安装', '卫浴洁具安装', '乳胶漆找补'], []],
  [15, '软装进场', '2026-09-09', '2026-09-12', '未开始', ['开荒保洁', '挂画安装', '窗帘安装', '家具进场'], []],
];

function folder(folderPath) {
  return { path: folderPath, children: [] };
}

function file(filePath, content) {
  const name = filePath.split('/').at(-1);
  return { path: filePath, name, basename: name.replace(/\.[^.]+$/, ''), extension: name.includes('.') ? name.split('.').at(-1) : '', content };
}

function legacyStageContent(stage) {
  const [order, name, start, due, status, checklist, reminders] = stage;
  const legacyStatus = status === '未开始' ? '待处理' : status === '等待' ? '等待中' : status;
  return [
    '---',
    'type: 施工任务',
    'project: 省地勘局宿舍',
    `order: ${order}`,
    `status: ${legacyStatus}`,
    `stage: ${name}`,
    `start: ${start}`,
    `due: ${due}`,
    'schedule_status: 草案排期',
    '---',
    '',
    `# ${String(order).padStart(2, '0')} ${name}`,
    '',
    '## 子项',
    '',
    ...checklist.map((item) => `- ${item}`),
    '',
    '## 提醒',
    '',
    ...reminders.map((item) => `- ${item}`),
    '',
    '## 记录',
    '',
  ].join('\n');
}

function createVault({ failCreatePath = '', failModifyPath = '', failRestorePath = '' } = {}) {
  const entries = new Map();
  const calls = { events: [], create: [], createFolder: [], modify: [], delete: [], read: [] };
  const addFolder = (folderPath) => entries.set(folderPath, folder(folderPath));
  addFolder('02 项目');
  addFolder('02 项目/省地勘局宿舍');
  addFolder('02 项目/省地勘局宿舍/施工任务');
  addFolder('07 模板');
  entries.set('02 项目/省地勘局宿舍/旧主页.md', file('02 项目/省地勘局宿舍/旧主页.md', '旧主页内容'));
  for (const stage of EXPECTED_STAGES) {
    const stagePath = `02 项目/省地勘局宿舍/施工任务/${String(stage[0]).padStart(2, '0')} ${stage[1]}.md`;
    entries.set(stagePath, file(stagePath, legacyStageContent(stage)));
  }
  entries.set('02 项目/省地勘局宿舍/项目视图.components', file('02 项目/省地勘局宿舍/项目视图.components', '旧视图内容'));
  entries.set('07 模板/项目模板.md', file('07 模板/项目模板.md', '旧项目模板'));
  entries.set('02 项目/项目索引.md', file('02 项目/项目索引.md', '旧项目索引'));

  const vault = {
    calls,
    entries,
    getAllLoadedFiles: () => [...entries.values()],
    getMarkdownFiles: () => [...entries.values()].filter((entry) => entry.extension === 'md'),
    getAbstractFileByPath: (targetPath) => entries.get(targetPath) || null,
    async read(target) {
      calls.events.push(['read', target.path]); calls.read.push(target.path); return target.content;
    },
    async createFolder(targetPath) {
      calls.events.push(['createFolder', targetPath]); calls.createFolder.push(targetPath);
      if (entries.has(targetPath)) throw new Error(`exists: ${targetPath}`);
      addFolder(targetPath);
    },
    async create(targetPath, content) {
      calls.events.push(['create', targetPath]); calls.create.push(targetPath);
      if (targetPath === failCreatePath) throw new Error(`create denied: ${targetPath}`);
      if (targetPath === failRestorePath && content.startsWith('旧')) throw new Error(`restore denied: ${targetPath}`);
      if (entries.has(targetPath)) throw new Error(`exists: ${targetPath}`);
      const created = file(targetPath, content); entries.set(targetPath, created); return created;
    },
    async modify(target, content) {
      calls.events.push(['modify', target.path]); calls.modify.push(target.path);
      if (target.path === failModifyPath && content !== '旧项目模板') throw new Error(`modify denied: ${target.path}`);
      target.content = content;
    },
    async delete(target, recursive) {
      calls.events.push(['delete', target.path, recursive]); calls.delete.push([target.path, recursive]);
      entries.delete(target.path);
      if (recursive) for (const entryPath of [...entries.keys()]) if (entryPath.startsWith(`${target.path}/`)) entries.delete(entryPath);
    },
  };
  return vault;
}

function assertNoWrites(vault) {
  assert.equal(vault.calls.create.length, 0);
  assert.equal(vault.calls.createFolder.length, 0);
  assert.equal(vault.calls.modify.length, 0);
  assert.equal(vault.calls.delete.length, 0);
}

test('locks the old fifteen stages, dates, status mapping, checklist, and material reminders', () => {
  assert.equal(DIKANJU_PROJECT_FOLDER, '02 项目/省地勘局宿舍');
  assert.equal(DIKANJU_STAGES.length, 15);
  assert.deepEqual(DIKANJU_STAGES.map((stage) => [
    stage.order, stage.name, stage.plannedStart, stage.plannedEnd, stage.status,
    [...stage.checklist], [...stage.materialReminders],
  ]), EXPECTED_STAGES);
  assert.ok(DIKANJU_STAGES.every((stage) => stage.scheduleStatus === '草案'));
  assert.ok(DIKANJU_STAGES.every((stage) => stage.actualStart === '' && stage.actualEnd === ''));
});

test('prebuilds and deeply validates the exact sixteen replacement project files', () => {
  const preview = buildDikanjuMigrationPreview();

  assert.equal(preview.valid, true, preview.errors.join('\n'));
  assert.equal(preview.projectFiles.length, 16);
  assert.equal(preview.outputFiles.length, 19);
  assert.equal(preview.projectFiles[0].path, '02 项目/省地勘局宿舍/省地勘局宿舍.md');
  assert.equal(preview.projectFiles.at(-1).path, '02 项目/省地勘局宿舍/阶段/15 软装进场.md');
  assert.match(preview.projectFiles[0].content, /^type: "项目"$/m);
  assert.match(preview.projectFiles[0].content, /^project_status: "进行中"$/m);
  assert.match(preview.projectFiles[0].content, /^plan_start: "2026-07-04"$/m);
  assert.match(preview.projectFiles[0].content, /^plan_end: "2026-09-12"$/m);
  for (const [index, stage] of DIKANJU_STAGES.entries()) {
    const output = preview.projectFiles[index + 1];
    assert.match(output.content, /^type: "项目阶段"$/m);
    assert.match(output.content, /^project: "\[\[省地勘局宿舍\]\]"$/m);
    assert.match(output.content, new RegExp(`^order: ${stage.order}$`, 'm'));
    assert.match(output.content, /^schedule_status: "草案"$/m);
    assert.match(output.content, /^actual_start: ""$/m);
    assert.match(output.content, /^actual_end: ""$/m);
    assert.equal((output.content.match(/^- \[[ xX]\] /gm) || []).length, stage.checklist.length);
    for (const heading of ['## 细项清单', '## 材料 / 设备预定', '## 等待原因', '## 验收要点', '## 阶段记录']) {
      assert.ok(output.content.includes(heading), `${output.path} misses ${heading}`);
    }
  }
});

test('includes project template, stage template, and project index in the same validated preview', () => {
  const preview = buildDikanjuMigrationPreview();
  const outputs = new Map(preview.outputFiles.map((entry) => [entry.path, entry.content]));

  assert.match(outputs.get('07 模板/项目模板.md'), /^type: 项目$/m);
  assert.match(outputs.get('07 模板/项目模板.md'), /^project_status: 筹备中$/m);
  assert.match(outputs.get('07 模板/项目阶段模板.md'), /^type: 项目阶段$/m);
  assert.match(outputs.get('07 模板/项目阶段模板.md'), /## 细项清单[\s\S]*## 材料 \/ 设备预定[\s\S]*## 等待原因[\s\S]*## 验收要点[\s\S]*## 阶段记录/);
  assert.match(outputs.get('02 项目/项目索引.md'), /TABLE project_status AS 状态, plan_end AS 计划完成/);
  assert.doesNotMatch(outputs.get('02 项目/项目索引.md'), /TABLE status AS 状态/);
});

test('exposes human-checkable 06 and 09 samples with the expected status and reminders', () => {
  const { samples } = buildDikanjuMigrationPreview();
  assert.equal(samples.stage06.path, '02 项目/省地勘局宿舍/阶段/06 水电暖改造.md');
  assert.match(samples.stage06.content, /^status: "进行中"$/m);
  assert.match(samples.stage06.content, /厨房需提前预定：热水器、烟机炉灶、洗碗机、蒸烤箱、净软水、冰箱/);
  assert.equal(samples.stage09.path, '02 项目/省地勘局宿舍/阶段/09 瓦工.md');
  assert.match(samples.stage09.content, /^status: "等待"$/m);
  assert.match(samples.stage09.content, /需提前预定：收口条/);
});

test('dry-run checks the exact legacy folder without making Vault writes', async () => {
  const vault = createVault();
  const result = await preflightDikanjuMigration(vault);

  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.equal(result.projectFiles.length, 16);
  assertNoWrites(vault);
});

test('preflight refuses a missing or already rebuilt project and performs zero writes', async () => {
  const missing = createVault();
  missing.entries.delete(DIKANJU_PROJECT_FOLDER);
  for (const entryPath of [...missing.entries.keys()]) if (entryPath.startsWith(`${DIKANJU_PROJECT_FOLDER}/`)) missing.entries.delete(entryPath);
  const missingResult = await preflightDikanjuMigration(missing);
  assert.equal(missingResult.valid, false);
  assert.match(missingResult.errors.join('；'), /旧项目目录不存在/);
  assertNoWrites(missing);

  const rebuilt = createVault();
  rebuilt.entries.delete('02 项目/省地勘局宿舍/施工任务');
  rebuilt.entries.delete('02 项目/省地勘局宿舍/施工任务/01 开工前准备.md');
  rebuilt.entries.delete('02 项目/省地勘局宿舍/项目视图.components');
  rebuilt.entries.set('02 项目/省地勘局宿舍/阶段', folder('02 项目/省地勘局宿舍/阶段'));
  const rebuiltResult = await preflightDikanjuMigration(rebuilt);
  assert.equal(rebuiltResult.valid, false);
  assert.match(rebuiltResult.errors.join('；'), /旧版标记|已经重建/);
  assertNoWrites(rebuilt);
});

test('preflight rejects legacy markers without the complete fifteen stage files and never deletes', async () => {
  const vault = createVault();
  for (const entryPath of [...vault.entries.keys()]) {
    if (entryPath.startsWith(`${DIKANJU_PROJECT_FOLDER}/施工任务/`)) vault.entries.delete(entryPath);
  }

  const result = await preflightDikanjuMigration(vault);

  assert.equal(result.valid, false);
  assert.match(result.errors.join('；'), /15|阶段文件|缺少/);
  assertNoWrites(vault);
});

test('preflight requires the construction path to be a folder and the components marker to be a file', async () => {
  const badConstruction = createVault();
  badConstruction.entries.set(`${DIKANJU_PROJECT_FOLDER}/施工任务`, file(`${DIKANJU_PROJECT_FOLDER}/施工任务`, 'wrong type'));
  const constructionResult = await preflightDikanjuMigration(badConstruction);
  assert.equal(constructionResult.valid, false);
  assert.match(constructionResult.errors.join('；'), /施工任务.*目录|folder|类型/);
  assertNoWrites(badConstruction);

  const badMarker = createVault();
  badMarker.entries.set(`${DIKANJU_PROJECT_FOLDER}/项目视图.components`, folder(`${DIKANJU_PROJECT_FOLDER}/项目视图.components`));
  const markerResult = await preflightDikanjuMigration(badMarker);
  assert.equal(markerResult.valid, false);
  assert.match(markerResult.errors.join('；'), /components.*文件|标记.*类型/);
  assertNoWrites(badMarker);
});

test('preflight reads every legacy stage and rejects changed checklist, reminder, date, or an extra numbered stage', async () => {
  const mutations = [
    ['细项', (content) => content.replace('- 厨房', '- 厨房（已改变）')],
    ['提醒', (content) => content.replace('需提前预定：收口条', '需提前预定：瓷砖')],
    ['日期', (content) => content.replace('start: 2026-07-28', 'start: 2026-07-29')],
    ['type', (content) => content.replace('type: 施工任务', 'type: 施工任务\ntype: 其他')],
  ];
  const paths = [
    `${DIKANJU_PROJECT_FOLDER}/施工任务/06 水电暖改造.md`,
    `${DIKANJU_PROJECT_FOLDER}/施工任务/09 瓦工.md`,
    `${DIKANJU_PROJECT_FOLDER}/施工任务/07 木工.md`,
    `${DIKANJU_PROJECT_FOLDER}/施工任务/01 开工前准备.md`,
  ];
  for (const [index, [label, mutate]] of mutations.entries()) {
    const vault = createVault();
    const target = vault.entries.get(paths[index]);
    target.content = mutate(target.content);
    const result = await preflightDikanjuMigration(vault);
    assert.equal(result.valid, false, label);
    assert.match(result.errors.join('；'), new RegExp(`${label}|不一致|${String([6, 9, 7, 1][index]).padStart(2, '0')}`), label);
    assertNoWrites(vault);
  }

  const extra = createVault();
  const extraPath = `${DIKANJU_PROJECT_FOLDER}/施工任务/16 临时阶段.md`;
  extra.entries.set(extraPath, file(extraPath, legacyStageContent([16, '临时阶段', '2026-09-13', '2026-09-14', '未开始', ['临时'], []])));
  const extraResult = await preflightDikanjuMigration(extra);
  assert.equal(extraResult.valid, false);
  assert.match(extraResult.errors.join('；'), /多出|16|阶段文件/);
  assertNoWrites(extra);
});

test('captures one deeply frozen migration snapshot detached from later Vault object mutation', async () => {
  const vault = createVault();
  const stagePath = `${DIKANJU_PROJECT_FOLDER}/施工任务/06 水电暖改造.md`;
  const sourceStage = vault.entries.get(stagePath);
  const expectedContent = sourceStage.content;

  const snapshot = await captureDikanjuMigrationSnapshot(vault);
  const capturedStage = snapshot.projectEntries.find((entry) => entry.path === stagePath);

  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.projectEntries), true);
  assert.equal(Object.isFrozen(capturedStage), true);
  assert.equal(capturedStage.content, expectedContent);
  assert.equal(vault.calls.read.filter((entryPath) => entryPath === stagePath).length, 1);

  sourceStage.content = sourceStage.content.replace('- 厨房', '- Vault 后续变化');
  sourceStage.path = `${stagePath}.moved`;
  assert.equal(capturedStage.path, stagePath);
  assert.equal(capturedStage.content, expectedContent);
  const validation = validateDikanjuMigrationSnapshot(snapshot);
  assert.equal(validation.valid, true, validation.errors.join('\n'));
});

test('execute validates its own changed snapshot and performs no delete', async () => {
  const vault = createVault();
  const stagePath = `${DIKANJU_PROJECT_FOLDER}/施工任务/06 水电暖改造.md`;
  vault.entries.get(stagePath).content = vault.entries.get(stagePath).content.replace('- 厨房', '- 已被同步修改');

  await assert.rejects(() => executeDikanjuMigration(vault), /旧阶段 06|细项不一致|预检失败/);

  assert.equal(vault.calls.delete.length, 0);
  assertNoWrites(vault);
});

test('execute reads each legacy stage once instead of validating one read and deleting a second unvalidated read', async () => {
  const vault = createVault();
  const stagePath = `${DIKANJU_PROJECT_FOLDER}/施工任务/06 水电暖改造.md`;
  const originalRead = vault.read;
  let reads = 0;
  vault.read = async (target) => {
    if (target.path === stagePath) reads += 1;
    const content = await originalRead(target);
    if (target.path === stagePath && reads > 1) return content.replace('- 厨房', '- 第二次读取已变化');
    return content;
  };

  const result = await executeDikanjuMigration(vault);

  assert.equal(result.projectFileCount, 16);
  assert.equal(reads, 1);
});

test('executes only after preflight, deletes the exact old folder, then writes and verifies all outputs via Vault API', async () => {
  const vault = createVault();
  const result = await executeDikanjuMigration(vault);

  assert.equal(result.projectFileCount, 16);
  assert.equal(result.supportFileCount, 3);
  assert.deepEqual(vault.calls.delete[0], [DIKANJU_PROJECT_FOLDER, true]);
  const deleteIndex = vault.calls.events.findIndex((entry) => entry[0] === 'delete' && entry[1] === DIKANJU_PROJECT_FOLDER);
  const firstCreateIndex = vault.calls.events.findIndex((entry) => entry[0] === 'create' && entry[1].startsWith(`${DIKANJU_PROJECT_FOLDER}/`));
  assert.ok(deleteIndex >= 0 && firstCreateIndex > deleteIndex);
  assert.ok(vault.entries.has('02 项目/省地勘局宿舍/省地勘局宿舍.md'));
  assert.ok(vault.entries.has('02 项目/省地勘局宿舍/阶段/15 软装进场.md'));
  assert.equal([...vault.entries.keys()].some((entryPath) => /施工任务|\.components|看板|甘特图/.test(entryPath)), false);
  assert.equal(vault.entries.get('07 模板/项目模板.md').content, buildDikanjuMigrationPreview().outputFiles.find((entry) => entry.path === '07 模板/项目模板.md').content);
  assert.ok(vault.entries.has('07 模板/项目阶段模板.md'));
});

test('stops on a failed project write, reports every missing output, and restores the old project plus support files from memory', async () => {
  const failedPath = '02 项目/省地勘局宿舍/阶段/03 结构改造.md';
  const vault = createVault({ failCreatePath: failedPath });
  const oldPaths = [...vault.entries.keys()].sort();

  await assert.rejects(async () => {
    await executeDikanjuMigration(vault);
  }, (error) => {
    assert.equal(error.name, 'ProjectMigrationError');
    assert.match(error.message, /03 结构改造\.md/);
    assert.ok(error.missingPaths.includes(failedPath));
    assert.equal(error.rollback.restored, true);
    return true;
  });

  assert.deepEqual([...vault.entries.keys()].sort(), oldPaths);
  assert.equal(vault.entries.get('02 项目/省地勘局宿舍/旧主页.md').content, '旧主页内容');
  assert.equal(vault.entries.get('07 模板/项目模板.md').content, '旧项目模板');
  assert.equal(vault.entries.get('02 项目/项目索引.md').content, '旧项目索引');
  assert.equal(vault.entries.has('07 模板/项目阶段模板.md'), false);
  const failedIndex = vault.calls.events.findIndex((entry) => entry[0] === 'create' && entry[1] === failedPath);
  const laterNewWrite = vault.calls.events.findIndex((entry, index) => index > failedIndex
    && entry[0] === 'create' && entry[1] === `${DIKANJU_PROJECT_FOLDER}/阶段/04 门窗改造.md`);
  assert.equal(laterNewWrite, -1);
});

test('reports rollback residue instead of hiding an in-memory restore failure', async () => {
  const failedPath = '02 项目/省地勘局宿舍/阶段/01 开工前准备.md';
  const restorePath = '02 项目/省地勘局宿舍/旧主页.md';
  const vault = createVault({ failCreatePath: failedPath, failRestorePath: restorePath });

  await assert.rejects(() => executeDikanjuMigration(vault), (error) => {
    assert.equal(error.rollback.restored, false);
    assert.ok(error.rollback.failedPaths.includes(restorePath));
    assert.match(error.message, /恢复失败/);
    return true;
  });
});

test('reports a stale support path when modify fails and rolls the complete transaction back', async () => {
  const failedPath = '07 模板/项目模板.md';
  const vault = createVault({ failModifyPath: failedPath });

  await assert.rejects(() => executeDikanjuMigration(vault), (error) => {
    assert.ok(error.missingPaths.includes(failedPath));
    assert.equal(error.rollback.restored, true);
    return true;
  });

  assert.equal(vault.entries.get(failedPath).content, '旧项目模板');
  assert.equal(vault.entries.get('02 项目/项目索引.md').content, '旧项目索引');
  assert.ok(vault.entries.has('02 项目/省地勘局宿舍/施工任务'));
  assert.equal(vault.entries.has('02 项目/省地勘局宿舍/阶段'), false);
});

test('rollback preserves a file created by sync during migration and reports a conflict', async () => {
  const failedPath = `${DIKANJU_PROJECT_FOLDER}/阶段/03 结构改造.md`;
  const syncPath = `${DIKANJU_PROJECT_FOLDER}/同步后新增.md`;
  const vault = createVault({ failCreatePath: failedPath });
  const originalCreate = vault.create;
  vault.create = async (targetPath, content) => {
    const result = await originalCreate(targetPath, content);
    if (targetPath === `${DIKANJU_PROJECT_FOLDER}/省地勘局宿舍.md`) {
      vault.entries.set(syncPath, file(syncPath, '同步产生，不得删除'));
    }
    return result;
  };

  await assert.rejects(() => executeDikanjuMigration(vault), (error) => {
    assert.equal(error.rollback.restored, false);
    assert.ok(error.rollback.conflicts.includes(syncPath));
    return true;
  });

  assert.equal(vault.entries.get(syncPath).content, '同步产生，不得删除');
  assert.equal(vault.entries.get(`${DIKANJU_PROJECT_FOLDER}/旧主页.md`).content, '旧主页内容');
});

test('rollback preserves a concurrently modified support file and reports a conflict', async () => {
  const vault = createVault();
  const supportPath = '07 模板/项目模板.md';
  const failingPath = '02 项目/项目索引.md';
  const originalModify = vault.modify;
  vault.modify = async (target, content) => {
    if (target.path === failingPath) throw new Error('later support write failed');
    await originalModify(target, content);
    if (target.path === supportPath && content !== '旧项目模板') target.content = '同步并发修改，不得覆盖';
  };

  await assert.rejects(() => executeDikanjuMigration(vault), (error) => {
    assert.equal(error.rollback.restored, false);
    assert.ok(error.rollback.conflicts.includes(supportPath));
    return true;
  });

  assert.equal(vault.entries.get(supportPath).content, '同步并发修改，不得覆盖');
  assert.equal(vault.entries.get(failingPath).content, '旧项目索引');
});

test('registers separate preview and explicitly confirmed one-time migration commands', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/main.js'), 'utf8');
  assert.match(source, /require\('\.\/project-migration'\)/);
  assert.match(source, /id: 'preview-dikanju-project-rebuild'/);
  assert.match(source, /id: 'execute-dikanju-project-rebuild'/);
  assert.match(source, /confirm\(/);
  assert.match(source, /executeDikanjuMigration\(this\.app\.vault\)/);
});
