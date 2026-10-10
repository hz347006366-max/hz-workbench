const { normalizeProject, normalizeStage } = require('./project-schema');
const {
  parseChecklistSection,
  parseStageDetails,
  setChecklistItemChecked,
  updateStageFrontmatterAfterChecklist,
  summarizeProjectCashlog,
  extractLinkedJournalParagraphs,
} = require('./project-markdown');
const {
  calculateStageProgress,
  calculateProjectProgress,
  selectCurrentStage,
  reconcileStageCompletion,
} = require('./project-metrics');
const { buildProjectFilePlan, validateProjectFilePlan } = require('./project-template');

function normalizedPath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '');
}

function isMarkdownFile(file) {
  return !!file && (file.extension === 'md' || String(file.path || '').endsWith('.md'));
}

function isDirectChildPath(path, folder) {
  const value = normalizedPath(path);
  const parent = normalizedPath(folder);
  return value.startsWith(`${parent}/`) && value.slice(parent.length + 1).split('/').length === 1;
}

function pathInside(path, folder) {
  const value = normalizedPath(path);
  const parent = normalizedPath(folder);
  return parent !== '' && value.startsWith(`${parent}/`);
}

function frontmatterValue(markdown, field) {
  if (typeof markdown !== 'string' || !markdown.startsWith('---')) return '';
  const lines = markdown.split(/\r?\n/);
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] === '---' || lines[index] === '...') break;
    const match = lines[index].match(new RegExp(`^${field}:\\s*(.*)$`));
    if (!match) continue;
    const value = match[1].trim();
    if (value.startsWith('"')) {
      try { return JSON.parse(value); } catch (error) { return value.slice(1, -1); }
    }
    return value;
  }
  return '';
}

function diagnostic(file, error) {
  return {
    filePath: file?.path || '',
    message: `无法读取项目文件 ${file?.path || '未知路径'}：${error.message || error}`,
  };
}

function dateValue(frontmatter, file) {
  for (const field of ['date', 'day', 'created']) {
    const value = frontmatter?.[field];
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  }
  const match = String(file?.basename || '').match(/^(\d{4}-\d{2}-\d{2})$/);
  return match ? match[1] : '';
}

class ProjectRepository {
  constructor(app, settings) {
    if (!app?.vault || !app?.metadataCache) throw new Error('项目仓储需要 Obsidian Vault 与 metadataCache');
    this.app = app;
    this.vault = app.vault;
    this.metadataCache = app.metadataCache;
    this.settings = settings || {};
  }

  markdownFilesIn(folder) {
    return this.vault.getMarkdownFiles().filter((file) => pathInside(file.path, folder));
  }

  frontmatter(file) {
    return this.metadataCache.getFileCache(file)?.frontmatter || {};
  }

  async listProjects() {
    const projects = [];
    const diagnostics = [];
    for (const file of this.markdownFilesIn(this.settings.projectFolder)) {
      try {
        const frontmatter = this.frontmatter(file);
        if (frontmatter.type !== '项目') continue;
        projects.push({ file, ...normalizeProject(frontmatter) });
      } catch (error) {
        diagnostics.push(diagnostic(file, error));
      }
    }
    projects.sort((left, right) => left.file.basename.localeCompare(right.file.basename, 'zh-Hans-CN'));
    return { projects, diagnostics };
  }

