const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

test('Chromium verifies weather visibility and no rail overlap at mobile and desktop widths', (t) => {
  const browser = [
    path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium',
  ].find((candidate) => fs.existsSync(candidate));
  if (!browser) return t.skip('No local Chromium available; real-device validation remains required');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hz-weather-layout-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const css = fs.readFileSync(path.join(__dirname, '../styles.css'), 'utf8');
  const scenarios = ['emerald', 'prism-blue-gold'].flatMap((theme) => [390, 768, 1280].map((width) => ({ theme, width })));
  const content = `<style>${css}</style><style>body{margin:0}.hz-workbench{padding:0}.hz-app{padding:0;gap:12px}.hz-shell{min-width:0}</style>
    <div class="hz-workbench THEME"><div class="hz-app"><aside class="hz-reserved-rail hz-weather-rail"><section class="hz-weather"><form class="hz-weather-search"><input placeholder="搜索城市"><button>搜索</button></form><article class="hz-weather-current"><h2>济南</h2><p class="hz-weather-temperature">29°C</p></article><details class="hz-weather-details"><summary>天气详情</summary><p>未来 12 小时与七天预报</p></details></section></aside><main class="hz-shell">工作台内容</main></div></div>`;
  const html = `<html><body><pre id="results"></pre><script>
    const results=[];
    for(const scenario of ${JSON.stringify(scenarios)}) {
      const frame=document.createElement('iframe');frame.style.width=scenario.width+'px';frame.style.height='900px';
      frame.onload=()=>{
        const d=frame.contentDocument,w=frame.contentWindow,rail=d.querySelector('.hz-weather-rail'),shell=d.querySelector('.hz-shell');
        const r=rail.getBoundingClientRect(),s=shell.getBoundingClientRect();
        results.push({...scenario,display:w.getComputedStyle(rail).display,visible:r.height>0,overlap:!(r.right<=s.left+1||r.bottom<=s.top+1),overflow:d.documentElement.scrollWidth>scenario.width+1,details:d.querySelector('details').open});
        document.querySelector('#results').textContent=JSON.stringify(results);
      };
      frame.srcdoc=${JSON.stringify(content)}.replace('THEME','hz-theme-'+scenario.theme);document.body.append(frame);
    }
  </script></body></html>`;
  const file = path.join(dir, 'layout.html');
  fs.writeFileSync(file, html);
  const result = spawnSync(browser, ['--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', `--user-data-dir=${path.join(dir, 'profile')}`, '--virtual-time-budget=1500', '--dump-dom', pathToFileURL(file).href], { encoding: 'utf8', timeout: 20000 });
  assert.equal(result.status, 0, String(result.stderr).slice(-500));
  const records = JSON.parse(result.stdout.match(/<pre id="results">([^<]*)<\/pre>/)?.[1] || '[]');
  assert.equal(records.length, scenarios.length);
  for (const record of records) {
    assert.notEqual(record.display, 'none', JSON.stringify(record));
    assert.equal(record.visible, true, JSON.stringify(record));
    assert.equal(record.overlap, false, JSON.stringify(record));
    assert.equal(record.overflow, false, JSON.stringify(record));
    assert.equal(record.details, false, JSON.stringify(record));
  }
});
