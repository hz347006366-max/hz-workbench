const fs = require('fs');
const path = require('path');

const file = path.resolve(__dirname, '..', 'styles.css');
let css = fs.readFileSync(file, 'utf8');

const replacements = [
  [
    '.hz-brand{position:relative;width:48px;height:48px;margin:2px auto 27px;border-radius:15px;overflow:hidden;background:#fff;box-shadow:0 10px 28px rgba(0,0,0,.3),0 0 0 1px color-mix(in srgb,var(--accent) 22%,transparent)}',
    '.hz-brand{width:48px;height:48px;margin:2px auto 27px;display:grid;place-items:center;overflow:visible;background:transparent;box-shadow:none}'
  ],
  [
    '.hz-brand-logo{position:absolute;width:87.7px;height:67.7px;max-width:none;left:-17.2px;top:-4.6px;object-fit:fill}',
    '.hz-brand-logo{position:static;width:100%;height:100%;max-width:100%;object-fit:contain;object-position:center}'
  ],
  [
    '.hz-left{min-width:0;display:grid;grid-template-rows:minmax(400px,1fr) 184px;gap:14px}',
    '.hz-left{min-width:0;display:grid;grid-template-rows:minmax(330px,1fr) 230px;gap:14px}'
  ],
  ['.hz-jcard{position:absolute;top:20%;height:65%;width:29%;', '.hz-jcard{position:absolute;top:24%;height:54%;width:25%;'],
  ['.hz-slot-1{left:3%;', '.hz-slot-1{left:8%;'],
  ['.hz-slot-2{left:19%;', '.hz-slot-2{left:23%;'],
  ['.hz-slot-3{left:35.5%;', '.hz-slot-3{left:37.5%;'],
  ['.hz-slot-4{right:18%;', '.hz-slot-4{right:22%;'],
  ['.hz-slot-5{right:2%;', '.hz-slot-5{right:7%;'],
  ['min-height:106px;cursor:pointer}.hz-project.is-primary', 'min-height:148px;cursor:pointer}.hz-project.is-primary']
];

for (const [before, after] of replacements) {
  if (!css.includes(before)) throw new Error(`Expected CSS fragment not found: ${before}`);
  css = css.replace(before, after);
}

fs.writeFileSync(file, css);
