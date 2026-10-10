const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const { CarouselController } = require('../src/carousel-controller');

const ANIMATION_MS = 350;

function journal(date, suffix = date) {
  return {
    date,
    title: `Journal ${suffix}`,
    summary: `Summary ${suffix}`,
    weather: 'Sunny',
    mood: 'Calm',
    meditation: `Meditation ${suffix}`,
    cover: `https://example.test/${suffix}.jpg`,
    file: { path: `daily/${suffix}.md` },
  };
}

test('journal cards render only date and one meditation line', () => {
  const item = { ...journal('2026-08-01', 'a'), meditation: '慢下来，再做决定。' };
  const context = setup([item]);
  context.controller.mount();
  const card = context.section.querySelector('.hz-jcard');
  assert.equal(card.querySelector('small').textContent, '2026-08-01');
  assert.equal(card.querySelector('h3').textContent, '慢下来，再做决定。');
  assert.equal(card.querySelector('p'), null);
  assert.doesNotMatch(card.textContent, /Sunny|Calm|Journal|Summary|点击打开/);
  context.dom.window.close();
});

test('a historical journal without meditation renders its date only', () => {
  const item = { ...journal('2026-08-01', 'a'), meditation: '' };
  const context = setup([item]);
  context.controller.mount();
  const card = context.section.querySelector('.hz-jcard');
  assert.equal(card.querySelector('small').textContent, '2026-08-01');
  assert.equal(card.querySelector('h3').textContent, '');
  context.dom.window.close();
});

function journalsFor(year, month, count) {
  return Array.from({ length: count }, (_, index) => {
    const day = String(index + 1).padStart(2, '0');
    return journal(`${year}-${month}-${day}`, `${year}-${month}-${day}`);
  });
}

function setup(journals, overrides = {}) {
  const dom = new JSDOM('<section id="journal"><div id="stable">stable</div></section>');
  const section = dom.window.document.querySelector('#journal');
  const opened = [];
  const controller = new CarouselController({
    section,
    journals,
    openJournal(item) { opened.push(item); },
    settings: { carouselSeconds: 60 },
    windowRef: dom.window,
    ...overrides,
  });
  return { dom, section, controller, opened, stable: section.querySelector('#stable') };
}

function cardPaths(section) {
  return [...section.querySelectorAll('.hz-jcard')].map((card) => card.dataset.path);
}

function tabbableCards(section) {
  return [...section.querySelectorAll('.hz-jcard')].filter((card) => card.tabIndex === 0);
}

function assertOnlyCurrentCardIsTabbable(context) {
  const cards = [...context.section.querySelectorAll('.hz-jcard')];
  const current = cards.find((card) => card.dataset.path === context.controller.currentItem().file.path);
  const tabbable = tabbableCards(context.section);
  assert.ok(current);
  assert.equal(tabbable.length, 1);
  assert.equal(tabbable[0], current);
  for (const card of cards) assert.equal(card.tabIndex, card === current ? 0 : -1);
}

function pointerEvent(windowRef, type, clientX, pointerId = 1) {
  const event = new windowRef.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    clientX: { value: clientX },
    pointerId: { value: pointerId },
  });
  return event;
}

