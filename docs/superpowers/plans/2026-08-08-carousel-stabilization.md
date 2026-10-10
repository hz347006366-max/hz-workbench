# HZ Workbench Carousel Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add year/month journal filtering and a stable seven-card carousel that never triggers a full workbench render during navigation.

**Architecture:** Extract month indexing and carousel state into pure CommonJS modules, then add one DOM-facing `CarouselController` that owns only the journal section. `WorkbenchView` creates the surrounding workbench once and delegates month changes, automatic movement, wheel input, drag input, image preloading, pause/resume, and cleanup to the controller.

**Tech Stack:** Obsidian plugin API, CommonJS JavaScript, native DOM/Pointer Events, CSS transforms, Node.js `node:test`, jsdom, esbuild, pnpm.

---

**Working directory:** `/Users/zhanghanzhong/Documents/Codex/HZ个人工作台-v0.1.0/development/obsidian-hz-workbench`

**Dependency:** None. This plan must finish and pass before `2026-08-08-layout-editor.md` begins.

### Task 1: Establish a versioned baseline and DOM test runtime

**Files:**
- Create: `../../.gitignore`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Verify: `src/core.js`
- Verify: `src/main.js`
- Verify: `tests/core.test.js`
- Verify: `tests/ui.test.js`

- [ ] **Step 1: Add a delivery-root ignore file**

Create `../../.gitignore`:

```gitignore
**/node_modules/
**/.DS_Store
*.log
```

- [ ] **Step 2: Run the untouched baseline**

Run:

```bash
pnpm install
pnpm test
pnpm build
```

Expected: 15 tests pass, esbuild exits 0, and `main.js` is produced.

- [ ] **Step 3: Initialize the complete handoff as a Git repository**

Run:

```bash
git -C ../.. init
git -C ../.. add .gitignore development/obsidian-hz-workbench install/hz-workbench
git -C ../.. commit -m "chore: import hz workbench v0.1.0 baseline"
```

Expected: the first commit succeeds and `git status --short` is empty.

- [ ] **Step 4: Add jsdom for controller-level DOM tests**

Run:

```bash
pnpm add -D jsdom
```

Expected: `package.json` contains `"jsdom"` in `devDependencies` and `pnpm-lock.yaml` changes.

- [ ] **Step 5: Expand the check script to include every source file**

Change `package.json` scripts to:

```json
{
  "test": "node --test tests/*.test.js",
  "build": "node esbuild.config.mjs",
  "check": "node --check src/*.js && node --test tests/*.test.js"
}
```

- [ ] **Step 6: Verify the test runtime and commit**

Run:

```bash
pnpm check
git add package.json pnpm-lock.yaml
git commit -m "test: add jsdom controller test runtime"
```

Expected: 15 tests pass; commit succeeds.

### Task 2: Build a deterministic year/month journal index

**Files:**
- Create: `src/journal-index.js`
- Create: `tests/journal-index.test.js`
- Modify: `src/main.js:79-118`

- [ ] **Step 1: Write the failing index tests**

Create `tests/journal-index.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildJournalIndex,
  latestSelection,
  selectYear,
  selectMonth,
} = require('../src/journal-index');

function journal(date, path) {
  return { date, file: { path }, title: path };
}

test('groups journals by available year and month in descending order', () => {
  const index = buildJournalIndex([
    journal('2025-12-02', 'z.md'),
    journal('2026-08-01', 'b.md'),
    journal('2026-08-01', 'a.md'),
    journal('2026-07-31', 'c.md'),
  ]);
  assert.deepEqual(index.years, ['2026', '2025']);
  assert.deepEqual(index.monthsByYear.get('2026'), ['08', '07']);
  assert.deepEqual(index.itemsByMonth.get('2026-08').map((item) => item.file.path), ['a.md', 'b.md']);
});

test('keeps only the newest 30 journals in a month', () => {
  const entries = Array.from({ length: 31 }, (_, i) =>
    journal(`2026-08-${String(31 - i).padStart(2, '0')}`, `${i}.md`));
  const index = buildJournalIndex(entries);
  assert.equal(index.itemsByMonth.get('2026-08').length, 30);
  assert.equal(index.itemsByMonth.get('2026-08')[0].date, '2026-08-31');
  assert.equal(index.itemsByMonth.get('2026-08').at(-1).date, '2026-08-02');
});

test('defaults to the newest month that contains journals', () => {
  const index = buildJournalIndex([
    journal('2025-12-02', 'old.md'),
    journal('2026-07-31', 'new.md'),
  ]);
  assert.deepEqual(latestSelection(index), { year: '2026', month: '07' });
});

test('selecting a year chooses its newest valid month', () => {
  const index = buildJournalIndex([
    journal('2026-02-01', 'a.md'),
    journal('2026-07-01', 'b.md'),
    journal('2025-12-01', 'c.md'),
  ]);
  assert.deepEqual(selectYear(index, '2026'), { year: '2026', month: '07' });
  assert.deepEqual(selectMonth(index, '2026', '02'), { year: '2026', month: '02' });
});
```

