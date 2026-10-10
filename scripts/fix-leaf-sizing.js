const fs = require('node:fs');
const path = require('node:path');

const target = path.resolve(__dirname, '../styles.css');
let css = fs.readFileSync(target, 'utf8');
const before = '.hz-workbench-host .view-content{padding:0;overflow:hidden;background:#030604}.hz-workbench{width:100%;max-width:100%;overflow:auto;';
const after = '.hz-workbench-host .view-content{position:relative;padding:0;overflow:hidden;background:#030604}.hz-workbench{position:absolute;inset:0;width:auto;max-width:none;overflow:auto;';
if (!css.includes(before)) throw new Error('无法定位叶片尺寸规则');
css = css.replace(before, after);
fs.writeFileSync(target, css, 'utf8');
console.log('LEAF_SIZING_FIXED');
