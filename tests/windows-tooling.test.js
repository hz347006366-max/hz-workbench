const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const pluginDir = path.resolve(__dirname, '..');
const repositoryDir = path.resolve(pluginDir, '../..');
const installDir = path.resolve(repositoryDir, 'install/hz-workbench');

test('package syntax check is portable across Windows and POSIX shells', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(pluginDir, 'package.json'), 'utf8'));
  assert.doesNotMatch(packageJson.scripts.check, /src\/\*\.js/);
  assert.match(packageJson.scripts.check, /node scripts\/check-syntax\.js/);

  const result = spawnSync(process.execPath, ['scripts/check-syntax.js'], {
    cwd: pluginDir,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('repository policy keeps release text artifacts LF-only on every platform', () => {
  const attributes = fs.readFileSync(path.join(repositoryDir, '.gitattributes'), 'utf8');
  assert.match(attributes, /^\* text=auto eol=lf$/m);
  assert.match(attributes, /^\*\.png binary$/m);
  assert.match(attributes, /^\*\.bundle binary$/m);

  for (const directory of [pluginDir, installDir]) {
    for (const artifact of ['main.js', 'manifest.json', 'styles.css']) {
      const bytes = fs.readFileSync(path.join(directory, artifact));
      assert.equal(bytes.includes(Buffer.from('\r\n')), false, `${artifact} must use LF in ${directory}`);
    }
  }
});
