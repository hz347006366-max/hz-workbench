# HZ Project Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不破坏 HZ 工作台 v0.3.2 已有日记、月复盘和 TickTick 只读能力的前提下，建立统一的 Markdown 项目数据模型、项目总览、项目驾驶舱、桌面甘特图、移动阶段列表、新建项目向导，并按新模型重建“省地勘局宿舍”。

**Architecture:** 项目主页保存唯一的项目级数据，阶段笔记保存唯一的阶段数据和细项。纯函数模块负责解析、计算、模板生成与安全文本变换；Obsidian 服务层只负责 Vault API 读写和索引；工作台视图只消费结构化模型。所有写操作都在写前重读、限定范围修改、写后复核。

**Tech Stack:** Obsidian Plugin API、CommonJS JavaScript、esbuild、Node.js `node:test`、原生 HTML/CSS、PowerShell 验证命令、Remotely Save 真机同步。

## Global Constraints

- 当前 `D:\Chat GPT\HZ--工作平台\obsidian-hz-workbench` 是过期的 v0.1.0 快照，不能用于覆盖已安装的 v0.3.2。
- 权威基线来自 `D:\Chat GPT\HZ--工作平台\HZ个人工作台-v0.3.2-Windows接力包-2026-09-01\HZ个人工作台-v0.3.2-Windows接力包-2026-09-01\04-源码快照\repository` 和 `05-Git历史\HZ个人工作台.bundle`。
- 实施必须在从 Git bundle 恢复出的独立仓库中完成；不得原地覆盖旧 v0.1.0 目录。
- 任何时候都不得把 API Key、TickTick 登录信息或 Obsidian 私密配置写入源码、测试夹具、日志或交接文档。
- “省地勘局宿舍”旧目录只有在新文件全集通过内存校验、单元测试通过并完成一次人工抽查后才能删除；用户已明确要求不保留旧项目备份。
- 项目文件创建、复选框修改和旧项目删除必须通过 Obsidian Vault API 完成。
- 不引入第三方项目插件，不恢复 Components、Mermaid、独立 Kanban 或项目任务 TickTick 双向同步。
- v0.3.2 已有的 189+ 项测试必须继续通过；每个任务先写失败测试，再写最小实现。
- Git 恢复成功后按任务提交；提交前必须运行该任务列出的验证命令。

---

## 文件与职责映射

### 基线与构建

- `package.json`：版本、测试和构建命令；从 v0.3.2 起步。
- `manifest.json`：插件版本与项目系统描述。
- `src/main.js`：插件生命周期、工作台首页/驾驶舱状态切换、设置入口。
- `styles.css`：首页、项目总览、驾驶舱、甘特图和移动端样式。

### 新增项目模块

- `src/project-schema.js`：状态枚举、字段归一化、日期校验、项目/阶段模型校验。
- `src/project-markdown.js`：阶段章节解析、复选框定位与文本变换、Cashlog 行解析、日记相关段落提取。
- `src/project-metrics.js`：阶段进度、项目进度、当前阶段、偏差、甘特时间范围。
- `src/project-catalog.js`：标准 15 阶段库、默认细项、默认材料提醒。
- `src/project-template.js`：项目主页和阶段 Markdown 生成。
- `src/project-repository.js`：Vault API 扫描、读取、写回、创建、删除和写后复核。
- `src/project-view-model.js`：把项目、阶段、财务和日记记录组合为首页卡片与驾驶舱模型。
- `src/project-wizard.js`：新建项目两步向导与预写入校验。

### 新增测试

- `tests/project-schema.test.js`
- `tests/project-markdown.test.js`
- `tests/project-metrics.test.js`
- `tests/project-catalog.test.js`
- `tests/project-template.test.js`
- `tests/project-repository.test.js`
- `tests/project-view-model.test.js`
- `tests/project-wizard.test.js`
- `tests/project-ui.test.js`
- `tests/project-migration.test.js`

### Obsidian 仓库文件

- `F:\Obsidian\07 模板\项目模板.md`：项目主页手动创建备用模板。
- `F:\Obsidian\07 模板\项目阶段模板.md`：阶段笔记手动创建备用模板。
- `F:\Obsidian\02 项目\项目索引.md`：改用 `project_status` 和计算入口说明。
- `F:\Obsidian\02 项目\省地勘局宿舍\省地勘局宿舍.md`：新项目主页。
- `F:\Obsidian\02 项目\省地勘局宿舍\阶段\01 开工前准备.md` 至 `15 软装进场.md`：新阶段文件。
- `F:\Obsidian\.obsidian\plugins\hz-workbench\{main.js,styles.css,manifest.json,logo.png}`：最终安装产物。