- [ ] **Step 2: Run the test and verify the expected failure**

Run:

```bash
node --test tests/journal-index.test.js
```

Expected: FAIL with `Cannot find module '../src/journal-index'`.

- [ ] **Step 3: Implement the pure index**

Create `src/journal-index.js`:

```js
function validMonthKey(date) {
  const match = String(date || '').match(/^(\d{4})-(\d{2})-\d{2}$/);
  return match ? `${match[1]}-${match[2]}` : '';
}

function compareJournals(a, b) {
  return b.date.localeCompare(a.date) || a.file.path.localeCompare(b.file.path);
}

function buildJournalIndex(journals) {
  const grouped = new Map();
  for (const item of journals) {
    const key = validMonthKey(item.date);
    if (!key) continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  }

  const itemsByMonth = new Map();
  for (const [key, items] of grouped) {
    itemsByMonth.set(key, [...items].sort(compareJournals).slice(0, 30));
  }

  const years = [...new Set([...itemsByMonth.keys()].map((key) => key.slice(0, 4)))].sort().reverse();
  const monthsByYear = new Map(years.map((year) => [
    year,
    [...itemsByMonth.keys()]
      .filter((key) => key.startsWith(`${year}-`))
      .map((key) => key.slice(5))
      .sort()
      .reverse(),
  ]));
  return { years, monthsByYear, itemsByMonth };
}

function latestSelection(index) {
  const year = index.years[0] || '';
  return { year, month: index.monthsByYear.get(year)?.[0] || '' };
}

function selectYear(index, year) {
  if (!index.monthsByYear.has(year)) return latestSelection(index);
  return { year, month: index.monthsByYear.get(year)[0] || '' };
}

function selectMonth(index, year, month) {
  if (!index.monthsByYear.get(year)?.includes(month)) return selectYear(index, year);
  return { year, month };
}

module.exports = { buildJournalIndex, latestSelection, selectYear, selectMonth };
```

- [ ] **Step 4: Stop truncating journals globally**

In `WorkbenchIndex.journals()` in `src/main.js`, replace the return expression with:

```js
return results.sort((a, b) => b.date.localeCompare(a.date) || a.file.path.localeCompare(b.file.path));
```

This preserves all journal dates for the heatmap and lets `buildJournalIndex()` apply the 30-item limit per month.

- [ ] **Step 5: Run focused and full tests**

Run:

```bash
node --test tests/journal-index.test.js
pnpm check
```

Expected: 4 new tests and all 15 existing tests pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/journal-index.js src/main.js tests/journal-index.test.js
git commit -m "feat: index journals by year and month"
```

### Task 3: Implement deterministic carousel state and input thresholds

**Files:**
- Create: `src/carousel-model.js`
- Create: `tests/carousel-model.test.js`

- [ ] **Step 1: Write failing model tests**

Create `tests/carousel-model.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createCarouselState,
  visibleItems,
  move,
  accumulateWheel,
  dragDirection,
} = require('../src/carousel-model');

const items = (count) => Array.from({ length: count }, (_, index) => ({ id: String(index) }));

test('uses actual card count below five and seven pooled slots above five', () => {
  assert.equal(createCarouselState(items(4)).poolSize, 4);
  assert.equal(createCarouselState(items(5)).poolSize, 5);
  assert.equal(createCarouselState(items(30)).poolSize, 7);
});

