const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const expectedVersion = '0.4.0';
const pluginDir = path.resolve(__dirname, '..');
const installDir = path.resolve(pluginDir, '../../install/hz-workbench');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function assertArtifactsMatch(sourceDir, targetDir, artifacts) {
  for (const artifact of artifacts) {
    const sourcePath = path.join(sourceDir, artifact);
    const targetPath = path.join(targetDir, artifact);
    assert.ok(fs.statSync(sourcePath).isFile(), `${artifact} must exist in development`);
    assert.ok(fs.statSync(targetPath).isFile(), `${artifact} must exist in the install package`);
    assert.ok(
      fs.readFileSync(sourcePath).equals(fs.readFileSync(targetPath)),
      `${artifact} must byte-match development`,
    );
  }
}

function assertBundleContract(directory) {
  const bundle = fs.readFileSync(path.join(directory, 'main.js'), 'utf8');
  const styles = fs.readFileSync(path.join(directory, 'styles.css'), 'utf8');
  const visibleAgentLabel = '进入 Copilot 智能体';
  const escapedAgentLabel = visibleAgentLabel.replace(
    /[^\x00-\x7f]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
  const upperEscapedAgentLabel = escapedAgentLabel.replace(
    /\\u[0-9a-f]{4}/g,
    (escape) => `\\u${escape.slice(2).toUpperCase()}`,
  );

  assert.match(bundle, /copilot:agent-chat-open-window/);
  assert.match(bundle, /DeepSeek-V4-Flash/);
  assert.ok(
    bundle.includes(visibleAgentLabel)
      || bundle.includes(escapedAgentLabel)
      || bundle.includes(upperEscapedAgentLabel),
    'bundle must include the visible Copilot agent entry label',
  );
  assert.doesNotMatch(
    `${bundle}\n${styles}`,
    /hz-agent-(?:empty|compose|send)/,
    'release must not include the retired agent input/send panel',
  );
}

test('artifact validation rejects install bytes that drift from development', (t) => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hz-workbench-release-'));
  const sourceDir = path.join(fixtureDir, 'development');
  const targetDir = path.join(fixtureDir, 'install');
  fs.mkdirSync(sourceDir);
  fs.mkdirSync(targetDir);
  fs.writeFileSync(path.join(sourceDir, 'main.js'), 'development bytes');
  fs.writeFileSync(path.join(targetDir, 'main.js'), 'drifted install bytes');
  t.after(() => fs.rmSync(fixtureDir, { recursive: true }));

  assert.throws(
    () => assertArtifactsMatch(sourceDir, targetDir, ['main.js']),
    /main\.js must byte-match development/,
  );
});

test('release package metadata and install artifacts are release-ready', () => {
  const packageJson = readJson(path.join(pluginDir, 'package.json'));
  const developmentManifest = readJson(path.join(pluginDir, 'manifest.json'));
  const installManifest = readJson(path.join(installDir, 'manifest.json'));

  assert.equal(packageJson.version, expectedVersion);
  assert.equal(developmentManifest.version, expectedVersion);
  assert.equal(installManifest.version, expectedVersion);

  assertArtifactsMatch(pluginDir, installDir, ['main.js', 'manifest.json', 'styles.css', 'logo.png', 'THIRD_PARTY_NOTICES.md', 'LICENSE-prism-glass.txt', 'NOTICE-prism-glass.txt']);
  assertBundleContract(pluginDir);
  assertBundleContract(installDir);
});

test('HZ all-checks runner uses project gates without reference demo assumptions', () => {
  const runner = fs.readFileSync(path.join(pluginDir, 'scripts/run_all_checks.py'), 'utf8');
  assert.match(runner, /NODE_BIN/);
  assert.match(runner, /esbuild\.config\.mjs/);
  assert.match(runner, /check-syntax\.js/);
  assert.match(runner, /--test/);
  assert.match(runner, /main\.js.*styles\.css.*manifest\.json.*logo\.png/s);
  assert.doesNotMatch(runner, /folder-card|12 cards|playwright/i);
});
