const { buildJournalIndex, latestSelection, selectYear, selectMonth } = require('./journal-index');
const {
  createCarouselState,
  move: moveState,
  accumulateWheel,
  dragDirection,
  clampDragOffset,
  sampleVelocity,
  projectDestination,
  circularDestinationIndex,
  snapDuration,
} = require('./carousel-model');

const ANIMATION_MS = 350;
const DRAG_THRESHOLD_PX = 35;
const FALLBACK_PIXELS_PER_CARD = 100;
const GESTURE_PAUSE_REASON = 'gesture';

function circularIndex(index, length) {
  return length ? ((index % length) + length) % length : 0;
}

function selectPreferredItem(index, preferredPath = '') {
  const fallback = { selection: latestSelection(index), preferredIndex: 0 };
  if (!preferredPath) return fallback;

  for (const [monthKey, items] of index.itemsByMonth) {
    const preferredIndex = items.findIndex((item) => item?.file?.path === preferredPath);
    if (preferredIndex !== -1) {
      return {
        selection: { year: monthKey.slice(0, 4), month: monthKey.slice(5) },
        preferredIndex,
      };
    }
  }
  return fallback;
}

class CarouselController {
  constructor({ section, journals, openJournal, settings, preferredPath = '', windowRef }) {
    this.section = section;
    this.openJournal = openJournal;
    this.settings = settings || {};
    this.reducedMotion = this.settings.reducedMotion === true;
    this.windowRef = windowRef || section?.ownerDocument?.defaultView || globalThis.window || globalThis;
    this.index = buildJournalIndex(journals);
    const preferred = selectPreferredItem(this.index, preferredPath);
    this.selection = preferred.selection;
    this.state = createCarouselState(this.itemsForSelection(), preferred.preferredIndex);
    this.cards = [];
    this.pauses = new Set();
    this.wheelState = { pixels: 0, direction: 0 };
    this.queuedDirection = 0;
    this.animating = false;
    this.animationDirection = 0;
    this.destroyed = false;

    this.mounted = false;
    this.listeners = [];
    this.ownedNodes = [];
    this.idleCallbacks = new Set();
    this.preloads = new Map();
    this.intervalId = 0;
    this.animationTimeout = 0;
    this.animationFrame = 0;
    this.motionCleanupFrame = 0;
    this.clickSuppressionTimeout = 0;
    this.clickSuppressionToken = null;
    this.suppressedClickCard = null;
    this.pendingActivationPath = '';
    this.pendingActivationTimeout = 0;
    this.pendingActivationToken = null;
    this.pointer = null;
    this.yearSelect = null;
    this.monthSelect = null;
    this.stage = null;
    this.dots = null;
    this.emptyState = null;
  }

  itemsForSelection() {
    return this.index.itemsByMonth.get(`${this.selection.year}-${this.selection.month}`) || [];
  }

  mount() {
    if (this.mounted || this.destroyed) return this;
    const document = this.section.ownerDocument;

    const controls = document.createElement('div');
    controls.className = 'hz-section-head hz-carousel-controls';
    const filters = document.createElement('div');
    filters.className = 'hz-filters';
    this.yearSelect = document.createElement('select');
    this.yearSelect.className = 'hz-journal-select hz-filter';
    this.yearSelect.setAttribute('aria-label', 'Journal year');
    this.monthSelect = document.createElement('select');
    this.monthSelect.className = 'hz-journal-select hz-filter';
    this.monthSelect.setAttribute('aria-label', 'Journal month');
    filters.append(this.yearSelect, this.monthSelect);
    controls.append(filters);

    const orbit = document.createElement('div');
    orbit.className = 'hz-orbit';
    const axis = document.createElement('div');
    axis.className = 'hz-axis';
    this.stage = document.createElement('div');
    this.stage.className = 'hz-carousel-stage';
    this.dots = document.createElement('div');
    this.dots.className = 'hz-center-dot';
    this.ownedNodes = [controls, orbit, axis, this.stage, this.dots];
    this.section.append(...this.ownedNodes);

    this.listen(this.yearSelect, 'change', () => this.setYear(this.yearSelect.value));
    this.listen(this.monthSelect, 'change', () => this.setMonth(this.selection.year, this.monthSelect.value));
    this.listen(this.section, 'wheel', (event) => this.onWheel(event), { passive: false });
    this.listen(this.stage, 'pointerdown', (event) => this.onPointerDown(event));
    this.listen(this.windowRef, 'pointermove', (event) => this.onPointerMove(event));
    this.listen(this.windowRef, 'pointerup', (event) => this.onPointerUp(event));
    this.listen(this.windowRef, 'pointercancel', (event) => this.onPointerCancel(event));

    this.mounted = true;
    this.refreshSelects();
    this.renderPool();
    if (!this.reducedMotion) {
      const seconds = Math.max(3, Number(this.settings.carouselSeconds) || 6);
      this.intervalId = this.windowRef.setInterval(() => this.onAutoTick(), seconds * 1000);
    }
    return this;
  }

