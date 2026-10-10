const CANVAS_WIDTH = 1640;
const GRID_SIZE = 8;
const SNAP_DISTANCE = 8;
const MIN_VIEW_SCALE = 0.68;

const MODULE_DEFINITIONS = Object.freeze({
  sidebar: { label: 'Logo', baseWidth: 112, baseHeight: 112, minScale: 0.65, maxScale: 2 },
  'agent-panel': { label: '天气', baseWidth: 306, baseHeight: 760, minScale: 0.65, maxScale: 2 },
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
  'agent-panel': { x: 16, y: 144, scale: 1 },
  header: { x: 338, y: 16, scale: 1 },
  'stat-today-tasks': { x: 338, y: 104, scale: 1 },
  'stat-active-projects': { x: 660, y: 104, scale: 1 },
  'stat-today-schedule': { x: 982, y: 104, scale: 1 },
  'stat-journal-streak': { x: 1304, y: 104, scale: 1 },
  'journal-carousel': { x: 338, y: 238, scale: 1 },
  projects: { x: 338, y: 584, scale: 1 },
  'must-do': { x: 1284, y: 238, scale: 1 },
  'today-tasks': { x: 1284, y: 556, scale: 1 },
});

function hasOwn(object, property) {
  return Object.prototype.hasOwnProperty.call(object, property);
}

function isKnownModule(moduleId) {
  return hasOwn(MODULE_DEFINITIONS, moduleId);
}

function moduleDefinition(moduleId) {
  if (!isKnownModule(moduleId)) throw new Error(`Unknown layout module: ${moduleId}`);
  return MODULE_DEFINITIONS[moduleId];
}

