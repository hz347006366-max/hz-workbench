const {
  normalizeList,
  dateKey,
  parseCaptureDate,
  combineCaptureDateTime,
} = require('./daily-capture-model');
const { applyModalTheme, resolveScheme } = require('./theme');

const CAPTURE_ACTIONS = ['photo', 'start-time', 'finish-time', 'manual-time', 'quick-note', 'finance', 'meditation', 'open-today'];
const DEFAULT_TIME_CATEGORIES = '工作,学习,沟通,生活,运动,通勤,休息,娱乐,其他';
const DEFAULT_EXPENSE_CATEGORIES = '餐饮,交通,购物,居住,医疗,娱乐,学习,项目,其他';
const DEFAULT_INCOME_CATEGORIES = '工资,设计费,报销,奖金,其他';

function listSetting(value, fallback) {
  const items = normalizeList(Array.isArray(value) ? value.join(',') : value);
  return (items.length ? items : normalizeList(fallback)).join(',');
}

function normalizeCaptureSettings(settings = {}) {
  const maxEdge = Number(settings.dailyPhotoMaxEdge ?? 2048);
  const quality = Number(settings.dailyPhotoQuality ?? 0.85);
  return {
    ...settings,
    dailyPhotoFolder: String(settings.dailyPhotoFolder || '06 附件/日记照片').trim(),
    dailyTemplatePath: String(settings.dailyTemplatePath || '07 模板/每日模板.md').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''),
    dailyPhotoMaxEdge: Math.min(4096, Math.max(640, Number.isFinite(maxEdge) ? Math.round(maxEdge) : 2048)),
    dailyPhotoQuality: Math.min(1, Math.max(0.1, Number.isFinite(quality) ? quality : 0.85)),
    timeCategories: listSetting(settings.timeCategories, DEFAULT_TIME_CATEGORIES),
    expenseCategories: listSetting(settings.expenseCategories, DEFAULT_EXPENSE_CATEGORIES),
    incomeCategories: listSetting(settings.incomeCategories, DEFAULT_INCOME_CATEGORIES),
    currencySymbol: String(settings.currencySymbol || '¥').trim() || '¥',
    openDailyAfterCapture: Boolean(settings.openDailyAfterCapture),
    activeTimer: settings.activeTimer ? { ...settings.activeTimer } : null,
  };
}

function protocolCaptureTime(params = {}) {
  const date = String(params.date || '').trim();
  const time = String(params.time || '').trim();
  if (!date && !time) return null;
  if (!date || !time) throw new Error('记录日期和时间必须同时提供');
  return combineCaptureDateTime(date, time);
}

async function routeCaptureAction(action, params = {}, { service, openModal }) {
  if (action === 'quick-note') {
    const text = String(params.text || '').trim();
    if (!text) throw new Error('随手记内容不能为空');
    const at = protocolCaptureTime(params);
    return at ? service.appendQuickNote(text, at) : service.appendQuickNote(text);
  }
  if (action === 'finish-time') return service.finishTimer();
  if (action === 'open-today') return service.openToday();
  if (['photo', 'start-time', 'manual-time', 'finance', 'meditation'].includes(action)) return openModal(action);
  throw new Error(`未知的记录动作：${action}`);
}