test('centers actual items without duplicates when fewer than five exist', () => {
  const state = createCarouselState(items(4));
  assert.deepEqual(visibleItems(state).map((item) => item.id), ['0', '1', '2', '3']);
});

test('moves circularly without changing the item array', () => {
  const state = createCarouselState(items(8));
  const next = move(state, 1);
  assert.equal(next.index, 1);
  assert.equal(next.items, state.items);
  assert.equal(move(state, -1).index, 7);
});

test('wheel moves only when normalized accumulation reaches 40px', () => {
  let result = accumulateWheel({ pixels: 0, direction: 0 }, 39, 0);
  assert.equal(result.move, 0);
  result = accumulateWheel(result.state, 1, 0);
  assert.equal(result.move, 1);
  assert.deepEqual(result.state, { pixels: 0, direction: 0 });
});

test('wheel direction change clears the previous accumulation', () => {
  const first = accumulateWheel({ pixels: 0, direction: 0 }, 30, 0);
  const second = accumulateWheel(first.state, -20, 0);
  assert.equal(second.move, 0);
  assert.equal(second.state.pixels, 20);
  assert.equal(second.state.direction, -1);
});

test('horizontal drag requires 35 CSS pixels', () => {
  assert.equal(dragDirection(34), 0);
  assert.equal(dragDirection(35), -1);
  assert.equal(dragDirection(-35), 1);
});
```

- [ ] **Step 2: Run and confirm failure**

Run:

```bash
node --test tests/carousel-model.test.js
```

Expected: FAIL because `src/carousel-model.js` does not exist.

- [ ] **Step 3: Implement the model**

Create `src/carousel-model.js`:

```js
function createCarouselState(items, index = 0) {
  const safeItems = [...items];
  return {
    items: safeItems,
    index: safeItems.length ? ((index % safeItems.length) + safeItems.length) % safeItems.length : 0,
    poolSize: Math.min(safeItems.length, safeItems.length > 5 ? 7 : 5),
  };
}

function visibleItems(state) {
  if (state.items.length <= 5) return state.items;
  return [-2, -1, 0, 1, 2].map((offset) =>
    state.items[(state.index + offset + state.items.length) % state.items.length]);
}

function move(state, direction) {
  if (state.items.length < 2 || !direction) return state;
  return createCarouselState(state.items, state.index + Math.sign(direction));
}

function wheelPixels(delta, deltaMode) {
  if (deltaMode === 1) return delta * 16;
  if (deltaMode === 2) return delta * 800;
  return delta;
}

function accumulateWheel(state, delta, deltaMode) {
  const pixels = wheelPixels(delta, deltaMode);
  const direction = Math.sign(pixels);
  const nextPixels = direction && direction === state.direction
    ? state.pixels + Math.abs(pixels)
    : Math.abs(pixels);
  if (nextPixels >= 40) return { state: { pixels: 0, direction: 0 }, move: direction };
  return { state: { pixels: nextPixels, direction }, move: 0 };
}

function dragDirection(distance) {
  if (Math.abs(distance) < 35) return 0;
  return distance > 0 ? -1 : 1;
}

