const {
  CANVAS_WIDTH,
  computedRect,
  computeCanvasHeight,
  viewScale,
} = require('./layout-model');

const OWNED_ATTRIBUTE = 'data-layout-view-owned';
const MODULE_SELECTOR = '[data-module-id]';
const EDITING_MODES = new Set(['editing', 'dragging', 'resizing']);

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function isElement(value, windowRef) {
  return Boolean(value && value.nodeType === 1 && value instanceof windowRef.Element);
}

class LayoutView {
  constructor({
    viewport,
    stage,
    canvas,
    controller,
    moduleDefinitions,
    renderIcon = () => {},
    windowRef = window,
  }) {
    this.viewport = viewport;
    this.stage = stage;
    this.canvas = canvas;
    this.controller = controller;
    this.moduleDefinitions = moduleDefinitions;
    this.renderIcon = renderIcon;
    this.windowRef = windowRef;

    this.state = { mode: 'idle', selectedId: '', conflicts: [], guides: [] };
    this.layout = controller?.layout || {};
    this.currentScale = 1;
    this.activePointerId = null;
    this.activeAction = '';
    this.captureTarget = null;
    this.listeners = [];
    this.resizeObserver = null;
    this.lockButton = null;
    this.mounted = false;
    this.destroyed = false;

    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
    this.handlePointerCancel = this.handlePointerCancel.bind(this);
    this.handlePointerOut = this.handlePointerOut.bind(this);
    this.handleLockClick = this.handleLockClick.bind(this);
    this.handleCanvasClick = this.handleCanvasClick.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleBlur = this.handleBlur.bind(this);
    this.handleResize = this.handleResize.bind(this);
  }

  mount() {
    if (this.mounted || this.destroyed) return this;
    this.mounted = true;

    this.mountLockButton();
    this.listen(this.canvas, 'pointerdown', this.handlePointerDown);
    this.listen(this.windowRef, 'pointermove', this.handlePointerMove);
    this.listen(this.windowRef, 'pointerup', this.handlePointerUp);
    this.listen(this.windowRef, 'pointercancel', this.handlePointerCancel);
    this.listen(this.windowRef, 'pointerout', this.handlePointerOut);
    this.listen(this.canvas, 'click', this.handleCanvasClick, true);
    this.listen(this.windowRef, 'keydown', this.handleKeyDown, true);
    this.listen(this.windowRef, 'blur', this.handleBlur);
    this.listen(this.windowRef, 'resize', this.handleResize);

    const ResizeObserverClass = this.windowRef.ResizeObserver;
    if (typeof ResizeObserverClass === 'function') {
      this.resizeObserver = new ResizeObserverClass(() => {
        if (this.destroyed) return;
        this.interruptActiveGesture();
        this.applyViewScale(this.layout);
      });
      this.resizeObserver.observe(this.viewport);
    }

    this.applyLayout(this.layout);
    this.applyViewScale(this.layout);
    return this;
  }

  listen(target, type, listener, options) {
    target.addEventListener(type, listener, options);
    this.listeners.push({ target, type, listener, options });
  }

  mode() {
    return this.controller?.state?.mode || this.state.mode;
  }

  mountLockButton() {
    const button = this.windowRef.document.createElement('button');
    button.type = 'button';
    button.className = 'hz-layout-lock';
    this.listen(button, 'click', this.handleLockClick);
    this.viewport.insertBefore(button, this.stage);
    this.lockButton = button;
    this.updateLockButton();
  }

  handleLockClick() {
    if (this.mode() === 'idle') return this.controller.enterEdit();
    if (this.mode() === 'editing') return this.controller.saveAndExit();
    return false;
  }

  updateLockButton() {
    if (!this.lockButton) return;
    const saving = Boolean(this.controller?.saving);
    const unlocked = this.mode() !== 'idle';
    const state = saving ? 'saving' : unlocked ? 'unlocked' : 'locked';
    this.lockButton.dataset.layoutState = state;
    this.lockButton.disabled = saving;
    this.lockButton.setAttribute('aria-pressed', String(unlocked));
    this.lockButton.setAttribute(
      'aria-label',
      saving ? '正在保存自由布局' : unlocked ? '锁定并保存自由布局' : '解锁自由布局',
    );
    this.lockButton.title = this.lockButton.getAttribute('aria-label');
    this.lockButton.replaceChildren();
    this.renderIcon(this.lockButton, unlocked ? 'lock-open' : 'lock');
  }

  pointFromEvent(event) {
    const rect = this.canvas.getBoundingClientRect();
    const scale = this.currentScale > 0 ? this.currentScale : 1;
    return {
      x: (finite(event.clientX) - finite(rect.left)) / scale,
      y: (finite(event.clientY) - finite(rect.top)) / scale,
    };
  }

  isPrimaryMouse(event) {
    return event.pointerType === 'mouse'
      && event.button === 0
      && !event.altKey
      && !event.ctrlKey
      && !event.metaKey
      && !event.shiftKey;
  }

