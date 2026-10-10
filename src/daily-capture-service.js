const { resolveJournalDate } = require('./journal-date');
const { dailyPath } = require('./core');
const { renderDailyTemplate } = require('./daily-template-renderer');
const { resolveJournalCaptureTarget } = require('./journal-capture-target');
const {
  dateKey,
  readManagedBlock,
  replaceManagedBlock,
  appendManagedLine,
  photoVaultPath,
  formatQuickNote,
  formatTimeEntry,
  parseTimeEntries,
  summarizeTimeEntries,
  splitIntervalByLocalDate,
  formatFinanceEntry,
  parseFinanceEntries,
  summarizeFinanceEntries,
  upsertMeditation,
  assertNotFuture,
  parseCaptureDate,
} = require('./daily-capture-model');

function normalizePath(value) {
  return String(value ?? '').replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '');
}

class DailyCaptureService {
  constructor({ app, settings, saveSettings, now = () => new Date(), sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), isActive = () => true }) {
    this.app = app;
    this.settings = settings;
    this.saveSettings = saveSettings;
    this.now = now;
    this.sleep = sleep;
    this.isActive = isActive;
    this.inFlight = new Map();
    this.mutationInFlight = Promise.resolve();
  }

  journals() {
    const prefix = `${normalizePath(this.settings.dailyFolder)}/`;
    return this.app.vault.getMarkdownFiles().filter((file) => file.path.startsWith(prefix));
  }

  findJournal(targetDate) {
    const journalType = String(this.settings.journalType || '日记').trim() || '日记';
    return this.journals().find((file) => {
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
      if (String(frontmatter.type || '').trim() !== journalType) return false;
      return resolveJournalDate(file, frontmatter) === targetDate;
    }) || null;
  }

  async ensureJournal(date = this.now()) {
    const target = typeof date === 'string' ? date : dateKey(date);
    const file = this.findJournal(target);
    if (file) return file;
    if (this.inFlight.has(target)) return this.inFlight.get(target);
    const operation = this.createJournal(target, date).finally(() => this.inFlight.delete(target));
    this.inFlight.set(target, operation);
    return operation;
  }

  journalDate(target, value) {
    if (value instanceof Date && Number.isFinite(value.getTime()) && dateKey(value) === target) return new Date(value.getTime());
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(target);
    if (!match) throw new Error(`日记日期无效：${target}`);
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
    if (dateKey(date) !== target) throw new Error(`日记日期无效：${target}`);
    return date;
  }

  async createJournal(target, value) {
    const date = this.journalDate(target, value);
    const templatePath = normalizePath(this.settings.dailyTemplatePath || '07 模板/每日模板.md');
    const templateFile = this.app.vault.getAbstractFileByPath(templatePath);
    if (!templateFile) throw new Error(`日记模板不存在：${templatePath}`);
    const template = await this.app.vault.cachedRead(templateFile);
    const rendered = renderDailyTemplate(template, date);
    const targetPath = dailyPath(normalizePath(this.settings.dailyFolder), date);

    const existing = this.findJournal(target);
    if (existing) return existing;
    if (this.app.vault.getAbstractFileByPath(targetPath)) throw new Error(`目标路径已被占用：${targetPath}`);

    await this.ensureFolders(targetPath);
    const repeated = this.findJournal(target);
    if (repeated) return repeated;
    if (this.app.vault.getAbstractFileByPath(targetPath)) throw new Error(`目标路径已被占用：${targetPath}`);

    const created = await this.app.vault.create(targetPath, rendered);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const recognized = this.findJournal(target) || this.app.vault.getAbstractFileByPath(targetPath);
      if (recognized) return recognized;
      await this.sleep(50);
    }
    if (created) return created;
    throw new Error('日记已创建，但 Vault 暂时无法识别该文件');
  }

  async read(file) {
    return this.app.vault.cachedRead(file);
  }

  assertHistoricalCaptureTime(at) {
    return assertNotFuture(at, this.now());
  }

  assertHistoricalCaptureDate(at) {
    if (!(at instanceof Date) || !Number.isFinite(at.getTime())) throw new Error('时间无效');
    return assertNotFuture(new Date(at.getFullYear(), at.getMonth(), at.getDate()), this.now());
  }

  assertHistoricalJournalTarget(target) {
    return assertNotFuture(parseCaptureDate(target?.date), this.now());
  }

  assertHistoricalJournalTimestamp(at, target) {
    if (dateKey(at) !== target.date) throw new Error('补记时间必须全部属于本篇日记同一天');
    return at;
  }

  async appendQuickNote(text, at = this.now()) {
    this.assertHistoricalCaptureTime(at);
    return this.withMutationLock(() => this.appendQuickNoteUnlocked(text, at));
  }

  async appendQuickNoteUnlocked(text, at) {
    const file = await this.ensureJournal(at);
    const source = await this.read(file);
    const candidate = appendManagedLine(source, 'quickNotes', formatQuickNote(text, at));
    await this.app.vault.modify(file, candidate);
    return file;
  }

  async setMeditation(text, at = this.now()) {
    this.assertHistoricalCaptureTime(at);
    return this.withMutationLock(() => this.setMeditationUnlocked(text, at));
  }

  async setMeditationUnlocked(text, at) {
    const file = await this.ensureJournal(at);
    const source = await this.read(file);
    const candidate = upsertMeditation(source, `${text}\n${this.captureTimestampComment('daily-meditation', at)}`);
    await this.app.vault.modify(file, candidate);
    return file;
  }

  async startTimer(input, at = this.now()) {
    if (this.settings.activeTimer) await this.finishTimer(at);
    await this.ensureJournal(at);
    formatTimeEntry({ ...input, start: at, end: new Date(at.getTime() + 60000) });
    this.settings.activeTimer = {
      startedAt: at.toISOString(),
      category: String(input.category).trim(),
      title: String(input.title).trim(),
      project: String(input.project || '').trim(),
    };
    await this.saveSettings();
    return { ...this.settings.activeTimer };
  }

  async finishTimer(at = this.now()) {
    const active = this.settings.activeTimer;
    if (!active) throw new Error('当前没有正在计时的事项');
    const start = new Date(active.startedAt);
    const segments = splitIntervalByLocalDate(start, at);
    await this.addTimeSegments(segments, active);
    this.settings.activeTimer = null;
    await this.saveSettings();
    return segments;
  }

  async addManualTime(input) {
    this.assertHistoricalCaptureTime(input.start);
    this.assertHistoricalCaptureTime(input.end);
    const segments = splitIntervalByLocalDate(input.start, input.end);
    await this.addTimeSegments(segments, input);
    return segments;
  }

  async addTimeSegments(segments, input) {
    return this.withMutationLock(() => this.addTimeSegmentsUnlocked(segments, input));
  }

  async addTimeSegmentsUnlocked(segments, input) {
    const candidates = [];
    for (const segment of segments) {
      const file = await this.ensureJournal(segment.date);
      const source = await this.read(file);
      const entry = formatTimeEntry({ ...input, start: segment.start, end: segment.end });
      const entryLines = [...readManagedBlock(source, 'timeEntries'), entry];
      let candidate = replaceManagedBlock(source, 'timeEntries', entryLines);
      candidate = replaceManagedBlock(candidate, 'timeSummary', summarizeTimeEntries(parseTimeEntries(entryLines)));
      candidates.push({ file, source, candidate });
    }
    await this.commitCandidates(candidates);
  }

  async addFinance(input) {
    const at = input.at || this.now();
    this.assertHistoricalCaptureTime(at);
    return this.withMutationLock(() => this.addFinanceUnlocked(input, at));
  }

  async addFinanceUnlocked(input, at) {
    const file = await this.ensureJournal(at);
    const source = await this.read(file);
    const entry = formatFinanceEntry({ ...input, at, currency: this.settings.currencySymbol || '¥' });
    const entryLines = [...readManagedBlock(source, 'financeEntries'), entry];
    let candidate = replaceManagedBlock(source, 'financeEntries', entryLines);
    candidate = replaceManagedBlock(candidate, 'financeSummary', summarizeFinanceEntries(
      parseFinanceEntries(entryLines, this.settings.currencySymbol || '¥'),
      this.settings.currencySymbol || '¥',
    ));
    await this.app.vault.modify(file, candidate);
    return file;
  }

  resolveExactJournal(target) {
    if (!this.isActive()) throw new Error('插件已停止');
    const file = this.app.vault.getAbstractFileByPath(String(target?.path || ''));
    if (!file) throw new Error('本篇日记已不存在');
    const current = resolveJournalCaptureTarget({
      file,
      frontmatter: this.app.metadataCache.getFileCache(file)?.frontmatter || {},
      dailyFolder: this.settings.dailyFolder,
    });
    if (current.path !== target.path || current.date !== target.date) throw new Error('本篇日记路径或日期已改变');
    return file;
  }

  async appendQuickNoteForJournal(text, at, target) {
    this.assertHistoricalJournalTarget(target);
    this.assertHistoricalJournalTimestamp(at, target);
    this.assertHistoricalCaptureTime(at);
    return this.withMutationLock(() => this.appendQuickNoteForJournalUnlocked(text, at, target));
  }

  async appendQuickNoteForJournalUnlocked(text, at, target) {
    const file = this.resolveExactJournal(target);
    const source = await this.read(file);
    const candidate = appendManagedLine(source, 'quickNotes', formatQuickNote(text, at));
    await this.app.vault.modify(file, candidate);
    return file;
  }

  async setMeditationForJournal(text, at, target) {
    this.assertHistoricalJournalTarget(target);
    this.assertHistoricalJournalTimestamp(at, target);
    this.assertHistoricalCaptureTime(at);
    return this.withMutationLock(() => this.setMeditationForJournalUnlocked(text, at, target));
  }

  async setMeditationForJournalUnlocked(text, at, target) {
    const file = this.resolveExactJournal(target);
    const source = await this.read(file);
    const candidate = upsertMeditation(source, `${text}\n${this.captureTimestampComment('daily-meditation', at)}`);
    await this.app.vault.modify(file, candidate);
    return file;
  }

  async addFinanceForJournal(input, target) {
    this.assertHistoricalJournalTarget(target);
    const at = input.at || this.now();
    this.assertHistoricalJournalTimestamp(at, target);
    this.assertHistoricalCaptureTime(at);
    return this.withMutationLock(() => this.addFinanceForJournalUnlocked(input, target, at));
  }

  async addFinanceForJournalUnlocked(input, target, at) {
    const file = this.resolveExactJournal(target);
    const source = await this.read(file);
    const entry = formatFinanceEntry({ ...input, at, currency: this.settings.currencySymbol || '¥' });
    const entryLines = [...readManagedBlock(source, 'financeEntries'), entry];
    let candidate = replaceManagedBlock(source, 'financeEntries', entryLines);
    candidate = replaceManagedBlock(candidate, 'financeSummary', summarizeFinanceEntries(
      parseFinanceEntries(entryLines, this.settings.currencySymbol || '¥'),
      this.settings.currencySymbol || '¥',
    ));
    await this.app.vault.modify(file, candidate);
    return file;
  }

  async addManualTimeForJournal(input, target) {
    this.assertHistoricalJournalTarget(target);
    const start = input.start instanceof Date ? input.start : new Date(input.start);
    const end = input.end instanceof Date ? input.end : new Date(input.end);
    this.assertHistoricalJournalTimestamp(start, target);
    this.assertHistoricalJournalTimestamp(end, target);
    this.assertHistoricalCaptureTime(start);
    this.assertHistoricalCaptureTime(end);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) throw new Error('补记时间无效');
    return this.withMutationLock(() => this.addManualTimeForJournalUnlocked(input, target, start, end));
  }

  async addManualTimeForJournalUnlocked(input, target, start, end) {
    const file = this.resolveExactJournal(target);
    const source = await this.read(file);
    const entry = formatTimeEntry({ ...input, start, end });
    const entryLines = [...readManagedBlock(source, 'timeEntries'), entry];
    let candidate = replaceManagedBlock(source, 'timeEntries', entryLines);
    candidate = replaceManagedBlock(candidate, 'timeSummary', summarizeTimeEntries(parseTimeEntries(entryLines)));
    await this.app.vault.modify(file, candidate);
    return file;
  }

  async commitCandidates(candidates) {
    const committed = [];
    try {
      for (const item of candidates) {
        await this.app.vault.modify(item.file, item.candidate);
        committed.push(item);
      }
    } catch (error) {
      for (const item of committed.reverse()) {
        try { await this.app.vault.modify(item.file, item.source); } catch (_) { /* best effort rollback */ }
      }
      throw error;
    }
  }

  async ensureFolders(filePath) {
    const adapter = this.app.vault.adapter;
    const parts = normalizePath(filePath).split('/').slice(0, -1);
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!(await adapter.exists(current))) await adapter.mkdir(current);
    }
  }

  photoConflictError() {
    return new Error('照片已存在，请重试并选择保存方式');
  }

  async createPhoto(arrayBuffer, at = this.now()) {
    this.assertPhotoData(arrayBuffer);
    this.assertHistoricalCaptureTime(at);
    const targetDate = dateKey(at);
    return this.withPhotoLock(targetDate, async () => {
      const existing = this.findJournal(targetDate);
      if (await this.photoTargetExists(existing, targetDate)) throw this.photoConflictError();
      const file = existing || await this.ensureJournal(at);
      return this.writePhotoToJournal(arrayBuffer, file, targetDate, 'replace', at);
    });
  }

  async createPhotoForJournal(arrayBuffer, target, at = null) {
    this.assertPhotoData(arrayBuffer);
    this.assertHistoricalJournalTarget(target);
    const capturedAt = at || parseCaptureDate(target.date);
    this.assertHistoricalJournalTimestamp(capturedAt, target);
    this.assertHistoricalCaptureTime(capturedAt);
    return this.withPhotoLock(target.date, async () => {
      const file = this.resolveExactJournal(target);
      if (await this.photoTargetExists(file, target.date)) throw this.photoConflictError();
      return this.writePhotoToJournal(arrayBuffer, file, target.date, 'replace', capturedAt);
    });
  }

  async replacePhoto(arrayBuffer, at = this.now()) {
    this.assertPhotoData(arrayBuffer);
    this.assertHistoricalCaptureTime(at);
    const file = await this.ensureJournal(at);
    const targetDate = dateKey(at);
    return this.withPhotoLock(targetDate, () => this.writePhotoToJournal(arrayBuffer, file, targetDate, 'replace', at));
  }

  async appendPhoto(arrayBuffer, at = this.now()) {
    this.assertPhotoData(arrayBuffer);
    this.assertHistoricalCaptureTime(at);
    const file = await this.ensureJournal(at);
    const targetDate = dateKey(at);
    return this.withPhotoLock(targetDate, () => this.writePhotoToJournal(arrayBuffer, file, targetDate, 'append', at));
  }

  async replacePhotoForJournal(arrayBuffer, target, at = null) {
    this.assertPhotoData(arrayBuffer);
    this.assertHistoricalJournalTarget(target);
    const capturedAt = at || parseCaptureDate(target.date);
    this.assertHistoricalJournalTimestamp(capturedAt, target);
    this.assertHistoricalCaptureTime(capturedAt);
    return this.withPhotoLock(target.date, () => {
      const file = this.resolveExactJournal(target);
      return this.writePhotoToJournal(arrayBuffer, file, target.date, 'replace', capturedAt);
    });
  }

  async appendPhotoForJournal(arrayBuffer, target, at = null) {
    this.assertPhotoData(arrayBuffer);
    this.assertHistoricalJournalTarget(target);
    const capturedAt = at || parseCaptureDate(target.date);
    this.assertHistoricalJournalTimestamp(capturedAt, target);
    this.assertHistoricalCaptureTime(capturedAt);
    return this.withPhotoLock(target.date, () => {
      const file = this.resolveExactJournal(target);
      return this.writePhotoToJournal(arrayBuffer, file, target.date, 'append', capturedAt);
    });
  }

  assertPhotoData(arrayBuffer) {
    if (!(arrayBuffer instanceof ArrayBuffer) || !arrayBuffer.byteLength) throw new Error('照片数据无效');
  }

  async photoExists(at = this.now()) {
    this.assertHistoricalCaptureDate(at);
    const targetDate = dateKey(at);
    const file = this.findJournal(targetDate);
    return this.photoTargetExists(file, targetDate);
  }

  async photoExistsForJournal(target, at = null) {
    this.assertHistoricalJournalTarget(target);
    if (at) {
      this.assertHistoricalJournalTimestamp(at, target);
      this.assertHistoricalCaptureTime(at);
    }
    const file = this.resolveExactJournal(target);
    return this.photoTargetExists(file, target.date);
  }

  async photoTargetExists(file, targetDate) {
    const target = photoVaultPath(this.settings.dailyPhotoFolder, targetDate);
    if (await this.app.vault.adapter.exists(target)) return true;
    if (!file) return false;
    const source = await this.read(file);
    return readManagedBlock(source, 'photo').some((line) => String(line).trim());
  }

  async withPhotoLock(targetDate, operation) {
    return this.withMutationLock(operation);
  }

  async withMutationLock(operation) {
    const previous = this.mutationInFlight;
    const current = previous.catch(() => {}).then(operation);
    this.mutationInFlight = current;
    try {
      return await current;
    } finally {
      if (this.mutationInFlight === current) this.mutationInFlight = Promise.resolve();
    }
  }

  managedPhotoPaths(lines) {
    const paths = new Set();
    for (const line of lines) {
      const text = String(line);
      for (const match of text.matchAll(/!\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) {
        paths.add(match[1].trim().replace(/\\/g, '/'));
      }
      for (const match of text.matchAll(/!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))/g)) {
        paths.add(String(match[1] || match[2]).trim().replace(/\\/g, '/'));
      }
    }
    return paths;
  }

  async appendPhotoPath(target, reservedPaths = new Set()) {
    const extensionIndex = target.toLowerCase().lastIndexOf('.jpg');
    const stem = extensionIndex === target.length - 4 ? target.slice(0, -4) : target;
    for (let suffix = 2; suffix < Number.MAX_SAFE_INTEGER; suffix += 1) {
      const candidate = `${stem}-${suffix}.jpg`;
      if (!reservedPaths.has(candidate) && !(await this.app.vault.adapter.exists(candidate))) return candidate;
    }
    throw new Error('照片文件名已用尽');
  }

  captureTimestampComment(kind, at) {
    return `<!-- hz:${kind}-at:${dateKey(at)}T${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')} -->`;
  }

  async writePhotoToJournal(arrayBuffer, file, targetDate, mode = 'replace', at = parseCaptureDate(targetDate)) {
    if (!['replace', 'append'].includes(mode)) throw new Error('照片保存方式无效');
    const source = await this.read(file);
    const baseTarget = photoVaultPath(this.settings.dailyPhotoFolder, targetDate);
    const existingLines = readManagedBlock(source, 'photo');
    const target = mode === 'append'
      ? await this.appendPhotoPath(baseTarget, this.managedPhotoPaths(existingLines))
      : baseTarget;
    const capturedLines = [this.captureTimestampComment('daily-photo', at), `![[${target}]]`];
    const photoLines = mode === 'append' ? [...existingLines, ...capturedLines] : capturedLines;
    const candidate = replaceManagedBlock(source, 'photo', photoLines);
    const adapter = this.app.vault.adapter;
    await this.ensureFolders(target);
    const existed = await adapter.exists(target);
    const previous = existed && typeof adapter.readBinary === 'function' ? await adapter.readBinary(target) : null;
    await adapter.writeBinary(target, arrayBuffer);
    try {
      await this.app.vault.modify(file, candidate);
    } catch (error) {
      try {
        if (previous) await adapter.writeBinary(target, previous);
        else if (typeof adapter.remove === 'function') await adapter.remove(target);
      } catch (_) { /* best effort rollback */ }
      throw error;
    }
    return { file, path: target };
  }

  async openJournalTarget(target) {
    const file = this.resolveExactJournal(target);
    await this.app.workspace.getLeaf('tab').openFile(file);
    return file;
  }

  async openToday() {
    const at = this.now();
    const existed = Boolean(this.findJournal(dateKey(at)));
    const file = await this.ensureJournal(at);
    if (!this.isActive()) return file;
    try {
      await this.app.workspace.getLeaf('tab').openFile(file);
    } catch (error) {
      const message = existed ? '今日日记打开失败' : '日记已创建，但打开失败';
      const wrapped = new Error(`${message}：${error.message}`);
      wrapped.cause = error;
      throw wrapped;
    }
    return file;
  }

  async openJournalDate(date) {
    const target = typeof date === 'string' ? date : dateKey(date);
    this.assertHistoricalCaptureDate(parseCaptureDate(target));
    const file = await this.ensureJournal(target);
    if (!this.isActive()) return file;
    try {
      await this.app.workspace.getLeaf('tab').openFile(file);
    } catch (error) {
      const wrapped = new Error(`日记打开失败：${error.message}`);
      wrapped.cause = error;
      throw wrapped;
    }
    return file;
  }
}

module.exports = { DailyCaptureService };
