const { normalizeTickTickTask } = require('./ticktick-read-model');

class TickTickReadAdapter {
  constructor(app) {
    this.app = app;
  }

  async loadTasks() {
    let plugin;
    try {
      plugin = this.app?.plugins?.getPlugin?.('tickticksync');
    } catch (error) {
      return this.unavailable(error);
    }

    if (!plugin) return this.unavailable('TickTickSync is unavailable');

    const repository = plugin.taskRepository;
    if (!repository || typeof repository.loadAllTasks !== 'function') {
      return this.unavailable('TickTickSync task repository is unavailable');
    }

    try {
      const rawTasks = await repository.loadAllTasks();
      const tasks = Array.isArray(rawTasks)
        ? rawTasks.map(normalizeTickTickTask).filter(Boolean)
        : [];
      return { tasks, available: true, reason: null };
    } catch (error) {
      return this.unavailable(error);
    }
  }

  unavailable(reason) {
    return {
      tasks: [],
      available: false,
      reason: reason instanceof Error ? reason.message : String(reason),
    };
  }
}

module.exports = { TickTickReadAdapter };