module.exports = { createCarouselState, visibleItems, move, accumulateWheel, dragDirection };
```

- [ ] **Step 4: Verify and commit**

Run:

```bash
node --test tests/carousel-model.test.js
pnpm check
git add src/carousel-model.js tests/carousel-model.test.js
git commit -m "feat: add deterministic carousel state"
```

Expected: all model and existing tests pass.

### Task 4: Build the stable seven-card DOM controller

**Files:**
- Create: `src/carousel-controller.js`
- Create: `tests/carousel-controller.test.js`

- [ ] **Step 1: Write failing DOM identity and lifecycle tests**

Create `tests/carousel-controller.test.js` with jsdom, a fake clock, and journal fixtures. The complete assertions must cover:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const { CarouselController } = require('../src/carousel-controller');

function journal(index, date = `2026-08-${String(30 - index).padStart(2, '0')}`) {
  return {
    date,
    title: `Journal ${index}`,
    summary: `Summary ${index}`,
    cover: '',
    weather: '',
    mood: '',
    file: { path: `01 日记/${index}.md` },
  };
}

function fixture(count = 8) {
  const dom = new JSDOM('<main><aside id="stable"></aside><section id="journal"></section></main>');
  const opened = [];
  const controller = new CarouselController({
    section: dom.window.document.querySelector('#journal'),
    journals: Array.from({ length: count }, (_, i) => journal(i)),
    openJournal: (item) => opened.push(item.file.path),
    settings: { carouselSeconds: 6, reducedMotion: false },
    windowRef: dom.window,
  });
  return { dom, controller, opened };
}

test('creates seven stable cards for more than five journals', () => {
  const { controller, dom } = fixture(8);
  controller.mount();
  assert.equal(dom.window.document.querySelectorAll('.hz-jcard').length, 7);
});

test('moving preserves non-carousel DOM and card node identities', async () => {
  const { controller, dom } = fixture(8);
  controller.mount();
  const stable = dom.window.document.querySelector('#stable');
  const cards = [...dom.window.document.querySelectorAll('.hz-jcard')];
  controller.move(1, { animate: false });
  assert.equal(dom.window.document.querySelector('#stable'), stable);
  assert.deepEqual([...dom.window.document.querySelectorAll('.hz-jcard')], cards);
});

test('fewer than five journals render once without duplicates', () => {
  const { controller, dom } = fixture(4);
  controller.mount();
  const paths = [...dom.window.document.querySelectorAll('.hz-jcard')]
    .map((card) => card.dataset.path);
  assert.equal(paths.length, 4);
  assert.equal(new Set(paths).size, 4);
});

test('pause blocks automatic movement and destroy clears DOM listeners and timers', () => {
  const { controller } = fixture(8);
  controller.mount();
  controller.pause('layout-edit');
  const index = controller.state.index;
  controller.onAutoTick();
  assert.equal(controller.state.index, index);
  controller.destroy();
  assert.equal(controller.destroyed, true);
});
```

- [ ] **Step 2: Run and confirm failure**

Run:

```bash
node --test tests/carousel-controller.test.js
```

Expected: FAIL because `CarouselController` is missing.

- [ ] **Step 3: Implement `CarouselController` with this public contract**

Create `src/carousel-controller.js` exporting:

```js
class CarouselController {
  constructor({ section, journals, openJournal, settings, windowRef = window })
  mount()
  currentItem()
  setJournals(journals, preferredPath = '')
  setYear(year)
  setMonth(year, month)
  move(direction, { animate = true } = {})
  onWheel(event)
  onPointerDown(event)
  onPointerUp(event)
  pause(reason)
  resume(reason)
  onAutoTick()
  destroy()
}

module.exports = { CarouselController };
```

Implementation requirements:

```js
// State and ownership invariants used throughout the class.
this.index = buildJournalIndex(journals);
this.selection = latestSelection(this.index);
this.state = createCarouselState(this.itemsForSelection());
this.cards = [];
this.pauses = new Set();
this.wheelState = { pixels: 0, direction: 0 };
this.queuedDirection = 0;
this.animating = false;
this.destroyed = false;
```

- `mount()` creates the two `<select>` elements, orbit/axis/stage, cards, dots, and gesture text once.
- `renderPool()` reuses `this.cards`; it may add/remove nodes only when the pool size changes after a month selection, never during ordinary movement.
- Each card has one click handler that reads `card.__journal` at click time, so recycled nodes do not accumulate listeners.
- `move()` updates slot classes first; after 350ms it recycles only the outgoing card and applies the next journal data.
- `animate: false` performs the same state update synchronously for reduced motion and tests.
- `pause(reason)` stores independent reasons such as `layout-edit`, `hidden`, and `inactive`; automatic movement resumes only when the set is empty.
- `destroy()` clears interval, animation timeout, idle callbacks, listeners, and references.
- Preloading uses `requestIdleCallback` with `setTimeout(..., 0)` fallback; image decoding uses `decode()` with `load/error` fallback.

- [ ] **Step 4: Add complete event-path tests**

Extend `tests/carousel-controller.test.js` to assert:

```js
test('wheel 39px does nothing and the 40th pixel moves one step', () => {
  const { controller } = fixture(8);
  controller.mount();
  controller.onWheel({ deltaY: 39, deltaMode: 0, preventDefault() {} });
  assert.equal(controller.state.index, 0);
  controller.onWheel({ deltaY: 1, deltaMode: 0, preventDefault() {} });
  assert.equal(controller.state.index, 1);
});

test('month selection changes only the pool data', () => {
  const { controller, dom } = fixture(8);
  controller.setJournals([
    journal(0, '2026-08-08'),
    journal(1, '2026-07-08'),
  ]);
  controller.mount();
  const stable = dom.window.document.querySelector('#stable');
  controller.setMonth('2026', '07');
  assert.equal(dom.window.document.querySelector('#stable'), stable);
  assert.equal(controller.selection.month, '07');
});
```

- [ ] **Step 5: Verify and commit**

Run:

```bash
node --test tests/carousel-controller.test.js
pnpm check
git add src/carousel-controller.js tests/carousel-controller.test.js
git commit -m "feat: add stable journal carousel controller"
```

### Task 5: Integrate the controller without full workbench rerenders

**Files:**
- Modify: `src/main.js:197-418`
- Create: `tests/render-boundary.test.js`

- [ ] **Step 1: Write the failing source-boundary regression test**

Create `tests/render-boundary.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../src/main.js'), 'utf8');

test('workbench delegates carousel movement instead of rerendering the whole view', () => {
  assert.match(source, /new CarouselController\(/);
  assert.doesNotMatch(source, /moveCarousel\([\s\S]*?this\.render\(\)/);
  assert.doesNotMatch(source, /startCarousel\(/);
});

test('view close destroys the carousel controller', () => {
  assert.match(source, /this\.carouselController\?\.destroy\(\)/);
});
```

- [ ] **Step 2: Run and confirm failure**

Run:

```bash
node --test tests/render-boundary.test.js
```

Expected: FAIL because `main.js` still owns `moveCarousel()` and `startCarousel()`.

- [ ] **Step 3: Wire `CarouselController` into `WorkbenchView`**

At the imports in `src/main.js`, add:

```js
const { CarouselController } = require('./carousel-controller');
```

In the constructor, replace carousel state fields with:

```js
this.carouselController = null;
this.pendingJournals = [];
```

In `onClose()` use:

```js
window.clearTimeout(this.refreshTimer);
this.carouselController?.destroy();
this.carouselController = null;
```

Replace `renderJournal(parent, journals)`, `moveCarousel()`, and `startCarousel()` with a `renderJournal()` that creates the section once and mounts the controller:

```js
renderJournal(parent, journals) {
  const section = this.el(parent, 'section', 'hz-journal');
  this.carouselController?.destroy();
  this.carouselController = new CarouselController({
    section,
    journals,
    settings: this.plugin.settings,
    openJournal: (journal) => this.app.workspace.getLeaf(false).openFile(journal.file),
  });
  this.carouselController.mount();
}
```

This plan intentionally allows business-data refreshes to rebuild the view for now; carousel navigation itself must never call `WorkbenchView.render()`. The layout plan replaces remaining full refreshes with module-scoped updates.

- [ ] **Step 4: Preserve the current journal across business-data refreshes**

Before destroying the old controller, read:

```js
const preferredPath = this.carouselController?.currentItem()?.file.path || '';
```

Pass `preferredPath` to the new controller and choose the same file if it is still in the refreshed month queue. Add `currentItem()` to the controller and cover it with a focused test.

- [ ] **Step 5: Run focused tests, full checks, and build**

Run:

```bash
node --test tests/render-boundary.test.js tests/carousel-controller.test.js
pnpm check
pnpm build
node --check main.js
```