function pointerClick(context, card, clientX = 100, pointerId = 1) {
  card.dispatchEvent(pointerEvent(context.dom.window, 'pointerdown', clientX, pointerId));
  context.dom.window.dispatchEvent(pointerEvent(context.dom.window, 'pointerup', clientX, pointerId));
  card.dispatchEvent(new context.dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

function pointerReleaseWithoutClick(context, card, clientX = 100, pointerId = 1) {
  card.dispatchEvent(pointerEvent(context.dom.window, 'pointerdown', clientX, pointerId));
  context.dom.window.dispatchEvent(pointerEvent(context.dom.window, 'pointerup', clientX, pointerId));
}

function installFakeClock(windowRef) {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  const originals = {
    setTimeout: windowRef.setTimeout,
    clearTimeout: windowRef.clearTimeout,
    setInterval: windowRef.setInterval,
    clearInterval: windowRef.clearInterval,
  };
  const schedule = (callback, delay, interval) => {
    const id = nextId++;
    timers.set(id, { callback, due: now + Math.max(0, Number(delay) || 0), interval });
    return id;
  };
  windowRef.setTimeout = (callback, delay) => schedule(callback, delay, 0);
  windowRef.clearTimeout = (id) => timers.delete(id);
  windowRef.setInterval = (callback, delay) => schedule(callback, delay, Math.max(1, Number(delay) || 0));
  windowRef.clearInterval = (id) => timers.delete(id);

  return {
    tick(milliseconds) {
      const target = now + milliseconds;
      while (true) {
        const next = [...timers.entries()]
          .filter(([, timer]) => timer.due <= target)
          .sort((left, right) => left[1].due - right[1].due || left[0] - right[0])[0];
        if (!next) break;
        const [id, timer] = next;
        now = timer.due;
        if (timer.interval) timer.due += timer.interval;
        else timers.delete(id);
        timer.callback();
      }
      now = target;
    },
    pending() { return timers.size; },
    restore() {
      windowRef.setTimeout = originals.setTimeout;
      windowRef.clearTimeout = originals.clearTimeout;
      windowRef.setInterval = originals.setInterval;
      windowRef.clearInterval = originals.clearInterval;
    },
  };
}

function installFakeAnimationFrames(windowRef) {
  let now = 0;
  let nextId = 1;
  const frames = new Map();
  const originalRequest = windowRef.requestAnimationFrame;
  const originalCancel = windowRef.cancelAnimationFrame;
  const originalNow = Object.getOwnPropertyDescriptor(windowRef.performance, 'now');
  windowRef.requestAnimationFrame = (callback) => {
    const id = nextId++;
    frames.set(id, callback);
    return id;
  };
  windowRef.cancelAnimationFrame = (id) => frames.delete(id);
  Object.defineProperty(windowRef.performance, 'now', {
    configurable: true,
    value: () => now,
  });

  return {
    advance(milliseconds) { now += milliseconds; },
    frame(milliseconds = 16) {
      now += milliseconds;
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) callback(now);
    },
    run(milliseconds = 16, limit = 100) {
      let count = 0;
      while (frames.size && count < limit) {
        this.frame(milliseconds);
        count += 1;
      }
      assert.ok(count < limit, 'animation frames did not settle');
    },
    pending() { return frames.size; },
    now() { return now; },
    restore() {
      windowRef.requestAnimationFrame = originalRequest;
      windowRef.cancelAnimationFrame = originalCancel;
      if (originalNow) Object.defineProperty(windowRef.performance, 'now', originalNow);
      else delete windowRef.performance.now;
    },
  };
}

function setCardWidth(card, width) {
  card.getBoundingClientRect = () => ({
    width,
    height: 200,
    left: 0,
    right: width,
    top: 0,
    bottom: 200,
    x: 0,
    y: 0,
    toJSON() {},
  });
}

test('mount creates the controls and seven stable cards for eight journals', () => {
  const context = setup(journalsFor('2026', '08', 8));
  try {
    context.controller.mount();
    assert.equal(context.section.querySelectorAll('select').length, 2);
    assert.ok(context.section.querySelector('.hz-orbit'));
    assert.ok(context.section.querySelector('.hz-axis'));
    assert.ok(context.section.querySelector('.hz-carousel-stage'));
    assert.ok(context.section.querySelector('.hz-center-dot'));
    assert.equal(context.section.querySelector('.hz-gesture'), null);
    assert.equal(context.section.querySelectorAll('.hz-jcard').length, 7);
    assert.equal(context.section.querySelectorAll('select.hz-journal-select').length, 2);
  } finally {
    context.controller.destroy();
    context.dom.window.close();
  }
});

test('mount derives its animation window from the owned document when none is injected', () => {
  const context = setup(journalsFor('2026', '08', 8), { windowRef: undefined });
  try {
    context.controller.mount();
    assert.equal(context.controller.windowRef, context.dom.window);
    assert.equal(context.section.querySelectorAll('.hz-jcard').length, 7);
  } finally {
    context.controller.destroy();
    context.dom.window.close();
  }
});

test('an owned document window outranks an unrelated global window', () => {
  const hadGlobalWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window');
  const originalWindow = globalThis.window;
  const unrelatedWindow = {};
  globalThis.window = unrelatedWindow;
  const context = setup(journalsFor('2026', '08', 1), { windowRef: undefined });
  try {
    assert.notEqual(context.controller.windowRef, unrelatedWindow);
    assert.equal(context.controller.windowRef, context.dom.window);
  } finally {
    context.controller.destroy();
    context.dom.window.close();
    if (hadGlobalWindow) globalThis.window = originalWindow;
    else delete globalThis.window;
  }
});

test('eight-journal mount keeps only the center card in the Tab sequence while a side-card click centers before opening', () => {
  const context = setup(journalsFor('2026', '08', 8));
  const clock = installFakeClock(context.dom.window);
  try {
    context.controller.mount();

    const tabbable = tabbableCards(context.section);
    assert.equal(tabbable.length, 1);
    assert.equal(tabbable[0], context.section.querySelector('.hz-slot-3'));
    assert.equal(tabbable[0].hasAttribute('aria-hidden'), false);

    const sideCard = context.section.querySelector('.hz-slot-5');
    const targetPath = sideCard.dataset.path;
    assert.equal(sideCard.tabIndex, -1);
    pointerClick(context, sideCard);
    assert.deepEqual(context.opened, []);

    clock.tick(ANIMATION_MS * 2);
    const currentCard = context.section.querySelector('.hz-slot-3');
    assert.equal(currentCard.dataset.path, targetPath);
    currentCard.click();
    assert.deepEqual(context.opened, [currentCard.__journal]);
  } finally {
    context.controller.destroy();
    clock.restore();
    context.dom.window.close();
  }
});

test('a side-card pointer release without click cannot hijack a later centered activation', () => {
  const context = setup(journalsFor('2026', '08', 8));
  const clock = installFakeClock(context.dom.window);
  try {
    context.controller.mount();
    const sideCard = context.section.querySelector('.hz-slot-5');
    const currentCard = context.section.querySelector('.hz-slot-3');
    const currentPath = currentCard.dataset.path;

    pointerReleaseWithoutClick(context, sideCard);
    assert.equal(context.controller.pendingActivationPath, sideCard.dataset.path);

    clock.tick(0);
    assert.equal(context.controller.pendingActivationPath, '');

    currentCard.click();
    assert.equal(context.opened.length, 1);
    assert.equal(context.opened[0].file.path, currentPath);
    assert.equal(context.section.querySelector('.hz-slot-3').dataset.path, currentPath);
  } finally {
    context.controller.destroy();
    clock.restore();
    context.dom.window.close();
  }
});

test('short pools and state changes retain exactly one Tab stop at the current card', () => {
  for (let count = 1; count <= 5; count += 1) {
    const context = setup(journalsFor('2026', '08', count));
    try {
      context.controller.mount();
      assertOnlyCurrentCardIsTabbable(context);

      context.controller.move(1, { animate: false });
      assertOnlyCurrentCardIsTabbable(context);
    } finally {
      context.controller.destroy();
      context.dom.window.close();
    }
  }

  const context = setup([
    ...journalsFor('2026', '08', 8),
    ...journalsFor('2026', '07', 4),
  ]);
  try {
    context.controller.mount();
    context.controller.move(1, { animate: false });
    assertOnlyCurrentCardIsTabbable(context);

    context.controller.setMonth('2026', '07');
    assertOnlyCurrentCardIsTabbable(context);

    context.controller.setJournals(journalsFor('2026', '08', 3));
    assertOnlyCurrentCardIsTabbable(context);
  } finally {
    context.controller.destroy();
    context.dom.window.close();
  }
});

test('seven-card animation keeps only the logical current card tabbable before and after recycle', () => {
  const context = setup(journalsFor('2026', '08', 8));
  const clock = installFakeClock(context.dom.window);
  try {
    context.controller.mount();
    assertOnlyCurrentCardIsTabbable(context);

    assert.equal(context.controller.move(1), true);
    assertOnlyCurrentCardIsTabbable(context);

    clock.tick(350);
    assertOnlyCurrentCardIsTabbable(context);
  } finally {
    context.controller.destroy();
    clock.restore();
    context.dom.window.close();
  }
});

test('select labels are localized without changing option values', () => {
  const context = setup([
    ...journalsFor('2026', '08', 2),
    ...journalsFor('2024', '12', 2),
  ]);
  try {
    context.controller.mount();

    assert.deepEqual(
      [...context.controller.yearSelect.options].map((option) => [option.value, option.textContent]),
      [['2026', '2026年'], ['2024', '2024年']],
    );
    assert.equal(context.controller.monthSelect.options[0].textContent, '08月');
  } finally {
    context.controller.destroy();
    context.dom.window.close();
  }
});

test('empty journals show an inactive controller-owned empty state', () => {
  const context = setup([]);
  try {
    context.controller.mount();

    const empty = context.section.querySelector('.hz-carousel-stage .hz-empty');
    assert.ok(empty);
    assert.match(empty.textContent, /还没有可展示的日记/);
    assert.equal(context.controller.yearSelect.disabled, true);
    assert.equal(context.controller.monthSelect.disabled, true);
    assert.equal(context.section.querySelectorAll('.hz-jcard').length, 0);
  } finally {
    context.controller.destroy();
    context.dom.window.close();
  }
});

test('empty state clears and restores as journals change', () => {
  const context = setup([]);
  try {
    context.controller.mount();
    context.controller.setJournals(journalsFor('2026', '08', 3));

    assert.equal(context.section.querySelector('.hz-empty'), null);
    assert.equal(context.controller.yearSelect.disabled, false);
    assert.equal(context.controller.monthSelect.disabled, false);
    assert.equal(context.section.querySelectorAll('.hz-jcard').length, 3);

    context.controller.setJournals([]);

    assert.match(context.section.querySelector('.hz-empty').textContent, /还没有可展示的日记/);
    assert.equal(context.controller.yearSelect.disabled, true);
    assert.equal(context.controller.monthSelect.disabled, true);
    assert.equal(context.section.querySelectorAll('.hz-jcard').length, 0);
  } finally {
    context.controller.destroy();
    context.dom.window.close();
  }
});

test('synchronous movement preserves non-carousel and every card DOM identity', () => {
  const context = setup(journalsFor('2026', '08', 8));
  try {
    context.controller.mount();
    const cards = [...context.section.querySelectorAll('.hz-jcard')];
    const stable = context.stable;

    context.controller.move(1, { animate: false });

    assert.equal(context.section.querySelector('#stable'), stable);
    assert.equal(context.section.querySelectorAll('.hz-jcard').length, 7);
    for (const card of cards) assert.ok(context.section.contains(card));
    assert.equal(context.controller.currentItem().date, '2026-08-07');
  } finally {
    context.controller.destroy();
    context.dom.window.close();
  }
});

test('four journals render four cards without duplicate journal paths', () => {
  const context = setup(journalsFor('2026', '08', 4));
  try {
    context.controller.mount();
    const paths = cardPaths(context.section);
    assert.equal(paths.length, 4);
    assert.equal(new Set(paths).size, 4);
    assert.equal(
      context.section.querySelector('.hz-slot-3').dataset.path,
      context.controller.currentItem().file.path,
    );
  } finally {
    context.controller.destroy();
    context.dom.window.close();
  }
});

test('short pools move synchronously in both directions without losing the centered journal', () => {
  for (let count = 2; count <= 5; count += 1) {
    const context = setup(journalsFor('2026', '08', count));
    const clock = installFakeClock(context.dom.window);
    try {
      context.controller.mount();
      const initial = context.controller.currentItem();

      assert.equal(context.controller.move(1), true);
      assert.notEqual(context.controller.currentItem(), initial);
      assert.equal(context.controller.animationTimeout, 0);
      assert.equal(context.controller.animating, false);
      assert.equal(context.section.querySelectorAll('.hz-jcard').length, count);
      assert.equal(context.section.querySelectorAll('.hz-slot-3').length, 1);
      assert.equal(
        context.section.querySelector('.hz-slot-3').dataset.path,
        context.controller.currentItem().file.path,
      );

      clock.tick(350);
      assert.equal(context.controller.animationTimeout, 0);
      assert.equal(
        context.section.querySelector('.hz-slot-3').dataset.path,
        context.controller.currentItem().file.path,
      );

      assert.equal(context.controller.move(-1), true);
      assert.equal(context.controller.currentItem(), initial);
      assert.equal(context.controller.animationTimeout, 0);
      assert.equal(
        context.section.querySelector('.hz-slot-3').dataset.path,
        context.controller.currentItem().file.path,
      );
      assert.equal(context.section.querySelector('.hz-carousel-stage .hz-empty'), null);
    } finally {
      context.controller.destroy();
      clock.restore();
      context.dom.window.close();
    }
  }

  const singleton = setup(journalsFor('2026', '08', 1));
  try {
    singleton.controller.mount();
    assert.equal(singleton.controller.move(1), false);
    assert.equal(singleton.controller.animationTimeout, 0);
  } finally {
    singleton.controller.destroy();
    singleton.dom.window.close();
  }
});

test('auto, wheel, and pointer inputs keep short pools synchronous and centered', () => {
  for (let count = 2; count <= 5; count += 1) {
    const context = setup(journalsFor('2026', '08', count));
    try {
      context.controller.mount();
      const assertCentered = () => {
        assert.equal(context.controller.animationTimeout, 0);
        assert.equal(context.controller.animating, false);
        assert.equal(
          context.section.querySelector('.hz-slot-3').dataset.path,
          context.controller.currentItem().file.path,
        );
      };

      context.controller.onAutoTick();
      assertCentered();
      context.controller.onWheel({ deltaY: 40, deltaMode: 0, preventDefault() {} });
      assertCentered();
      context.controller.onPointerDown({ clientX: 65, pointerId: 1 });
      context.controller.onPointerMove({ clientX: 100, pointerId: 1 });
      context.controller.onPointerUp({ clientX: 100, pointerId: 1 });
      assertCentered();
    } finally {
      context.controller.destroy();
      context.dom.window.close();
    }
  }
});

test('short-month count classes stay synchronized across journal and month changes', () => {
  const context = setup(journalsFor('2026', '08', 4));
  try {
    context.controller.mount();
    assert.equal(context.section.classList.contains('hz-count-4'), true);
    assert.equal(context.controller.stage.classList.contains('hz-count-4'), true);

    context.controller.setJournals([
      ...journalsFor('2026', '08', 3),
      ...journalsFor('2026', '07', 2),
    ]);
    assert.equal(context.section.classList.contains('hz-count-3'), true);
    assert.equal(context.section.classList.contains('hz-count-4'), false);

    context.controller.setMonth('2026', '07');
    assert.equal(context.section.classList.contains('hz-count-2'), true);
    assert.equal(context.controller.stage.classList.contains('hz-count-2'), true);
    assert.equal(context.controller.stage.classList.contains('hz-count-3'), false);

    context.controller.setJournals(journalsFor('2026', '08', 8));
    for (let count = 1; count <= 4; count += 1) {
      assert.equal(context.section.classList.contains(`hz-count-${count}`), false);
      assert.equal(context.controller.stage.classList.contains(`hz-count-${count}`), false);
    }
  } finally {
    context.controller.destroy();
    context.dom.window.close();
  }
});

test('a cover becomes loaded only after its preload completes', () => {
  const context = setup(journalsFor('2026', '08', 1));
  const clock = installFakeClock(context.dom.window);
  const images = [];
  context.dom.window.Image = class {
    constructor() {
      this.listeners = new Map();
      images.push(this);
    }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    removeEventListener(type) { this.listeners.delete(type); }
    dispatch(type) { this.listeners.get(type)?.(); }
  };

  try {
    context.controller.mount();
    const card = context.section.querySelector('.hz-jcard');
    const cover = card.querySelector('.hz-jcard-cover');
    assert.equal(cover.classList.contains('is-loaded'), false);

    assert.equal(images.length, 1);
    images[0].dispatch('load');
    assert.equal(cover.classList.contains('is-loaded'), true);
    assert.equal(card.classList.contains('is-loaded'), false);
  } finally {
    context.controller.destroy();
    clock.restore();
    context.dom.window.close();
  }
});

test('pause reasons block auto movement and destroy clears lifecycle resources', () => {
  const context = setup(journalsFor('2026', '08', 8));
  context.controller.mount();
  const mountedCards = [...context.controller.cards];
  const initial = context.controller.currentItem();
  context.controller.pause('layout-edit');
  context.controller.onAutoTick();
  assert.equal(context.controller.currentItem(), initial);

  context.controller.pause('hidden');
  context.controller.resume('layout-edit');
  context.controller.onAutoTick();
  assert.equal(context.controller.currentItem(), initial);
  context.controller.resume('hidden');
  context.controller.onAutoTick();
  assert.notEqual(context.controller.currentItem(), initial);

  context.controller.destroy();
  context.section.dispatchEvent(new context.dom.window.WheelEvent('wheel', { deltaY: 40 }));
  assert.equal(context.controller.destroyed, true);
  assert.equal(context.controller.state.index, 0);
  assert.equal(context.controller.currentItem(), null);
  assert.equal(context.controller.intervalId, 0);
  assert.equal(context.controller.animationTimeout, 0);
  assert.equal(context.controller.listeners.length, 0);
  assert.equal(context.controller.idleCallbacks.size, 0);
  assert.equal(context.controller.cards.length, 0);
  for (const card of mountedCards) {
    assert.equal(card.__journal, null);
    assert.equal(card.__clickHandler, undefined);
    assert.equal(card.__keydownHandler, undefined);
    assert.equal(card.__parts, undefined);
  }
  context.dom.window.close();
});

test('wheel accumulation moves only on the fortieth CSS pixel', () => {
  const context = setup(journalsFor('2026', '08', 8));
  try {
    context.controller.mount();
    const initial = context.controller.state.index;
    context.section.dispatchEvent(new context.dom.window.WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 39,
      deltaMode: 0,
    }));
    assert.equal(context.controller.state.index, initial);
    context.section.dispatchEvent(new context.dom.window.WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 1,
      deltaMode: 0,
    }));
    assert.equal(context.controller.state.index, initial + 1);
  } finally {
    context.controller.destroy();
    context.dom.window.close();
  }
});

