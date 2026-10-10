const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pluginDir = path.resolve(__dirname, '..');
const installDir = path.resolve(pluginDir, '../../install/hz-workbench');
const hostCodeMirrorPackages = ['@codemirror/state', '@codemirror/view'];

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function configuredExternals() {
  const config = read(path.join(pluginDir, 'esbuild.config.mjs'));
  const match = config.match(/external\s*:\s*\[([^\]]*)\]/);
  assert.ok(match, 'esbuild config must declare a literal external array');
  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((entry) => entry[1]);
}

test('esbuild externalizes the exact Obsidian host CodeMirror packages', () => {
  assert.deepEqual(configuredExternals(), ['obsidian', ...hostCodeMirrorPackages]);
});

for (const [label, artifactPath] of [
  ['development', path.join(pluginDir, 'main.js')],
  ['install', path.join(installDir, 'main.js')],
]) {
  test(`${label} artifact excludes private CodeMirror runtime diagnostics`, () => {
    const artifact = read(artifactPath);
    assert.doesNotMatch(artifact, /multiple instances of @codemirror\/state/);
    assert.doesNotMatch(artifact, /Unrecognized extension value in extension set/);
  });

  test(`${label} artifact resolves CodeMirror from the Obsidian host`, () => {
    const artifact = read(artifactPath);
    for (const packageName of hostCodeMirrorPackages) {
      assert.match(artifact, new RegExp(`require\\(["']${packageName.replace('/', '\\/')}["']\\)`));
    }
  });
}