  currentItem() {
    return this.state.items[this.state.index] || null;
  }

  setJournals(journals, preferredPath = '') {
    if (this.destroyed) return;
    this.cancelPointerGesture();
    this.cancelAnimation();
    this.index = buildJournalIndex(journals);
    const preferred = selectPreferredItem(this.index, preferredPath);
    this.selection = preferred.selection;
    this.state = createCarouselState(this.itemsForSelection(), preferred.preferredIndex);
    if (this.mounted) {
      this.refreshSelects();
      this.renderPool();
    }
  }

  setYear(year) {
    if (this.destroyed) return;
    this.cancelPointerGesture();
    this.cancelAnimation();
    this.selection = selectYear(this.index, String(year));
    this.state = createCarouselState(this.itemsForSelection());
    if (this.mounted) {
      this.refreshSelects();
      this.renderPool();
    }
  }

  setMonth(year, month) {
    if (this.destroyed) return;
    this.cancelPointerGesture();
    this.cancelAnimation();
    this.selection = selectMonth(this.index, String(year), String(month).padStart(2, '0'));
    this.state = createCarouselState(this.itemsForSelection());
    if (this.mounted) {
      this.refreshSelects();
      this.renderPool();
    }
  }

  move(direction, { animate = true } = {}) {
    if (this.destroyed || this.pointer || this.state.items.length < 2 || !direction) return false;
    const normalized = Math.sign(direction);
    if (this.animating) {
      this.queuedDirection = normalized;
      return false;
    }

    this.state = moveState(this.state, normalized);
    this.updateDots();

    if (this.state.poolSize <= 5) {
      this.recycle(normalized);
      return true;
    }

    this.updateSlots(normalized);

    if (!animate || this.reducedMotion) {
      this.recycle(normalized);
      return true;
    }

    this.animating = true;
    this.animationDirection = normalized;
    this.animationTimeout = this.windowRef.setTimeout(() => {
      this.animationTimeout = 0;
      this.recycle(normalized);
      this.animating = false;
      this.animationDirection = 0;
      const queued = this.queuedDirection;
      this.queuedDirection = 0;
      if (queued) this.move(queued);
    }, ANIMATION_MS);
    return true;
  }

  onWheel(event) {
    if (this.destroyed || this.pointer) return;
    const deltaX = Number(event.deltaX) || 0;
    const deltaY = Number(event.deltaY) || 0;
    const delta = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
    const result = accumulateWheel(this.wheelState, delta, Number(event.deltaMode) || 0);
    this.wheelState = result.state;
    if (result.move) {
      event.preventDefault?.();
      this.move(result.move);
    }
  }

  onPointerDown(event) {
    if (this.destroyed) return;
    this.cancelPointerGesture();
    this.finishAnimation();
    this.pendingActivationPath = '';
    const startX = Number(event.clientX) || 0;
    const time = this.clockNow();
    const card = event.target?.closest?.('.hz-jcard') || null;
    this.pauses.add(GESTURE_PAUSE_REASON);
    this.pointer = {
      phase: 'pending',
      pointerId: event.pointerId,
      startX,
      offset: 0,
      pixelsPerCard: 0,
      samples: [{ x: startX, time }],
      card,
      path: this.cardPath(card),
      captureTarget: null,
      captureActive: false,
      captureReleased: false,
    };
  }

  onPointerMove(event) {
    const pointer = this.pointer;
    if (this.destroyed || !pointer || !['pending', 'dragging'].includes(pointer.phase)) return;
    if (pointer.pointerId != null && event.pointerId != null && event.pointerId !== pointer.pointerId) return;
    const x = Number(event.clientX) || 0;
    const distance = x - pointer.startX;
    this.recordPointerSample(pointer, x);
    if (pointer.phase === 'pending' && Math.abs(distance) < DRAG_THRESHOLD_PX) return;

    if (pointer.phase === 'pending') {
      pointer.phase = 'dragging';
      this.setMotionPhase('dragging');
      pointer.captureTarget = pointer.card || this.stage;
      if (pointer.pointerId != null && pointer.captureTarget?.setPointerCapture) {
        try {
          pointer.captureTarget.setPointerCapture(pointer.pointerId);
          pointer.captureActive = true;
        } catch (_) { /* unsupported capture */ }
      }
    }
    pointer.pixelsPerCard = pointer.pixelsPerCard || this.measurePixelsPerCard(pointer.card);
    pointer.offset = clampDragOffset(distance, pointer.pixelsPerCard);
    event.preventDefault?.();
    this.requestMotionFrame();
  }

