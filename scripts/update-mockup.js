const fs = require('node:fs');
const path = require('node:path');

const target = path.resolve(__dirname, '../../设计输出/index.html');
let html = fs.readFileSync(target, 'utf8');

function replaceRequired(before, after, label) {
  if (!html.includes(before)) throw new Error(`无法定位：${label}`);
  html = html.replace(before, after);
}

replaceRequired(
  '.brand{width:48px;height:48px;margin:2px auto 27px;border-radius:16px;display:grid;place-items:center;background:linear-gradient(145deg,#b7ffcc,#4ae384 48%,#1b9b50);box-shadow:0 0 30px rgba(70,241,132,.18);color:#07110b;font-weight:900;font-size:19px}',
  '.brand{position:relative;width:48px;height:48px;margin:2px auto 27px;border-radius:16px;overflow:hidden;background:#fff;box-shadow:0 0 30px rgba(70,241,132,.18)}.brand-logo{position:absolute;width:87.7px;height:67.7px;max-width:none;left:-17.2px;top:-4.6px}',
  '旧 Logo 样式',
);

replaceRequired(
  '.stat-foot{margin-top:8px;color:#6d8176;font-size:9px}',
  '.stat-foot{margin-top:8px;color:#6d8176;font-size:9px}.heat-summary{display:flex;justify-content:space-between;align-items:baseline;margin-top:7px}.heat-summary b{font-size:15px}.heat-summary span{color:#81958a;font-size:8px}.journal-heatmap{position:relative;z-index:2;display:grid;grid-template-columns:repeat(13,1fr);grid-template-rows:repeat(7,5px);grid-auto-flow:column;gap:2px;margin-top:7px}.heat-cell{height:5px;border-radius:2px;background:#1e2b23}.heat-level-1{background:#244b31}.heat-level-2{background:#2c7545}.heat-level-3{background:#43ac66}.heat-level-4{background:#76ee9f}',
  '统计卡样式',
);

replaceRequired(
  '.jcard:before{content:"";position:absolute;inset:0;background:linear-gradient(to top,rgba(3,9,5,.91) 3%,rgba(3,8,5,.47) 35%,transparent 65%)}',
  '.jcard-cover{position:absolute;z-index:1;inset:0;background-size:cover;background-position:center;background-repeat:no-repeat}.jcard:before{content:"";position:absolute;z-index:2;inset:0;background:linear-gradient(to top,rgba(3,9,5,.91) 3%,rgba(3,8,5,.47) 35%,transparent 65%)}',
  '轮播遮罩样式',
);

replaceRequired(
  '.jcard:after{content:"";position:absolute;inset:0;background:linear-gradient(115deg,rgba(255,255,255,.16),transparent 22%,transparent 70%,rgba(255,255,255,.06))}',
  '.jcard:after{content:"";position:absolute;z-index:2;inset:0;background:linear-gradient(115deg,rgba(255,255,255,.16),transparent 22%,transparent 70%,rgba(255,255,255,.06))}',
  '轮播高光样式',
);

replaceRequired(
  '<div class="brand">H</div>',
  '<div class="brand"><img class="brand-logo" src="assets/workbench-logo.png" alt="个人工作台 Logo"></div>',
  '旧 Logo 结构',
);

const cells = Array.from({ length: 91 }, (_, index) => {
  const level = ((index * 7 + index % 5) % 11 < 4) ? 0 : ((index * 3) % 5);
  return `<i class="heat-cell heat-level-${level}"></i>`;
}).join('');

const fourthCard = /<article class="stat"><div class="stat-top"><span>连续日记<\/span>[\s\S]*?<\/article>/;
if (!fourthCard.test(html)) throw new Error('无法定位：连续日记统计卡');
html = html.replace(fourthCard, `<article class="stat"><div class="stat-top"><span>连续日记</span><span class="trend">16 天</span></div><div class="heat-summary"><b>连续 16 天</b><span>今年已记录 69 篇</span></div><div class="journal-heatmap">${cells}</div></article>`);

replaceRequired(
  '<article class="jcard jc1"></article><article class="jcard jc2"></article>',
  '<article class="jcard jc1"><div class="jcard-cover" style="background-image:url(\'../参考素材/微信图片_20260806183946_394_2.jpg\')"></div></article><article class="jcard jc2"><div class="jcard-cover" style="background-image:url(\'../参考素材/微信图片_20260808142541_399_2.jpg\')"></div></article>',
  '左侧轮播卡片',
);

const centerCard = /<article class="jcard jc3">[\s\S]*?<\/article>/;
if (!centerCard.test(html)) throw new Error('无法定位：中心轮播卡片');
html = html.replace(centerCard, '<article class="jcard jc3"><div class="jcard-cover" style="background-image:url(\'../参考素材/微信图片_20260808142541_400_2.jpg\')"></div><div class="card-copy"><small>2026.07.30 · 晴 · 平静</small><h3>忙碌，但方向变清楚了</h3><p>整理了项目节点，也重新思考个人工作台如何连接日常工作与生活记录……</p></div></article>');

replaceRequired(
  '<article class="jcard jc4"></article><article class="jcard jc5"></article>',
  '<article class="jcard jc4"><div class="jcard-cover" style="background-image:url(\'../参考素材/微信图片_20260808142541_401_2.jpg\')"></div></article><article class="jcard jc5"><div class="jcard-cover" style="background-image:url(\'../参考素材/微信图片_20260806183946_391_2.jpg\')"></div></article>',
  '右侧轮播卡片',
);

fs.writeFileSync(target, html, 'utf8');
console.log('MOCKUP_UPDATED');