---

## Task 1：恢复并锁定 v0.3.2 权威开发基线

**Files:**

- Create: `D:\Chat GPT\HZ--工作平台\obsidian-hz-workbench-project-system\`
- Copy after clone: `docs/superpowers/specs/2026-09-02-project-workspace-design.md`
- Copy after clone: `docs/superpowers/plans/2026-09-02-project-workspace.md`

- [ ] 1.1 从 Git bundle 克隆独立仓库。

```powershell
git clone "D:\Chat GPT\HZ--工作平台\HZ个人工作台-v0.3.2-Windows接力包-2026-09-01\HZ个人工作台-v0.3.2-Windows接力包-2026-09-01\05-Git历史\HZ个人工作台.bundle" "D:\Chat GPT\HZ--工作平台\obsidian-hz-workbench-project-system"
```

Expected: 命令退出码为 0，目标目录存在 `.git`。

- [ ] 1.2 核对 bundle HEAD、源码快照和已安装插件版本均为 `0.3.2`；若 bundle HEAD 不是接力文档记录的提交，停止实施并先查明差异。

```powershell
git -C "D:\Chat GPT\HZ--工作平台\obsidian-hz-workbench-project-system" log -1 --oneline
Get-Content "D:\Chat GPT\HZ--工作平台\obsidian-hz-workbench-project-system\manifest.json" -Raw
Get-Content "F:\Obsidian\.obsidian\plugins\hz-workbench\manifest.json" -Raw
```

Expected: 两个 manifest 的版本均为 `0.3.2`，Git HEAD 与接力包记录一致。

- [ ] 1.3 安装依赖并运行完整基线检查。

```powershell
pnpm install --frozen-lockfile
python scripts/run_all_checks.py
```

Expected: 语法检查、全部自动测试和构建均通过；不得少于接力包记录的 189 项测试。

- [ ] 1.4 复制已确认规格和本计划到恢复仓库，提交规划基线。

```powershell
git add docs/superpowers/specs/2026-09-02-project-workspace-design.md docs/superpowers/plans/2026-09-02-project-workspace.md
git commit -m "docs: add confirmed project workspace plan"
```

---

## Task 2：建立项目字段规范与标准阶段库

**Files:**

- Create: `src/project-schema.js`
- Create: `src/project-catalog.js`
- Create: `tests/project-schema.test.js`
- Create: `tests/project-catalog.test.js`

- [ ] 2.1 写失败测试，固定项目状态、阶段状态、旧状态迁移和日期字段规则。

```js
assert.equal(normalizeStageStatus('待处理'), '未开始');
assert.equal(normalizeStageStatus('等待中'), '等待');
assert.equal(normalizeProjectStatus('进行中'), '进行中');
assert.deepEqual(validateIsoDate('2026-09-02'), { valid: true, value: '2026-09-02' });
assert.equal(validateIsoDate('2026-13-40').valid, false);
```

- [ ] 2.2 运行测试并确认因模块不存在而失败。

```powershell
node --test tests/project-schema.test.js tests/project-catalog.test.js
```

Expected: FAIL，错误指向缺少模块或导出。

- [ ] 2.3 实现并导出以下稳定接口。

```js
module.exports = {
  PROJECT_STATUSES,
  STAGE_STATUSES,
  normalizeProject,
  normalizeStage,
  normalizeProjectStatus,
  normalizeStageStatus,
  validateIsoDate,
  validateProjectDraft,
  validateStageDraft,
};
```

`src/project-catalog.js` 导出 `DEFAULT_INTERIOR_STAGES`，按 01–15 固定顺序保存阶段名、细项和材料提醒。细项和提醒必须逐项覆盖已确认规格中的现有内容。

- [ ] 2.4 运行定向测试和全量检查。

```powershell
node --test tests/project-schema.test.js tests/project-catalog.test.js
python scripts/run_all_checks.py
git add src/project-schema.js src/project-catalog.js tests/project-schema.test.js tests/project-catalog.test.js
git commit -m "feat: add project schema and stage catalog"
```

Expected: PASS，标准阶段数量严格等于 15，`order` 为连续的 1–15。

---

## Task 3：实现 Markdown 解析与安全复选框变换

**Files:**

- Create: `src/project-markdown.js`
- Create: `tests/project-markdown.test.js`

- [ ] 3.1 写失败测试，覆盖“细项清单”边界、重复标题、无细项、勾选与取消、其他章节不被改动。

```js
const source = '# 阶段\n\n## 细项清单\n\n- [ ] 厨房\n- [x] 卫生间\n\n## 材料 / 设备预定\n\n- 热水器\n';
assert.deepEqual(parseChecklistSection(source).items.map((item) => item.text), ['厨房', '卫生间']);
const changed = setChecklistItemChecked(source, { index: 0, checked: true });
assert.match(changed, /- \[x\] 厨房/);
assert.match(changed, /## 材料 \/ 设备预定\n\n- 热水器/);
```

- [ ] 3.2 写 Cashlog 双格式测试。

必须同时识别：

```markdown
- #支出/项目/材料 [[省地勘局宿舍]] 灯具定金 💴 -860 ➕2026-07-14
- 21:55｜支出｜项目｜买酒｜¥14.00｜[[省地勘局宿舍]]
```

并把无法解析但含项目双链的账目计入 `invalidCount`，不得让汇总失败。

- [ ] 3.3 写日记段落提取测试：只返回含 `[[省地勘局宿舍]]` 的自然段，保留日期与源文件，不复制无关正文。

- [ ] 3.4 实现接口。

```js
module.exports = {
  parseChecklistSection,
  setChecklistItemChecked,
  updateStageFrontmatterAfterChecklist,
  parseCashlogLine,
  summarizeProjectCashlog,
  extractLinkedJournalParagraphs,
};
```

- [ ] 3.5 验证并提交。

```powershell
node --test tests/project-markdown.test.js
python scripts/run_all_checks.py
git add src/project-markdown.js tests/project-markdown.test.js
git commit -m "feat: parse project markdown safely"
```

---

## Task 4：实现阶段、项目进度与甘特时间计算

**Files:**

- Create: `src/project-metrics.js`
- Create: `tests/project-metrics.test.js`

- [ ] 4.1 写失败测试，覆盖以下规则。

```js
assert.equal(calculateStageProgress([{ checked: true }, { checked: false }]), 50);
assert.equal(calculateProjectProgress([{ progress: 50, valid: true }, { progress: 100, valid: true }]), 75);
assert.equal(selectCurrentStage([
  { order: 1, status: '未开始' },
  { order: 2, status: '进行中' },
]).order, 2);
```

还需覆盖：无细项不参与分母、全部完成、取消完成后恢复进行中、`actual_end` 自动写入/清空、草案排期不报延期、已确认排期提前/正常/延期、无排期提示。

- [ ] 4.2 写甘特范围测试。

- `本月`：当月 1 日至月末。
- `三个月`：当前月前一月 1 日至后一月月末。
- `全项目`：最早有效计划开始至最晚有效计划结束。
- 缺失/反向日期返回局部诊断，不抛出导致整个页面崩溃的异常。

- [ ] 4.3 实现并导出纯函数。

```js
module.exports = {
  calculateStageProgress,
  calculateProjectProgress,
  selectCurrentStage,
  reconcileStageCompletion,
  calculateScheduleVariance,
  calculateGanttRange,
  positionStageBar,
};
```

- [ ] 4.4 验证并提交。

```powershell
node --test tests/project-metrics.test.js
python scripts/run_all_checks.py
git add src/project-metrics.js tests/project-metrics.test.js
git commit -m "feat: calculate project progress and gantt ranges"
```

---

## Task 5：生成标准项目文件并校验新建项目草稿

**Files:**

- Create: `src/project-template.js`
- Create: `tests/project-template.test.js`
- Create: `tests/project-wizard.test.js`
- Create later through Vault API: `F:\Obsidian\07 模板\项目阶段模板.md`
- Modify later through Vault API: `F:\Obsidian\07 模板\项目模板.md`

- [ ] 5.1 写失败测试，固定项目主页和阶段文件的 YAML 与章节顺序。

项目主页必须包含 `type: 项目`、稳定 `project_id`、`project_status`、客户/地址/负责人/日期/金额/成员/供应商字段；阶段必须包含 `type: 项目阶段`、同一 `project_id`、项目双链、`order`、四态状态、计划/实际日期、`schedule_status`、负责人、依赖。

- [ ] 5.2 写完整文件集预生成测试。

```js
const plan = buildProjectFilePlan({ name: '省地勘局宿舍', stages: DEFAULT_INTERIOR_STAGES });
assert.equal(plan.files.length, 16);
assert.equal(plan.files[0].path, '02 项目/省地勘局宿舍/省地勘局宿舍.md');
assert.equal(plan.files[1].path, '02 项目/省地勘局宿舍/阶段/01 开工前准备.md');
```

校验项目名空白、非法路径字符、重复 order、重复文件名、目标目录已存在时必须失败且返回明确中文错误。

- [ ] 5.3 实现 `renderProjectHome`、`renderStageNote`、`buildProjectFilePlan`、`validateProjectFilePlan`。

- [ ] 5.4 验证并提交。

```powershell
node --test tests/project-template.test.js tests/project-wizard.test.js
python scripts/run_all_checks.py
git add src/project-template.js tests/project-template.test.js tests/project-wizard.test.js
git commit -m "feat: generate validated project files"
```

---

## Task 6：建立 Vault 项目仓库与写入复核

**Files:**

- Create: `src/project-repository.js`
- Create: `tests/project-repository.test.js`
- Modify: `src/main.js`

- [ ] 6.1 用内存 Vault mock 写失败测试，覆盖项目扫描、阶段关联、目录缺失、字段缺失和错误隔离。

- [ ] 6.2 写复选框事务测试：修改前重读、只改“细项清单”、写后重读核对；写后内容不符时返回失败并要求界面刷新。

- [ ] 6.3 写创建事务测试：先验证全部路径与内容，再建目录和文件；目标项目目录存在时零写入。

- [ ] 6.4 实现接口。

```js
class ProjectRepository {
  async listProjects() {}
  async loadProject(projectFile) {}
  async toggleStageItem(stageFile, itemIndex, checked, today) {}
  async createProject(draft) {}
  async deleteProjectFolder(projectFolder) {}
  async loadProjectFinance(project) {}
  async loadProjectJournalRecords(project) {}
}
```

`deleteProjectFolder` 只能接收已经归一化且严格位于设置项 `projectFolder` 下的单个项目目录；拒绝仓库根、`02 项目` 根目录、空路径和通配符。

- [ ] 6.5 在 `src/main.js` 中初始化仓库，但暂不替换现有 UI。

- [ ] 6.6 验证并提交。

```powershell
node --test tests/project-repository.test.js
python scripts/run_all_checks.py
git add src/project-repository.js src/main.js tests/project-repository.test.js
git commit -m "feat: add safe Obsidian project repository"
```

---

## Task 7：组合首页项目卡与项目驾驶舱模型

**Files:**

- Create: `src/project-view-model.js`
- Create: `tests/project-view-model.test.js`
- Modify: `src/main.js`

- [ ] 7.1 写失败测试，验证首页默认只显示“筹备中/进行中”，并可筛选暂停、已完成、已归档。

- [ ] 7.2 写项目卡测试：名称、状态、当前阶段、总体进度、计划完成日期、偏差文案必须来自同一模型。

- [ ] 7.3 写驾驶舱模型测试：阶段排序、当前阶段详情、财务四项指标、分类流水、异常账目数、最近日记记录和局部诊断全部可独立缺失。

- [ ] 7.4 实现 `buildProjectOverviewModel` 与 `buildProjectCockpitModel`，然后在 `WorkbenchView` 中保存：

```js
this.screen = { type: 'home' };
// 或
this.screen = { type: 'project', projectPath, selectedStagePath, ganttRange: 'month' };
```

切换项目时只重渲染同一个工作台 leaf；打开阶段笔记或日记记录时使用 `this.app.workspace.getLeaf('tab').openFile(file)` 保留工作台。

- [ ] 7.5 验证并提交。

```powershell
node --test tests/project-view-model.test.js
python scripts/run_all_checks.py
git add src/project-view-model.js src/main.js tests/project-view-model.test.js
git commit -m "feat: add project overview and cockpit state"
```

---

## Task 8：实现首页项目总览、驾驶舱与响应式界面

**Files:**

- Modify: `src/main.js`
- Modify: `styles.css`
- Create: `tests/project-ui.test.js`
- Modify: `tests/ui.test.js`
- Modify: `tests/production-integration.test.js`

- [ ] 8.1 写失败 UI 测试，固定以下结构与交互标识。

- 桌面左侧保留空白竖栏，内部不出现“智能体/Copilot/待接入”内容。
- Logo 位于顶部日期与问候语左侧。
- 首页项目区域标题为“项目总览”，带状态筛选和“新建项目”按钮。
- 点击项目卡切换驾驶舱；返回按钮恢复首页。
- 驾驶舱有“本月/三个月/全项目”范围按钮、阶段行、今天标线、当前阶段详情、财务、最近记录。
- 阶段标题和日记入口在新标签页打开。
- 桌面显示甘特图；移动断点隐藏预留栏和甘特图，显示阶段时间列表。

- [ ] 8.2 修改首页布局，不改动日记轮播、今日必完成、今日任务和月复盘既有行为。

- [ ] 8.3 实现甘特图为原生 DOM/CSS 网格，不引入图表库；实际日期覆盖层和状态色都使用现有主题变量，`monochrome` 只改变 UI，不对项目图片或日记图片应用灰度滤镜。

- [ ] 8.4 实现阶段细项复选框。点击时先禁用当前控件，调用 repository 写入并复核；成功后刷新模型，失败则恢复 UI 并显示 Notice。

- [ ] 8.5 实现移动阶段列表与可展开详情，确保 44px 最小触控尺寸和无横向溢出。

- [ ] 8.6 运行 JSDOM/字符串边界测试和完整检查。

```powershell
node --test tests/project-ui.test.js tests/ui.test.js tests/production-integration.test.js
python scripts/run_all_checks.py
git add src/main.js styles.css tests/project-ui.test.js tests/ui.test.js tests/production-integration.test.js
git commit -m "feat: render project overview and cockpit"
```

---

## Task 9：实现新建项目两步向导

**Files:**

- Create: `src/project-wizard.js`
- Modify: `src/main.js`
- Modify: `styles.css`
- Modify: `tests/project-wizard.test.js`
- Modify: `tests/project-ui.test.js`

- [ ] 9.1 写失败测试，覆盖基本信息、金额与日期校验、15 阶段默认选中、增删、拖动排序和重复名称拦截。

- [ ] 9.2 实现两步 Modal：第一步项目基本信息，第二步阶段选择/排序；最后一步先显示将创建的 16 个文件摘要。

- [ ] 9.3 提交前再次调用 `validateProjectFilePlan`，只有成功才调用 `ProjectRepository.createProject`。

- [ ] 9.4 创建成功后进入新项目驾驶舱；失败时保留用户输入并显示具体错误，不留下半成品目录。

- [ ] 9.5 验证并提交。

```powershell
node --test tests/project-wizard.test.js tests/project-ui.test.js
python scripts/run_all_checks.py
git add src/project-wizard.js src/main.js styles.css tests/project-wizard.test.js tests/project-ui.test.js
git commit -m "feat: add validated project creation wizard"
```

---

## Task 10：按新模板重建“省地勘局宿舍”

**Files:**

- Create: `tests/project-migration.test.js`
- Modify through Vault API: `F:\Obsidian\07 模板\项目模板.md`
- Create through Vault API: `F:\Obsidian\07 模板\项目阶段模板.md`
- Modify through Vault API: `F:\Obsidian\02 项目\项目索引.md`
- Delete through Vault API: `F:\Obsidian\02 项目\省地勘局宿舍\` old contents
- Create through Vault API: new project homepage and 15 phase notes

- [ ] 10.1 写迁移夹具测试，固定旧 15 阶段的名称、顺序、细项、材料提醒、草案日期与状态映射。

关键断言：

```js
assert.equal(result.stages.length, 15);
assert.equal(result.stages[5].name, '水电暖改造');
assert.equal(result.stages[5].status, '进行中');
assert.equal(result.stages[8].status, '等待');
assert.ok(result.stages.every((stage) => stage.schedule_status === '草案'));
```

- [ ] 10.2 在内存中生成项目主页和 15 个阶段文件，执行 schema、路径、顺序、双链、章节和 Markdown 复选框完整校验。

- [ ] 10.3 人工抽查生成结果中的 06 水电暖改造与 09 瓦工，确认材料提醒和状态正确；在此之前不得删除旧目录。

- [ ] 10.4 在 Obsidian 中通过受限的一次性重建命令调用 Vault API：删除旧项目目录，立即写入已验证的 16 个新文件。若任何写入失败，停止后续写入并报告确切缺失文件；不要用 PowerShell `Remove-Item` 或文件系统脚本删除仓库内容。

- [ ] 10.5 更新项目模板、阶段模板和项目索引。

项目索引查询至少改为：

```dataview
TABLE project_status AS 状态, plan_end AS 计划完成
FROM "02 项目"
WHERE type = "项目"
SORT file.name ASC
```

- [ ] 10.6 在 Obsidian 内抽查新目录只包含主页、`阶段`、可选 `附件`，不再存在甘特图、看板、Components、施工任务总表。

- [ ] 10.7 验证并提交迁移定义；真实仓库内容不提交到插件仓库。

```powershell
node --test tests/project-migration.test.js
python scripts/run_all_checks.py
git add tests/project-migration.test.js src/project-catalog.js
git commit -m "test: lock project rebuild mapping"
```

---

## Task 11：版本、瘦身、安装与真机验收

**Files:**

- Modify: `package.json`
- Modify: `manifest.json`
- Generated: `main.js`
- Install: `F:\Obsidian\.obsidian\plugins\hz-workbench\main.js`
- Install: `F:\Obsidian\.obsidian\plugins\hz-workbench\styles.css`
- Install: `F:\Obsidian\.obsidian\plugins\hz-workbench\manifest.json`
- Preserve: `F:\Obsidian\.obsidian\plugins\hz-workbench\data.json`

- [ ] 11.1 将版本统一提升为 `0.4.0`，更新说明但不改插件 ID。

- [ ] 11.2 运行完整验证并记录测试数量。

```powershell
python scripts/run_all_checks.py
pnpm build
node --check main.js
```

Expected: 全部测试通过，构建退出码 0，产物无 source map、无 API Key、无测试夹具和 `.superpowers` 文件。

- [ ] 11.3 比较安装前后的文件清单，只安装运行必需的 `main.js`、`styles.css`、`manifest.json`、`logo.png`；保留现有 `data.json`，不要覆盖用户设置。

- [ ] 11.4 将安装文件复制到 `F:\Obsidian\.obsidian\plugins\hz-workbench`，在 Obsidian 中重新加载插件。

- [ ] 11.5 Windows 真机验收。

1. 首页日记、今日必完成、今日任务、月复盘无回归。
2. 左侧空白栏存在但无智能体文字，Logo/日期/时间位于顶部。
3. 项目总览正确显示“省地勘局宿舍”的当前阶段、进度、草案排期。
4. 三种甘特范围均可切换，草案不显示延期。
5. 勾选一个阶段细项后 Markdown 精确变化，取消勾选能恢复。
6. 阶段笔记与日记记录在新标签页打开，工作台保留。
7. Cashlog 正确汇总；示例账目可识别，异常账目只提示不崩溃。
8. 新建项目向导在重名时不写入，在有效输入时生成完整结构。

- [ ] 11.6 iPhone/窄屏模拟验收：预留栏和甘特图隐藏，阶段时间列表可展开，页面无横向滚动。

- [ ] 11.7 最终提交。

```powershell
git add package.json manifest.json main.js styles.css src tests
git commit -m "release: hz workbench 0.4.0 project workspace"
git status --short
```

Expected: `git status --short` 无未提交的产品代码和测试改动。

---

## Task 12：交接文档与跨设备同步验证

**Files:**

- Modify through Obsidian: `F:\Obsidian\09 知识库\Hanzhong-codex.md`
- Create: `docs/WINDOWS-PROJECT-WORKSPACE-VALIDATION-2026-09-02.md`

- [ ] 12.1 写验证记录：版本、Git 提交、测试数量、构建哈希、安装文件哈希、真实项目验收结果和已知限制。

- [ ] 12.2 更新交接文档，写清楚项目模型、文件结构、已完成内容、未完成内容、下一步和禁止再踩的坑；重点写明 v0.1.0 旧开发目录不可再用于构建。

- [ ] 12.3 触发 Remotely Save 后，在 Mac/iPhone 确认项目主页、15 个阶段文件和模板均同步；移动端只读打开与复选框写回各测试一次。

- [ ] 12.4 对比 Windows、Mac、iPhone 同一阶段复选框状态，确认没有同步冲突后结束任务。
