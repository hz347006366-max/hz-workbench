const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createCarouselState,
  visibleItems,
  move,
  accumulateWheel,
  dragDirection,
  clampDragOffset,
  sampleVelocity,
  projectDestination,
  circularDestinationIndex,
  snapDuration,
} = require('../src/carousel-model');

const items = (count) => Array.from({ length: count }, (_, index) => ({ id: String(index) }));

test('uses the actual pool size through five items and seven slots above five', () => {
  for (const count of [0, 1, 2, 3, 4, 5]) {
    assert.equal(createCarouselState(items(count)).poolSize, count);
  }
  assert.equal(createCarouselState(items(6)).poolSize, 7);
  assert.equal(createCarouselState(items(30)).poolSize, 7);
});

test('returns each actual item once when fewer than five items exist', () => {
  const state = createCarouselState(items(4));
  const visible = visibleItems(state);
  assert.equal(visible, state.items);
  assert.deepEqual(visible.map((item) => item.id), ['0', '1', '2', '3']);
  assert.equal(new Set(visible).size, 4);
});

test('returns five circular items centered on the current item above five', () => {
  const state = createCarouselState(items(8), 0);
  assert.deepEqual(visibleItems(state).map((item) => item.id), ['6', '7', '0', '1', '2']);
});

test('moves circularly without replacing or mutating the item array', () => {
  const source = items(8);
  const state = createCarouselState(source);
  const forward = move(state, 1);
  const backward = move(state, -1);
  assert.equal(state.items, source);
  assert.equal(forward.items, state.items);
  assert.equal(backward.items, state.items);
  assert.equal(forward.index, 1);
  assert.equal(backward.index, 7);
  assert.deepEqual(source.map((item) => item.id), ['0', '1', '2', '3', '4', '5', '6', '7']);
});

test('does not move state with fewer than two items or zero direction', () => {
  const empty = createCarouselState([]);
  const single = createCarouselState(items(1));
  const many = createCarouselState(items(2));
  assert.equal(move(empty, 1), empty);
  assert.equal(move(single, -1), single);
  assert.equal(move(many, 0), many);
});

test('wheel moves only when normalized accumulation reaches 40px', () => {
  let result = accumulateWheel({ pixels: 0, direction: 0 }, 39, 0);
  assert.equal(result.move, 0);
  result = accumulateWheel(result.state, 1, 0);
  assert.equal(result.move, 1);
  assert.deepEqual(result.state, { pixels: 0, direction: 0 });
});

test('wheel line and page modes convert to CSS pixels', () => {
  const line = accumulateWheel({ pixels: 0, direction: 0 }, 2, 1);
  assert.equal(line.move, 0);
  assert.deepEqual(line.state, { pixels: 32, direction: 1 });
  const page = accumulateWheel({ pixels: 0, direction: 0 }, -1, 2);
  assert.equal(page.move, -1);
  assert.deepEqual(page.state, { pixels: 0, direction: 0 });
});

test('wheel direction changes clear prior accumulation', () => {
  const first = accumulateWheel({ pixels: 0, direction: 0 }, 30, 0);
  const second = accumulateWheel(first.state, -20, 0);
  assert.equal(second.move, 0);
  assert.deepEqual(second.state, { pixels: 20, direction: -1 });
});

test('wheel zero delta preserves valid accumulation', () => {
  const first = accumulateWheel({ pixels: 0, direction: 0 }, 30, 0);
  const zero = accumulateWheel(first.state, 0, 0);
  assert.equal(zero.move, 0);
  assert.equal(zero.state, first.state);
  assert.deepEqual(zero.state, { pixels: 30, direction: 1 });
  const threshold = accumulateWheel(zero.state, 10, 0);
  assert.equal(threshold.move, 1);
  assert.deepEqual(threshold.state, { pixels: 0, direction: 0 });
});

test('horizontal drag requires exactly 35 CSS pixels', () => {
  assert.equal(dragDirection(34), 0);
  assert.equal(dragDirection(35), -1);
  assert.equal(dragDirection(-35), 1);
});

test('clamps drag offset to one card in either direction', () => {
  for (const [offset, expected] of [[-400, -120], [-120, -120], [-40, -40], [0, 0], [40, 40], [120, 120], [400, 120]]) {
    assert.equal(clampDragOffset(offset, 120), expected);
  }
});

test('samples velocity from supplied distance and elapsed milliseconds', () => {
  assert.equal(sampleVelocity(240, 120), 2);
  assert.equal(sampleVelocity(-90, 30), -3);
  assert.equal(sampleVelocity(90, 0), 0);
});

test('projects a bounded destination in card units', () => {
  const cases = [
    [0, 0, 100, 180, 2, 0],
    [60, 0, 100, 180, 2, -1],
    [-60, 0, 100, 180, 2, 1],
    [0, 2, 100, 180, 2, -2],
    [0, -9, 100, 180, 2, 2],
  ];
  for (const [offset, velocity, ppc, projectionMs, maxCards, expected] of cases) {
    assert.equal(projectDestination(offset, velocity, ppc, projectionMs, maxCards), expected);
  }
});

test('projects card displacement with symmetric half-away-from-zero rounding', () => {
  const cases = [
    [50, 0, 100, 180, 2, -1],
    [-50, 0, 100, 180, 2, 1],
    [49.999, 0, 100, 180, 2, 0],
    [-49.999, 0, 100, 180, 2, 0],
    [150, 0, 100, 180, 2, -2],
    [-150, 0, 100, 180, 2, 2],
  ];
  for (const [offset, velocity, ppc, projectionMs, maxCards, expected] of cases) {
    assert.equal(projectDestination(offset, velocity, ppc, projectionMs, maxCards), expected);
  }
});

test('projects deterministically for non-finite and zero pixels per card', () => {
  assert.equal(projectDestination(90, 0, 0), 0);
  assert.equal(projectDestination(90, 0, Number.NaN), 0);
  assert.equal(projectDestination(10, 999, 100), -2);
  assert.equal(projectDestination(10, Number.NaN, 100), 0);
});

test('wraps a projected destination index circularly', () => {
  assert.deepEqual([circularDestinationIndex(0, -1, 5), circularDestinationIndex(4, 2, 5), circularDestinationIndex(2, 0, 0)], [4, 1, 0]);
});

test('bounds snap duration and makes reduced motion immediate', () => {
  assert.equal(snapDuration(0, 0), 0);
  assert.equal(snapDuration(100, 0), 420);
  assert.equal(snapDuration(100, 1000), 50);
  assert.equal(snapDuration(100, 2), 50);
  assert.equal(snapDuration(100, 2, true), 0);
});