Expected: all tests pass; build and bundle syntax checks exit 0.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/main.js src/carousel-controller.js tests/carousel-controller.test.js tests/render-boundary.test.js main.js
git commit -m "fix: isolate carousel navigation from workbench render"
```

### Task 6: Style month selectors and seven stable slots

**Files:**
- Modify: `styles.css`
- Modify: `tests/ui.test.js`

- [ ] **Step 1: Add failing CSS contract tests**

Append to `tests/ui.test.js`:

```js
test('journal filters expose year and month selects', () => {
  assert.match(css, /\.hz-journal-select\{/);
  assert.match(css, /\.hz-carousel-stage\{position:absolute;inset:0/);
});

test('carousel defines five visible and two off-canvas slots', () => {
  for (let slot = 0; slot <= 6; slot += 1) {
    assert.match(css, new RegExp(`\\.hz-slot-${slot}\\{`));
  }
  assert.match(css, /\.hz-slot-0\{[^}]*opacity:0/);
  assert.match(css, /\.hz-slot-6\{[^}]*opacity:0/);
});
```

- [ ] **Step 2: Run and confirm failure**

Run:

```bash
node --test tests/ui.test.js
```

Expected: the two new tests fail because selectors and off-canvas slots are absent.

- [ ] **Step 3: Add the carousel CSS**

Update `styles.css` so:

- `.hz-filters` accepts interactive `<select>` controls and has `pointer-events:auto`.
- `.hz-journal-select` uses the existing surface, line, muted, accent, 10px radius, and compact 30px height.
- Slots `1` through `5` retain the current five-card composition.
- `.hz-slot-0` and `.hz-slot-6` sit outside the left/right edge with `opacity:0;pointer-events:none`.
- `.hz-jcard` transitions `transform`, `left`, `right`, and `opacity` for 350ms.
- `.hz-jcard-cover.is-loaded` fades in only the cover layer.
- Months with 1–4 cards receive `.hz-count-N` section classes that center the real cards without duplicates.
- `.hz-reduced-motion` removes slot transitions and cover fades.

- [ ] **Step 4: Verify desktop and responsive CSS tests**

Run:

```bash
node --test tests/ui.test.js
pnpm check
pnpm build
```

Expected: all tests and the build pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add styles.css tests/ui.test.js main.js
git commit -m "style: add journal month filters and stable slots"
```

### Task 7: Install the carousel build and verify the real symptom

**Files:**
- Modify: `package.json`
- Modify: `manifest.json`
- Modify: `install/hz-workbench/manifest.json`
- Modify: `install/hz-workbench/main.js`
- Modify: `install/hz-workbench/styles.css`
- Modify: `/Users/zhanghanzhong/Documents/Obsidian/.obsidian/plugins/hz-workbench/manifest.json`
- Modify: `/Users/zhanghanzhong/Documents/Obsidian/.obsidian/plugins/hz-workbench/main.js`
- Modify: `/Users/zhanghanzhong/Documents/Obsidian/.obsidian/plugins/hz-workbench/styles.css`

- [ ] **Step 1: Mark the independently testable carousel milestone as `0.2.0-beta.1` and build**

Change `manifest.json` and `package.json` versions:

```json
"version": "0.2.0-beta.1"
```

Run:

```bash
pnpm check
pnpm build
node --check main.js
```

Expected: all tests pass and the bundle parses.

- [ ] **Step 2: Refresh the tracked install package**

Run:

```bash
cp main.js manifest.json styles.css logo.png ../../install/hz-workbench/
cmp main.js ../../install/hz-workbench/main.js
cmp manifest.json ../../install/hz-workbench/manifest.json
cmp styles.css ../../install/hz-workbench/styles.css
cmp logo.png ../../install/hz-workbench/logo.png
```

Expected: every `cmp` exits 0.

- [ ] **Step 3: Install into the current Vault and reload Obsidian**

Run:

```bash
cp main.js manifest.json styles.css logo.png /Users/zhanghanzhong/Documents/Obsidian/.obsidian/plugins/hz-workbench/
osascript -e 'tell application "Obsidian" to activate' \
  -e 'tell application "System Events" to keystroke "r" using command down'
```

Expected: Obsidian reloads and the workbench opens without plugin errors.

- [ ] **Step 4: Perform the macOS symptom regression**

Verify in the open workbench:

1. Default selection is the newest month containing journals.
2. Year change selects that year's newest valid month.
3. Month change displays no more than 30 journals.
4. Automatic, wheel, and horizontal drag navigation keep sidebar, statistics, project area, task area, and scroll position visually stable.
5. A month with fewer than five journals displays only its real journals centered.
6. Backgrounding the tab pauses automatic movement; returning restarts the full interval.
7. Reduced-motion mode disables automatic movement and slot animation.

- [ ] **Step 5: Commit the release-ready carousel milestone**

Run:

```bash
git add package.json manifest.json main.js styles.css ../../install/hz-workbench
git commit -m "release: prepare hz workbench 0.2.0 beta carousel milestone"
git status --short
```

Expected: commit succeeds and the working tree is clean.
