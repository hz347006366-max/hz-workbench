# HZ Workbench Free Layout Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add desktop-only 500ms long-press layout editing with deterministic snapping, proportional module scaling, overlap-safe autosave, undo/reset/cancel controls, and collision-free per-device persistence.

**Architecture:** Keep layout mathematics and validation pure in `layout-model.js`, isolate filesystem/local-storage work in `layout-store.js`, and express interaction transitions through a scheduler-injected `LayoutController`. `LayoutView` owns Pointer Events and editing chrome, while `WorkbenchView` supplies ten stable module shells and pauses the already-stabilized carousel during editing.

**Tech Stack:** Obsidian plugin API, CommonJS JavaScript, native Pointer Events, CSS transforms/absolute positioning, Node.js `node:test`, jsdom, esbuild, pnpm.

---

**Working directory:** `/Users/zhanghanzhong/Documents/Codex/HZ个人工作台-v0.1.0/development/obsidian-hz-workbench`

**Dependency:** Complete every task in `docs/superpowers/plans/2026-08-08-carousel-stabilization.md`; begin from its clean `0.2.0-beta.1` Git state.

### Task 1: Lock down module definitions and default layout

**Files:**
- Create: `src/layout-model.js`
- Create: `tests/layout-model.test.js`

- [ ] **Step 1: Write failing default-layout tests**

Create `tests/layout-model.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CANVAS_WIDTH,
  MODULE_DEFINITIONS,
  DEFAULT_LAYOUT,
  computedRect,
  computeCanvasHeight,
  viewScale,
} = require('../src/layout-model');

const EXPECTED_IDS = [
  'sidebar',
  'header',
  'stat-today-tasks',
  'stat-active-projects',
  'stat-today-schedule',
  'stat-journal-streak',
  'journal-carousel',
  'projects',
  'must-do',
  'today-tasks',
];

test('default layout defines all ten stable modules', () => {
  assert.equal(CANVAS_WIDTH, 1440);
  assert.deepEqual(Object.keys(MODULE_DEFINITIONS), EXPECTED_IDS);
  assert.deepEqual(Object.keys(DEFAULT_LAYOUT), EXPECTED_IDS);
});

test('stored layout derives dimensions from one proportional scale', () => {
  const rect = computedRect('journal-carousel', { x: 200, y: 300, scale: 0.8 });
  const definition = MODULE_DEFINITIONS['journal-carousel'];
  assert.equal(rect.width, definition.baseWidth * 0.8);
  assert.equal(rect.height, definition.baseHeight * 0.8);
  assert.equal(rect.width / rect.height, definition.baseWidth / definition.baseHeight);
});

test('default layout stays inside the canvas and has no overlaps', () => {
  const ids = Object.keys(DEFAULT_LAYOUT);
  for (const id of ids) {
    const rect = computedRect(id, DEFAULT_LAYOUT[id]);
    assert.ok(rect.x >= 0 && rect.y >= 0);
    assert.ok(rect.x + rect.width <= CANVAS_WIDTH);
  }
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = computedRect(ids[i], DEFAULT_LAYOUT[ids[i]]);
      const b = computedRect(ids[j], DEFAULT_LAYOUT[ids[j]]);
      const overlaps = a.x < b.x + b.width && a.x + a.width > b.x
        && a.y < b.y + b.height && a.y + a.height > b.y;
      assert.equal(overlaps, false, `${ids[i]} overlaps ${ids[j]}`);
    }
  }
});

test('canvas height follows the lowest module plus safe padding', () => {
  const height = computeCanvasHeight(DEFAULT_LAYOUT);
  const bottom = Math.max(...Object.entries(DEFAULT_LAYOUT)
    .map(([id, item]) => {
      const rect = computedRect(id, item);
      return rect.y + rect.height;
    }));
  assert.equal(height, bottom + 32);
});

test('view scale clamps to 0.68 below the readable width', () => {
  assert.equal(viewScale(1440), 1);
  assert.equal(viewScale(720), 0.68);
});
```

- [ ] **Step 2: Run and confirm failure**

Run:

```bash
node --test tests/layout-model.test.js
```

Expected: FAIL because `layout-model.js` does not exist.

- [ ] **Step 3: Define the pure model contract**

Create `src/layout-model.js` with these exports:

```js
const CANVAS_WIDTH = 1440;
const GRID_SIZE = 8;
const SNAP_DISTANCE = 8;
const MIN_VIEW_SCALE = 0.68;

const MODULE_DEFINITIONS = Object.freeze({
  sidebar: { label: '左侧导航与 Logo', baseWidth: 112, baseHeight: 760, minScale: 0.65, maxScale: 2 },
  header: { label: '顶部问候与操作区', baseWidth: 1280, baseHeight: 72, minScale: 0.65, maxScale: 2 },
  'stat-today-tasks': { label: '今日任务统计卡', baseWidth: 306, baseHeight: 118, minScale: 0.65, maxScale: 2 },
  'stat-active-projects': { label: '进行中项目统计卡', baseWidth: 306, baseHeight: 118, minScale: 0.65, maxScale: 2 },
  'stat-today-schedule': { label: '今日日程统计卡', baseWidth: 306, baseHeight: 118, minScale: 0.65, maxScale: 2 },
  'stat-journal-streak': { label: '连续日记热力图卡', baseWidth: 306, baseHeight: 118, minScale: 0.65, maxScale: 2 },
  'journal-carousel': { label: '日记 3D 轮播区', baseWidth: 930, baseHeight: 330, minScale: 0.65, maxScale: 2 },
  projects: { label: '进行中的项目区', baseWidth: 930, baseHeight: 280, minScale: 0.65, maxScale: 2 },
  'must-do': { label: '今日必完成区', baseWidth: 318, baseHeight: 302, minScale: 0.75, maxScale: 2 },
  'today-tasks': { label: '今日任务列表区', baseWidth: 318, baseHeight: 302, minScale: 0.75, maxScale: 2 },
});

const DEFAULT_LAYOUT = Object.freeze({
  sidebar: { x: 16, y: 16, scale: 1 },
  header: { x: 144, y: 16, scale: 1 },
  'stat-today-tasks': { x: 144, y: 104, scale: 1 },
  'stat-active-projects': { x: 466, y: 104, scale: 1 },
  'stat-today-schedule': { x: 788, y: 104, scale: 1 },
  'stat-journal-streak': { x: 1110, y: 104, scale: 1 },
  'journal-carousel': { x: 144, y: 238, scale: 1 },
  projects: { x: 144, y: 584, scale: 1 },
  'must-do': { x: 1090, y: 238, scale: 1 },
  'today-tasks': { x: 1090, y: 556, scale: 1 },
});
```

Before accepting these constants, run the overlap test. If any current base dimensions conflict, adjust only the default `x`/`y` values and record the final tested constants in this file; do not weaken the test.

Add pure functions:

```js
computedRect(moduleId, stored)
cloneLayout(layout)
computeCanvasHeight(layout)
viewScale(availableWidth)
```

- [ ] **Step 4: Implement pure functions minimally and verify**

Run:

```bash
node --test tests/layout-model.test.js
pnpm check
```

Expected: all default-layout and existing tests pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/layout-model.js tests/layout-model.test.js
git commit -m "feat: define workbench logical layout model"
```

### Task 2: Add validation, collision, snapping, and proportional resize math

**Files:**
- Modify: `src/layout-model.js`
- Modify: `tests/layout-model.test.js`

- [ ] **Step 1: Add failing validation and collision tests**

Append tests that assert:

```js
const {
  validateLayout,
  overlaps,
  layoutConflicts,
  snapMove,
  resizeFromPointer,
} = require('../src/layout-model');

test('validation repairs missing, invalid, and out-of-bounds entries and preserves unknown modules', () => {
  const input = {
    sidebar: { x: -20, y: Number.NaN, scale: 99 },
    unknown: { x: 1, y: 2, scale: 1 },
  };
  const result = validateLayout(input);
  assert.deepEqual(result.layout.unknown, input.unknown);
  assert.equal(result.layout.sidebar.x, 0);
  assert.equal(result.layout.sidebar.y, DEFAULT_LAYOUT.sidebar.y);
  assert.equal(result.layout.sidebar.scale, MODULE_DEFINITIONS.sidebar.maxScale);
  assert.ok(result.repaired.includes('sidebar'));
  assert.ok(result.layout.header);
});

test('touching edges do not overlap but positive-area intersection does', () => {
  assert.equal(overlaps({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 }), false);
  assert.equal(overlaps({ x: 0, y: 0, width: 10, height: 10 }, { x: 9, y: 0, width: 10, height: 10 }), true);
});

test('layout conflicts return both colliding module ids', () => {
  const layout = cloneLayout(DEFAULT_LAYOUT);
  layout.header = { ...layout.sidebar };
  assert.deepEqual(new Set(layoutConflicts(layout)), new Set(['sidebar', 'header']));
});