  async loadProject(projectFile) {
    const diagnostics = [];
    let projectFrontmatter;
    try {
      projectFrontmatter = this.frontmatter(projectFile);
    } catch (error) {
      throw new Error(`无法读取项目主页：${error.message || error}`);
    }
    if (projectFrontmatter.type !== '项目' || !projectFrontmatter.project_id) {
      throw new Error('项目主页缺少 type: 项目 或 project_id');
    }
    const stages = [];
    for (const file of this.markdownFilesIn(this.settings.projectFolder)) {
      try {
        const frontmatter = this.frontmatter(file);
        if (frontmatter.type !== '项目阶段' || frontmatter.project_id !== projectFrontmatter.project_id) continue;
        const markdown = await this.vault.read(file);
        const checklist = parseChecklistSection(markdown);
        if (!checklist.found) {
          diagnostics.push({ filePath: file.path, message: `阶段文件缺少“细项清单”：${file.path}` });
          continue;
        }
        stages.push({
          file,
          ...normalizeStage(frontmatter),
          items: checklist.items,
          ...parseStageDetails(markdown),
          progress: calculateStageProgress(checklist.items),
          valid: true,
        });
      } catch (error) {
        diagnostics.push(diagnostic(file, error));
      }
    }
    stages.sort((left, right) => left.order - right.order || left.file.path.localeCompare(right.file.path));
    const project = { file: projectFile, ...normalizeProject(projectFrontmatter) };
    return {
      project,
      stages,
      progress: calculateProjectProgress(stages),
      currentStage: selectCurrentStage(stages),
      diagnostics,
    };
  }

  async toggleStageItem(stageFile, itemIndex, checked, today) {
    if (!isMarkdownFile(stageFile) || !pathInside(stageFile.path, this.settings.projectFolder)) {
      throw new Error('阶段文件必须是严格位于项目目录下的 Markdown 文件');
    }
    const original = await this.vault.read(stageFile);
    let markdown;
    let checklist;
    try {
      markdown = setChecklistItemChecked(original, { index: itemIndex, checked });
      checklist = parseChecklistSection(markdown);
    } catch (error) {
      throw new Error(`无法更新阶段清单：${error.message || error}`);
    }
    const progress = calculateStageProgress(checklist.items);
    let completion;
    try {
      completion = reconcileStageCompletion({
        status: frontmatterValue(original, 'status'),
        actualEnd: frontmatterValue(original, 'actual_end'),
        progress,
      }, today);
    } catch (error) {
      throw new Error(`无法计算阶段完成状态：${error.message || error}`);
    }
    markdown = updateStageFrontmatterAfterChecklist(markdown, completion);
    await this.vault.modify(stageFile, markdown);
    const verified = await this.vault.read(stageFile);
    const verifiedChecklist = parseChecklistSection(verified);
    const verifiedItem = verifiedChecklist.items[itemIndex];
    const verifiedStatus = frontmatterValue(verified, 'status');
    const verifiedActualEnd = frontmatterValue(verified, 'actual_end');
    if (!verifiedItem || verifiedItem.checked !== checked
      || verifiedStatus !== completion.status || verifiedActualEnd !== completion.actualEnd) {
      throw new Error('阶段写后核对失败：Vault 返回的内容与请求不一致');
    }
    return {
      markdown: verified,
      progress: calculateStageProgress(verifiedChecklist.items),
      status: verifiedStatus,
      actualEnd: verifiedActualEnd,
    };
  }

