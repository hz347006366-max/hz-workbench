const fs = require('fs');
const path = require('path');

const file = path.resolve(__dirname, '..', 'styles.css');
let css = fs.readFileSync(file, 'utf8');
const replacements = [
  [
    '.hz-left{min-width:0;align-self:start;display:grid;grid-template-rows:330px 280px;gap:14px}',
    '.hz-left{min-width:0;align-self:start;height:624px;max-height:624px;display:grid;grid-template-rows:330px 280px;gap:14px}'
  ],
  [
    '.hz-journal{position:relative;overflow:hidden;',
    '.hz-journal{position:relative;height:330px;min-height:0;max-height:330px;overflow:hidden;'
  ],
  [
    '.hz-projects,.hz-must,.hz-tasks{',
    '.hz-projects{height:280px;min-height:280px}.hz-projects,.hz-must,.hz-tasks{'
  ]
];
for (const [before, after] of replacements) {
  if (!css.includes(before)) throw new Error(`Expected CSS fragment not found: ${before}`);
  css = css.replace(before, after);
}
fs.writeFileSync(file, css);