  handlePointerDown(event) {
    if (this.destroyed || !this.isPrimaryMouse(event)) return;
    const target = event.target;
    if (!isElement(target, this.windowRef)) return;
    const module = target.closest(MODULE_SELECTOR);
    if (!module || !this.canvas.contains(module)) return;

    const point = this.pointFromEvent(event);
    const moduleId = module.dataset.moduleId;
    const mode = this.mode();
    let started = false;
    let action = '';

    if (EDITING_MODES.has(mode)) {
      if (target.closest('.hz-resize-handle')) {
        started = this.controller.startResize(moduleId, point) !== false;
      } else {
        started = this.controller.startDrag(moduleId, point) !== false;
      }
      action = 'gesture';
    }

    if (!started) return;
    event.preventDefault();
    this.activePointerId = event.pointerId;
    this.activeAction = action;
    if (action === 'gesture') {
      this.captureTarget = module;
      try {
        module.setPointerCapture?.(event.pointerId);
      } catch (error) {
        // Pointer capture is a convenience; window listeners still finish the gesture.
      }
    }
  }

  matchesActivePointer(event) {
    return this.activePointerId !== null
      && (event.pointerId === undefined || event.pointerId === this.activePointerId);
  }

  handlePointerMove(event) {
    if (this.destroyed || !this.matchesActivePointer(event)) return;
    const point = this.pointFromEvent(event);
    this.controller.pointerMove(point);
    event.preventDefault?.();
  }

  handlePointerUp(event) {
    if (this.destroyed || !this.matchesActivePointer(event)) return;
    this.controller.endGesture();
    this.releasePointer(event.pointerId);
  }

  handlePointerCancel(event) {
    if (this.destroyed || !this.matchesActivePointer(event)) return;
    this.controller.handleWindowInterruption();
    this.releasePointer(event.pointerId);
  }

  handlePointerOut(event) {
    if (this.destroyed || event.relatedTarget != null || !this.matchesActivePointer(event)) return;
    this.controller.handleWindowInterruption();
    this.releasePointer(event.pointerId);
  }

  releasePointer(pointerId) {
    if (this.activeAction === 'gesture') {
      try {
        this.captureTarget?.releasePointerCapture?.(pointerId);
      } catch (error) {
        // The browser may already have released capture after pointerup/cancel.
      }
    }
    this.activePointerId = null;
    this.activeAction = '';
    this.captureTarget = null;
  }