test('snap priority is boundary then edge then standard gap then grid', () => {
  const layout = cloneLayout(DEFAULT_LAYOUT);
  const boundary = snapMove('sidebar', { x: 5, y: 5 }, layout);
  assert.equal(boundary.x, 0);
  assert.equal(boundary.y, 0);
  const grid = snapMove('sidebar', { x: 101, y: 101 }, { sidebar: layout.sidebar });
  assert.equal(grid.x % 8, 0);
  assert.equal(grid.y % 8, 0);
});

test('resize uses one scalar and keeps the top-left anchor fixed', () => {
  const start = { x: 100, y: 200, scale: 1 };
  const resized = resizeFromPointer('journal-carousel', start, { dx: 186, dy: 66 }, {});
  const rect = computedRect('journal-carousel', resized);
  assert.equal(resized.x, 100);
  assert.equal(resized.y, 200);
  assert.equal(rect.width / rect.height, 930 / 330);
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
node --test tests/layout-model.test.js
```

Expected: FAIL because validation, snapping, conflict, and resize functions are not exported.

- [ ] **Step 3: Implement validation and geometry**

Implement and export:

```js
validateLayout(input)
overlaps(a, b)
layoutConflicts(layout)
snapMove(moduleId, candidate, layout)
resizeFromPointer(moduleId, start, delta, layout)
```

Rules enforced by code:

- Missing known modules come from `DEFAULT_LAYOUT`.
- Unknown modules are copied unchanged but ignored by geometry functions.
- Non-finite `x`, `y`, or `scale` values use defaults.
- Scale clamps to the module's `minScale`/`maxScale` and canvas width.
- Candidate snaps are objects `{ axis, value, kind, distance, targetId }` sorted by kind rank (`boundary`, `edge`, `gap`, `grid`), then distance, then stable target ID.
- Standard-gap candidates are 8 and 16 logical units.
- Resize snaps the scalar, not width and height independently.

- [ ] **Step 4: Add deterministic tie and boundary regression tests**

Add tests for equal-distance candidate ordering, negative coordinates, maximum canvas width, and a resize that would exceed the right boundary. Expected output must contain exact `{x, y, scale}` values.

- [ ] **Step 5: Verify and commit**

Run:

```bash
node --test tests/layout-model.test.js
pnpm check
git add src/layout-model.js tests/layout-model.test.js
git commit -m "feat: add deterministic layout geometry"
```

### Task 3: Persist one atomic layout file per local device

**Files:**
- Create: `src/layout-store.js`
- Create: `tests/layout-store.test.js`

- [ ] **Step 1: Write failing persistence tests with an in-memory adapter**

Create `tests/layout-store.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const { LayoutStore } = require('../src/layout-store');

class MemoryAdapter {
  constructor() { this.files = new Map(); this.folders = new Set(); }
  async exists(path) { return this.files.has(path) || this.folders.has(path); }
  async mkdir(path) { this.folders.add(path); }
  async read(path) {
    if (!this.files.has(path)) throw new Error(`missing ${path}`);
    return this.files.get(path);
  }
  async write(path, value) { this.files.set(path, value); }
  async rename(from, to) {
    this.files.set(to, this.files.get(from));
    this.files.delete(from);
  }
}

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
}

test('creates and reuses a valid local UUID', () => {
  const local = storage();
  const store = new LayoutStore({ adapter: new MemoryAdapter(), configDir: '.obsidian', localStorage: local });
  const first = store.deviceId();
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(store.deviceId(), first);
});

test('two devices write different files without overwriting each other', async () => {
  const adapter = new MemoryAdapter();
  const a = new LayoutStore({ adapter, configDir: '.obsidian', localStorage: storage({ 'hz-workbench:device-id:v1': '11111111-1111-4111-8111-111111111111' }) });
  const b = new LayoutStore({ adapter, configDir: '.obsidian', localStorage: storage({ 'hz-workbench:device-id:v1': '22222222-2222-4222-8222-222222222222' }) });
  await a.save({ sidebar: { x: 1, y: 2, scale: 1 } });
  await b.save({ sidebar: { x: 3, y: 4, scale: 1 } });
  assert.ok(adapter.files.has('.obsidian/hz-workbench/layouts/11111111-1111-4111-8111-111111111111.json'));
  assert.ok(adapter.files.has('.obsidian/hz-workbench/layouts/22222222-2222-4222-8222-222222222222.json'));
});

test('failed replacement leaves the previous valid layout intact', async () => {
  const adapter = new MemoryAdapter();
  const store = new LayoutStore({ adapter, configDir: '.obsidian', localStorage: storage() });
  await store.save({ sidebar: { x: 1, y: 2, scale: 1 } });
  const path = store.layoutPath();
  const previous = adapter.files.get(path);
  adapter.rename = async () => { throw new Error('rename failed'); };
  await assert.rejects(() => store.save({ sidebar: { x: 8, y: 8, scale: 1 } }), /rename failed/);
  assert.equal(adapter.files.get(path), previous);
});
```

- [ ] **Step 2: Run and confirm failure**

Run:

```bash
node --test tests/layout-store.test.js
```

Expected: FAIL because `LayoutStore` does not exist.

- [ ] **Step 3: Implement the storage contract**

Create `src/layout-store.js` exporting:

```js
class LayoutStore {
  constructor({ adapter, configDir, localStorage, now = () => new Date().toISOString(), uuid = () => crypto.randomUUID() })
  deviceId()
  layoutDir()
  layoutPath()
  recoveryPath()
  async load()
  async save(layout)
}

module.exports = { LayoutStore };
```

Implementation requirements:

- Validate UUIDs before composing paths.
- Recursively create `<configDir>/hz-workbench/layouts` using adapter operations.
- Write `{schemaVersion:1, deviceId, canvasWidth:1440, modules, updatedAt}` to `<id>.json.tmp`.
- Parse and validate the temp content before renaming it over `<id>.json`.
- On load parse failure, write raw content to `<id>.recovery.json`, return the validated default layout, and leave the corrupt original untouched for diagnosis.
- Migrate schema versions one step at a time through a `MIGRATIONS` map; never overwrite the source until migration validates.

- [ ] **Step 4: Add corrupt-data and migration tests**

Add tests that load invalid JSON, assert recovery-file content exactly equals the corrupt source, and assert a schema-0 fixture migrates to schema 1 without changing module coordinates.

- [ ] **Step 5: Verify and commit**

Run:

```bash
node --test tests/layout-store.test.js
pnpm check
git add src/layout-store.js tests/layout-store.test.js
git commit -m "feat: persist layouts per local device"
```

### Task 4: Implement the scheduler-driven edit state machine

**Files:**
- Create: `src/layout-controller.js`
- Create: `tests/layout-controller.test.js`

- [ ] **Step 1: Write failing long-press and snapshot tests**

Create `tests/layout-controller.test.js` around a fake scheduler:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const { LayoutController } = require('../src/layout-controller');
const { DEFAULT_LAYOUT, cloneLayout } = require('../src/layout-model');

class Scheduler {
  constructor() { this.jobs = []; }
  setTimeout(fn, ms) { const job = { fn, ms, cancelled: false }; this.jobs.push(job); return job; }
  clearTimeout(job) { if (job) job.cancelled = true; }
  advance(ms) {
    for (const job of this.jobs.filter((item) => !item.cancelled && item.ms <= ms)) {
      job.cancelled = true;
      job.fn();
    }
  }
}

function fixture() {
  const scheduler = new Scheduler();
  const saved = [];
  const carousel = { pauses: [], resumes: [], pause(v) { this.pauses.push(v); }, resume(v) { this.resumes.push(v); } };
  const controller = new LayoutController({
    initialLayout: cloneLayout(DEFAULT_LAYOUT),
    scheduler,
    save: async (layout) => saved.push(layout),
    carousel,
  });
  return { scheduler, saved, carousel, controller };
}

test('499ms does not edit and 500ms enters editing', () => {
  const { scheduler, controller } = fixture();
  controller.arm({ moduleId: 'sidebar', x: 10, y: 10 });
  scheduler.advance(499);
  assert.equal(controller.state.mode, 'arming');
  scheduler.advance(500);
  assert.equal(controller.state.mode, 'editing');
});

test('moving more than 6px cancels arming', () => {
  const { scheduler, controller } = fixture();
  controller.arm({ moduleId: 'sidebar', x: 10, y: 10 });
  controller.pointerMove({ x: 17, y: 10 });
  scheduler.advance(500);
  assert.equal(controller.state.mode, 'idle');
});

test('drag commit adds one undo snapshot and undo restores it', () => {
  const { controller } = fixture();
  controller.enterEdit('sidebar');
  const before = controller.layout.sidebar.x;
  controller.startDrag('sidebar', { x: 0, y: 0 });
  controller.pointerMove({ x: 80, y: 0 });
  controller.endGesture();
  assert.equal(controller.undoStack.length, 1);
  controller.undo();
  assert.equal(controller.layout.sidebar.x, before);
});

test('conflicts block save and valid blank click saves once', async () => {
  const { controller, saved } = fixture();
  controller.enterEdit('sidebar');
  controller.layout.header = { ...controller.layout.sidebar };
  assert.equal(await controller.saveAndExit(), false);
  assert.equal(saved.length, 0);
  controller.layout = cloneLayout(DEFAULT_LAYOUT);
  assert.equal(await controller.saveAndExit(), true);
  assert.equal(saved.length, 1);
});
```

- [ ] **Step 2: Run and confirm failure**

Run:

```bash
node --test tests/layout-controller.test.js
```

Expected: FAIL because `LayoutController` does not exist.

- [ ] **Step 3: Implement the controller contract**

Create `src/layout-controller.js` exporting:

```js
class LayoutController {
  constructor({ initialLayout, scheduler, save, carousel, onChange = () => {}, onNotice = () => {} })
  canArm(pointer)
  arm(pointer)
  cancelArm()
  enterEdit(moduleId)
  select(moduleId)
  startDrag(moduleId, point)
  startResize(moduleId, point)
  pointerMove(point)
  endGesture()
  undo()
  restoreDefault()
  cancelAndExit()
  async saveAndExit()
  handleEscape()
  handleWindowInterruption()
  destroy()
}

module.exports = { LayoutController };
```

State requirements:

```js
this.state = { mode: 'idle', selectedId: '', conflicts: [], guides: [] };
this.layout = cloneLayout(initialLayout);
this.entrySnapshot = cloneLayout(initialLayout);
this.gestureSnapshot = null;
this.undoStack = [];
```

- Only primary mouse pointers without modifier keys may arm.
- Arming cancels on movement greater than 6px, release, pointer cancel, blur, or destroy.
- Editing selection changes at 3px or less without drag; movement above 3px begins drag.
- `endGesture()` creates exactly one undo snapshot only if layout changed, capped at 30.
- `restoreDefault()` adds the previous layout to undo before loading defaults.
- Entering edit calls `carousel.pause('layout-edit')`; every exit path calls `carousel.resume('layout-edit')` once.
- Save failure keeps editing state and calls `onNotice('布局保存失败，请重试或取消')`.

- [ ] **Step 4: Add full exit-path tests**

Test cancel, Escape, restore default, save rejection, 30-entry undo cap, repeated edit request, pointer cancel, blur, and carousel pause/resume balance.

- [ ] **Step 5: Verify and commit**

Run:

```bash
node --test tests/layout-controller.test.js
pnpm check
git add src/layout-controller.js tests/layout-controller.test.js
git commit -m "feat: add layout editing state machine"
```

### Task 5: Render the editing overlay and Pointer Event adapter

**Files:**
- Create: `src/layout-view.js`
- Create: `tests/layout-view.test.js`

- [ ] **Step 1: Write failing jsdom interaction tests**

Create a jsdom document with a `[data-layout-canvas]`, two `[data-module-id]` shells, an interactive button, and a fake `LayoutController`. Assert:

```js
test('long press adapter ignores interactive descendants and touch pointers', () => {
  dispatchPointer(button, 'pointerdown', { pointerType: 'mouse', button: 0 });
  assert.equal(controller.calls.arm.length, 0);
  dispatchPointer(moduleBody, 'pointerdown', { pointerType: 'touch', button: 0 });
  assert.equal(controller.calls.arm.length, 0);
});

test('direct canvas click saves while child clicks do not', () => {
  moduleBody.click();
  assert.equal(controller.calls.saveAndExit, 0);
  canvas.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(controller.calls.saveAndExit, 1);
});

test('editing chrome contains labels, one handle, toolbar, and conflict markup', () => {
  view.render({ mode: 'editing', selectedId: 'sidebar', conflicts: ['header'], guides: [] });
  assert.equal(canvas.querySelectorAll('.hz-layout-label').length, 2);
  assert.equal(canvas.querySelectorAll('.hz-resize-handle').length, 1);
  assert.ok(canvas.querySelector('.hz-layout-toolbar'));
  assert.ok(canvas.querySelector('[data-module-id="header"].is-conflicting'));
});
```

Include a small `dispatchPointer()` helper that defines `pointerType`, `button`, `clientX`, `clientY`, and modifier properties on a bubbling Event.

- [ ] **Step 2: Run and confirm failure**

Run:

```bash
node --test tests/layout-view.test.js
```

Expected: FAIL because `LayoutView` does not exist.

- [ ] **Step 3: Implement `LayoutView`**

Create `src/layout-view.js` exporting:

```js
class LayoutView {
  constructor({ viewport, stage, canvas, controller, moduleDefinitions, windowRef = window })
  mount()
  render(state, layout)
  applyLayout(layout)
  applyViewScale(layout)
  destroy()
}

module.exports = { LayoutView };
```

Implementation rules:

- One delegated `pointerdown` listener finds the nearest `[data-module-id]`.
- Interactive targets match `button,input,textarea,select,a,[data-layout-interactive]` and never arm.
- Screen coordinates are converted to logical coordinates by subtracting the canvas bounding rectangle and dividing by the current global view scale.
- Layout shells get `left`, `top`, `width`, and `height` from `computedRect()`; content gets `transform:scale(...)` only if the content uses base dimensions.
- `applyViewScale()` computes `scale = viewScale(viewport.clientWidth)`, applies `transform:scale(scale)` to the 1440-unit canvas, and sets the stage width/height to the scaled canvas dimensions so scrollbars reflect the visual size.
- A `ResizeObserver` calls `applyViewScale()` after settled window changes; if a pointer gesture is active, the controller first rolls that gesture back.
- The toolbar is appended directly under the canvas, marks itself `data-layout-interactive`, and stops click/pointer propagation.
- Only `event.target === canvas` invokes `saveAndExit()`.
- Window `blur`, `resize`, `pointercancel`, and view destruction interrupt the current gesture safely.
- All registered listeners and the `ResizeObserver` are recorded and removed by `destroy()`.

- [ ] **Step 4: Verify and commit**

Run:

```bash
node --test tests/layout-view.test.js
pnpm check
git add src/layout-view.js tests/layout-view.test.js
git commit -m "feat: render layout editing controls"
```

### Task 6: Give the workbench ten stable module shells

**Files:**
- Modify: `src/main.js:197-517`
- Modify: `tests/render-boundary.test.js`

- [ ] **Step 1: Add failing shell and mobile-boundary tests**

Append to `tests/render-boundary.test.js`:

```js
const MODULE_IDS = [
  'sidebar', 'header', 'stat-today-tasks', 'stat-active-projects',
  'stat-today-schedule', 'stat-journal-streak', 'journal-carousel',
  'projects', 'must-do', 'today-tasks',
];

test('main view creates all stable layout module ids', () => {
  for (const id of MODULE_IDS) {
    assert.match(source, new RegExp(`moduleShell\\([^,]+, ['\"]${id}['\"]`));
  }
});