test('setJournals then setMonth updates the pool without replacing stable DOM', () => {
  const context = setup(journalsFor('2026', '08', 8));
  try {
    context.controller.mount();
    const stable = context.stable;
    context.controller.setJournals([
      ...journalsFor('2026', '08', 8),
      ...journalsFor('2026', '07', 4),
    ]);
    context.controller.monthSelect.value = '07';
    context.controller.monthSelect.dispatchEvent(new context.dom.window.Event('change', { bubbles: true }));

    assert.equal(context.section.querySelector('#stable'), stable);
    assert.deepEqual(context.controller.selection, { year: '2026', month: '07' });
    assert.equal(context.controller.monthSelect.value, '07');
    assert.equal(context.section.querySelectorAll('.hz-jcard').length, 4);
    assert.equal(new Set(cardPaths(context.section)).size, 4);
  } finally {
    context.controller.destroy();
    context.dom.window.close();
  }
});

test('fake-clock animation recycles only one outgoing card forward and backward', () => {
  const context = setup(journalsFor('2026', '08', 8));
  const clock = installFakeClock(context.dom.window);
  try {
    context.controller.mount();
    clock.tick(0);
    const cards = [...context.controller.cards];
    const paths = cards.map((card) => card.dataset.path);
    const classes = cards.map((card) => card.className);

    context.controller.move(1);
    assert.deepEqual(cards.map((card) => card.dataset.path), paths);
    assert.notDeepEqual(cards.map((card) => card.className), classes);

    clock.tick(349);
    assert.deepEqual(cards.map((card) => card.dataset.path), paths);
    clock.tick(1);
    assert.equal(cards.filter((card, index) => card.dataset.path !== paths[index]).length, 1);
    assert.equal(context.controller.cards.length, 7);
    for (const card of cards) assert.ok(context.section.contains(card));

    const forwardPaths = new Map(cards.map((card) => [card, card.dataset.path]));
    context.controller.move(-1);
    clock.tick(350);
    assert.equal(cards.filter((card) => card.dataset.path !== forwardPaths.get(card)).length, 1);
    assert.equal(context.controller.state.index, 0);
  } finally {
    context.controller.destroy();
    clock.restore();
    context.dom.window.close();
  }
});