  onPointerUp(event) {
    if (this.destroyed || !this.pointer) return;
    if (this.pointer.pointerId != null
      && event.pointerId != null
      && event.pointerId !== this.pointer.pointerId) return;
    const pointer = this.pointer;
    if (pointer.phase === 'pending') {
      this.queuePendingActivation(pointer.path || this.cardPath(pointer.card));
      this.pointer = null;
      this.endGesturePause();
      return;
    }
    if (pointer.phase !== 'dragging') return;

    const x = Number(event.clientX) || 0;
    this.recordPointerSample(pointer, x);
    const distance = x - pointer.startX;
    pointer.offset = clampDragOffset(distance, pointer.pixelsPerCard);
    const [previous, latest] = pointer.samples.slice(-2);
    const velocity = previous && latest
      ? sampleVelocity(latest.x - previous.x, latest.time - previous.time)
      : 0;
    pointer.velocity = velocity;
    pointer.destination = this.reducedMotion
      ? dragDirection(pointer.offset)
      : projectDestination(pointer.offset, velocity, pointer.pixelsPerCard);
    pointer.startOffset = pointer.offset;
    pointer.targetOffset = -pointer.destination * pointer.pixelsPerCard;
    pointer.settleStartTime = this.clockNow();
    pointer.settleDuration = snapDuration(
      pointer.targetOffset - pointer.startOffset,
      velocity,
      this.reducedMotion,
    );
    pointer.phase = 'settling';
    this.setMotionPhase('settling');
    this.releasePointerCapture(pointer);
    this.suppressClick(pointer.card);

    if (this.reducedMotion || this.state.poolSize <= 5 || pointer.settleDuration === 0) {
      this.completePointerSettle(pointer);
      return;
    }
    this.requestMotionFrame();
  }

  onPointerCancel(event) {
    const pointer = this.pointer;
    if (!pointer) return;
    if (pointer.pointerId != null && event?.pointerId != null && event.pointerId !== pointer.pointerId) return;
    this.cancelPointerGesture();
  }

  cancelPointerGesture({ commitSettling = false } = {}) {
    const pointer = this.pointer;
    this.pointer = null;
    this.cancelMotionFrame();
    this.releasePointerCapture(pointer);
    this.clearMotionStyles();
    if (commitSettling && pointer?.phase === 'settling') {
      this.commitPointerDestination(pointer.destination);
    }
    this.endGesturePause();
  }

  releasePointerCapture(pointer) {
    if (!pointer?.captureActive || pointer.captureReleased) return;
    pointer.captureReleased = true;
    pointer.captureActive = false;
    if (pointer.pointerId != null && pointer.captureTarget?.releasePointerCapture) {
      try { pointer.captureTarget.releasePointerCapture(pointer.pointerId); } catch (_) { /* unsupported capture */ }
    }
  }

  pause(reason) {
    if (this.destroyed) return;
    if (reason) this.pauses.add(reason);
    if (reason && reason !== GESTURE_PAUSE_REASON) this.clearPendingActivation();
    if (reason && reason !== GESTURE_PAUSE_REASON && this.pointer) {
      this.cancelPointerGesture({ commitSettling: true });
    } else if (reason && reason !== GESTURE_PAUSE_REASON) {
      this.cancelMotionFrame();
      this.clearMotionStyles();
      this.endGesturePause();
    }
  }

  resume(reason) {
    if (this.destroyed) return;
    this.pauses.delete(reason);
  }

  onAutoTick() {
    if (!this.destroyed && !this.reducedMotion && this.pauses.size === 0) this.move(1);
  }

  clockNow() {
    const performanceNow = this.windowRef?.performance?.now;
    if (typeof performanceNow === 'function') {
      const value = Number(performanceNow.call(this.windowRef.performance));
      if (Number.isFinite(value)) return value;
    }
    const value = Number(this.windowRef?.Date?.now?.());
    return Number.isFinite(value) ? value : 0;
  }

