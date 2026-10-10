const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../src/main.js'), 'utf8');
const css = fs.readFileSync(path.resolve(__dirname, '../styles.css'), 'utf8');

function loadPlugin() {
  const module = { exports: {} };
  const obsidian = {
    Plugin: class {}, ItemView: class {}, PluginSettingTab: class {}, Setting: class {}, Notice: class {},
    TFile: class {}, TFolder: class {}, Platform: { isDesktopApp: true }, normalizePath: (value) => value, setIcon: () => {},
  };
  const localRequire = (request) => request === 'obsidian'
    ? obsidian
    : require(path.resolve(__dirname, '../src', request));
  vm.runInNewContext(source, { module, exports: module.exports, require: localRequire, window: {}, console });
  return module.exports;
}

function chromiumExecutable() {
  const candidates = process.platform === 'win32'
    ? [
      path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
    ]
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
      : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

function sourceModeMarkerDisplay(pluginCss) {
  const browser = chromiumExecutable();
  if (!browser) return { available: false, diagnostic: 'No local Chromium browser' };
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hz-guidance-cascade-'));
  const fixturePath = path.join(tempDir, 'source-mode.html');
  const fixture = `<!doctype html>
    <style>${pluginCss}</style>
    <style>.markdown-source-view.mod-cm6 .cm-content > * { display: block; }</style>
    <div class="markdown-source-view mod-cm6">
      <div class="cm-editor">
        <div class="cm-scroller">
          <div class="cm-content">
            <div class="cm-line cm-hz-technical-marker-line">&lt;!-- hz:daily-photo:start --&gt;</div>
          </div>
        </div>
      </div>
    </div>
    <script>
      const markerLine = document.querySelector('.cm-hz-technical-marker-line');
      document.documentElement.dataset.markerPresent = String(Boolean(markerLine));
      document.documentElement.dataset.markerClasses = String(
        markerLine?.classList.contains('cm-line') && markerLine?.classList.contains('cm-hz-technical-marker-line')
      );
      document.documentElement.dataset.markerDisplay = markerLine ? getComputedStyle(markerLine).display : 'missing';
    </script>`;

  try {
    fs.writeFileSync(fixturePath, fixture, 'utf8');
    const result = spawnSync(browser, [
      '--headless=new',
      '--disable-gpu',
      '--disable-extensions',
      '--no-first-run',
      `--user-data-dir=${path.join(tempDir, 'profile')}`,
      '--dump-dom',
      pathToFileURL(fixturePath).href,
    ], { encoding: 'utf8', timeout: 15_000 });
    return {
      available: result.status === 0,
      output: result.stdout,
      diagnostic: String(result.stderr || `Chromium exited ${result.status}`).slice(0, 500),
    };
  } finally {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
}

test('production registers one daily guidance editor extension with safe defaults', () => {
  assert.match(source, /showDailyGuidance:\s*true/);
  assert.match(source, /showDailyTechnicalMarkers:\s*false/);
  assert.equal((source.match(/registerEditorExtension\(/g) || []).length, 1);
  assert.match(source, /createDailyEditorGuidanceExtension/);
  assert.match(source, /resolveJournalCaptureTarget/);
  assert.match(source, /action === 'record-today' \? 'manual-time' : action/);
  assert.match(source, /openDailyCapture\(captureAction, target\)/);
  assert.match(source, /refreshEditorGuidance\(\)/);
  assert.match(source, /workspace\.updateOptions\(\)/);
});

test('settings expose two independent persisted toggles and refresh open editors', () => {
  assert.match(source, /显示日记填写提示/);
  assert.match(source, /显示日记技术标记/);
  assert.match(source, /this\.plugin\.settings\.showDailyGuidance\s*=\s*value/);
  assert.match(source, /this\.plugin\.settings\.showDailyTechnicalMarkers\s*=\s*value/);
  assert.ok((source.match(/refreshEditorGuidance\(\)/g) || []).length >= 4);
});

test('editor guidance CSS is theme-variable based and accessible', () => {
  assert.match(css, /\.cm-line\.cm-hz-technical-marker-line\s*\{[^}]*display:\s*none/s);
  assert.match(css, /\.hz-daily-editor-placeholder\s*\{[^}]*var\(--text-muted\)/s);
  assert.match(css, /\.hz-daily-editor-placeholder:hover/);
  assert.match(css, /\.hz-daily-editor-placeholder:focus-visible/);
  assert.doesNotMatch(css, /\.hz-daily-editor-placeholder[^}]*#[0-9a-f]{3,8}/i);
});

test('technical marker selector outranks the host source-mode rule', () => {
  const pluginSelector = '.markdown-source-view.mod-cm6 .cm-line.cm-hz-technical-marker-line';
  const hostSelector = '.markdown-source-view.mod-cm6 .cm-content > *';
  const specificity = (selector) => (selector.match(/\.[\w-]+/g) || []).length;
  assert.ok(specificity(pluginSelector) > specificity(hostSelector));
  assert.match(css, new RegExp(`${pluginSelector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{[^}]*display:\\s*none`, 's'));
});

test('Source-mode host cascade keeps decorated technical marker lines hidden when Chromium is usable', (t) => {
  const rendered = sourceModeMarkerDisplay(css);
  if (!rendered.available) {
    t.diagnostic(rendered.diagnostic);
    return;
  }
  assert.match(rendered.output, /data-marker-present="true"/);
  assert.match(rendered.output, /data-marker-classes="true"/);
  assert.match(rendered.output, /data-marker-display="none"/);
});

test('guidance integration adds no Vault task or TickTick write path', () => {
  const extension = fs.readFileSync(path.resolve(__dirname, '../src/daily-editor-guidance-extension.js'), 'utf8');
  assert.doesNotMatch(extension, /vault\.(?:create|modify|delete|process)|taskRepository|TickTick|setInterval/);
});

test('editor guidance keeps historical capture actions locked to the active source journal', () => {
  const HZWorkbenchPlugin = loadPlugin();
  const file = { path: '01 日记/2026年/8月/2026年-08-17-星期一.md', basename: '2026年-08-17-星期一' };
  const plugin = new HZWorkbenchPlugin();
  const calls = [];
  plugin.app = {
    workspace: { getActiveFile: () => file },
    metadataCache: { getFileCache: () => ({ frontmatter: { type: '日记', date: '2026-08-17' } }) },
  };
  plugin.settings = { dailyFolder: '01 日记' };
  plugin.openDailyCapture = (action, target) => calls.push({ action, target });

  plugin.handleDailyEditorGuidanceAction('finance');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, 'finance');
  assert.deepEqual(calls[0].target, { path: file.path, date: '2026-08-17' });
  assert.equal(Object.isFrozen(calls[0].target), true);
});