function defineOwn(target, property, value) {
  Object.defineProperty(target, property, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function computedRect(moduleId, stored) {
  const definition = moduleDefinition(moduleId);
  return {
    x: stored.x,
    y: stored.y,
    width: definition.baseWidth * stored.scale,
    height: definition.baseHeight * stored.scale,
  };
}

function cloneLayout(layout) {
  return Object.fromEntries(
    Object.entries(layout).map(([moduleId, stored]) => [moduleId, { ...stored }]),
  );
}

function computeCanvasHeight(layout) {
  const lowestBottom = Math.max(
    ...Object.entries(layout)
      .filter(([moduleId]) => isKnownModule(moduleId))
      .map(([moduleId, stored]) => {
        const rect = computedRect(moduleId, stored);
        return rect.y + rect.height;
      }),
  );
  return lowestBottom + 32;
}

function viewScale(availableWidth) {
  return Math.min(1, Math.max(MIN_VIEW_SCALE, availableWidth / CANVAS_WIDTH));
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function validateLayout(input) {
  const source = input && typeof input === 'object' ? input : {};
  const layout = {};
  const repaired = [];

  for (const moduleId of Object.keys(MODULE_DEFINITIONS)) {
    const definition = MODULE_DEFINITIONS[moduleId];
    const fallback = DEFAULT_LAYOUT[moduleId];
    const stored = source[moduleId];

    if (!stored || typeof stored !== 'object') {
      layout[moduleId] = { ...fallback };
      repaired.push(moduleId);
      continue;
    }

    const requestedScale = Number.isFinite(stored.scale) ? stored.scale : fallback.scale;
    const maximumScale = Math.min(definition.maxScale, CANVAS_WIDTH / definition.baseWidth);
    const scale = clamp(requestedScale, definition.minScale, maximumScale);
    const requestedX = Number.isFinite(stored.x) ? stored.x : fallback.x;
    const requestedY = Number.isFinite(stored.y) ? stored.y : fallback.y;
    const x = clamp(requestedX, 0, CANVAS_WIDTH - definition.baseWidth * scale);
    const y = Math.max(0, requestedY);

    layout[moduleId] = { x, y, scale };
    if (x !== stored.x || y !== stored.y || scale !== stored.scale) repaired.push(moduleId);
  }

  for (const [moduleId, stored] of Object.entries(source)) {
    if (!isKnownModule(moduleId)) defineOwn(layout, moduleId, stored);
  }

  return { layout, repaired };
}

function overlaps(a, b) {
  return a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y;
}

function layoutConflicts(layout) {
  const moduleIds = Object.keys(layout).filter((moduleId) => isKnownModule(moduleId));
  const conflicts = new Set();

  for (let index = 0; index < moduleIds.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < moduleIds.length; otherIndex += 1) {
      const moduleId = moduleIds[index];
      const otherId = moduleIds[otherIndex];
      if (overlaps(computedRect(moduleId, layout[moduleId]), computedRect(otherId, layout[otherId]))) {
        conflicts.add(moduleId);
        conflicts.add(otherId);
      }
    }
  }

  return [...conflicts];
}

const SNAP_KIND_RANK = Object.freeze({
  boundary: 0,
  edge: 1,
  gap: 2,
  grid: 3,
});

function compareSnapCandidates(a, b) {
  const targetOrder = a.targetId === b.targetId ? 0 : (a.targetId < b.targetId ? -1 : 1);
  return SNAP_KIND_RANK[a.kind] - SNAP_KIND_RANK[b.kind]
    || a.distance - b.distance
    || targetOrder;
}

function addPositionCandidate(
  candidates,
  axis,
  currentValue,
  value,
  kind,
  targetId,
  { coordinate = value, gap, alignment, label } = {},
) {
  const distance = Math.abs(currentValue - value);
  if (distance <= SNAP_DISTANCE) {
    const candidate = { axis, value, kind, distance, targetId, coordinate };
    if (Number.isFinite(gap)) {
      candidate.gap = gap;
      candidate.label = String(gap);
    }
    if (alignment) candidate.alignment = alignment;
    if (label) candidate.label = label;
    candidates.push(candidate);
  }
}

function positionCandidates(axis, currentValue, size, moduleId, layout, maximum) {
  const candidates = [];
  addPositionCandidate(
    candidates,
    axis,
    currentValue,
    0,
    'boundary',
    `canvas-${axis}-start`,
    { coordinate: 0 },
  );
  if (Number.isFinite(maximum)) {
    addPositionCandidate(
      candidates,
      axis,
      currentValue,
      maximum,
      'boundary',
      `canvas-${axis}-end`,
      { coordinate: maximum + size },
    );
  }

  for (const targetId of Object.keys(layout).filter((id) => id !== moduleId && isKnownModule(id))) {
    const target = computedRect(targetId, layout[targetId]);
    const targetStart = axis === 'x' ? target.x : target.y;
    const targetSize = axis === 'x' ? target.width : target.height;
    const targetEnd = targetStart + targetSize;
    const targetCenter = targetStart + targetSize / 2;

    for (const alignment of [
      { value: targetStart, coordinate: targetStart },
      { value: targetEnd - size, coordinate: targetEnd },
      { value: targetEnd, coordinate: targetEnd },
      { value: targetStart - size, coordinate: targetStart },
      {
        value: targetCenter - size / 2,
        coordinate: targetCenter,
        alignment: 'center',
        label: '居中',
      },
    ]) {
      addPositionCandidate(
        candidates,
        axis,
        currentValue,
        alignment.value,
        'edge',
        targetId,
        {
          coordinate: alignment.coordinate,
          alignment: alignment.alignment,
          label: alignment.label,
        },
      );
    }

    for (const gap of [8, 16]) {
      addPositionCandidate(
        candidates,
        axis,
        currentValue,
        targetStart - gap - size,
        'gap',
        targetId,
        { coordinate: targetStart - gap, gap },
      );
      addPositionCandidate(
        candidates,
        axis,
        currentValue,
        targetEnd + gap,
        'gap',
        targetId,
        { coordinate: targetEnd + gap, gap },
      );
    }
  }

  addPositionCandidate(
    candidates,
    axis,
    currentValue,
    Math.round(currentValue / GRID_SIZE) * GRID_SIZE,
    'grid',
    'grid',
    { coordinate: Math.round(currentValue / GRID_SIZE) * GRID_SIZE },
  );
  return candidates
    .filter((candidate) => candidate.value >= 0 && (!Number.isFinite(maximum) || candidate.value <= maximum))
    .sort(compareSnapCandidates);
}

function renderableGuide(candidate) {
  if (!candidate) return null;
  const guide = {
    axis: candidate.axis,
    coordinate: candidate.coordinate,
    kind: candidate.kind,
    targetId: candidate.targetId,
  };
  if (Number.isFinite(candidate.gap)) {
    guide.gap = candidate.gap;
  }
  if (candidate.alignment) guide.alignment = candidate.alignment;
  if (candidate.label) guide.label = candidate.label;
  return guide;
}

function snapMoveDetailed(moduleId, candidate, layout) {
  const definition = moduleDefinition(moduleId);
  const fallback = layout[moduleId] || DEFAULT_LAYOUT[moduleId];
  const requestedScale = Number.isFinite(candidate.scale) ? candidate.scale : fallback.scale;
  const maximumScale = Math.min(definition.maxScale, CANVAS_WIDTH / definition.baseWidth);
  const scale = clamp(requestedScale, definition.minScale, maximumScale);
  const width = definition.baseWidth * scale;
  const height = definition.baseHeight * scale;
  const maximumX = CANVAS_WIDTH - width;
  const requestedX = Number.isFinite(candidate.x) ? candidate.x : fallback.x;
  const requestedY = Number.isFinite(candidate.y) ? candidate.y : fallback.y;
  const xCandidates = positionCandidates('x', requestedX, width, moduleId, layout, maximumX);
  const yCandidates = positionCandidates('y', requestedY, height, moduleId, layout, null);
  const selectedX = xCandidates[0];
  const selectedY = yCandidates[0];

  return {
    stored: {
      x: clamp(selectedX?.value ?? requestedX, 0, maximumX),
      y: Math.max(0, selectedY?.value ?? requestedY),
      scale,
    },
    guides: [renderableGuide(selectedX), renderableGuide(selectedY)].filter(Boolean),
  };
}

function snapMove(moduleId, candidate, layout) {
  return snapMoveDetailed(moduleId, candidate, layout).stored;
}

function addScaleCandidate(
  candidates,
  value,
  kind,
  targetId,
  distance,
  limits,
  { axis, coordinate, gap, alignment, label } = {},
) {
  if (value < limits.minimum || value > limits.maximum || distance > SNAP_DISTANCE) return;
  const candidate = {
    axis: 'scale',
    value,
    kind,
    distance,
    targetId,
    guideAxis: axis,
    coordinate,
  };
  if (Number.isFinite(gap)) {
    candidate.gap = gap;
    candidate.label = String(gap);
  }
  if (alignment) candidate.alignment = alignment;
  if (label) candidate.label = label;
  candidates.push(candidate);
}

function resizeFromPointerDetailed(moduleId, start, delta, layout) {
  const definition = moduleDefinition(moduleId);
  const dx = Number.isFinite(delta.dx) ? delta.dx : 0;
  const dy = Number.isFinite(delta.dy) ? delta.dy : 0;
  const denominator = definition.baseWidth ** 2 + definition.baseHeight ** 2;
  const pointerScale = start.scale
    + (dx * definition.baseWidth + dy * definition.baseHeight) / denominator;
  const maximum = Math.min(
    definition.maxScale,
    CANVAS_WIDTH / definition.baseWidth,
    (CANVAS_WIDTH - start.x) / definition.baseWidth,
  );
  const limits = { minimum: Math.min(definition.minScale, maximum), maximum };
  const scale = clamp(pointerScale, limits.minimum, limits.maximum);
  const right = start.x + definition.baseWidth * scale;
  const bottom = start.y + definition.baseHeight * scale;
  const centerX = start.x + definition.baseWidth * scale / 2;
  const centerY = start.y + definition.baseHeight * scale / 2;
  const candidates = [];

  addScaleCandidate(
    candidates,
    (CANVAS_WIDTH - start.x) / definition.baseWidth,
    'boundary',
    'canvas-x-end',
    Math.abs(CANVAS_WIDTH - right),
    limits,
    { axis: 'x', coordinate: CANVAS_WIDTH },
  );

  for (const targetId of Object.keys(layout).filter((id) => id !== moduleId && isKnownModule(id))) {
    const target = computedRect(targetId, layout[targetId]);
    const targetRight = target.x + target.width;
    const targetBottom = target.y + target.height;
    const targetCenterX = target.x + target.width / 2;
    const targetCenterY = target.y + target.height / 2;

    for (const targetX of [target.x, targetRight]) {
      addScaleCandidate(
        candidates,
        (targetX - start.x) / definition.baseWidth,
        'edge',
        targetId,
        Math.abs(targetX - right),
        limits,
        { axis: 'x', coordinate: targetX },
      );
    }
    for (const targetY of [target.y, targetBottom]) {
      addScaleCandidate(
        candidates,
        (targetY - start.y) / definition.baseHeight,
        'edge',
        targetId,
        Math.abs(targetY - bottom),
        limits,
        { axis: 'y', coordinate: targetY },
      );
    }
    addScaleCandidate(
      candidates,
      2 * (targetCenterX - start.x) / definition.baseWidth,
      'edge',
      targetId,
      Math.abs(targetCenterX - centerX),
      limits,
      { axis: 'x', coordinate: targetCenterX, alignment: 'center', label: '居中' },
    );
    addScaleCandidate(
      candidates,
      2 * (targetCenterY - start.y) / definition.baseHeight,
      'edge',
      targetId,
      Math.abs(targetCenterY - centerY),
      limits,
      { axis: 'y', coordinate: targetCenterY, alignment: 'center', label: '居中' },
    );

    for (const gap of [8, 16]) {
      const targetX = target.x - gap;
      addScaleCandidate(
        candidates,
        (targetX - start.x) / definition.baseWidth,
        'gap',
        targetId,
        Math.abs(targetX - right),
        limits,
        { axis: 'x', coordinate: targetX, gap },
      );
      const targetY = target.y - gap;
      addScaleCandidate(
        candidates,
        (targetY - start.y) / definition.baseHeight,
        'gap',
        targetId,
        Math.abs(targetY - bottom),
        limits,
        { axis: 'y', coordinate: targetY, gap },
      );
    }
  }

  const gridRight = Math.round(right / GRID_SIZE) * GRID_SIZE;
  const gridBottom = Math.round(bottom / GRID_SIZE) * GRID_SIZE;
  addScaleCandidate(
    candidates,
    (gridRight - start.x) / definition.baseWidth,
    'grid',
    'grid-x',
    Math.abs(gridRight - right),
    limits,
    { axis: 'x', coordinate: gridRight },
  );
  addScaleCandidate(
    candidates,
    (gridBottom - start.y) / definition.baseHeight,
    'grid',
    'grid-y',
    Math.abs(gridBottom - bottom),
    limits,
    { axis: 'y', coordinate: gridBottom },
  );

  candidates.sort(compareSnapCandidates);
  const selected = candidates[0];
  const guide = selected
    ? renderableGuide({
      ...selected,
      axis: selected.guideAxis,
    })
    : null;
  return {
    stored: { x: start.x, y: start.y, scale: selected?.value ?? scale },
    guides: guide ? [guide] : [],
  };
}

function resizeFromPointer(moduleId, start, delta, layout) {
  return resizeFromPointerDetailed(moduleId, start, delta, layout).stored;
}

module.exports = {
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
};
