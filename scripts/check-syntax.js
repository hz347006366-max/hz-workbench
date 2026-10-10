const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const sourceDir = path.resolve(__dirname, '../src');
const sourceFiles = fs.readdirSync(sourceDir)
  .filter((name) => name.endsWith('.js'))
  .sort();

for (const name of sourceFiles) {
  const result = spawnSync(process.execPath, ['--check', path.join(sourceDir, name)], {
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
