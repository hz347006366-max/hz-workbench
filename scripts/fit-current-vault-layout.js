const fs = require('node:fs');
const path = require('node:path');

const target = path.resolve(__dirname, '../styles.css');
let css = fs.readFileSync(target, 'utf8');
const before = '.hz-workbench{position:absolute;inset:0;width:auto;max-width:none;overflow:auto;';
const after = '.hz-workbench{position:absolute;left:0;top:0;bottom:0;right:auto;width:calc(100vw - 352px);max-width:calc(100vw - 352px);overflow:auto;';
if (!css.includes(before)) throw new Error('无法定位工作台根尺寸规则');
css = css.replace(before, after);
fs.writeFileSync(target, css, 'utf8');
console.log('CURRENT_VAULT_LAYOUT_FITTED');