  handleCanvasClick(event) {
    if (this.destroyed || !EDITING_MODES.has(this.mode())) return;
    if (isElement(event.target, this.windowRef) && event.target.closest(MODULE_SELECTOR)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  handleKeyDown(event) {
    if (this.destroyed || event.key !== 'Escape' || this.mode() === 'idle') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();
    this.controller.handleEscape();
    this.releasePointer(this.activePointerId);
  }

  interruptActiveGesture() {
    const gestureActive = this.activePointerId !== null
      || this.mode() === 'dragging'
      || this.mode() === 'resizing'
      || Boolean(this.controller?.gesture);
    if (!gestureActive) return false;
    this.controller.handleWindowInterruption();
    this.releasePointer(this.activePointerId);
    return true;
  }

  handleBlur() {
    if (this.destroyed) return;
    this.interruptActiveGesture();
  }

  handleResize() {
    if (this.destroyed) return;
    this.interruptActiveGesture();
    this.applyViewScale(this.layout);
  }

  render(state = this.state, layout = this.layout) {
    if (this.destroyed) return;
    this.state = {
      mode: 'idle',
      selectedId: '',
      conflicts: [],
      guides: [],
      ...state,
    };
    this.layout = layout || this.layout;
    this.applyLayout(this.layout);
    this.applyViewScale(this.layout);
    this.clearChrome();
    this.updateLockButton();

    if (!EDITING_MODES.has(this.state.mode)) return;

    this.canvas.classList.add('is-layout-editing');
    this.setContentInert(true);
    this.renderModuleChrome();
    this.renderGuides();
    this.renderToolbar();
  }

  applyLayout(layout) {
    if (!layout) return;
    for (const shell of this.canvas.querySelectorAll(MODULE_SELECTOR)) {
      const moduleId = shell.dataset.moduleId;
      const definition = this.moduleDefinitions[moduleId];
      const stored = layout[moduleId];
      if (!definition || !stored) continue;
      const rect = computedRect(moduleId, stored);
      shell.style.left = `${rect.x}px`;
      shell.style.top = `${rect.y}px`;
      shell.style.width = `${rect.width}px`;
      shell.style.height = `${rect.height}px`;

      const content = shell.querySelector(':scope > .hz-layout-content');
      if (content) {
        content.style.width = `${definition.baseWidth}px`;
        content.style.height = `${definition.baseHeight}px`;
        content.style.transformOrigin = 'top left';
        content.style.transform = `scale(${stored.scale})`;
      }
    }
  }

  applyViewScale(layout = this.layout) {
    if (!layout) return;
    const scale = viewScale(finite(this.viewport.clientWidth));
    const canvasHeight = computeCanvasHeight(layout);
    this.currentScale = scale;
    this.canvas.style.setProperty('--hz-layout-view-scale', String(scale));
    this.canvas.style.setProperty('--hz-layout-inverse-scale', String(1 / scale));
    this.canvas.style.width = `${CANVAS_WIDTH}px`;
    this.canvas.style.height = `${canvasHeight}px`;
    this.canvas.style.transformOrigin = 'top left';
    this.canvas.style.transform = `scale(${scale})`;
    this.stage.style.width = `${CANVAS_WIDTH * scale}px`;
    this.stage.style.height = `${canvasHeight * scale}px`;
    return scale;
  }

  owned(element) {
    element.setAttribute(OWNED_ATTRIBUTE, 'true');
    return element;
  }

  clearChrome() {
    for (const owned of this.viewport.querySelectorAll(`[${OWNED_ATTRIBUTE}="true"]`)) owned.remove();
    this.canvas.classList.remove('is-layout-editing');
    this.setContentInert(false);
    for (const shell of this.canvas.querySelectorAll(MODULE_SELECTOR)) {
      shell.classList.remove('is-layout-selected', 'is-conflicting');
      shell.removeAttribute('aria-selected');
      shell.removeAttribute('aria-current');
    }
  }

  setContentInert(inert) {
    for (const content of this.canvas.querySelectorAll('.hz-layout-content')) {
      content.inert = inert;
      if (inert) content.setAttribute('inert', '');
      else content.removeAttribute('inert');
    }
  }

  renderModuleChrome() {
    const conflicts = new Set(this.state.conflicts || []);
    for (const shell of this.canvas.querySelectorAll(MODULE_SELECTOR)) {
      const moduleId = shell.dataset.moduleId;
      const definition = this.moduleDefinitions[moduleId];
      if (!definition) continue;

      const selected = moduleId === this.state.selectedId;
      shell.classList.toggle('is-layout-selected', selected);
      if (selected) shell.setAttribute('aria-current', 'true');
      else shell.removeAttribute('aria-current');
      shell.classList.toggle('is-conflicting', conflicts.has(moduleId));

      const label = this.owned(this.windowRef.document.createElement('span'));
      label.className = 'hz-layout-label';
      label.textContent = definition.label;
      shell.appendChild(label);

      if (conflicts.has(moduleId)) {
        const stripes = this.owned(this.windowRef.document.createElement('span'));
        stripes.className = 'hz-conflict-stripes';
        stripes.setAttribute('aria-label', '模块重叠');
        shell.appendChild(stripes);
      }

      if (selected) {
        const handle = this.owned(this.windowRef.document.createElement('button'));
        handle.type = 'button';
        handle.className = 'hz-resize-handle';
        handle.dataset.layoutInteractive = 'resize';
        handle.setAttribute('aria-label', `等比例缩放${definition.label}`);
        shell.appendChild(handle);
      }
    }
  }

  renderGuides() {
    for (const guide of this.state.guides || []) {
      const axis = guide.axis === 'scale' ? guide.guideAxis : guide.axis;
      if (axis !== 'x' && axis !== 'y') continue;
      const element = this.owned(this.windowRef.document.createElement('div'));
      element.className = `hz-snap-guide hz-snap-guide-${axis}`;
      element.dataset.axis = axis;
      element.dataset.kind = guide.kind || '';
      if (axis === 'x') element.style.left = `${guide.coordinate}px`;
      else element.style.top = `${guide.coordinate}px`;
      if (guide.label) {
        const label = this.windowRef.document.createElement('span');
        label.className = 'hz-snap-guide-label';
        label.textContent = guide.label;
        element.appendChild(label);
      }
      this.canvas.appendChild(element);
    }
  }

  renderToolbar() {
    const toolbar = this.owned(this.windowRef.document.createElement('div'));
    toolbar.className = 'hz-layout-toolbar';
    toolbar.dataset.layoutInteractive = 'toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', '布局调整工具');

    const hint = this.windowRef.document.createElement('span');
    hint.className = 'hz-layout-toolbar-hint';
    hint.textContent = '拖动模块调整位置，关锁保存';
    toolbar.appendChild(hint);

    const actions = [
      ['undo', '撤销', () => this.controller.undo()],
      ['default', '恢复默认', () => this.controller.restoreDefault()],
      ['cancel', '取消调整', () => this.controller.cancelAndExit()],
    ];
    for (const [action, label, callback] of actions) {
      const button = this.windowRef.document.createElement('button');
      button.type = 'button';
      button.dataset.layoutAction = action;
      button.textContent = label;
      if (action === 'undo') button.disabled = !this.state.canUndo;
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        callback();
      });
      toolbar.appendChild(button);
    }
    for (const eventName of ['pointerdown', 'pointerup', 'click']) {
      toolbar.addEventListener(eventName, (event) => event.stopPropagation());
    }
    this.viewport.insertBefore(toolbar, this.stage);
  }

  destroy() {
    if (this.destroyed) return;
    this.interruptActiveGesture();
    this.destroyed = true;
    for (const { target, type, listener, options } of this.listeners) {
      target.removeEventListener(type, listener, options);
    }
    this.listeners = [];
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.clearChrome();
    this.lockButton?.remove();
    this.lockButton = null;
    this.mounted = false;
  }
}

module.exports = { LayoutView };