test('desktop layout is gated by Obsidian Platform.isDesktopApp', () => {
  assert.match(source, /Platform\.isDesktopApp/);
});
```

- [ ] **Step 2: Run and confirm failure**

Run:

```bash
node --test tests/render-boundary.test.js
```

Expected: new tests fail because stable module shells and desktop gating are missing.

- [ ] **Step 3: Import desktop and layout dependencies**

Extend Obsidian imports with `Platform`, then add:

```js
const { MODULE_DEFINITIONS, DEFAULT_LAYOUT, cloneLayout } = require('./layout-model');
const { LayoutStore } = require('./layout-store');
const { LayoutController } = require('./layout-controller');
const { LayoutView } = require('./layout-view');
```

- [ ] **Step 4: Add a single shell helper**

Add to `WorkbenchView`:

```js
moduleShell(parent, moduleId, renderContent) {
  const shell = this.el(parent, 'section', 'hz-layout-module');
  shell.dataset.moduleId = moduleId;
  shell.dataset.moduleLabel = MODULE_DEFINITIONS[moduleId].label;
  const content = this.el(shell, 'div', 'hz-layout-content');
  renderContent(content);
  return shell;
}
```

Refactor every current module renderer so the ten IDs appear exactly once. Split `renderStats()` into four calls that each receive an individual shell. Preserve existing business markup inside each shell.

- [ ] **Step 5: Create desktop canvas and mobile fallback paths**

In `render()`:

```js
if (!Platform.isDesktopApp) {
  await this.renderResponsiveWorkbench(data);
  return;
}
await this.renderDesktopWorkbench(data);
```

- `renderResponsiveWorkbench()` keeps the current responsive DOM and never mounts `LayoutView`.
- `renderDesktopWorkbench()` creates `.hz-layout-viewport > .hz-layout-stage > [data-layout-canvas]`, loads the current layout, renders ten stable shells, and mounts `LayoutView` with all three elements.
- The carousel section passes its controller into `LayoutController` for pause/resume.

- [ ] **Step 6: Queue business refreshes during editing**

Change `scheduleRender()` so:

```js
if (this.layoutController?.state.mode !== 'idle') {
  this.pendingRefresh = true;
  return;
}
```

After save or cancel exits editing, consume `pendingRefresh` once. Before an ordinary business refresh, preserve the current carousel file path and selection.

- [ ] **Step 7: Destroy every controller on close and before rebuilding**

Use one method:

```js
destroyInteractiveControllers() {
  this.layoutView?.destroy();
  this.layoutController?.destroy();
  this.carouselController?.destroy();
  this.layoutView = null;
  this.layoutController = null;
  this.carouselController = null;
}
```

Call it from `onClose()` and before replacing the desktop workbench after a business-data refresh.

- [ ] **Step 8: Verify and commit**

Run:

```bash
node --test tests/render-boundary.test.js
pnpm check
pnpm build
git add src/main.js tests/render-boundary.test.js main.js
git commit -m "refactor: add stable workbench module shells"
```

### Task 7: Style the logical canvas and editing chrome

**Files:**
- Modify: `styles.css`
- Modify: `tests/ui.test.js`

- [ ] **Step 1: Add failing CSS contract tests**

Append:

```js
test('desktop workbench exposes logical canvas and module shells', () => {
  assert.match(css, /\.hz-layout-canvas\{/);
  assert.match(css, /\.hz-layout-module\{position:absolute/);
  assert.match(css, /\.hz-layout-content\{transform-origin:top left/);
});

test('editing chrome includes labels, handle, guides, conflict stripes, and toolbar', () => {
  for (const selector of [
    'hz-layout-label', 'hz-resize-handle', 'hz-snap-guide',
    'is-conflicting', 'hz-layout-toolbar', 'hz-long-press-progress',
  ]) assert.match(css, new RegExp(`\\.${selector}\\{`));
});

test('reduced motion keeps feedback while removing editing transitions', () => {
  assert.match(css, /\.hz-reduced-motion \.hz-layout-module\{[^}]*transition:none/);
});
```

- [ ] **Step 2: Run and confirm failure**

Run:

```bash
node --test tests/ui.test.js
```

Expected: new contract tests fail.

- [ ] **Step 3: Replace desktop grid positioning with logical-canvas CSS**

Add CSS that:

- Gives `.hz-layout-canvas` `position:relative;width:1440px;transform-origin:top left`.
- Gives `.hz-layout-viewport` `overflow:auto` and `.hz-layout-stage` a runtime width/height matching the scaled canvas.
- Gives `.hz-layout-module` absolute positioning and no implicit CSS Grid placement.
- Gives `.hz-layout-content` fixed base dimensions and `transform-origin:top left`.
- Applies 1px edit borders to all modules and 2px accent border to the selected module.
- Places module labels at top-left and a 16px visual/32px hit target handle at bottom-right.
- Renders guides as low-opacity dashed accent lines.
- Uses danger-color diagonal stripes on `.is-conflicting`.
- Keeps the toolbar as a top-center overlay outside collision math.
- Clamps runtime scale at 0.68; when the scaled stage is wider than the viewport, `.hz-layout-viewport` provides horizontal scrolling.
- Keeps mobile media rules on the existing responsive layout and hides all editing chrome.
- Preserves theme variables for all five themes.

- [ ] **Step 4: Verify and commit**

Run:

```bash
node --test tests/ui.test.js
pnpm check
pnpm build
git add styles.css tests/ui.test.js main.js
git commit -m "style: add workbench layout editing canvas"
```

### Task 8: Add integrated persistence, interruption, and regression coverage

**Files:**
- Create: `tests/layout-integration.test.js`
- Modify: `src/main.js`
- Modify: `src/layout-controller.js`
- Modify: `src/layout-view.js`

- [ ] **Step 1: Write the integrated jsdom scenario**

Create `tests/layout-integration.test.js` that mounts a ten-shell canvas with a real `LayoutController` and `LayoutView`, fake `LayoutStore`, and fake carousel. The scenario must:

1. Long-press `sidebar` for 500ms.
2. Drag it to an 8-unit grid position.
3. Resize it from the bottom-right while preserving aspect ratio.
4. Introduce a collision and assert blank click does not save.
5. Undo the collision and assert blank click saves exactly once.
6. Remount from the saved layout and assert the same logical coordinates.
7. Dispatch `resize` during a gesture and assert only that gesture rolls back.
8. Assert carousel pause/resume counts balance.

Use exact assertions on `{x, y, scale}`, save-call count, conflict IDs, and controller mode.

- [ ] **Step 2: Run and confirm failure**

Run:

```bash
node --test tests/layout-integration.test.js
```

Expected: FAIL on the first missing or incorrectly wired integration behavior.

- [ ] **Step 3: Implement only the missing wiring revealed by the test**

Do not alter layout mathematics in this task. Limit changes to lifecycle callbacks, event translation, save completion, queued refresh consumption, and carousel pause/resume wiring.

- [ ] **Step 4: Run the complete automated gate**

Run:

```bash
pnpm check
pnpm build
node --check main.js
```

Expected: all original, carousel, model, store, controller, DOM, integration, and CSS tests pass; build exits 0.

- [ ] **Step 5: Commit**

Run:

```bash
git add src tests main.js
git commit -m "test: cover complete layout editing workflow"
```

### Task 9: Install, verify, and prepare the combined release

**Files:**
- Modify: `manifest.json`
- Modify: `package.json`
- Modify: `install/hz-workbench/manifest.json`
- Modify: `install/hz-workbench/main.js`
- Modify: `install/hz-workbench/styles.css`
- Modify: `/Users/zhanghanzhong/Documents/Obsidian/.obsidian/plugins/hz-workbench/manifest.json`
- Modify: `/Users/zhanghanzhong/Documents/Obsidian/.obsidian/plugins/hz-workbench/main.js`
- Modify: `/Users/zhanghanzhong/Documents/Obsidian/.obsidian/plugins/hz-workbench/styles.css`

- [ ] **Step 1: Set the combined feature version**

Set `manifest.json` and `package.json` to:

```json
"version": "0.2.0"
```

Keep `minAppVersion`, plugin ID, name, and author unchanged.

- [ ] **Step 2: Run the fresh verification gate**

Run:

```bash
pnpm check
pnpm build
node --check main.js
```

Expected: zero failing tests and exit code 0 for syntax/build.

- [ ] **Step 3: Refresh install and live plugin packages**

Run:

```bash
cp main.js manifest.json styles.css logo.png ../../install/hz-workbench/
cp main.js manifest.json styles.css logo.png /Users/zhanghanzhong/Documents/Obsidian/.obsidian/plugins/hz-workbench/
cmp main.js ../../install/hz-workbench/main.js
cmp main.js /Users/zhanghanzhong/Documents/Obsidian/.obsidian/plugins/hz-workbench/main.js
cmp styles.css /Users/zhanghanzhong/Documents/Obsidian/.obsidian/plugins/hz-workbench/styles.css
```

Expected: every comparison exits 0.

- [ ] **Step 4: Reload Obsidian and perform the macOS acceptance checklist**

Run:

```bash
osascript -e 'tell application "Obsidian" to activate' \
  -e 'tell application "System Events" to keystroke "r" using command down'
```

Verify all 13 macOS cases in `docs/superpowers/specs/2026-08-08-layout-editor-design.md`, including all ten long-press targets, 6px cancellation, 3px selection threshold, every snap priority, proportional resize, overlap-blocked save, undo/default/cancel/Escape, restart persistence, window scaling, month filtering, no-flash carousel navigation, edit-time carousel pause, business interactions, and reduced motion.

- [ ] **Step 5: Verify runtime state and persisted layout path**

After one successful layout save, run:

```bash
find /Users/zhanghanzhong/Documents/Obsidian/.obsidian/hz-workbench/layouts -maxdepth 1 -type f -name '*.json' -print
rg -n 'hz-workbench-view' /Users/zhanghanzhong/Documents/Obsidian/.obsidian/workspace.json
```

Expected: one UUID-named layout JSON exists for this Mac and the workspace contains `hz-workbench-view`.

- [ ] **Step 6: Commit the release**

Run:

```bash
git add package.json manifest.json main.js styles.css ../../install/hz-workbench
git commit -m "release: ship hz workbench free layout editor"
git status --short
```

Expected: commit succeeds and the working tree is clean.

- [ ] **Step 7: Record the Windows release gate**

Before distributing the same install package to Windows, run the spec's Windows real-device checks for Pointer Events, 500ms long press, display scaling, wheel direction, and distinct UUID layout file. Do not mark the cross-platform release complete until that checklist passes.
