const { formatChineseDate, monthlyReviewBasenames } = require('./month-context');

function normalizeFolder(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function currentMonthKey(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

function monthlyReviewPaths(dailyFolder, now = new Date()) {
  const month = currentMonthKey(now);
  const [year, monthNumber] = month.split('-');
  const folder = `${normalizeFolder(dailyFolder)}/${year}年/${Number(monthNumber)}月`;
  const names = monthlyReviewBasenames(month);
  return {
    month,
    folder,
    preferred: `${folder}/${names.preferred}.md`,
    legacy: `${folder}/${names.legacy}.md`,
  };
}

function isCurrentMonthDailyFile(file, dailyFolder, now = new Date()) {
  if (String(file?.extension || '').toLowerCase() !== 'md') return false;
  const paths = monthlyReviewPaths(dailyFolder, now);
  const path = String(file?.path || '').replace(/\\/g, '/');
  if (!path.startsWith(`${paths.folder}/`)) return false;
  if (path.slice(paths.folder.length + 1).includes('/')) return false;
  const basename = String(file?.basename || '');
  const match = /^(\d{4})年-(\d{2})-(\d{2})-星期[日一二三四五六]$/.exec(basename);
  if (!match) return false;
  const dateKey = `${match[1]}-${match[2]}-${match[3]}`;
  return dateKey.startsWith(`${paths.month}-`) && formatChineseDate(dateKey) === basename;
}

class MonthlyReviewEnsurer {
  constructor({ vault, dailyFolder, enabled, render, onCreated, onError, isActive }) {
    Object.assign(this, { vault, dailyFolder, enabled, render, onCreated, onError, isActive });
    this.active = true;
    this.inFlight = null;
  }

  async handleCreate(file, now = new Date()) {
    if (!isCurrentMonthDailyFile(file, this.dailyFolder(), now)) return false;
    return this.ensure(now);
  }

  ensure(now = new Date()) {
    if (!this.active || !this.isActive() || !this.enabled()) return Promise.resolve(false);
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.runEnsure(now).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  async runEnsure(now) {
    const dailyFolder = this.dailyFolder();
    const paths = monthlyReviewPaths(dailyFolder, now);
    const files = this.vault.getMarkdownFiles();
    if (!files.some((file) => isCurrentMonthDailyFile(file, dailyFolder, now))) return false;
    if (this.vault.getAbstractFileByPath(paths.preferred) || this.vault.getAbstractFileByPath(paths.legacy)) return false;
    if (!this.active || !this.isActive() || !this.enabled()) return false;
    try {
      if (this.vault.getAbstractFileByPath(paths.preferred)) return false;
      const basename = paths.preferred.split('/').pop().replace(/\.md$/i, '');
      await this.vault.create(paths.preferred, this.render(basename));
      if (this.active && this.isActive()) this.onCreated(paths.month);
      return true;
    } catch (error) {
      if (this.vault.getAbstractFileByPath(paths.preferred)) return false;
      if (this.active && this.isActive()) this.onError(error);
      return false;
    }
  }

  destroy() {
    this.active = false;
  }
}

module.exports = {
  currentMonthKey,
  monthlyReviewPaths,
  isCurrentMonthDailyFile,
  MonthlyReviewEnsurer,
};
