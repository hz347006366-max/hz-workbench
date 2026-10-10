const {
  DEFAULT_LAYOUT,
  MODULE_DEFINITIONS,
  cloneLayout,
  layoutConflicts,
  resizeFromPointerDetailed,
  snapMoveDetailed,
  validateLayout,
} = require('./layout-model');

const DRAG_MOVE_LIMIT = 3;
const UNDO_LIMIT = 30;
const CAROUSEL_REASON = 'layout-edit';

function layoutsEqual(first, second) {
  return JSON.stringify(first) === JSON.stringify(second);
}

function knownModule(moduleId) {
  return typeof moduleId === 'string'
    && Object.prototype.hasOwnProperty.call(MODULE_DEFINITIONS, moduleId);
}

class LayoutController {
  constructor({
    initialLayout,
    scheduler,
    save,
    carousel,
    onChange = () => {},
    onNotice = () => {},
  }) {
    this.scheduler = scheduler;
    this.save = save;
    this.carousel = carousel;
    this.onChange = onChange;
    this.onNotice = onNotice;

    this.state = { mode: 'idle', selectedId: '', conflicts: [], guides: [] };
    this.layout = cloneLayout(initialLayout);
    this.entrySnapshot = cloneLayout(initialLayout);
    this.gestureSnapshot = null;
    this.undoStack = [];

    this.gesture = null;
    this.saving = false;
    this.savePromise = null;
    this.editSessionActive = false;
    this.destroyed = false;
  }

  enterEdit(moduleId = '') {
    if (this.destroyed || this.saving || (moduleId && !knownModule(moduleId))) return false;
    if (this.state.mode !== 'idle') return false;

    const entrySnapshot = cloneLayout(this.layout);
    const conflicts = layoutConflicts(this.layout);
    try {
      this.carousel?.pause?.(CAROUSEL_REASON);
    } catch (error) {
      this.state = { mode: 'idle', selectedId: '', conflicts: [], guides: [] };
      this.resumeCarousel();
      this.notify('无法进入布局编辑，请重试');
      this.emitChange();
      return false;
    }

    this.entrySnapshot = entrySnapshot;
    this.gestureSnapshot = null;
    this.gesture = null;
    this.undoStack = [];
    this.state = {
      mode: 'editing',
      selectedId: moduleId,
      conflicts,
      guides: [],
    };
    this.editSessionActive = true;
    this.emitChange();
    return true;
  }

  select(moduleId) {
    if (this.destroyed || this.saving || this.state.mode !== 'editing' || !knownModule(moduleId)) {
      return false;
    }
    if (this.state.selectedId === moduleId) return true;
    this.state = { ...this.state, selectedId: moduleId };
    this.emitChange();
    return true;
  }

  startDrag(moduleId, point) {
    if (this.destroyed || this.saving || this.state.mode !== 'editing' || !knownModule(moduleId)) {
      return false;
    }

    this.select(moduleId);
    this.gestureSnapshot = cloneLayout(this.layout);
    this.gesture = {
      kind: 'drag',
      moduleId,
      startPoint: { x: point.x, y: point.y },
      startStored: { ...this.layout[moduleId] },
      active: false,
    };
    return true;
  }

  startResize(moduleId, point) {
    if (this.destroyed || this.saving || this.state.mode !== 'editing' || !knownModule(moduleId)) {
      return false;
    }

    this.select(moduleId);
    this.gestureSnapshot = cloneLayout(this.layout);
    this.gesture = {
      kind: 'resize',
      moduleId,
      startPoint: { x: point.x, y: point.y },
      startStored: { ...this.layout[moduleId] },
      active: true,
    };
    this.state = { ...this.state, mode: 'resizing' };
    this.emitChange();
    return true;
  }

  pointerMove(point) {
    if (this.destroyed || this.saving) return false;

    if (!this.gesture || !this.gestureSnapshot) return false;
    const delta = {
      dx: point.x - this.gesture.startPoint.x,
      dy: point.y - this.gesture.startPoint.y,
    };

    if (this.gesture.kind === 'drag') {
      if (!this.gesture.active && Math.hypot(delta.dx, delta.dy) <= DRAG_MOVE_LIMIT) return true;
      this.gesture.active = true;
      this.state = { ...this.state, mode: 'dragging' };
      const preview = snapMoveDetailed(
        this.gesture.moduleId,
        {
          ...this.gesture.startStored,
          x: this.gesture.startStored.x + delta.dx,
          y: this.gesture.startStored.y + delta.dy,
        },
        this.gestureSnapshot,
      );
      this.layout[this.gesture.moduleId] = preview.stored;
      this.state = { ...this.state, guides: preview.guides };
    } else {
      const preview = resizeFromPointerDetailed(
        this.gesture.moduleId,
        this.gesture.startStored,
        delta,
        this.gestureSnapshot,
      );
      this.layout[this.gesture.moduleId] = preview.stored;
      this.state = { ...this.state, guides: preview.guides };
    }

    this.state = { ...this.state, conflicts: layoutConflicts(this.layout) };
    this.emitChange();
    return true;
  }

  endGesture() {
    if (this.destroyed) return false;
    if (!this.gesture || !this.gestureSnapshot) return false;

    const changed = !layoutsEqual(this.layout, this.gestureSnapshot);
    if (changed) this.pushUndo(this.gestureSnapshot);
    this.gesture = null;
    this.gestureSnapshot = null;
    this.state = {
      ...this.state,
      mode: 'editing',
      conflicts: layoutConflicts(this.layout),
      guides: [],
    };
    this.emitChange();
    return changed;
  }