  recordPointerSample(pointer, x) {
    const sample = { x, time: this.clockNow() };
    const latest = pointer.samples[pointer.samples.length - 1];
    if (latest && latest.x === sample.x && latest.time === sample.time) return;
    pointer.samples.push(sample);
    if (pointer.samples.length > 4) pointer.samples.shift();
  }

  measurePixelsPerCard(card) {
    const cardWidth = Math.abs(Number(card?.getBoundingClientRect?.().width) || 0);
    if (cardWidth) return cardWidth;
    const stageWidth = Math.abs(Number(this.stage?.getBoundingClientRect?.().width) || 0);
    return stageWidth ? stageWidth * 0.155 : FALLBACK_PIXELS_PER_CARD;
  }

  requestMotionFrame() {
    if (this.destroyed || this.animationFrame || !this.pointer) return;
    const request = this.windowRef?.requestAnimationFrame;
    if (typeof request === 'function') {
      this.animationFrame = request.call(this.windowRef, (time) => this.onMotionFrame(time));
      return;
    }
    this.animationFrame = this.windowRef.setTimeout(() => this.onMotionFrame(this.clockNow()), 16);
  }

  cancelMotionFrame() {
    if (!this.animationFrame || !this.windowRef) return;
    const cancel = this.windowRef.cancelAnimationFrame;
    if (typeof cancel === 'function') cancel.call(this.windowRef, this.animationFrame);
    else this.windowRef.clearTimeout(this.animationFrame);
    this.animationFrame = 0;
  }

  requestMotionCleanupFrame(phase) {
    if (this.destroyed || this.motionCleanupFrame || !this.stage) return;
    const cleanup = () => {
      this.motionCleanupFrame = 0;
      if (this.destroyed) return;
      if (phase === 'variables-reset') {
        this.clearMotionVariables();
        this.requestMotionCleanupFrame('phase-reset');
        return;
      }
      this.setMotionPhase();
      this.endGesturePause();
    };
    const request = this.windowRef?.requestAnimationFrame;
    if (typeof request === 'function') {
      this.motionCleanupFrame = request.call(this.windowRef, cleanup);
      return;
    }
    this.motionCleanupFrame = this.windowRef.setTimeout(cleanup, 0);
  }

  cancelMotionCleanupFrame() {
    if (!this.motionCleanupFrame || !this.windowRef) return;
    const cancel = this.windowRef.cancelAnimationFrame;
    if (typeof cancel === 'function') cancel.call(this.windowRef, this.motionCleanupFrame);
    else this.windowRef.clearTimeout(this.motionCleanupFrame);
    this.motionCleanupFrame = 0;
  }

  onMotionFrame(time) {
    this.animationFrame = 0;
    const pointer = this.pointer;
    if (this.destroyed || !pointer) return;
    if (pointer.phase === 'dragging') {
      this.renderMotion(pointer.offset, pointer.pixelsPerCard);
      return;
    }
    if (pointer.phase !== 'settling') return;

    const elapsed = Math.max(0, Number(time) - pointer.settleStartTime);
    const progress = pointer.settleDuration > 0
      ? Math.min(1, elapsed / pointer.settleDuration)
      : 1;
    const eased = 1 - ((1 - progress) ** 3);
    const offset = pointer.startOffset
      + ((pointer.targetOffset - pointer.startOffset) * eased);
    this.renderMotion(offset, pointer.pixelsPerCard);
    if (progress >= 1) this.completePointerSettle(pointer);
    else this.requestMotionFrame();
  }

  renderMotion(offset, pixelsPerCard) {
    if (!this.stage) return;
    const safeOffset = Number.isFinite(Number(offset)) ? Number(offset) : 0;
    const card = Math.max(1, Math.abs(Number(pixelsPerCard) || 0));
    const opacity = Math.max(0, 1 - (Math.abs(safeOffset) / card));
    this.stage.style.setProperty('--hz-carousel-drag-x', `${safeOffset}px`);
    this.stage.style.setProperty('--hz-carousel-drag-opacity', String(opacity));
  }

  clearMotionStyles() {
    if (!this.stage) return;
    this.cancelMotionCleanupFrame();
    this.clearMotionVariables();
    this.setMotionPhase();
  }

  clearMotionVariables() {
    if (!this.stage) return;
    this.stage.style.removeProperty('--hz-carousel-drag-x');
    this.stage.style.removeProperty('--hz-carousel-drag-opacity');
  }

  setMotionPhase(phase = '') {
    if (!this.stage) return;
    this.stage.classList.toggle('is-dragging', phase === 'dragging');
    this.stage.classList.toggle('is-settling', phase === 'settling');
  }

