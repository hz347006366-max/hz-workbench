const fs = require('node:fs');
const path = require('node:path');

const target = path.resolve(__dirname, '../styles.css');
let css = fs.readFileSync(target, 'utf8');
const before = '.hz-workbench-host{position:relative;overflow:hidden}.hz-workbench-host .view-content{position:absolute!important;inset:0!important;width:auto!important;height:auto!important;padding:0;overflow:hidden;background:#030604}.hz-workbench{position:absolute;left:0;top:0;bottom:0;right:auto;width:calc(100vw - 352px);max-width:calc(100vw - 352px);overflow:auto;';
const after = '.hz-workbench-host .view-content{padding:0;overflow:auto;background:#030604}.hz-workbench{width:100%;max-width:100%;overflow:auto;';
if (!css.includes(before)) throw new Error('无法定位需要回退的宿主尺寸规则');
css = css.replace(before, after);
fs.writeFileSync(target, css, 'utf8');
console.log('HOST_SIZING_ROLLED_BACK');