test('seven-card transitions keep edge cards renderable but inaccessible until recycle', () => {
  for (const direction of [1, -1]) {
    const context = setup(journalsFor('2026', '08', 8));
    const clock = installFakeClock(context.dom.window);
    try {
      context.controller.mount();
      const cards = [...context.controller.cards];
      const paths = new Map(cards.map((card) => [card, card.dataset.path]));
      const outgoing = direction > 0
        ? context.section.querySelector('.hz-slot-1')
        : context.section.querySelector('.hz-slot-5');
      const incoming = direction > 0
        ? context.section.querySelector('.hz-slot-6')
        : context.section.querySelector('.hz-slot-0');
      const transientSlot = direction > 0 ? 0 : 6;
      const incomingSlot = direction > 0 ? 5 : 1;

      assert.equal(context.controller.move(direction), true);
      assert.equal(outgoing.classList.contains(`hz-slot-${transientSlot}`), true);
      assert.equal(outgoing.style.visibility, '');
      assert.equal(outgoing.tabIndex, -1);
      assert.equal(outgoing.getAttribute('aria-hidden'), 'true');
      assert.equal(incoming.classList.contains(`hz-slot-${incomingSlot}`), true);
      assert.equal(incoming.style.visibility, '');
      assert.equal(incoming.tabIndex, -1);
      assert.equal(incoming.hasAttribute('aria-hidden'), false);
      assert.equal(
        context.section.querySelector('.hz-slot-3').dataset.path,
        context.controller.currentItem().file.path,
      );

      clock.tick(349);
      assert.equal(outgoing.classList.contains(`hz-slot-${transientSlot}`), true);
      assert.equal(outgoing.style.visibility, '');
      assert.deepEqual(cards.map((card) => card.dataset.path), cards.map((card) => paths.get(card)));

      clock.tick(1);
      assert.equal(outgoing.classList.contains(`hz-slot-${transientSlot}`), true);
      assert.equal(outgoing.style.visibility, 'hidden');
      assert.equal(outgoing.tabIndex, -1);
      assert.equal(outgoing.getAttribute('aria-hidden'), 'true');
      assert.equal(cards.filter((card) => card.dataset.path !== paths.get(card)).length, 1);
      assert.equal(context.controller.cards.length, 7);
      for (const card of cards) assert.ok(context.section.contains(card));
    } finally {
      context.controller.destroy();
      clock.restore();
      context.dom.window.close();
    }
  }
});