  async createProject(draft) {
    const plan = buildProjectFilePlan(draft);
    const existingPaths = (this.vault.getAllLoadedFiles ? this.vault.getAllLoadedFiles() : this.vault.getMarkdownFiles())
      .map((entry) => entry.path);
    const validation = validateProjectFilePlan(plan, { existingPaths });
    if (!validation.valid) throw new Error(`项目创建校验失败：${validation.errors.join('；')}`);
    if (!pathInside(plan.projectFolder, this.settings.projectFolder)) {
      throw new Error('项目创建校验失败：目标目录必须严格位于项目目录下');
    }

    const createdPaths = [];
    const existing = new Set(existingPaths.map(normalizedPath));
    const folders = new Set();
    for (const entry of plan.files) {
      const parts = normalizedPath(entry.path).split('/');
      parts.pop();
      while (parts.length > 0) {
        folders.add(parts.join('/'));
        parts.pop();
      }
    }
    const foldersInOrder = [...folders]
      .filter((folderPath) => pathInside(folderPath, this.settings.projectFolder))
      .sort((left, right) => left.split('/').length - right.split('/').length || left.localeCompare(right));
    try {
      for (const folderPath of foldersInOrder) {
        if (!existing.has(folderPath)) {
          await this.vault.createFolder(folderPath);
          createdPaths.push(folderPath);
          existing.add(folderPath);
        }
      }
      for (const entry of plan.files) {
        await this.vault.create(entry.path, entry.content);
        createdPaths.push(entry.path);
      }
    } catch (error) {
      const rollbackErrors = [];
      for (const createdPath of [...createdPaths].reverse()) {
        try {
          const created = this.vault.getAbstractFileByPath(createdPath);
          if (created) await this.vault.delete(created, true);
        } catch (rollbackError) {
          rollbackErrors.push(`${createdPath}（${rollbackError.message || rollbackError}）`);
        }
      }
      const residualPaths = createdPaths.filter((createdPath) => this.vault.getAbstractFileByPath(createdPath));
      const rollbackMessage = residualPaths.length === 0
        ? '已回滚本次创建内容'
        : `回滚失败：${rollbackErrors.join('、') || '未知错误'}；残留路径：${residualPaths.join('、')}`;
      throw new Error(`项目创建写入失败：${error.message || error}；${rollbackMessage}`);
    }
    return { projectFolder: plan.projectFolder, files: plan.files.map((entry) => entry.path) };
  }

  async deleteProjectFolder(projectFolder) {
    if (typeof projectFolder !== 'string' || projectFolder === '' || projectFolder.includes('\\')
      || /[*?]/.test(projectFolder) || projectFolder === '.' || projectFolder === '..') {
      throw new Error('删除项目目录的路径不安全');
    }
    const root = normalizedPath(this.settings.projectFolder);
    const targetPath = normalizedPath(projectFolder);
    if (!isDirectChildPath(targetPath, root) || targetPath.split('/').some((part) => part === '.' || part === '..')) {
      throw new Error('删除目标必须是项目目录下的单个项目目录');
    }
    const target = this.vault.getAbstractFileByPath(targetPath);
    if (!target || !Array.isArray(target.children) || isMarkdownFile(target)) {
      throw new Error('删除目标必须是存在的项目目录');
    }
    await this.vault.delete(target, true);
  }

  async loadProjectFinance(project) {
    const projectTarget = project?.basename || project?.file?.basename;
    if (!projectTarget) throw new Error('无法确定项目主页名称');
    const folder = this.settings.cashlogFolder || this.settings.dailyFolder;
    const lines = [];
    const diagnostics = [];
    for (const file of this.markdownFilesIn(folder)) {
      try {
        lines.push(...(await this.vault.read(file)).split(/\r?\n/));
      } catch (error) {
        diagnostics.push(diagnostic(file, error));
      }
    }
    return { ...summarizeProjectCashlog(lines, projectTarget), diagnostics };
  }

  async loadProjectJournalRecords(project) {
    const projectTarget = project?.basename || project?.file?.basename;
    if (!projectTarget) throw new Error('无法确定项目主页名称');
    const records = [];
    const scheduleFolder = normalizedPath(this.settings.scheduleFolder);
    for (const file of this.markdownFilesIn(this.settings.dailyFolder)) {
      if (pathInside(file.path, scheduleFolder) || normalizedPath(file.path) === scheduleFolder) continue;
      try {
        const frontmatter = this.frontmatter(file);
        const date = dateValue(frontmatter, file);
        records.push(...extractLinkedJournalParagraphs(await this.vault.read(file), projectTarget, {
          date,
          filePath: file.path,
        }));
      } catch (error) {
        // A damaged journal must not hide records from other daily notes.
      }
    }
    return records.sort((left, right) => right.date.localeCompare(left.date) || right.filePath.localeCompare(left.filePath));
  }
}

module.exports = { ProjectRepository };