async function decodeImage(file, windowRef) {
  try {
    if (typeof windowRef.createImageBitmap === 'function') return await windowRef.createImageBitmap(file);
  } catch (_) { /* use the more compatible image-element decoder below */ }
  if (!windowRef.Image || !windowRef.URL?.createObjectURL) {
    throw new Error('图片无法解码，请改用 JPG 或 PNG 格式');
  }
  const objectUrl = windowRef.URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const candidate = new windowRef.Image();
      candidate.onload = () => resolve(candidate);
      candidate.onerror = () => reject(new Error('图片格式无法解码，请改用 JPG 或 PNG，或将 iPhone 相机格式设为“兼容性最佳”'));
      candidate.src = objectUrl;
    });
    image.close = () => windowRef.URL.revokeObjectURL(objectUrl);
    return image;
  } catch (error) {
    windowRef.URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

async function compressImageToJpeg(file, { maxEdge = 2048, quality = 0.85, windowRef = globalThis } = {}) {
  if (!file) throw new Error('请选择一张照片');
  const bitmap = await decodeImage(file, windowRef);
  const sourceWidth = bitmap.naturalWidth || bitmap.width;
  const sourceHeight = bitmap.naturalHeight || bitmap.height;
  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
  const canvas = windowRef.document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((resolve, reject) => canvas.toBlob(
    (result) => (result ? resolve(result) : reject(new Error('照片压缩失败'))),
    'image/jpeg', quality,
  ));
  return blob.arrayBuffer();
}

function createField(contentEl, label, type = 'text') {
  const wrapper = contentEl.createDiv({ cls: 'hz-daily-capture-field' });
  wrapper.createEl('label', { text: label });
  if (type === 'textarea') return wrapper.createEl('textarea');
  return wrapper.createEl(type === 'select' ? 'select' : 'input', type === 'select' ? {} : { attr: { type } });
}

function addOptions(select, values) {
  normalizeList(values).forEach((value) => select.createEl('option', { text: value, attr: { value } }));
}

function localInputValue(date) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 16);
}

function localTimeValue(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function parseLocalDateTimeInput(value) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(String(value || ''));
  if (!match) throw new Error('时间无效');
  return combineCaptureDateTime(match[1], match[2]);
}