  pushUndo(snapshot) {
    this.undoStack.push(cloneLayout(snapshot));
    if (this.undoStack.length > UNDO_LIMIT) {
      this.undoStack.splice(0, this.undoStack.length - UNDO_LIMIT);
    }
  }

  undo() {
    if (this.destroyed || this.saving || this.state.mode !== 'editing' || this.undoStack.length === 0) {
      return false;
    }
    this.layout = cloneLayout(this.undoStack.pop());
    this.state = {
      ...this.state,
      conflicts: layoutConflicts(this.layout),
      guides: [],
    };
    this.emitChange();
    return true;
  }

  restoreDefault() {
    if (this.destroyed || this.saving || this.state.mode !== 'editing') return false;
    this.pushUndo(this.layout);
    this.layout = cloneLayout(DEFAULT_LAYOUT);
    this.state = {
      ...this.state,
      conflicts: layoutConflicts(this.layout),
      guides: [],
    };
    this.emitChange();
    return true;
  }

  exitEdit({ restoreEntry = false, emit = true } = {}) {
    if (!this.editSessionActive) return false;
    if (restoreEntry) this.layout = cloneLayout(this.entrySnapshot);
    this.gesture = null;
    this.gestureSnapshot = null;
    this.undoStack = [];
    this.saving = false;
    this.state = { mode: 'idle', selectedId: '', conflicts: [], guides: [] };
    this.editSessionActive = false;
    this.resumeCarousel();
    if (emit) this.emitChange();
    return true;
  }

  cancelAndExit() {
    if (this.destroyed || this.saving) return false;
    return this.exitEdit({ restoreEntry: true });
  }

  saveAndExit() {
    if (this.destroyed) return Promise.resolve(false);
    if (this.savePromise) return this.savePromise;
    if (this.state.mode !== 'editing') return Promise.resolve(false);

    const validation = validateLayout(this.layout);
    if (validation.repaired.length > 0) {
      this.state = { ...this.state, guides: [] };
      this.emitChange();
      this.notify('布局数据无效，无法保存');
      return Promise.resolve(false);
    }

    const conflicts = layoutConflicts(validation.layout);
    this.state = { ...this.state, conflicts, guides: [] };
    if (conflicts.length > 0) {
      this.emitChange();
      this.notify('存在重叠，无法保存');
      return Promise.resolve(false);
    }

    const snapshot = cloneLayout(validation.layout);
    this.saving = true;
    this.emitChange();

    let result;
    try {
      result = this.save(snapshot);
    } catch (error) {
      result = Promise.reject(error);
    }

    const operation = Promise.resolve(result)
      .then(
        () => {
          if (this.destroyed) return false;
          this.saving = false;
          this.notify('布局已保存到当前设备');
          this.exitEdit();
          return true;
        },
        () => {
          if (this.destroyed) return false;
          this.saving = false;
          this.notify('布局保存失败，请重试或取消');
          this.emitChange();
          return false;
        },
      )
      .finally(() => {
        if (this.savePromise === operation) this.savePromise = null;
      });
    this.savePromise = operation;
    return operation;
  }

  handleEscape() {
    return this.cancelAndExit();
  }

  handleWindowInterruption() {
    if (this.destroyed) return false;
    if (!this.gesture || !this.gestureSnapshot) return false;

    this.layout = cloneLayout(this.gestureSnapshot);
    this.gesture = null;
    this.gestureSnapshot = null;
    this.state = {
      ...this.state,
      mode: 'editing',
      conflicts: layoutConflicts(this.layout),
      guides: [],
    };
    this.emitChange();
    return true;
  }

  emitChange() {
    if (this.destroyed) return;
    const state = {
      ...this.state,
      conflicts: [...this.state.conflicts],
      guides: this.state.guides.map((guide) => ({ ...guide })),
      canUndo: this.undoStack.length > 0,
      saving: this.saving,
    };
    const layout = cloneLayout(this.layout);
    try {
      this.onChange(state, layout);
    } catch (error) {
      // View callbacks are best-effort and must not corrupt controller state.
    }
  }

  notify(message) {
    try {
      this.onNotice(message);
    } catch (error) {
      // Notice rendering is best-effort and independent from persistence.
    }
  }

  resumeCarousel() {
    try {
      this.carousel?.resume?.(CAROUSEL_REASON);
    } catch (error) {
      // Session state still closes even if a view-side resume callback fails.
    }
  }

  destroy() {
    if (this.destroyed) return;
    if (this.gesture && this.gestureSnapshot) this.layout = cloneLayout(this.gestureSnapshot);
    this.gesture = null;
    this.gestureSnapshot = null;
    this.state = { mode: 'idle', selectedId: '', conflicts: [], guides: [] };
    if (this.editSessionActive) {
      this.editSessionActive = false;
      this.resumeCarousel();
    }
    this.destroyed = true;
    this.scheduler = null;
    this.save = null;
    this.carousel = null;
    this.onChange = () => {};
    this.onNotice = () => {};
    this.entrySnapshot = null;
    this.undoStack = [];
  }
}

module.exports = { LayoutController };
