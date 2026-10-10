const fs = require('node:fs');
const path = require('node:path');

const target = path.resolve(__dirname, '../styles.css');
let css = fs.readFileSync(target, 'utf8');

function replaceRequired(before, after) {
  if (!css.includes(before)) throw new Error(`无法定位 CSS：${before.slice(0, 60)}`);
  css = css.replace(before, after);
}

replaceRequired(
  '.hz-workbench-host .view-content{padding:0;overflow:auto;background:#030604}.hz-workbench{',
  '.hz-workbench-host .view-content{padding:0;overflow:hidden;background:#030604}.hz-workbench{width:100%;max-width:100%;overflow:auto;',
);
replaceRequired(
  '.hz-app{min-height:100vh;display:grid;',
  '.hz-app{width:100%;max-width:100%;min-height:100vh;display:grid;',
);
replaceRequired(
  '.hz-shell{min-width:0;display:grid;grid-template-columns:minmax(0,1fr) 338px;',
  '.hz-shell{width:100%;max-width:100%;min-width:0;overflow:hidden;display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,318px);',
);

fs.writeFileSync(target, css, 'utf8');
console.log('LAYOUT_TIGHTENED');