function targetTimeDefaults(targetDate, now = new Date()) {
  let endMinutes = now.getHours() * 60 + now.getMinutes();
  if (endMinutes < 1) endMinutes = 60;
  const value = (minutes) => `${targetDate}T${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  return { start: value(Math.max(0, endMinutes - 60)), end: value(endMinutes) };
}

function createTargetFields(contentEl, { action, now, journalTarget }) {
  const group = contentEl.createDiv({ cls: 'hz-daily-capture-target' });
  if (action === 'manual-time') {
    const start = createField(group, '开始时间', 'datetime-local');
    const end = createField(group, '结束时间', 'datetime-local');
    const defaults = journalTarget ? targetTimeDefaults(journalTarget.date, now) : {
      start: localInputValue(new Date(now.getTime() - 3600000)),
      end: localInputValue(now),
    };
    start.value = defaults.start;
    end.value = defaults.end;
    const maximum = journalTarget
      ? `${journalTarget.date}T23:59`
      : localInputValue(now);
    start.max = maximum;
    end.max = maximum;
    if (journalTarget) {
      start.min = `${journalTarget.date}T00:00`;
      end.min = `${journalTarget.date}T00:00`;
    }
    return { start, end };
  }

  const date = createField(group, '记录日期', 'date');
  date.value = journalTarget?.date || dateKey(now);
  date.max = dateKey(now);
  date.disabled = Boolean(journalTarget);
  const fields = { date };
  if (['photo', 'quick-note', 'finance', 'meditation'].includes(action)) {
    const time = createField(group, '记录时间', 'time');
    time.value = localTimeValue(now);
    fields.time = time;
  }
  return fields;
}

function freezeCaptureTarget(action, fields, journalTarget) {
  if (action === 'manual-time') {
    const start = parseLocalDateTimeInput(fields.start.value);
    const end = parseLocalDateTimeInput(fields.end.value);
    return Object.freeze({ startMs: start.getTime(), endMs: end.getTime() });
  }
  const selectedDate = journalTarget?.date || fields.date.value;
  const at = fields.time
    ? combineCaptureDateTime(selectedDate, fields.time.value)
    : parseCaptureDate(selectedDate);
  return Object.freeze({ atMs: at.getTime() });
}

function choosePhotoConflict(contentEl) {
  return new Promise((resolve) => {
    contentEl.querySelector('.hz-daily-photo-conflict')?.remove();
    const panel = contentEl.createDiv({ cls: 'hz-daily-photo-conflict' });
    panel.createEl('p', { text: '该日期已有照片，请选择保存方式。' });
    const actions = panel.createDiv({ cls: 'hz-daily-photo-conflict-actions' });
    for (const [label, value] of [['替换', 'replace'], ['新增', 'append'], ['取消', null]]) {
      const button = actions.createEl('button', { text: label, attr: { type: 'button' } });
      button.addEventListener('click', () => {
        panel.remove();
        resolve(value);
      }, { once: true });
    }
  });
}

function openDailyCaptureModal(plugin, action, service, {
  Modal,
  Notice,
  windowRef = globalThis,
  target = null,
  now = () => new Date(),
  compressImage = compressImageToJpeg,
} = {}) {
  const journalTarget = target ? Object.freeze({ path: String(target.path), date: String(target.date) }) : null;
  class DailyCaptureModal extends Modal {
    onOpen() {
      this.captureActive = true;
      this.contentEl.empty();
      this.contentEl.addClass('hz-daily-capture-modal');
      const theme = String(plugin.settings.theme || 'emerald');
      const scheme = plugin.settings.themeFollowsScheme ? resolveScheme(globalThis.document) : '';
      applyModalTheme(this, theme, scheme);
      this.contentEl.addClass(`hz-theme-${/^[a-z0-9-]+$/.test(theme) ? theme : 'emerald'}`);
      this.contentEl.createEl('h2', { text: journalTarget ? `补记 ${journalTarget.date}` : action ? '记录今日' : '记录今日 · 选择内容' });
      if (!action) return this.renderHub();
      return this.renderForm();
    }

    onClose() {
      this.captureActive = false;
    }

    renderHub() {
      const labels = {
        photo: '今日照片', 'start-time': '开始计时', 'finish-time': '结束当前计时',
        'manual-time': '补记时间', 'quick-note': '随手记', finance: '记录收支', meditation: '每日冥想', 'open-today': '打开今日日记',
      };
      CAPTURE_ACTIONS.forEach((value) => {
        const button = this.contentEl.createEl('button', { text: labels[value], cls: 'hz-daily-capture-action' });
        button.addEventListener('click', async () => {
          this.close();
          if (['finish-time', 'open-today'].includes(value)) await plugin.handleDailyCapture({ action: value });
          else openDailyCaptureModal(plugin, value, service, { Modal, Notice, windowRef, now, compressImage });
        });
      });
    }

    renderForm() {
      const form = this.contentEl.createEl('form');
      const fields = {};
      const openedAt = now();
      if (['photo', 'quick-note', 'finance', 'meditation', 'manual-time'].includes(action)) {
        Object.assign(fields, createTargetFields(form, { action, now: openedAt, journalTarget }));
      }
      if (fields.time) {
        const nowButton = form.createEl('button', { text: '现在', cls: 'hz-daily-capture-now', attr: { type: 'button' } });
        nowButton.addEventListener('click', () => { fields.time.value = localTimeValue(now()); });
      }
      if (action === 'photo') fields.file = createField(form, '从相册选择照片', 'file');
      if (action === 'start-time' || action === 'manual-time') {
        fields.category = createField(form, '分类', 'select'); addOptions(fields.category, plugin.settings.timeCategories);
        fields.title = createField(form, '事项');
        fields.project = createField(form, '项目（可选）');
      }
      if (action === 'quick-note') fields.text = createField(form, '想法');
      if (action === 'meditation') fields.text = createField(form, '今天最值得留下的一句话', 'textarea');
      if (action === 'finance') {
        fields.type = createField(form, '类型', 'select'); addOptions(fields.type, '支出,收入');
        fields.category = createField(form, '分类', 'select'); addOptions(fields.category, plugin.settings.expenseCategories);
        fields.title = createField(form, '事项');
        fields.amount = createField(form, '金额', 'number'); fields.amount.step = '0.01'; fields.amount.min = '0.01';
        fields.project = createField(form, '项目（可选）');
        fields.type.addEventListener('change', () => {
          fields.category.empty(); addOptions(fields.category, fields.type.value === '收入' ? plugin.settings.incomeCategories : plugin.settings.expenseCategories);
        });
      }
      if (fields.file) fields.file.accept = 'image/*';
      const submit = form.createEl('button', { text: '保存', cls: 'mod-cta hz-daily-capture-action', attr: { type: 'submit' } });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (submit.disabled) return;
        submit.disabled = true;
        try {
          const captured = ['photo', 'quick-note', 'finance', 'meditation', 'manual-time'].includes(action)
            ? freezeCaptureTarget(action, fields, journalTarget)
            : null;
          if (action === 'photo') {
            const at = new Date(captured.atMs);
            const selectedFile = fields.file.files?.[0];
            const exists = journalTarget
              ? await service.photoExistsForJournal(journalTarget, at)
              : await service.photoExists(at);
            if (!this.captureActive) return;
            const mode = exists ? await choosePhotoConflict(form) : 'create';
            if (!this.captureActive) return;
            if (!mode) { submit.disabled = false; return; }
            const binary = await compressImage(selectedFile, { maxEdge: plugin.settings.dailyPhotoMaxEdge, quality: plugin.settings.dailyPhotoQuality, windowRef });
            if (!this.captureActive) return;
            if (journalTarget) {
              if (mode === 'append') await service.appendPhotoForJournal(binary, journalTarget, at);
              else if (mode === 'replace') await service.replacePhotoForJournal(binary, journalTarget, at);
              else await service.createPhotoForJournal(binary, journalTarget, at);
            } else if (mode === 'append') await service.appendPhoto(binary, new Date(captured.atMs));
            else if (mode === 'replace') await service.replacePhoto(binary, new Date(captured.atMs));
            else await service.createPhoto(binary, new Date(captured.atMs));
          } else if (action === 'start-time') await service.startTimer({ category: fields.category.value, title: fields.title.value, project: fields.project.value });
          else if (action === 'manual-time') {
            const input = { category: fields.category.value, title: fields.title.value, project: fields.project.value, start: new Date(captured.startMs), end: new Date(captured.endMs) };
            if (journalTarget) await service.addManualTimeForJournal(input, journalTarget);
            else await service.addManualTime(input);
          }
          else if (action === 'quick-note') {
            const at = new Date(captured.atMs);
            if (journalTarget) await service.appendQuickNoteForJournal(fields.text.value, at, journalTarget);
            else await service.appendQuickNote(fields.text.value, at);
          }
          else if (action === 'meditation') {
            const at = new Date(captured.atMs);
            if (journalTarget) await service.setMeditationForJournal(fields.text.value, at, journalTarget);
            else await service.setMeditation(fields.text.value, at);
          }
          else if (action === 'finance') {
            const input = { type: fields.type.value, category: fields.category.value, title: fields.title.value, amount: Number(fields.amount.value), project: fields.project.value, at: new Date(captured.atMs) };
            if (journalTarget) await service.addFinanceForJournal(input, journalTarget);
            else await service.addFinance(input);
          }
          const selectedDate = journalTarget?.date
            || (captured?.atMs != null ? dateKey(new Date(captured.atMs))
              : captured?.startMs != null ? dateKey(new Date(captured.startMs)) : dateKey(openedAt));
          new Notice(`已写入 ${selectedDate} 日记`); this.close();
          if (plugin.settings.openDailyAfterCapture) {
            if (journalTarget) await service.openJournalTarget(journalTarget);
            else await service.openJournalDate(selectedDate);
          }
        } catch (error) {
          new Notice(`记录失败：${error.message}`); submit.disabled = false;
        }
      });
    }
  }
  new DailyCaptureModal(plugin.app).open();
}

module.exports = { CAPTURE_ACTIONS, normalizeCaptureSettings, routeCaptureAction, compressImageToJpeg, openDailyCaptureModal };
