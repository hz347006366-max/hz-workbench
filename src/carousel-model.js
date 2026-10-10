const DEFAULT_PROJECTION_MS = 180;
const DEFAULT_MAX_PROJECTION_CARDS = 2;
const MIN_SNAP_DURATION_MS = 50;
const DEFAULT_SNAP_DURATION_MS = 120;
const MAX_SNAP_DURATION_MS = 420;

function finiteNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function roundHalfAwayFromZero(value) {
  if (!Number.isFinite(value) || value === 0) return 0;
  const rounded = value > 0 ? Math.floor(value + 0.5) : Math.ceil(value - 0.5);
  return Object.is(rounded, -0) ? 0 : rounded;
}

function circularIndex(index, length) {
  return length ? ((index % length) + length) % length : 0;
}

function createCarouselState(items, index = 0) {
  const safeItems = Array.isArray(items) ? items : [];
  return {
    items: safeItems,
    index: circularIndex(index, safeItems.length),
    poolSize: safeItems.length <= 5 ? safeItems.length : 7,
  };
}

function visibleItems(state) {
  if (state.items.length <= 5) return state.items;
  return [-2, -1, 0, 1, 2].map((offset) =>
    state.items[circularIndex(state.index + offset, state.items.length)]);
}

function move(state, direction) {
  if (state.items.length < 2 || !direction) return state;
  return {
    ...state,
    index: circularIndex(state.index + Math.sign(direction), state.items.length),
  };
}

function wheelPixels(delta, deltaMode) {
  if (deltaMode === 1) return delta * 16;
  if (deltaMode === 2) return delta * 800;
  return delta;
}

function accumulateWheel(state, delta, deltaMode) {
  const pixels = wheelPixels(delta, deltaMode);
  const direction = Math.sign(pixels);
  if (!direction) return { state, move: 0 };
  const nextPixels = direction && direction === state.direction
    ? state.pixels + Math.abs(pixels)
    : Math.abs(pixels);

  if (nextPixels >= 40) {
    return { state: { pixels: 0, direction: 0 }, move: direction };
  }

  return { state: { pixels: nextPixels, direction }, move: 0 };
}

function dragDirection(distance) {
  if (Math.abs(distance) < 35) return 0;
  return distance > 0 ? -1 : 1;
}

/** Clamp a pointer displacement in CSS pixels to a bounded card span. */
function clampDragOffset(offsetPx, pixelsPerCard, maxCards = 1) {
  const offset = finiteNumber(offsetPx);
  const card = Math.abs(finiteNumber(pixelsPerCard));
  const span = card * Math.max(0, finiteNumber(maxCards, 1));
  if (!span) return 0;
  return Math.max(-span, Math.min(span, offset));
}

/** Return signed CSS pixels per millisecond from supplied samples. */
function sampleVelocity(distancePx, elapsedMs) {
  const elapsed = finiteNumber(elapsedMs);
  if (elapsed <= 0) return 0;
  return finiteNumber(distancePx) / elapsed;
}

/** Project an offset and velocity into a bounded integer card displacement. */
function projectDestination(
  offsetPx,
  velocityPxPerMs,
  pixelsPerCard,
  projectionMs = DEFAULT_PROJECTION_MS,
  maxCards = DEFAULT_MAX_PROJECTION_CARDS,
) {
  const card = Math.abs(finiteNumber(pixelsPerCard));
  if (!card) return 0;
  const projectedPx = finiteNumber(offsetPx) + finiteNumber(velocityPxPerMs) * Math.max(0, finiteNumber(projectionMs));
  const limit = Math.max(0, finiteNumber(maxCards, DEFAULT_MAX_PROJECTION_CARDS));
  const displacement = roundHalfAwayFromZero(-(projectedPx / card));
  return Math.max(-limit, Math.min(limit, displacement));
}

function circularDestinationIndex(index, displacement, length) {
  return circularIndex(finiteNumber(index) + finiteNumber(displacement), Math.max(0, Math.trunc(finiteNumber(length))));
}

/** Compute a bounded CSS animation duration from distance and sampled velocity. */
function snapDuration(distancePx, velocityPxPerMs, reducedMotion = false) {
  if (reducedMotion) return 0;
  const distance = Math.abs(finiteNumber(distancePx));
  if (distance === 0) return 0;
  const velocity = Math.abs(finiteNumber(velocityPxPerMs));
  const raw = velocity > 0 ? distance / velocity : MAX_SNAP_DURATION_MS;
  return Math.max(MIN_SNAP_DURATION_MS, Math.min(MAX_SNAP_DURATION_MS, raw));
}

module.exports = {
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
  DEFAULT_PROJECTION_MS,
  DEFAULT_MAX_PROJECTION_CARDS,
  MIN_SNAP_DURATION_MS,
  DEFAULT_SNAP_DURATION_MS,
  MAX_SNAP_DURATION_MS,
};