  completePointerSettle(pointer) {
    if (this.pointer !== pointer || pointer.phase !== 'settling') return;
    this.pointer = null;
    this.cancelMotionFrame();
    this.commitPointerDestination(pointer.destination, { preserveMotionStyles: true });
    if (this.reducedMotion || this.state.poolSize <= 5 || pointer.settleDuration === 0) {
      this.clearMotionStyles();
      this.endGesturePause();
      return;
    }
    this.requestMotionCleanupFrame('variables-reset');
  }

  commitPointerDestination(displacement, { preserveMotionStyles = false } = {}) {
    if (!displacement || this.state.items.length < 2) {
      this.applyFinalSlots();
      return;
    }
    this.state = {
      ...this.state,
      index: circularDestinationIndex(this.state.index, displacement, this.state.items.length),
    };
    this.renderPool({ preserveMotionStyles });
  }

  endGesturePause() {
    this.pauses.delete(GESTURE_PAUSE_REASON);
  }

  destroy() {
    if (this.destroyed) return;
    this.cancelPointerGesture();
    this.destroyed = true;
    this.cancelAnimation();
    this.clearClickSuppression();
    this.clearPendingActivation();
    if (this.intervalId) this.windowRef.clearInterval(this.intervalId);
    this.intervalId = 0;
    for (const callback of this.idleCallbacks) {
      if (callback.kind === 'idle') this.windowRef.cancelIdleCallback?.(callback.id);
      else this.windowRef.clearTimeout(callback.id);
    }
    this.idleCallbacks.clear();
    for (const entry of this.preloads.values()) {
      entry.idleRecord = null;
      this.detachPreload(entry);
      entry.status = 'destroyed';
      entry.covers.clear();
      entry.callbacks.clear();
    }
    this.preloads.clear();
    for (const { target, type, handler, options } of this.listeners) {
      target.removeEventListener(type, handler, options);
    }
    this.listeners.length = 0;
    for (const card of this.cards) {
      card.__journal = null;
      delete card.__clickHandler;
      delete card.__parts;
    }
    this.cards.length = 0;
    this.updateCountClasses(0);
    for (const node of this.ownedNodes) node.remove();
    this.ownedNodes.length = 0;
    this.pointer = null;
    this.stage = null;
    this.dots = null;
    this.emptyState = null;
    this.pendingActivationPath = '';
    this.pendingActivationTimeout = 0;
    this.pendingActivationToken = null;
    this.yearSelect = null;
    this.monthSelect = null;
    this.section = null;
    this.openJournal = null;
    this.index = buildJournalIndex([]);
    this.selection = latestSelection(this.index);
    this.state = createCarouselState([]);
    this.settings = null;
    this.windowRef = null;
    this.pauses.clear();
    this.wheelState = { pixels: 0, direction: 0 };
    this.mounted = false;
  }

  listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    this.listeners.push({ target, type, handler, options });
  }

  cancelAnimation() {
    if (this.animationTimeout) this.windowRef.clearTimeout(this.animationTimeout);
    this.animationTimeout = 0;
    this.animating = false;
    this.animationDirection = 0;
    this.queuedDirection = 0;
  }

  finishAnimation() {
    if (!this.animating) return;
    const direction = this.animationDirection;
    this.cancelAnimation();
    if (direction) this.recycle(direction);
  }

  refreshSelects() {
    this.replaceOptions(this.yearSelect, this.index.years, this.selection.year, '年');
    const months = this.index.monthsByYear.get(this.selection.year) || [];
    this.replaceOptions(this.monthSelect, months, this.selection.month, '月');
  }

  replaceOptions(select, values, selected, suffix = '') {
    const document = this.section.ownerDocument;
    const options = values.map((value) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value + suffix;
      return option;
    });
    select.replaceChildren(...options);
    select.value = selected;
  }

  renderPool({ preserveMotionStyles = false } = {}) {
    this.clearPendingActivation();
    if (this.pointer) this.cancelPointerGesture();
    else if (!preserveMotionStyles) {
      this.cancelMotionFrame();
      this.clearMotionStyles();
      this.endGesturePause();
    }
    const desired = this.state.poolSize;
    while (this.cards.length < desired) this.cards.push(this.createCard());
    while (this.cards.length > desired) this.removeCard(this.cards.pop());
    this.updateCountClasses(desired);

    const empty = desired === 0;
    this.yearSelect.disabled = empty;
    this.monthSelect.disabled = empty;
    if (empty && !this.emptyState) {
      this.emptyState = this.section.ownerDocument.createElement('div');
      this.emptyState.className = 'hz-empty';
      this.emptyState.textContent = '还没有可展示的日记';
      this.stage.append(this.emptyState);
    } else if (!empty && this.emptyState) {
      this.emptyState.remove();
      this.emptyState = null;
    }

    if (desired > 5) {
      for (let position = 0; position < desired; position += 1) {
        const offset = position - 3;
        const item = this.state.items[circularIndex(this.state.index + offset, this.state.items.length)];
        this.applyJournal(this.cards[position], item);
      }
    } else {
      const centerPosition = Math.floor(desired / 2);
      for (let position = 0; position < desired; position += 1) {
        const offset = position - centerPosition;
        const item = this.state.items[circularIndex(this.state.index + offset, this.state.items.length)];
        this.applyJournal(this.cards[position], item);
      }
    }
    this.applyFinalSlots();
    this.renderDots();
  }

  createCard() {
    const document = this.section.ownerDocument;
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'hz-jcard';
    const cover = document.createElement('div');
    cover.className = 'hz-jcard-cover';
    const copy = document.createElement('div');
    copy.className = 'hz-card-copy';
    const meta = document.createElement('small');
    const meditation = document.createElement('h3');
    copy.append(meta, meditation);
    card.append(cover, copy);
    card.__parts = { cover, meta, meditation };
    const clickHandler = (event) => {
      if (this.suppressedClickCard === card) {
        event.preventDefault();
        event.stopPropagation();
        this.clearClickSuppression();
        return;
      }
      this.activateCard(card);
    };
    card.__clickHandler = clickHandler;
    this.listen(card, 'click', clickHandler);
    this.stage.append(card);
    return card;
  }

  removeCard(card) {
    if (!card) return;
    card.removeEventListener('click', card.__clickHandler);
    for (let index = this.listeners.length - 1; index >= 0; index -= 1) {
      if (this.listeners[index].target === card) this.listeners.splice(index, 1);
    }
    const cover = card.__parts?.cover;
    const coverUrl = cover?.dataset.coverUrl || '';
    if (coverUrl) this.preloads.get(coverUrl)?.covers.delete(cover);
    card.__journal = null;
    delete card.__clickHandler;
    delete card.__parts;
    card.remove();
  }

  activateCard(card) {
    const activationPath = this.consumeActivationPath(card);
    if (!activationPath) return;

    const centeredPath = this.isSettled() ? this.currentCenteredPath() : '';
    if (!centeredPath || activationPath !== centeredPath) {
      this.centerPath(activationPath);
      return;
    }

    const centeredCard = this.currentCenteredCard();
    if (centeredCard?.getAttribute('aria-hidden') !== 'true' && centeredCard.__journal && this.openJournal) {
      this.openJournal(centeredCard.__journal);
    }
  }

  consumeActivationPath(card) {
    const activationPath = this.pendingActivationPath || this.cardPath(card);
    this.clearPendingActivation();
    return activationPath;
  }

  queuePendingActivation(path) {
    this.clearPendingActivation();
    if (!path) return;
    const token = {};
    this.pendingActivationPath = path;
    this.pendingActivationToken = token;
    this.pendingActivationTimeout = this.windowRef.setTimeout(() => {
      if (this.pendingActivationToken !== token) return;
      this.pendingActivationTimeout = 0;
      this.pendingActivationToken = null;
      this.pendingActivationPath = '';
    }, 0);
  }

  clearPendingActivation() {
    if (this.pendingActivationTimeout && this.windowRef) {
      this.windowRef.clearTimeout(this.pendingActivationTimeout);
    }
    this.pendingActivationTimeout = 0;
    this.pendingActivationToken = null;
    this.pendingActivationPath = '';
  }

  cardPath(card) {
    return card?.dataset?.path || card?.__journal?.file?.path || '';
  }

  currentCenteredCard() {
    const centerPosition = this.state.poolSize <= 5 ? Math.floor(this.cards.length / 2) : 3;
    return this.cards[centerPosition] || null;
  }

  currentCenteredPath() {
    return this.cardPath(this.currentCenteredCard());
  }

  isSettled() {
    return !this.animating && this.pointer?.phase !== 'settling';
  }

  centerPath(path) {
    const displacement = this.displacementToPath(path);
    if (!displacement) return false;
    const direction = Math.sign(displacement);
    for (let step = 0; step < Math.abs(displacement); step += 1) {
      this.move(direction);
    }
    return true;
  }

  displacementToPath(path) {
    if (!path || this.state.items.length < 2) return 0;
    const position = this.cards.findIndex((candidate) =>
      candidate.getAttribute('aria-hidden') !== 'true' && this.cardPath(candidate) === path);
    if (position === -1) return 0;
    const centerPosition = this.state.poolSize <= 5 ? Math.floor(this.cards.length / 2) : 3;
    return position - centerPosition;
  }

  suppressClick(card) {
    this.clearClickSuppression();
    const token = {};
    this.clickSuppressionToken = token;
    this.suppressedClickCard = card;
    if (!card) return;
    this.clickSuppressionTimeout = this.windowRef.setTimeout(() => {
      if (this.clickSuppressionToken !== token) return;
      this.clickSuppressionTimeout = 0;
      this.clickSuppressionToken = null;
      this.suppressedClickCard = null;
    }, 0);
  }

  clearClickSuppression() {
    if (this.clickSuppressionTimeout && this.windowRef) {
      this.windowRef.clearTimeout(this.clickSuppressionTimeout);
    }
    this.clickSuppressionTimeout = 0;
    this.clickSuppressionToken = null;
    this.suppressedClickCard = null;
  }

  applyJournal(card, journal) {
    card.__journal = journal || null;
    card.dataset.path = journal?.file?.path || '';
    const { cover, meta, meditation } = card.__parts;
    const coverUrl = journal?.cover || '';
    const previousUrl = cover.dataset.coverUrl || '';
    if (previousUrl) this.preloads.get(previousUrl)?.covers.delete(cover);
    cover.classList.remove('is-loaded');
    cover.dataset.coverUrl = coverUrl;
    cover.style.backgroundImage = coverUrl ? `url("${String(coverUrl).replace(/"/g, '%22')}")` : '';
    meta.textContent = journal?.date || '';
    meditation.textContent = journal?.meditation || '';
  }

  updateCountClasses(count) {
    const targets = [this.section, this.stage].filter(Boolean);
    for (const target of targets) {
      for (let value = 1; value <= 4; value += 1) target.classList.remove(`hz-count-${value}`);
      if (count >= 1 && count <= 4) target.classList.add(`hz-count-${count}`);
    }
  }

  updateSlots(direction) {
    const poolSize = this.cards.length;
    for (let position = 0; position < poolSize; position += 1) {
      this.setSlot(this.cards[position], position - direction, poolSize, { transient: true });
    }
  }

  recycle(direction) {
    if (direction > 0) {
      const outgoing = this.cards.shift();
      if (this.state.poolSize > 5) {
        const itemIndex = this.state.index + 3;
        this.applyJournal(outgoing, this.state.items[circularIndex(itemIndex, this.state.items.length)]);
      }
      this.cards.push(outgoing);
    } else {
      const outgoing = this.cards.pop();
      if (this.state.poolSize > 5) {
        const itemIndex = this.state.index - 3;
        this.applyJournal(outgoing, this.state.items[circularIndex(itemIndex, this.state.items.length)]);
      }
      this.cards.unshift(outgoing);
    }
    this.applyFinalSlots();
  }

  applyFinalSlots() {
    for (let position = 0; position < this.cards.length; position += 1) {
      this.setSlot(this.cards[position], position, this.cards.length);
    }
  }

  setSlot(card, position, poolSize, { transient = false } = {}) {
    for (const name of [...card.classList]) {
      if (name.startsWith('hz-slot-')) card.classList.remove(name);
    }
    if (poolSize > 5) {
      card.classList.add(`hz-slot-${position}`);
      const outside = position < 0 || position > 6;
      const preparatory = position === 0 || position === 6;
      this.setCardExposure(card, {
        renderable: !outside && (!preparatory || transient),
        accessible: !outside && !preparatory,
        tabbable: position === 3,
      });
      if (!outside) this.ensureCardCover(card, !preparatory);
      return;
    }
    const firstSlot = Math.floor((5 - poolSize) / 2) + 1;
    const slot = firstSlot + position;
    card.classList.add(`hz-slot-${slot}`);
    const visible = position >= 0 && position < poolSize;
    this.setCardExposure(card, {
      renderable: visible,
      accessible: visible,
      tabbable: position === Math.floor(poolSize / 2),
    });
    if (visible) this.ensureCardCover(card, true);
  }

  setCardExposure(card, { renderable, accessible, tabbable }) {
    card.style.visibility = renderable ? '' : 'hidden';
    card.tabIndex = tabbable ? 0 : -1;
    if (accessible) card.removeAttribute('aria-hidden');
    else card.setAttribute('aria-hidden', 'true');
  }

  ensureCardCover(card, immediate) {
    const cover = card.__parts?.cover;
    const url = cover?.dataset.coverUrl || '';
    if (!cover || !url || this.destroyed) return;
    const entry = this.getPreloadEntry(url);
    entry.covers.add(cover);
    if (entry.status === 'loaded') {
      if (cover.dataset.coverUrl === url) cover.classList.add('is-loaded');
    } else if (entry.status !== 'error') {
      if (immediate) this.startPreload(entry);
      else this.schedulePreload(entry);
    }
  }

  renderDots() {
    const document = this.section.ownerDocument;
    const dots = this.state.items.map(() => document.createElement('i'));
    this.dots.replaceChildren(...dots);
    this.updateDots();
  }

  updateDots() {
    if (!this.dots) return;
    [...this.dots.children].forEach((dot, index) => {
      dot.classList.toggle('is-on', index === this.state.index);
    });
  }

  getPreloadEntry(url) {
    let entry = this.preloads.get(url);
    if (!entry) {
      entry = {
        url,
        status: 'idle',
        covers: new Set(),
        callbacks: new Set(),
        idleRecord: null,
        image: null,
        onLoad: null,
        onError: null,
      };
      this.preloads.set(url, entry);
    }
    return entry;
  }

  preload(url, onLoad, { immediate = false } = {}) {
    if (!url || this.destroyed) return null;
    const entry = this.getPreloadEntry(url);
    if (onLoad) {
      if (entry.status === 'loaded') onLoad();
      else if (entry.status !== 'error') entry.callbacks.add(onLoad);
    }
    if (entry.status === 'idle') {
      if (immediate) this.startPreload(entry);
      else this.schedulePreload(entry);
    }
    return entry;
  }

  schedulePreload(entry) {
    if (this.destroyed || entry.status !== 'idle' || entry.idleRecord) return;
    const record = { kind: 'timeout', id: 0, entry };
    const complete = () => {
      if (entry.idleRecord !== record) return;
      entry.idleRecord = null;
      this.idleCallbacks.delete(record);
      if (!this.destroyed) this.startPreload(entry);
    };
    if (typeof this.windowRef.requestIdleCallback === 'function') {
      record.kind = 'idle';
      record.id = this.windowRef.requestIdleCallback(complete);
    } else {
      record.id = this.windowRef.setTimeout(complete, 0);
    }
    entry.idleRecord = record;
    this.idleCallbacks.add(record);
  }

  cancelScheduledPreload(entry) {
    const record = entry.idleRecord;
    if (!record) return;
    if (record.kind === 'idle') this.windowRef.cancelIdleCallback?.(record.id);
    else this.windowRef.clearTimeout(record.id);
    entry.idleRecord = null;
    this.idleCallbacks.delete(record);
  }

  startPreload(entry) {
    if (this.destroyed || entry.status !== 'idle') return;
    this.cancelScheduledPreload(entry);
    const ImageConstructor = this.windowRef.Image;
    if (!ImageConstructor) {
      entry.status = 'error';
      entry.callbacks.clear();
      return;
    }

    const image = new ImageConstructor();
    entry.status = 'pending';
    entry.image = image;
    entry.onLoad = () => this.finishPreload(entry, true);
    entry.onError = () => this.finishPreload(entry, false);
    image.addEventListener('load', entry.onLoad, { once: true });
    image.addEventListener('error', entry.onError, { once: true });
    image.src = entry.url;
    if (typeof image.decode === 'function') {
      try {
        Promise.resolve(image.decode()).then(
          () => this.finishPreload(entry, true),
          () => {},
        );
      } catch (_) {
        // The load/error listeners remain as the decoding fallback.
      }
    }
  }

  finishPreload(entry, loaded) {
    if (entry.status !== 'pending') return;
    this.detachPreload(entry);
    entry.status = loaded ? 'loaded' : 'error';
    if (loaded && !this.destroyed) {
      for (const cover of entry.covers) {
        if (cover.dataset.coverUrl === entry.url) cover.classList.add('is-loaded');
      }
      for (const callback of entry.callbacks) callback();
    }
    entry.callbacks.clear();
  }

  detachPreload(entry) {
    if (entry.image) {
      if (entry.onLoad) entry.image.removeEventListener('load', entry.onLoad);
      if (entry.onError) entry.image.removeEventListener('error', entry.onError);
    }
    entry.image = null;
    entry.onLoad = null;
    entry.onError = null;
  }
}

module.exports = { CarouselController };
