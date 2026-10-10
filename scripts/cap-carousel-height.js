const fs = require('fs');
const path = require('path');

const file = path.resolve(__dirname, '..', 'styles.css');
let css = fs.readFileSync(file, 'utf8');
const before = '.hz-left{min-width:0;display:grid;grid-template-rows:minmax(330px,1fr) 230px;gap:14px}';
const after = '.hz-left{min-width:0;align-self:start;display:grid;grid-template-rows:clamp(330px,42vh,460px) 250px;gap:14px}';
if (!css.includes(before)) throw new Error('Expected flexible carousel layout was not found');
css = css.replace(before, after);
fs.writeFileSync(file, css);