test('resting off-canvas cards cannot activate by keyboard or click', () => {
  const context = setup(journalsFor('2026', '08', 8));
  try {
    context.controller.mount();
    for (const slot of [0, 6]) {
      const card = context.section.querySelector(`.hz-slot-${slot}`);
      assert.equal(card.style.visibility, 'hidden');
      assert.equal(card.tabIndex, -1);
      assert.equal(card.getAttribute('aria-hidden'), 'true');
      card.dispatchEvent(new context.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      card.dispatchEvent(new context.dom.window.MouseEvent('click', { bubbles: true }));
    }
    assert.equal(context.opened.length, 0);
  } finally {
    context.controller.destroy();
    context.dom.window.close();
  }
});

test('animation keeps only the latest queued direction and selection cancels pending work', () => {
  const context = setup(journalsFor('2026', '08', 8));
  const clock = installFakeClock(context.dom.window);
  try {
    context.controller.mount();
    clock.tick(0);
    context.controller.move(1);
    context.controller.move(-1);
    context.controller.move(1);
    assert.equal(context.controller.queuedDirection, 1);

    clock.tick(350);
    assert.equal(context.controller.state.index, 2);
    assert.equal(context.controller.animating, true);
    clock.tick(350);
    assert.equal(context.controller.animating, false);

    context.controller.move(-1);
    context.controller.move(1);
    context.controller.setJournals([
      ...journalsFor('2026', '08', 8),
      ...journalsFor('2026', '07', 4),
    ], 'daily/2026-07-02.md');
    const selectedIndex = context.controller.state.index;
    assert.equal(context.controller.animationTimeout, 0);
    assert.equal(context.controller.queuedDirection, 0);
    clock.tick(1000);
    assert.equal(context.controller.state.index, selectedIndex);
    assert.equal(context.controller.currentItem().file.path, 'daily/2026-07-02.md');
  } finally {
    context.controller.destroy();
    assert.equal(clock.pending(), 0);
    clock.restore();
    context.dom.window.close();
  }
});

test('a recycled side-card click centers its current journal path before a later open', () => {
  const context = setup(journalsFor('2026', '08', 8));
  const clock = installFakeClock(context.dom.window);
  try {
    context.controller.mount();
    const cards = [...context.controller.cards];
    const previous = new Map(cards.map((card) => [card, card.dataset.path]));
    context.controller.move(1, { animate: false });
    const recycled = cards.find((card) => card.dataset.path !== previous.get(card));
    assert.ok(recycled);

    context.controller.move(1, { animate: false });
    assert.equal(recycled.classList.contains('hz-slot-5'), true);
    const targetPath = recycled.dataset.path;
    pointerClick(context, recycled);
    assert.deepEqual(context.opened, []);

    clock.tick(ANIMATION_MS * 2);
    const currentCard = context.section.querySelector('.hz-slot-3');
    assert.equal(currentCard.dataset.path, targetPath);
    currentCard.click();

    assert.deepEqual(context.opened, [currentCard.__journal]);
    assert.equal(context.opened[0].file.path, targetPath);
    assert.notEqual(context.opened[0].file.path, previous.get(recycled));
  } finally {
    context.controller.destroy();
    clock.restore();
    context.dom.window.close();
  }
});

test('a dispatched drag suppresses one synthetic click and a later click opens normally', () => {
  const context = setup(journalsFor('2026', '08', 8));
  const clock = installFakeClock(context.dom.window);
  const frames = installFakeAnimationFrames(context.dom.window);
  try {
    context.controller.mount();
    clock.tick(0);
    const draggedCard = context.section.querySelector('.hz-slot-3');
    draggedCard.dispatchEvent(pointerEvent(context.dom.window, 'pointerdown', 100));
    draggedCard.dispatchEvent(pointerEvent(context.dom.window, 'pointermove', 65));
    draggedCard.dispatchEvent(pointerEvent(context.dom.window, 'pointerup', 65));
    draggedCard.__parts.cover.dispatchEvent(new context.dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    assert.equal(context.opened.length, 0);

    clock.tick(0);
    frames.run();
    const currentCard = context.section.querySelector('.hz-slot-3');
    currentCard.dispatchEvent(new context.dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    assert.equal(context.opened.length, 1);
    assert.equal(context.opened[0], currentCard.__journal);
  } finally {
    context.controller.destroy();
    frames.restore();
    clock.restore();
    context.dom.window.close();
  }
});

test('cover title and blank area share one native button click path without custom keydown activation', () => {
  const context = setup(journalsFor('2026', '08', 8));
  try {
    context.controller.mount();
    const currentCard = context.section.querySelector('.hz-slot-3');
    assert.equal(currentCard.tabIndex, 0);
    assert.equal(currentCard.tagName, 'BUTTON');
    assert.equal(currentCard.type, 'button');
    assert.equal(currentCard.hasAttribute('role'), false);

    currentCard.__parts.cover.dispatchEvent(new context.dom.window.MouseEvent('click', { bubbles: true }));
    currentCard.__parts.meditation.dispatchEvent(new context.dom.window.MouseEvent('click', { bubbles: true }));
    currentCard.dispatchEvent(new context.dom.window.MouseEvent('click', { bubbles: true }));
    currentCard.dispatchEvent(new context.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    currentCard.dispatchEvent(new context.dom.window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    assert.deepEqual(context.opened, Array(3).fill(currentCard.__journal));
  } finally {
    context.controller.destroy();
    context.dom.window.close();
  }
});

test('pointercancel and destroy use the public cancellation path and release active capture', () => {
  const context = setup(journalsFor('2026', '08', 8));
  context.controller.mount();
  const currentCard = context.section.querySelector('.hz-slot-3');
  let captures = 0;
  let releases = 0;
  let cancellations = 0;
  currentCard.setPointerCapture = () => { captures += 1; };
  currentCard.releasePointerCapture = () => { releases += 1; };
  const cancelPointerGesture = context.controller.cancelPointerGesture.bind(context.controller);
  context.controller.cancelPointerGesture = () => {
    cancellations += 1;
    cancelPointerGesture();
  };

  currentCard.dispatchEvent(pointerEvent(context.dom.window, 'pointerdown', 100));
  currentCard.dispatchEvent(pointerEvent(context.dom.window, 'pointermove', 135));
  currentCard.dispatchEvent(pointerEvent(context.dom.window, 'pointercancel', 135));
  assert.equal(captures, 1);
  assert.equal(releases, 1);
  assert.equal(cancellations, 2);
  assert.equal(context.controller.pointer, null);
  assert.deepEqual(context.opened, []);

  currentCard.dispatchEvent(pointerEvent(context.dom.window, 'pointerdown', 100));
  currentCard.dispatchEvent(pointerEvent(context.dom.window, 'pointermove', 65));
  context.controller.destroy();
  assert.equal(captures, 2);
  assert.equal(releases, 2);
  assert.equal(cancellations, 4);
  assert.equal(context.controller.pointer, null);
  assert.deepEqual(context.opened, []);
  context.dom.window.close();
});

test('cards are native buttons and a pending pointer gesture leaves activation to click', () => {
  const context = setup(journalsFor('2026', '08', 8));
  try {
    context.controller.mount();
    const currentCard = context.section.querySelector('.hz-slot-3');
    assert.equal(currentCard.tagName, 'BUTTON');
    assert.equal(currentCard.type, 'button');

    let captures = 0;
    currentCard.setPointerCapture = () => { captures += 1; };

    currentCard.__parts.cover.dispatchEvent(pointerEvent(context.dom.window, 'pointerdown', 100));
    currentCard.dispatchEvent(pointerEvent(context.dom.window, 'pointerup', 110));
    assert.equal(captures, 0);
    assert.deepEqual(context.opened, []);

    currentCard.click();
    assert.deepEqual(context.opened, [currentCard.__journal]);
  } finally {
    context.controller.destroy();
    context.dom.window.close();
  }
});

test('drag captures only after 35 pixels and cancels exactly its synthetic click', () => {
  const context = setup(journalsFor('2026', '08', 8));
  const frames = installFakeAnimationFrames(context.dom.window);
  try {
    context.controller.mount();
    const currentCard = context.section.querySelector('.hz-slot-3');
    setCardWidth(currentCard, 100);
    const initialIndex = context.controller.state.index;
    let captures = 0;
    let releases = 0;
    currentCard.setPointerCapture = () => { captures += 1; };
    currentCard.releasePointerCapture = () => { releases += 1; };

    currentCard.dispatchEvent(pointerEvent(context.dom.window, 'pointerdown', 100));
    currentCard.dispatchEvent(pointerEvent(context.dom.window, 'pointermove', 134));
    assert.equal(captures, 0);
    currentCard.dispatchEvent(pointerEvent(context.dom.window, 'pointermove', 135));
    assert.equal(captures, 1);
    currentCard.dispatchEvent(pointerEvent(context.dom.window, 'pointermove', 150));
    frames.frame();
    currentCard.dispatchEvent(pointerEvent(context.dom.window, 'pointerup', 150));
    frames.run();

    assert.equal(releases, 1);
    assert.equal(context.controller.state.index, (initialIndex - 1 + 8) % 8);
    assert.notEqual(context.controller.state.index, initialIndex);
    currentCard.click();
    assert.deepEqual(context.opened, []);
    currentCard.click();
    assert.deepEqual(context.opened, [currentCard.__journal]);
  } finally {
    context.controller.destroy();
    frames.restore();
    context.dom.window.close();
  }
});

test('drag takeover follows a pointer retreat and snaps back without losing click suppression', () => {
  const context = setup(journalsFor('2026', '08', 8));
  const frames = installFakeAnimationFrames(context.dom.window);
  try {
    context.controller.mount();
    const currentCard = context.section.querySelector('.hz-slot-3');
    setCardWidth(currentCard, 100);
    const initialIndex = context.controller.state.index;

    currentCard.dispatchEvent(pointerEvent(context.dom.window, 'pointerdown', 100));
    currentCard.dispatchEvent(pointerEvent(context.dom.window, 'pointermove', 135));
    currentCard.dispatchEvent(pointerEvent(context.dom.window, 'pointermove', 105));
    frames.frame();
    currentCard.dispatchEvent(pointerEvent(context.dom.window, 'pointerup', 105));
    frames.run();
    currentCard.click();

    assert.equal(context.controller.state.index, initialIndex);
    assert.deepEqual(context.opened, []);
    currentCard.click();
    assert.deepEqual(context.opened, [currentCard.__journal]);
  } finally {
    context.controller.destroy();
    frames.restore();
    context.dom.window.close();
  }
});

test('drag samples follow the pointer on one deterministic animation frame without committing selection', () => {
  const context = setup(journalsFor('2026', '08', 8));
  const frames = installFakeAnimationFrames(context.dom.window);
  try {
    context.controller.mount();
    const cards = [...context.controller.cards];
    const currentCard = context.section.querySelector('.hz-slot-3');
    setCardWidth(currentCard, 100);
    const initialIndex = context.controller.state.index;
    const initialTabbable = tabbableCards(context.section)[0];

    currentCard.dispatchEvent(pointerEvent(context.dom.window, 'pointerdown', 100));
    frames.advance(20);
    currentCard.dispatchEvent(pointerEvent(context.dom.window, 'pointermove', 60));

    assert.equal(context.controller.pointer.phase, 'dragging');
    assert.equal(context.controller.stage.classList.contains('is-dragging'), true);
    assert.equal(context.controller.stage.classList.contains('is-settling'), false);
    assert.deepEqual(context.controller.pointer.samples, [
      { x: 100, time: 0 },
      { x: 60, time: 20 },
    ]);
    assert.equal(context.controller.pauses.has('gesture'), true);
    assert.equal(frames.pending(), 1);
    assert.equal(context.controller.stage.style.getPropertyValue('--hz-carousel-drag-x'), '');

    frames.frame();

    assert.equal(context.controller.stage.style.getPropertyValue('--hz-carousel-drag-x'), '-40px');
    assert.equal(context.controller.stage.style.getPropertyValue('--hz-carousel-drag-opacity'), '0.6');
    assert.equal(context.controller.stage.style.transform, '');
    assert.equal(context.controller.stage.style.opacity, '');
    assert.equal(context.controller.state.index, initialIndex);
    assert.equal(tabbableCards(context.section)[0], initialTabbable);
    assert.deepEqual(context.controller.cards, cards);
  } finally {
    context.controller.destroy();
    assert.equal(frames.pending(), 0);
    frames.restore();
    context.dom.window.close();
  }
});

test('pointer release projects bounded inertia and commits index plus ARIA only after snap completion', () => {
  const context = setup(journalsFor('2026', '08', 8));
  const frames = installFakeAnimationFrames(context.dom.window);
  try {
    context.controller.mount();
    const cards = [...context.controller.cards];
    const currentCard = context.section.querySelector('.hz-slot-3');
    setCardWidth(currentCard, 100);
    const initialIndex = context.controller.state.index;
    let captures = 0;
    let releases = 0;
    currentCard.setPointerCapture = () => { captures += 1; };
    currentCard.releasePointerCapture = () => { releases += 1; };

    currentCard.dispatchEvent(pointerEvent(context.dom.window, 'pointerdown', 100));
    frames.advance(20);
    currentCard.dispatchEvent(pointerEvent(context.dom.window, 'pointermove', 60));
    frames.frame(0);
    currentCard.dispatchEvent(pointerEvent(context.dom.window, 'pointerup', 60));

    assert.equal(context.controller.pointer.phase, 'settling');
    assert.equal(context.controller.stage.classList.contains('is-dragging'), false);
    assert.equal(context.controller.stage.classList.contains('is-settling'), true);
    assert.equal(context.controller.pointer.destination, 2);
    assert.equal(context.controller.state.index, initialIndex);
    assert.equal(context.section.querySelector('.hz-slot-3'), currentCard);
    assert.equal(captures, 1);
    assert.equal(releases, 1);
    assert.equal(frames.pending(), 1);

    frames.frame(40);
    assert.equal(context.controller.state.index, initialIndex);
    assert.notEqual(context.controller.stage.style.getPropertyValue('--hz-carousel-drag-x'), '-40px');

    frames.frame(40);

    assert.equal(context.controller.pointer, null);
    assert.equal(context.controller.state.index, initialIndex + 2);
    assert.equal(context.controller.currentItem(), context.controller.state.items[initialIndex + 2]);
    assert.equal(context.controller.stage.classList.contains('is-settling'), true);
    assert.equal(context.controller.stage.style.getPropertyValue('--hz-carousel-drag-x'), '-200px');
    assert.equal(tabbableCards(context.section)[0].__journal, context.controller.currentItem());
    assert.equal(frames.pending(), 1);

    frames.frame(40);

    assert.equal(context.controller.stage.classList.contains('is-settling'), true);
    assert.equal(context.controller.stage.style.getPropertyValue('--hz-carousel-drag-x'), '');
    assert.equal(context.controller.stage.style.getPropertyValue('--hz-carousel-drag-opacity'), '');
    assert.equal(context.controller.pauses.has('gesture'), true);
    assert.equal(frames.pending(), 1);

    frames.frame(40);

    assert.equal(context.controller.pointer, null);
    assert.equal(context.controller.state.index, initialIndex + 2);
    assert.equal(context.controller.currentItem(), context.controller.state.items[initialIndex + 2]);
    assert.equal(context.controller.stage.style.getPropertyValue('--hz-carousel-drag-x'), '');
    assert.equal(context.controller.stage.style.getPropertyValue('--hz-carousel-drag-opacity'), '');
    assert.equal(context.controller.stage.classList.contains('is-dragging'), false);
    assert.equal(context.controller.stage.classList.contains('is-settling'), false);
    assert.equal(context.controller.pauses.has('gesture'), false);
    assert.equal(tabbableCards(context.section)[0].__journal, context.controller.currentItem());
    assert.deepEqual(context.controller.cards, cards);
    assert.equal(frames.pending(), 0);
  } finally {
    context.controller.destroy();
    frames.restore();
    context.dom.window.close();
  }
});

test('rerender pause and destroy cancel either deferred settle cleanup phase without retaining gesture state', () => {
  for (const cleanupPhase of ['committed', 'variables-reset']) {
    for (const action of ['rerender', 'pause', 'destroy']) {
      const context = setup(journalsFor('2026', '08', 8));
      const frames = installFakeAnimationFrames(context.dom.window);
      try {
        context.controller.mount();
        const currentCard = context.section.querySelector('.hz-slot-3');
        setCardWidth(currentCard, 100);

        currentCard.dispatchEvent(pointerEvent(context.dom.window, 'pointerdown', 100));
        frames.advance(20);
        currentCard.dispatchEvent(pointerEvent(context.dom.window, 'pointermove', 60));
        frames.frame(0);
        currentCard.dispatchEvent(pointerEvent(context.dom.window, 'pointerup', 60));
        frames.frame(40);
        frames.frame(40);

        assert.equal(context.controller.pointer, null);
        assert.equal(context.controller.stage.classList.contains('is-settling'), true);
        assert.equal(frames.pending(), 1);

        if (cleanupPhase === 'variables-reset') {
          frames.frame(40);
          assert.equal(context.controller.stage.style.getPropertyValue('--hz-carousel-drag-x'), '');
          assert.equal(context.controller.stage.style.getPropertyValue('--hz-carousel-drag-opacity'), '');
          assert.equal(context.controller.stage.classList.contains('is-settling'), true);
          assert.equal(frames.pending(), 1);
        }

        if (action === 'rerender') context.controller.renderPool();
        if (action === 'pause') context.controller.pause('view-inactive');
        if (action === 'destroy') context.controller.destroy();

        assert.equal(frames.pending(), 0);
        assert.equal(context.controller.pauses.has('gesture'), false);
        if (action !== 'destroy') {
          assert.equal(context.controller.stage.classList.contains('is-dragging'), false);
          assert.equal(context.controller.stage.classList.contains('is-settling'), false);
          assert.equal(context.controller.stage.style.getPropertyValue('--hz-carousel-drag-x'), '');
          assert.equal(context.controller.stage.style.getPropertyValue('--hz-carousel-drag-opacity'), '');
        }
      } finally {
        context.controller.destroy();
        assert.equal(frames.pending(), 0);
        frames.restore();
        context.dom.window.close();
      }
    }
  }
});

test('pointercancel rolls back drag variables and releases the exact capture once', () => {
  const context = setup(journalsFor('2026', '08', 8));
  const frames = installFakeAnimationFrames(context.dom.window);
  try {
    context.controller.mount();
    const currentCard = context.section.querySelector('.hz-slot-3');
    setCardWidth(currentCard, 100);
    const initialIndex = context.controller.state.index;
    const released = [];
    currentCard.setPointerCapture = () => {};
    currentCard.releasePointerCapture = (pointerId) => released.push(pointerId);

    currentCard.dispatchEvent(pointerEvent(context.dom.window, 'pointerdown', 100, 19));
    frames.advance(20);
    currentCard.dispatchEvent(pointerEvent(context.dom.window, 'pointermove', 55, 19));
    frames.frame();
    currentCard.dispatchEvent(pointerEvent(context.dom.window, 'pointercancel', 55, 19));
    context.controller.cancelPointerGesture();

    assert.equal(context.controller.pointer, null);
    assert.deepEqual(released, [19]);
    assert.equal(context.controller.state.index, initialIndex);
    assert.equal(context.controller.stage.style.getPropertyValue('--hz-carousel-drag-x'), '');
    assert.equal(context.controller.stage.style.getPropertyValue('--hz-carousel-drag-opacity'), '');
    assert.equal(context.controller.pauses.has('gesture'), false);
    assert.equal(frames.pending(), 0);
  } finally {
    context.controller.destroy();
    frames.restore();
    context.dom.window.close();
  }
});

test('a pending gesture released outside the stage cannot strand autoplay pause', () => {
  const context = setup(journalsFor('2026', '08', 8));
  try {
    context.controller.mount();
    const currentCard = context.section.querySelector('.hz-slot-3');

    currentCard.dispatchEvent(pointerEvent(context.dom.window, 'pointerdown', 100, 23));
    context.dom.window.dispatchEvent(pointerEvent(context.dom.window, 'pointerup', 110, 23));

    assert.equal(context.controller.pointer, null);
    assert.equal(context.controller.pauses.has('gesture'), false);
    assert.equal(context.controller.state.index, 0);
  } finally {
    context.controller.destroy();
    context.dom.window.close();
  }
});

test('pointer takeover finishes legacy motion and rejects competing wheel movement', () => {
  const context = setup(journalsFor('2026', '08', 8));
  const clock = installFakeClock(context.dom.window);
  const frames = installFakeAnimationFrames(context.dom.window);
  try {
    context.controller.mount();
    context.controller.move(1);
    const movedIndex = context.controller.state.index;
    assert.equal(context.controller.animating, true);
    const currentCard = context.controller.cards.find((card) => card.__journal === context.controller.currentItem());
    setCardWidth(currentCard, 100);

    currentCard.dispatchEvent(pointerEvent(context.dom.window, 'pointerdown', 100));

    assert.equal(context.controller.animating, false);
    assert.equal(context.controller.animationTimeout, 0);
    assert.equal(context.section.querySelector('.hz-slot-3').__journal, context.controller.currentItem());
    context.controller.onWheel({ deltaY: 40, deltaMode: 0, preventDefault() {} });
    assert.equal(context.controller.state.index, movedIndex);

    frames.advance(20);
    context.dom.window.dispatchEvent(pointerEvent(context.dom.window, 'pointermove', 60));
    frames.frame(0);
    context.controller.onWheel({ deltaY: 40, deltaMode: 0, preventDefault() {} });
    assert.equal(context.controller.state.index, movedIndex);
    context.dom.window.dispatchEvent(pointerEvent(context.dom.window, 'pointerup', 60));
    assert.equal(context.controller.pointer.phase, 'settling');
    context.controller.onWheel({ deltaY: 40, deltaMode: 0, preventDefault() {} });
    assert.equal(context.controller.state.index, movedIndex);
    frames.run(40);
    assert.equal(context.controller.state.index, movedIndex + 2);
  } finally {
    context.controller.destroy();
    assert.equal(frames.pending(), 0);
    frames.restore();
    clock.restore();
    context.dom.window.close();
  }
});

test('view pause during settling commits a coherent resting DOM and leaves no animation frame', () => {
  const context = setup(journalsFor('2026', '08', 8));
  const frames = installFakeAnimationFrames(context.dom.window);
  try {
    context.controller.mount();
    const currentCard = context.section.querySelector('.hz-slot-3');
    setCardWidth(currentCard, 100);

    currentCard.dispatchEvent(pointerEvent(context.dom.window, 'pointerdown', 100));
    frames.advance(20);
    currentCard.dispatchEvent(pointerEvent(context.dom.window, 'pointermove', 60));
    frames.frame(0);
    currentCard.dispatchEvent(pointerEvent(context.dom.window, 'pointerup', 60));
    context.controller.pause('view-inactive');

    assert.equal(context.controller.pointer, null);
    assert.equal(context.controller.state.index, 2);
    assert.equal(context.section.querySelector('.hz-slot-3').__journal, context.controller.currentItem());
    assert.deepEqual([...context.controller.pauses], ['view-inactive']);
    assert.equal(context.controller.stage.style.getPropertyValue('--hz-carousel-drag-x'), '');
    assert.equal(frames.pending(), 0);

    context.controller.onAutoTick();
    assert.equal(context.controller.state.index, 2);
    context.controller.resume('view-inactive');
    context.controller.onAutoTick();
    assert.equal(context.controller.state.index, 3);
  } finally {
    context.controller.destroy();
    frames.restore();
    context.dom.window.close();
  }
});

test('rerender cancels an active drag frame and restores the resting pool', () => {
  const context = setup(journalsFor('2026', '08', 8));
  const frames = installFakeAnimationFrames(context.dom.window);
  try {
    context.controller.mount();
    const currentCard = context.section.querySelector('.hz-slot-3');
    setCardWidth(currentCard, 100);

    currentCard.dispatchEvent(pointerEvent(context.dom.window, 'pointerdown', 100));
    frames.advance(20);
    currentCard.dispatchEvent(pointerEvent(context.dom.window, 'pointermove', 60));
    assert.equal(frames.pending(), 1);

    context.controller.renderPool();

    assert.equal(context.controller.pointer, null);
    assert.equal(context.controller.state.index, 0);
    assert.equal(context.section.querySelector('.hz-slot-3').__journal, context.controller.currentItem());
    assert.equal(context.controller.pauses.has('gesture'), false);
    assert.equal(frames.pending(), 0);
  } finally {
    context.controller.destroy();
    frames.restore();
    context.dom.window.close();
  }
});

test('pending dragging and settling pause autoplay and destroy rejects late pointer or frame work', () => {
  const context = setup(journalsFor('2026', '08', 8));
  const frames = installFakeAnimationFrames(context.dom.window);
  context.controller.mount();
  const currentCard = context.section.querySelector('.hz-slot-3');
  setCardWidth(currentCard, 100);
  const initialIndex = context.controller.state.index;

  currentCard.dispatchEvent(pointerEvent(context.dom.window, 'pointerdown', 100));
  context.controller.onAutoTick();
  assert.equal(context.controller.state.index, initialIndex);
  frames.advance(20);
  currentCard.dispatchEvent(pointerEvent(context.dom.window, 'pointermove', 60));
  context.controller.onAutoTick();
  assert.equal(context.controller.state.index, initialIndex);
  frames.frame(0);
  currentCard.dispatchEvent(pointerEvent(context.dom.window, 'pointerup', 60));
  context.controller.onAutoTick();
  assert.equal(context.controller.state.index, initialIndex);

  context.controller.destroy();
  assert.equal(frames.pending(), 0);
  assert.equal(context.controller.pointer, null);
  assert.equal(context.controller.pauses.size, 0);
  currentCard.dispatchEvent(pointerEvent(context.dom.window, 'pointermove', 0));
  currentCard.dispatchEvent(pointerEvent(context.dom.window, 'pointerup', 0));
  frames.frame();
  assert.equal(context.controller.state.index, 0);
  assert.equal(frames.pending(), 0);
  frames.restore();
  context.dom.window.close();
});

test('destroy removes only controller-owned DOM and permits a clean remount', () => {
  const journals = journalsFor('2026', '08', 8);
  const context = setup(journals);
  const stable = context.stable;
  context.controller.mount();
  context.controller.destroy();

  assert.equal(context.section.querySelector('#stable'), stable);
  assert.equal(context.section.querySelectorAll('select').length, 0);
  assert.equal(context.section.querySelectorAll('.hz-carousel-controls,.hz-orbit,.hz-axis,.hz-carousel-stage,.hz-center-dot,.hz-gesture,.hz-jcard').length, 0);

  const fresh = new CarouselController({
    section: context.section,
    journals,
    openJournal() {},
    settings: { carouselSeconds: 60 },
    windowRef: context.dom.window,
  });
  try {
    fresh.mount();
    assert.equal(context.section.querySelectorAll('.hz-jcard').length, 7);
    assert.equal(context.section.querySelectorAll('select').length, 2);
    assert.equal(context.section.querySelector('#stable'), stable);
  } finally {
    fresh.destroy();
    context.dom.window.close();
  }
});

test('visible covers start synchronously while preparatory covers idle and promote on entry', () => {
  const context = setup(journalsFor('2026', '08', 8));
  const idleCallbacks = new Map();
  const cancelled = new Set();
  const images = [];
  let nextIdleId = 1;
  context.dom.window.requestIdleCallback = (callback) => {
    const id = nextIdleId++;
    idleCallbacks.set(id, callback);
    return id;
  };
  context.dom.window.cancelIdleCallback = (id) => {
    cancelled.add(id);
    idleCallbacks.delete(id);
  };
  context.dom.window.Image = class {
    constructor() {
      this.listeners = new Map();
      images.push(this);
    }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    removeEventListener(type) { this.listeners.delete(type); }
    set src(value) { this.url = value; }
  };

  try {
    context.controller.mount();
    assert.equal(images.length, 5);
    assert.equal(idleCallbacks.size, 2);
    assert.equal(context.controller.idleCallbacks.size, 2);

    const incoming = context.section.querySelector('.hz-slot-6');
    const incomingUrl = incoming.__parts.cover.dataset.coverUrl;
    context.controller.move(1);
    assert.equal(incoming.classList.contains('hz-slot-5'), true);
    assert.equal(images.length, 6);
    assert.equal(images.some((image) => image.url === incomingUrl), true);
    assert.equal(cancelled.size, 1);
    assert.equal(context.controller.idleCallbacks.size, 1);
  } finally {
    context.controller.destroy();
    context.dom.window.close();
  }
});

test('preparatory preload falls back to a zero-delay timeout', () => {
  const context = setup([]);
  const clock = installFakeClock(context.dom.window);
  const images = [];
  context.dom.window.requestIdleCallback = undefined;
  context.dom.window.Image = class {
    constructor() { images.push(this); }
    addEventListener() {}
    removeEventListener() {}
  };

  try {
    context.controller.preload('https://example.test/timeout.jpg');
    assert.equal(context.controller.idleCallbacks.size, 1);
    assert.equal(images.length, 0);
    clock.tick(0);
    assert.equal(images.length, 1);
    assert.equal(context.controller.idleCallbacks.size, 0);
  } finally {
    context.controller.destroy();
    clock.restore();
    context.dom.window.close();
  }
});

test('cover preloads deduplicate by URL and notify every visible cover', () => {
  const source = journalsFor('2026', '08', 5).map((item) => ({
    ...item,
    cover: 'https://example.test/shared.jpg',
  }));
  const context = setup(source);
  const images = [];
  context.dom.window.Image = class {
    constructor() {
      this.listeners = new Map();
      images.push(this);
    }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    removeEventListener(type) { this.listeners.delete(type); }
    dispatch(type) { this.listeners.get(type)?.(); }
  };

  try {
    context.controller.mount();
    assert.equal(images.length, 1);
    images[0].dispatch('load');
    assert.equal(context.section.querySelectorAll('.hz-jcard-cover.is-loaded').length, 5);

    context.controller.setJournals(source);
    assert.equal(images.length, 1);
    assert.equal(context.section.querySelectorAll('.hz-jcard-cover.is-loaded').length, 5);
  } finally {
    context.controller.destroy();
    context.dom.window.close();
  }
});

test('rapid reassignment and destroy detach preloads and reject late completion', async () => {
  const context = setup(journalsFor('2026', '08', 2));
  const images = [];
  const decodeResolvers = [];
  context.dom.window.Image = class {
    constructor() {
      this.listeners = new Map();
      images.push(this);
    }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    removeEventListener(type) { this.listeners.delete(type); }
    set src(value) { this.url = value; }
    dispatch(type) { this.listeners.get(type)?.(); }
    decode() { return new Promise((resolve) => decodeResolvers.push(resolve)); }
  };

  context.controller.mount();
  const cover = context.controller.cards[0].__parts.cover;
  const removedCover = context.controller.cards[1].__parts.cover;
  const oldImage = images.find((image) => image.url === cover.dataset.coverUrl);
  const removedImage = images.find((image) => image.url === removedCover.dataset.coverUrl);
  context.controller.setJournals(journalsFor('2026', '08', 1).map((item, index) => ({
    ...item,
    cover: `https://example.test/reassigned-${index}.jpg`,
  })));
  const currentUrl = cover.dataset.coverUrl;
  const currentImage = images.find((image) => image.url === currentUrl);
  oldImage.dispatch('load');
  assert.equal(cover.classList.contains('is-loaded'), false);
  removedImage.dispatch('load');
  assert.equal(removedCover.classList.contains('is-loaded'), false);
  currentImage.dispatch('load');
  assert.equal(cover.classList.contains('is-loaded'), true);

  cover.classList.remove('is-loaded');
  context.controller.destroy();
  assert.equal(context.controller.idleCallbacks.size, 0);
  assert.equal(context.controller.preloads.size, 0);
  for (const image of images) assert.equal(image.listeners.size, 0);
  for (const resolve of decodeResolvers) resolve();
  await Promise.resolve();
  assert.equal(cover.classList.contains('is-loaded'), false);
  context.dom.window.close();
});

test('destroy releases journal and window-owning references into neutral state', () => {
  const source = journalsFor('2026', '08', 8);
  const context = setup(source);
  context.controller.mount();
  const previousIndex = context.controller.index;
  const previousSelection = context.controller.selection;
  const previousState = context.controller.state;
  const previousSettings = context.controller.settings;
  const previousWindow = context.controller.windowRef;

  context.controller.destroy();
  context.controller.destroy();

  assert.equal(context.controller.currentItem(), null);
  assert.notEqual(context.controller.index, previousIndex);
  assert.deepEqual(context.controller.index.years, []);
  assert.equal(context.controller.index.itemsByMonth.size, 0);
  assert.notEqual(context.controller.selection, previousSelection);
  assert.deepEqual(context.controller.selection, { year: '', month: '' });
  assert.notEqual(context.controller.state, previousState);
  assert.deepEqual(context.controller.state.items, []);
  assert.equal(context.controller.settings, null);
  assert.notEqual(context.controller.settings, previousSettings);
  assert.equal(context.controller.windowRef, null);
  assert.notEqual(context.controller.windowRef, previousWindow);
  context.controller.pause('after-destroy');
  assert.equal(context.controller.pauses.size, 0);
  context.controller.resume('after-destroy');
  assert.equal(context.controller.pauses.size, 0);
  context.dom.window.close();
});

test('setJournals selects an existing preferred path in a non-latest month', () => {
  const context = setup(journalsFor('2026', '08', 2));
  try {
    context.controller.mount();
    const replacement = [
      ...journalsFor('2026', '08', 3),
      ...journalsFor('2026', '07', 4),
    ];
    const preferredPath = 'daily/2026-07-02.md';

    context.controller.setJournals(replacement, preferredPath);

    assert.deepEqual(context.controller.selection, { year: '2026', month: '07' });
    assert.equal(context.controller.currentItem().file.path, preferredPath);
    assert.equal(context.controller.monthSelect.value, '07');
  } finally {
    context.controller.destroy();
    context.dom.window.close();
  }
});

test('constructor retains a preferred journal without a second journal update', () => {
  const preferredPath = 'daily/2026-07-02.md';
  const context = setup([
    ...journalsFor('2026', '08', 3),
    ...journalsFor('2026', '07', 4),
  ], { preferredPath });
  try {
    context.controller.mount();

    assert.deepEqual(context.controller.selection, { year: '2026', month: '07' });
    assert.equal(context.controller.currentItem().file.path, preferredPath);
    assert.equal(context.controller.monthSelect.value, '07');
  } finally {
    context.controller.destroy();
    context.dom.window.close();
  }
});

test('setJournals with an absent preferred path falls back to latest selection', () => {
  const context = setup(journalsFor('2025', '12', 1));
  try {
    context.controller.mount();
    context.controller.setJournals([
      ...journalsFor('2026', '08', 3),
      ...journalsFor('2026', '07', 4),
    ], 'daily/missing.md');

    assert.deepEqual(context.controller.selection, { year: '2026', month: '08' });
    assert.equal(context.controller.currentItem().file.path, 'daily/2026-08-03.md');
  } finally {
    context.controller.destroy();
    context.dom.window.close();
  }
});

test('reduced motion disables auto movement and makes every input synchronous', () => {
  const context = setup(journalsFor('2026', '08', 8), {
    settings: { carouselSeconds: 3, reducedMotion: true },
  });
  try {
    context.controller.mount();
    const initial = context.controller.state.index;
    context.controller.onAutoTick();
    assert.equal(context.controller.state.index, initial);
    assert.equal(context.controller.intervalId, 0);

    context.controller.move(1);
    assert.equal(context.controller.state.index, initial + 1);
    assert.equal(context.controller.animating, false);
    assert.equal(context.controller.animationTimeout, 0);

    context.controller.onWheel({ deltaY: 40, deltaMode: 0, preventDefault() {} });
    assert.equal(context.controller.state.index, initial + 2);
    assert.equal(context.controller.animating, false);
    assert.equal(context.controller.animationTimeout, 0);

    context.controller.onPointerDown({ clientX: 100, pointerId: 1 });
    context.controller.onPointerMove({ clientX: 65, pointerId: 1 });
    context.controller.onPointerUp({ clientX: 65, pointerId: 1 });
    assert.equal(context.controller.state.index, initial + 3);
    assert.equal(context.controller.animating, false);
    assert.equal(context.controller.animationTimeout, 0);
  } finally {
    context.controller.destroy();
    context.dom.window.close();
  }
});
