const fs = require('node:fs');
const path = require('node:path');

const target = path.resolve(__dirname, '../styles.css');
let css = fs.readFileSync(target, 'utf8');
const before = '.hz-workbench-host .view-content{position:relative;padding:0;overflow:hidden;background:#030604}';
const after = '.hz-workbench-host{position:relative;overflow:hidden}.hz-workbench-host .view-content{position:absolute!important;inset:0!important;width:auto!important;height:auto!important;padding:0;overflow:hidden;background:#030604}';
if (!css.includes(before)) throw new Error('无法定位 Obsidian 叶片宿主规则');
css = css.replace(before, after);
fs.writeFileSync(target, css, 'utf8');
console.log('HOST_SIZING_FIXED');
