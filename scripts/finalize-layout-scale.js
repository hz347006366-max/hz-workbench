const fs = require('node:fs');
const path = require('node:path');

const target = path.resolve(__dirname, '../styles.css');
let css = fs.readFileSync(target, 'utf8');
const before = '.hz-app{width:122%;max-width:122%;min-height:122vh;zoom:.82;display:grid;';
const after = '.hz-app{width:100%;max-width:100%;min-height:122vh;zoom:.82;display:grid;';
if (!css.includes(before)) throw new Error('无法定位最终缩放规则');
css = css.replace(before, after);
fs.writeFileSync(target, css, 'utf8');
console.log('LAYOUT_SCALE_FINALIZED');
