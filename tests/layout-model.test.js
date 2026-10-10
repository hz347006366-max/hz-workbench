const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CANVAS_WIDTH,
  GRID_SIZE,
  SNAP_DISTANCE,
  MIN_VIEW_SCALE,
  MODULE_DEFINITIONS,
  DEFAULT_LAYOUT,
  computedRect,
  cloneLayout,
  computeCanvasHeight,
  viewScale,
  validateLayout,
  overlaps,
  layoutConflicts,
  snapMove,
  snapMoveDetailed,
  resizeFromPointer,
  resizeFromPointerDetailed,
} = require('../src/layout-model');

const EXPECTED_IDS = [
  'sidebar',
  'agent-panel',
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

test('default layout defines all eleven stable modules for the wider agent canvas', () => {
  assert.equal(CANVAS_WIDTH, 1640);
  assert.equal(GRID_SIZE, 8);
  assert.equal(SNAP_DISTANCE, 8);
  assert.equal(MIN_VIEW_SCALE, 0.68);
  assert.deepEqual(Object.keys(MODULE_DEFINITIONS), EXPECTED_IDS);
  assert.deepEqual(Object.keys(DEFAULT_LAYOUT), EXPECTED_IDS);
  assert.deepEqual(MODULE_DEFINITIONS.sidebar, { label: 'Logo', baseWidth: 112, baseHeight: 112, minScale: 0.65, maxScale: 2 });
  assert.deepEqual(MODULE_DEFINITIONS['agent-panel'], { label: '天气', baseWidth: 306, baseHeight: 760, minScale: 0.65, maxScale: 2 });
  assert.deepEqual(DEFAULT_LAYOUT['agent-panel'], { x: 16, y: 144, scale: 1 });
  assert.deepEqual(DEFAULT_LAYOUT.header, { x: 338, y: 16, scale: 1 });
});

test('layout clones do not share stored module objects', () => {
  const clone = cloneLayout(DEFAULT_LAYOUT);
  clone.sidebar.x = 200;
  assert.equal(DEFAULT_LAYOUT.sidebar.x, 16);
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

test('viewScale fits narrow panes but never enlarges wide panes', () => {
  assert.equal(viewScale(720), 0.68);
  assert.equal(viewScale(1476), 0.9);
  assert.equal(viewScale(1640), 1);
  assert.equal(viewScale(1920), 1);
});

test('validation repairs missing, invalid, and out-of-bounds entries and preserves unknown modules', () => {
  const input = {
    sidebar: { x: -20, y: Number.NaN, scale: 99 },
    unknown: { x: 1, y: 2, scale: 1 },
  };

  const result = validateLayout(input);

  assert.deepEqual(result.layout.unknown, input.unknown);
  assert.deepEqual(result.layout.sidebar, { x: 0, y: DEFAULT_LAYOUT.sidebar.y, scale: 2 });
  assert.ok(result.repaired.includes('sidebar'));
  assert.ok(result.repaired.includes('header'));
  assert.deepEqual(result.layout.header, DEFAULT_LAYOUT.header);
});

test('validation preserves reserved unknown module ids as enumerable own properties', () => {
  const input = JSON.parse(`{
    "__proto__": {"x": 1, "y": 2, "scale": 1},
    "constructor": {"x": 3, "y": 4, "scale": 1},
    "toString": {"x": 5, "y": 6, "scale": 1}
  }`);

  const result = validateLayout(input).layout;

  for (const moduleId of ['__proto__', 'constructor', 'toString']) {
    assert.equal(Object.hasOwn(result, moduleId), true);
    assert.deepEqual(result[moduleId], input[moduleId]);
  }
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
});

test('geometry ignores reserved unknown module ids instead of treating inherited keys as definitions', () => {
  const layout = cloneLayout(DEFAULT_LAYOUT);
  const reserved = JSON.parse(`{
    "__proto__": {"x": 16, "y": 16, "scale": 1},
    "constructor": {"x": 16, "y": 16, "scale": 1},
    "toString": {"x": 16, "y": 16, "scale": 1}
  }`);
  for (const [moduleId, stored] of Object.entries(reserved)) {
    Object.defineProperty(layout, moduleId, {
      value: stored,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }

  assert.equal(computeCanvasHeight(layout), computeCanvasHeight(DEFAULT_LAYOUT));
  assert.deepEqual(layoutConflicts(layout), []);
  assert.deepEqual(
    snapMove('sidebar', { x: 101, y: 101 }, layout),
    snapMove('sidebar', { x: 101, y: 101 }, DEFAULT_LAYOUT),
  );
  assert.deepEqual(
    resizeFromPointer('sidebar', layout.sidebar, { dx: 1, dy: 1 }, layout),
    resizeFromPointer('sidebar', DEFAULT_LAYOUT.sidebar, { dx: 1, dy: 1 }, DEFAULT_LAYOUT),
  );
});

test('validation limits a wide module to the canvas and repairs finite overflow coordinates', () => {
  const result = validateLayout({
    header: { x: 500, y: -12, scale: 2 },
  });

  assert.deepEqual(result.layout.header, { x: 0, y: 0, scale: 1.28125 });
  assert.ok(result.repaired.includes('header'));
  assert.equal(computedRect('header', result.layout.header).width, CANVAS_WIDTH);
});

test('touching edges do not overlap but positive-area intersection does', () => {
  assert.equal(
    overlaps({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 }),
    false,
  );
  assert.equal(
    overlaps({ x: 0, y: 0, width: 10, height: 10 }, { x: 9, y: 0, width: 10, height: 10 }),
    true,
  );
});

test('layout conflicts return both colliding module ids and ignore unknown entries', () => {
  const layout = cloneLayout(DEFAULT_LAYOUT);
  layout.header = { ...layout.sidebar };
  layout.unknown = { x: 16, y: 16, scale: 1 };

  assert.deepEqual(new Set(layoutConflicts(layout)), new Set(['sidebar', 'header']));
});

test('snap priority is boundary then aligned edge or center then standard gap then grid', () => {
  const layout = {
    sidebar: { x: 16, y: 16, scale: 1 },
    'stat-today-tasks': { x: 300, y: 100, scale: 1 },
  };

  assert.deepEqual(snapMove('sidebar', { x: 5, y: 5 }, layout), { x: 0, y: 0, scale: 1 });
  assert.deepEqual(snapMove('sidebar', { x: 402, y: 501 }, layout), { x: 397, y: 504, scale: 1 });
  assert.deepEqual(snapMove('sidebar', { x: 177, y: 501 }, layout), { x: 180, y: 504, scale: 1 });
  assert.deepEqual(snapMove('sidebar', { x: 173, y: 501 }, layout), { x: 172, y: 504, scale: 1 });
  assert.deepEqual(
    snapMove('sidebar', { x: 101, y: 101 }, { sidebar: layout.sidebar }),
    { x: 104, y: 104, scale: 1 },
  );
});

test('snap aligns adjacent outer edges and horizontal and vertical center lines', () => {
  const layout = {
    sidebar: { x: 16, y: 16, scale: 1 },
    'stat-today-tasks': { x: 300, y: 900, scale: 1 },
  };

  assert.deepEqual(
    snapMove('sidebar', { x: 601, y: 903 }, layout),
    { x: 606, y: 903, scale: 1 },
  );
  assert.deepEqual(
    snapMove('sidebar', { x: 402, y: 582 }, layout),
    { x: 397, y: 584, scale: 1 },
  );
});

test('equal-distance snap candidates use stable target id ordering', () => {
  const layout = {
    sidebar: { x: 16, y: 16, scale: 1 },
    'stat-today-tasks': { x: 104, y: 1200, scale: 1 },
    'stat-active-projects': { x: 96, y: 900, scale: 1 },
  };

  assert.deepEqual(
    snapMove('sidebar', { x: 100, y: 501 }, layout),
    { x: 96, y: 504, scale: 1 },
  );
});

test('same-target snap ties preserve deterministic candidate creation order', () => {
  const scale = 145 / 153;
  const layout = {
    'stat-today-tasks': { x: 16, y: 16, scale },
    'stat-active-projects': { x: 400, y: 900, scale: 1 },
  };

  assert.deepEqual(
    snapMove('stat-today-tasks', { x: 412, y: 501 }, layout),
    { x: 416, y: 504, scale },
  );
});

test('move snapping clamps negative coordinates exactly', () => {
  assert.deepEqual(
    snapMove('sidebar', { x: -13, y: -2 }, { sidebar: DEFAULT_LAYOUT.sidebar }),
    { x: 0, y: 0, scale: 1 },
  );
});

test('resize uses one scalar and keeps the top-left anchor fixed', () => {
  const start = { x: 100, y: 200, scale: 1 };
  const resized = resizeFromPointer('journal-carousel', start, { dx: 186, dy: 66 }, {});
  const rect = computedRect('journal-carousel', resized);

  assert.deepEqual(resized, { x: 100, y: 200, scale: 1.2 });
  assert.equal(rect.width / rect.height, 930 / 330);
});

test('resize clamps its single scalar to the right canvas boundary', () => {
  const start = { x: 800, y: 200, scale: 0.65 };

  assert.deepEqual(
    resizeFromPointer('journal-carousel', start, { dx: 1000, dy: 1000 }, {}),
    { x: 800, y: 200, scale: 84 / 93 },
  );
});

test('resize does not treat an overlapping far edge as a standard horizontal gap', () => {
  const start = { x: 100, y: 100, scale: 1 };
  const rawScale = 215 / 153;
  const deltaScale = rawScale - start.scale;
  const layout = {
    'stat-today-tasks': start,
    sidebar: { x: 403, y: 900, scale: 1 },
  };

  assert.deepEqual(
    resizeFromPointer('stat-today-tasks', start, {
      dx: 306 * deltaScale,
      dy: 118 * deltaScale,
    }, layout),
    { x: 100, y: 100, scale: 82 / 59 },
  );
});

test('horizontal resize gap snapping leaves a true 16-unit non-overlapping gap', () => {
  const start = { x: 100, y: 100, scale: 1 };
  const deltaScale = 145 / 153 - start.scale;
  const layout = {
    'stat-today-tasks': start,
    sidebar: { x: 403, y: 900, scale: 1 },
  };
  const resized = resizeFromPointer('stat-today-tasks', start, {
    dx: 306 * deltaScale,
    dy: 118 * deltaScale,
  }, layout);
  const resizedRect = computedRect('stat-today-tasks', resized);
  const targetRect = computedRect('sidebar', layout.sidebar);

  assert.deepEqual(resized, { x: 100, y: 100, scale: 287 / 306 });
  assert.equal(targetRect.x - (resizedRect.x + resizedRect.width), 16);
  assert.equal(overlaps(resizedRect, targetRect), false);
});

test('vertical resize gap snapping leaves a true 16-unit non-overlapping gap', () => {
  const start = { x: 100, y: 100, scale: 1 };
  const deltaScale = 183 / 118 - start.scale;
  const layout = {
    'stat-today-tasks': start,
    sidebar: { x: 100, y: 300, scale: 1 },
  };
  const resized = resizeFromPointer('stat-today-tasks', start, {
    dx: 306 * deltaScale,
    dy: 118 * deltaScale,
  }, layout);
  const resizedRect = computedRect('stat-today-tasks', resized);
  const targetRect = computedRect('sidebar', layout.sidebar);

  assert.deepEqual(resized, { x: 100, y: 100, scale: 92 / 59 });
  assert.equal(targetRect.y - (resizedRect.y + resizedRect.height), 16);
  assert.equal(overlaps(resizedRect, targetRect), false);
});

test('detailed move reports exact renderable boundary guides without changing the stored result', () => {
  const detailed = snapMoveDetailed(
    'sidebar',
    { x: 5, y: 5 },
    { sidebar: DEFAULT_LAYOUT.sidebar },
  );

  assert.deepEqual(detailed.stored, snapMove(
    'sidebar',
    { x: 5, y: 5 },
    { sidebar: DEFAULT_LAYOUT.sidebar },
  ));
  assert.deepEqual(detailed.guides, [
    { axis: 'x', coordinate: 0, kind: 'boundary', targetId: 'canvas-x-start' },
    { axis: 'y', coordinate: 0, kind: 'boundary', targetId: 'canvas-y-start' },
  ]);
});

test('detailed move preserves the selected standard-gap size and label', () => {
  const layout = {
    sidebar: { x: 16, y: 16, scale: 1 },
    'stat-today-tasks': { x: 300, y: 100, scale: 1 },
  };
  const detailed = snapMoveDetailed('sidebar', { x: 177, y: 501 }, layout);

  assert.deepEqual(detailed.stored, { x: 180, y: 504, scale: 1 });
  assert.deepEqual(detailed.guides[0], {
    axis: 'x',
    coordinate: 292,
    kind: 'gap',
    targetId: 'stat-today-tasks',
    gap: 8,
    label: '8',
  });
  assert.deepEqual(detailed.guides[1], {
    axis: 'y',
    coordinate: 504,
    kind: 'grid',
    targetId: 'grid',
  });
});

test('detailed resize converts the selected scalar candidate into a physical guide', () => {
  const start = { x: 100, y: 200, scale: 1 };
  const detailed = resizeFromPointerDetailed(
    'journal-carousel',
    start,
    { dx: 186, dy: 66 },
    {},
  );

  assert.deepEqual(detailed.stored, resizeFromPointer(
    'journal-carousel',
    start,
    { dx: 186, dy: 66 },
    {},
  ));
  assert.deepEqual(detailed.guides, [{
    axis: 'x',
    coordinate: 1216,
    kind: 'grid',
    targetId: 'grid-x',
  }]);
});

test('detailed move distinguishes center alignment with a short renderable label', () => {
  const layout = {
    sidebar: { x: 16, y: 16, scale: 1 },
    'stat-today-tasks': { x: 300, y: 900, scale: 1 },
  };
  const detailed = snapMoveDetailed('sidebar', { x: 402, y: 501 }, layout);

  assert.deepEqual(detailed.guides[0], {
    axis: 'x',
    coordinate: 453,
    kind: 'edge',
    targetId: 'stat-today-tasks',
    alignment: 'center',
    label: '居中',
  });
  assert.deepEqual(detailed.stored, snapMove('sidebar', { x: 402, y: 501 }, layout));
});

test('detailed resize distinguishes a center scalar snap while preserving edge priority', () => {
  const definitionWidth = MODULE_DEFINITIONS.header.baseWidth;
  const definitionHeight = MODULE_DEFINITIONS.header.baseHeight;
  const deltaScale = 0.65 - 1;
  const dx = deltaScale * (definitionWidth ** 2 + definitionHeight ** 2) / definitionWidth;
  const start = { x: 0, y: 1000, scale: 1 };
  const layout = {
    header: start,
    'stat-today-tasks': { x: 263, y: 0, scale: 1 },
  };
  const detailed = resizeFromPointerDetailed('header', start, { dx, dy: 0 }, layout);

  assert.deepEqual(detailed.guides, [{
    axis: 'x',
    coordinate: 416,
    kind: 'edge',
    targetId: 'stat-today-tasks',
    alignment: 'center',
    label: '居中',
  }]);
  assert.deepEqual(detailed.stored, resizeFromPointer('header', start, { dx, dy: 0 }, layout));
});
