const {
  CANVAS_WIDTH,
  DEFAULT_LAYOUT,
  validateLayout,
  layoutConflicts,
} = require('./layout-model');

const DEVICE_ID_KEY = 'hz-workbench:device-id:v1';
const CURRENT_SCHEMA_VERSION = 2;
const LEGACY_CANVAS_WIDTH = 1440;
const LAYOUT_X_SHIFT = 194;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MIGRATIONS = Object.freeze({
  0: (document) => ({
    ...document,
    schemaVersion: 1,
    canvasWidth: LEGACY_CANVAS_WIDTH,
  }),
  1: (document) => {
    const source = document.modules && typeof document.modules === 'object'
      ? document.modules
      : {};
    const modules = {};
    for (const [moduleId, stored] of Object.entries(source)) {
      modules[moduleId] = moduleId === 'sidebar' || !Object.hasOwn(DEFAULT_LAYOUT, moduleId)
        ? stored
        : { ...stored, x: Number.isFinite(stored?.x) ? stored.x + LAYOUT_X_SHIFT : stored?.x };
    }
    if (!Object.hasOwn(modules, 'agent-panel')) modules['agent-panel'] = { ...DEFAULT_LAYOUT['agent-panel'] };
    return { ...document, schemaVersion: 2, canvasWidth: CANVAS_WIDTH, modules };
  },
});

function isUuidV4(value) {
  return typeof value === 'string' && UUID_V4.test(value);
}

function isCanonicalIsoTimestamp(value) {
  if (typeof value !== 'string') return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function joinVaultPath(...parts) {
  return parts
    .filter((part) => typeof part === 'string' && part.length > 0)
    .map((part, index) => (index === 0 ? part.replace(/\/+$/g, '') : part.replace(/^\/+|\/+$/g, '')))
    .filter(Boolean)
    .join('/');
}

function validateDocument(document, expectedDeviceId, { strictModules = false } = {}) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('Layout document must be an object');
  }
  if (document.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    throw new Error(`Unsupported layout schema version: ${document.schemaVersion}`);
  }
  if (document.deviceId !== expectedDeviceId || !isUuidV4(document.deviceId)) {
    throw new Error('Layout document has an invalid device ID');
  }
  if (document.canvasWidth !== CANVAS_WIDTH) {
    throw new Error('Layout document has an invalid canvas width');
  }
  if (!document.modules || typeof document.modules !== 'object' || Array.isArray(document.modules)) {
    throw new Error('Layout document has invalid modules');
  }
  if (!isCanonicalIsoTimestamp(document.updatedAt)) {
    throw new Error('Layout document has an invalid update timestamp');
  }
  if (strictModules && validateLayout(document.modules).repaired.length > 0) {
    throw new Error('Layout document has an invalid module layout');
  }
  return document;
}

function migrateDocument(source) {
  let document = source;
  while (document?.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    const migration = MIGRATIONS[document?.schemaVersion];
    if (!migration) {
      throw new Error(`Unsupported layout schema version: ${document?.schemaVersion}`);
    }
    document = migration(document);
  }
  return document;
}

class LayoutStore {
  constructor({
    adapter,
    configDir,
    localStorage,
    now = () => new Date().toISOString(),
    uuid = () => crypto.randomUUID(),
    onRecovery = () => {},
  }) {
    this.adapter = adapter;
    this.configDir = configDir;
    this.localStorage = localStorage;
    this.now = now;
    this.uuid = uuid;
    this.onRecovery = onRecovery;
    this.cachedDeviceId = null;
  }

  deviceId() {
    if (this.cachedDeviceId) return this.cachedDeviceId;

    const stored = this.localStorage.getItem(DEVICE_ID_KEY);
    if (isUuidV4(stored)) {
      this.cachedDeviceId = stored;
      return stored;
    }

    const generated = this.uuid();
    if (!isUuidV4(generated)) {
      throw new Error('Device ID generator must return a UUID v4');
    }
    this.localStorage.setItem(DEVICE_ID_KEY, generated);
    this.cachedDeviceId = generated;
    return generated;
  }

  layoutDir() {
    return joinVaultPath(this.configDir, 'hz-workbench', 'layouts');
  }

  layoutPath() {
    return joinVaultPath(this.layoutDir(), `${this.deviceId()}.json`);
  }

  recoveryPath() {
    return joinVaultPath(this.layoutDir(), `${this.deviceId()}.recovery.json`);
  }

  schemaBackupPath(version) {
    return joinVaultPath(this.layoutDir(), `${this.deviceId()}.schema-v${version}.backup.json`);
  }

  async ensureLayoutDir() {
    const directory = this.layoutDir();
    const segments = directory.split('/').filter(Boolean);
    let current = directory.startsWith('/') ? '/' : '';

    for (const segment of segments) {
      current = current === '/' ? `/${segment}` : joinVaultPath(current, segment);
      if (!(await this.adapter.exists(current))) await this.adapter.mkdir(current);
    }
  }

  async cleanup(path) {
    if (typeof this.adapter.remove !== 'function') return;
    if (await this.adapter.exists(path)) await this.adapter.remove(path);
  }

  async load() {
    const path = this.layoutPath();
    if (!(await this.adapter.exists(path))) return validateLayout({}).layout;

    const raw = await this.adapter.read(path);
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      await this.ensureLayoutDir();
      await this.adapter.write(this.recoveryPath(), raw);
      return validateLayout({}).layout;
    }

    if (parsed.schemaVersion === 1) {
      const backupPath = this.schemaBackupPath(1);
      if (!(await this.adapter.exists(backupPath))) {
        await this.ensureLayoutDir();
        await this.adapter.write(backupPath, raw);
      }
    }

    const sourceVersion = parsed.schemaVersion;
    const migrated = migrateDocument(parsed);
    validateDocument(migrated, this.deviceId());
    const validated = validateLayout(migrated.modules);
    if (sourceVersion < CURRENT_SCHEMA_VERSION
      && (validated.repaired.length > 0 || layoutConflicts(validated.layout).length > 0)) {
      this.onRecovery('旧版布局无法安全迁移，已恢复新版默认布局。');
      return validateLayout({}).layout;
    }
    return validated.layout;
  }

  async save(layout) {
    await this.ensureLayoutDir();

    const deviceId = this.deviceId();
    const path = this.layoutPath();
    const tempPath = `${path}.tmp`;
    const modules = validateLayout(layout).layout;
    const document = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      deviceId,
      canvasWidth: CANVAS_WIDTH,
      modules,
      updatedAt: this.now(),
    };
    const serialized = JSON.stringify(document, null, 2);

    await this.adapter.write(tempPath, serialized);
    try {
      const tempRaw = await this.adapter.read(tempPath);
      const verified = JSON.parse(tempRaw);
      validateDocument(verified, deviceId, { strictModules: true });
      try {
        await this.adapter.rename(tempPath, path);
      } catch (error) {
        if (!(await this.adapter.exists(path))) throw error;
        await this.adapter.write(path, tempRaw);
      }
    } finally {
      await this.cleanup(tempPath);
    }
  }
}

module.exports = { LayoutStore };
