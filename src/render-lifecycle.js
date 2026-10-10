class RenderLifecycle {
  constructor() {
    this.active = false;
    this.generation = 0;
    this.preferredPath = '';
  }

  open() {
    this.active = true;
    this.generation += 1;
  }

  close() {
    this.active = false;
    this.generation += 1;
  }

  begin(currentPath = '') {
    if (!this.active) return null;
    if (currentPath) this.preferredPath = currentPath;
    this.generation += 1;
    return { generation: this.generation, preferredPath: this.preferredPath };
  }

  isCurrent(token) {
    return this.active && token?.generation === this.generation;
  }

  commit(token, currentPath = '') {
    if (!this.isCurrent(token)) return false;
    this.preferredPath = currentPath;
    return true;
  }
}

async function runRenderTransaction({ lifecycle, getCurrentPath, load, commit }) {
  const token = lifecycle.begin(getCurrentPath() || '');
  if (!token) return false;

  const data = await load();
  if (!lifecycle.isCurrent(token)) return false;

  const preferredPath = getCurrentPath() || token.preferredPath;
  const committedPath = commit(data, preferredPath) || '';
  return lifecycle.commit(token, committedPath);
}

async function renderSafely(render, reportError) {
  try {
    await render();
    return true;
  } catch (error) {
    try { reportError(error); } catch (_) { /* reporting must not reject background work */ }
    return false;
  }
}

module.exports = { RenderLifecycle, runRenderTransaction, renderSafely };
