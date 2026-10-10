const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.resolve(__dirname, '../styles.css'), 'utf8');

test('monochrome is neutral dark and never filters user images', () => {
  assert.match(css, /\.hz-theme-monochrome\{--bg:#0d0d0d;/);
  assert.match(css, /--surface:#151515;/);
  assert.doesNotMatch(css, /grayscale\(/);
});

test('logo uses the transparent PNG without a white background or crop offset', () => {
  assert.match(css, /\.hz-brand\{[^}]*background:transparent/);
  assert.match(css, /\.hz-brand-logo\{position:static;width:100%;height:100%;[^}]*object-fit:contain/);
});

test('journal carousel cards use a smaller footprint', () => {
  assert.match(css, /\.hz-jcard\{position:absolute;top:24%;height:54%;width:25%/);
});

test('native journal card buttons reset browser chrome and expose a tokenized keyboard outline', () => {
  assert.match(
    css,
    /\.hz-jcard\{[^}]*appearance:none;[^}]*padding:0;[^}]*font:inherit;[^}]*color:inherit;[^}]*text-align:left;/,
  );
  assert.match(
    css,
    /\.hz-jcard:focus-visible\{outline:2px solid var\(--accent\);outline-offset:3px\}/,
  );
  assert.match(css, /\.hz-jcard\{position:absolute;top:24%;height:54%;width:25%/);
  assert.match(css, /\.hz-jcard\{[^}]*transition:[^;}]*transform \.35s[^;}]*left \.35s[^;}]*right \.35s[^;}]*opacity \.35s/);
});

test('journal carousel consumes drag variables only during active motion and keeps its static fallback accessible', () => {
  assert.match(css, /\.hz-jcard\{[^}]*cursor:grab;[^}]*touch-action:pan-y/);
  assert.match(css, /\.hz-carousel-stage\.is-dragging \.hz-jcard,\.hz-carousel-stage\.is-settling \.hz-jcard\{[^}]*cursor:grabbing;[^}]*will-change:transform,opacity;[^}]*transition:none/);
  assert.match(css, /\.hz-slot-3\{[^}]*--hz-slot-scale:1\.03;[^}]*--hz-slot-opacity:1/);
  assert.match(css, /\.hz-carousel-stage\.is-dragging \.hz-jcard,\.hz-carousel-stage\.is-settling \.hz-jcard\{[^}]*transform:translate3d\(var\(--hz-carousel-drag-x,0px\),0,0\) perspective\(var\(--hz-carousel-perspective\)\) rotateY\(var\(--hz-slot-turn\)\) scale\(var\(--hz-slot-scale\)\);[^}]*opacity:calc\(var\(--hz-slot-opacity\) \* var\(--hz-carousel-drag-opacity,1\)\)/);
  assert.match(css, /\.hz-reduced-motion \.hz-carousel-stage \.hz-jcard\{[^}]*transform:perspective\(var\(--hz-carousel-perspective\)\) rotateY\(var\(--hz-slot-turn\)\) scale\(var\(--hz-slot-scale\)\)!important;[^}]*opacity:var\(--hz-slot-opacity\)!important/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)\{[^}]*\.hz-carousel-stage \.hz-jcard\{[^}]*transform:perspective\(var\(--hz-carousel-perspective\)\) rotateY\(var\(--hz-slot-turn\)\) scale\(var\(--hz-slot-scale\)\)!important/);
  assert.match(css, /\.hz-jcard:focus-visible\{outline:2px solid var\(--accent\);outline-offset:3px\}/);
  const restingCard = css.match(/^\.hz-jcard\{([^}]*)\}/m)?.[1] || '';
  assert.doesNotMatch(restingCard, /will-change:/);
});

test('journal filters expose interactive year and month selects', () => {
  assert.match(css, /\.hz-journal-select\{[^}]*height:30px/);
  assert.match(css, /\.hz-filter\{[^}]*border-radius:10px;[^}]*color:var\(--muted\);background:var\(--surface-2\)/);
  assert.match(css, /\.hz-carousel-stage\{position:absolute;inset:0/);
  assert.match(css, /\.hz-filters\{[^}]*pointer-events:auto/);
});

test('journal filter controls anchor right without covering the section title', () => {
  assert.match(
    css,
    /\.hz-carousel-controls\{left:auto;right:21px;z-index:11;width:max-content;max-width:calc\(100% - 42px\);pointer-events:auto\}/,
  );
  const mobile = css.slice(css.lastIndexOf('@media(max-width:700px)'));
  assert.match(mobile, /\.hz-carousel-controls\{right:12px;max-width:calc\(100% - 24px\)\}/);
  assert.match(css, /\.hz-filters\{[^}]*gap:7px;[^}]*pointer-events:auto/);
});

test('carousel defines five visible and two non-interactive off-canvas slots', () => {
  for (let slot = 0; slot <= 6; slot += 1) {
    assert.match(css, new RegExp(`\\.hz-slot-${slot}\\{`));
  }
  assert.match(css, /\.hz-slot-0\{[^}]*left:-[^;}]+;[^}]*opacity:0;[^}]*pointer-events:none/);
  assert.match(css, /\.hz-slot-6\{[^}]*right:-[^;}]+;[^}]*opacity:0;[^}]*pointer-events:none/);
});

test('carousel slot movement and cover loading use scoped 350ms transitions', () => {
  assert.match(css, /\.hz-jcard\{[^}]*transition:[^;}]*transform \.35s[^;}]*left \.35s[^;}]*right \.35s[^;}]*opacity \.35s/);
  assert.match(css, /\.hz-jcard-cover\{[^}]*opacity:0;[^}]*transition:opacity \.35s/);
  assert.match(css, /\.hz-jcard-cover\.is-loaded\{opacity:1/);
});

test('acrylic journal depth keeps photos and text clear while only the rim breathes', () => {
  assert.match(css, /\.hz-jcard-cover\{[^}]*background-size:cover;[^}]*background-position:center/);
  assert.doesNotMatch(css, /\.hz-jcard-cover\{[^}]*(?:filter|grayscale|saturate)/);
  assert.match(css, /\.hz-card-copy\{[^}]*z-index:3/);
  assert.match(css, /\.hz-card-copy h3\{[^}]*white-space:nowrap;[^}]*text-overflow:ellipsis/);
  assert.match(css, /@keyframes hz-journal-rim-breathe/);
  assert.match(css, /\.hz-slot-3:after\{[^}]*animation:hz-journal-rim-breathe/);
  assert.match(css, /\.hz-reduced-motion \.hz-slot-3:after\{animation:none!important/);
  const keyframes = css.match(/@keyframes hz-journal-rim-breathe\{([\s\S]*?)\}\n/)?.[1] || '';
  assert.doesNotMatch(keyframes, /transform:|filter:/);
});

test('short months center one to four cards and reduced motion removes their fades', () => {
  for (let count = 1; count <= 4; count += 1) {
    assert.match(css, new RegExp(`\\.hz-count-${count} `));
  }
  assert.match(css, /\.hz-reduced-motion \.hz-jcard,.hz-reduced-motion \.hz-jcard-cover\{transition:none!important/);
});

test('mobile keeps the active card visible while hiding both off-canvas slots', () => {
  const mobile = css.slice(css.lastIndexOf('@media(max-width:700px)'));
  assert.match(mobile, /\.hz-app \.hz-slot-0,\.hz-app \.hz-slot-1,\.hz-app \.hz-slot-2,\.hz-app \.hz-slot-4,\.hz-app \.hz-slot-5,\.hz-app \.hz-slot-6\{display:none\}/);
  assert.match(mobile, /\.hz-app \.hz-slot-3\{opacity:1\}/);
  assert.doesNotMatch(mobile, /\.hz-app \.hz-slot-3(?:,[^{]+)?\{[^}]*display:none/);
  assert.doesNotMatch(mobile, /(?:^|})\.hz-slot-0/);
  assert.match(css, /\.hz-slot-0\{[^}]*pointer-events:none/);
  assert.match(css, /\.hz-slot-6\{[^}]*pointer-events:none/);
});

test('project card region is taller than the previous 184px layout', () => {
  assert.match(css, /\.hz-left\{[^}]*height:624px;max-height:624px;[^}]*grid-template-rows:330px 280px/);
  assert.match(css, /\.hz-journal\{[^}]*height:330px;min-height:0;max-height:330px/);
  assert.match(css, /\.hz-projects\{height:280px;min-height:280px/);
  assert.match(css, /\.hz-project\{[^}]*min-height:148px/);
});

test('desktop workbench exposes a scrollable 1640 logical canvas and absolute module shells', () => {
  const legacyMinimum = css.indexOf('min-width:980px');
  const desktopReset = css.indexOf('.hz-workbench:has(> .hz-layout-viewport){height:100%;min-width:0;min-height:0;overflow:hidden}');
  assert.ok(legacyMinimum >= 0, 'legacy and mobile flow retains its 980px base minimum');
  assert.ok(desktopReset > legacyMinimum, 'desktop contextual reset follows and overrides the legacy minimum');
  assert.match(css, /\.hz-layout-viewport\{position:relative;width:100%;max-width:100%;min-width:0;height:100%;min-height:0;max-height:100%;overflow:auto/);
  assert.match(css, /\.hz-layout-stage\{position:relative;min-width:0;min-height:0;margin-inline:auto/);
  assert.match(css, /\.hz-layout-canvas\{position:relative;width:1640px;transform-origin:top left/);
  assert.match(css, /\.hz-layout-module\{position:absolute;display:block;min-width:0;min-height:0/);
  assert.match(css, /\.hz-layout-content\{position:absolute;left:0;top:0;transform-origin:top left/);
  assert.doesNotMatch(css, /\.hz-layout-module\{[^}]*display:grid/);
});

test('desktop module content keeps fixed base geometry inside transform-only shells', () => {
  assert.match(css, /\.hz-layout-content>\.hz-sidebar\{width:112px;height:112px;min-height:112px;position:relative;top:0/);
  assert.match(css, /\.hz-layout-content>\.hz-agent-panel\{width:306px;height:760px/);
  assert.match(css, /\.hz-layout-content>\.hz-header\{width:1280px;height:72px/);
  assert.match(css, /\.hz-layout-content>\.hz-stat\{width:306px;height:118px/);
  assert.match(css, /\.hz-layout-content>\.hz-journal\{width:930px;height:330px/);
  assert.match(css, /\.hz-layout-content>\.hz-projects\{width:930px;height:280px/);
  assert.match(css, /\.hz-layout-content>\.hz-must,\.hz-layout-content>\.hz-tasks\{width:318px;height:302px/);
});

test('Copilot entry uses a centered flexible layout with accessible action states', () => {
  assert.match(css, /\.hz-workbench\{[^}]*--accent-text:var\(--bg\)/);
  assert.match(css, /\.hz-agent-panel\{[^}]*display:flex;[^}]*flex-direction:column/);
  assert.match(css, /\.hz-agent-entry\{[^}]*display:flex;[^}]*flex-direction:column;[^}]*flex:1/);
  assert.match(css, /\.hz-agent-facts\{[^}]*display:grid;[^}]*grid-template-columns:auto minmax\(0,1fr\)/);
  assert.match(css, /\.hz-agent-open\{[^}]*min-height:44px;[^}]*background:var\(--accent\);color:var\(--accent-text\)/);
  assert.match(css, /\.hz-agent-open:focus-visible\{outline:2px solid var\(--accent\);outline-offset:3px\}/);
  assert.match(css, /\.hz-agent-open:disabled\{[^}]*cursor:not-allowed/);
  assert.doesNotMatch(css, /\.hz-agent-(?:empty|compose|send)(?:[\s:{.,>]|$)/);
  assert.match(css, /\.hz-layout-content>\.hz-agent-panel\{width:306px;height:760px/);
  const responsive = css.slice(css.indexOf('@media(max-width:980px)'));
  assert.match(responsive, /\.hz-app \.hz-agent-panel\{[^}]*height:340px/);
  assert.match(css, /\.hz-focus-checkbox\{[^}]*width:16px;[^}]*height:16px;[^}]*accent-color:var\(--accent\)/);
  assert.match(css, /\.hz-focus-checkbox:focus-visible\{outline:2px solid var\(--accent\)/);
  assert.doesNotMatch(css, /\.hz-focus-toggle\{/);
});

test('responsive Copilot entry compacts its internals without changing panel or action height', () => {
  const responsive = css.slice(css.indexOf('@media(max-width:980px)'));
  assert.match(responsive, /\.hz-app \.hz-agent-panel\{[^}]*height:340px/);
  assert.match(responsive, /\.hz-app \.hz-agent-entry\{gap:8px;padding:12px\}/);
  assert.match(responsive, /\.hz-app \.hz-agent-entry-icon\{width:40px;height:40px\}/);
  assert.match(responsive, /\.hz-app \.hz-agent-entry-icon svg\{width:22px;height:22px\}/);
  assert.match(responsive, /\.hz-app \.hz-agent-facts\{gap:4px 8px;padding:8px\}/);
  assert.match(responsive, /\.hz-app \.hz-agent-help\{line-height:1\.4\}/);
  assert.match(css, /\.hz-agent-open\{[^}]*min-height:44px/);
});

test('editing mode dims content without mutating theme variables and preserves chrome hit testing', () => {
  assert.match(css, /\.hz-layout-canvas\.is-layout-editing \.hz-layout-content\{[^}]*pointer-events:none;[^}]*filter:brightness\(\.78\)/);
  assert.match(css, /\.hz-layout-canvas\.is-layout-editing \.hz-layout-module\{[^}]*border:1px solid var\(--accent\)/);
  assert.match(css, /\.hz-layout-canvas\.is-layout-editing \.hz-layout-module\.is-layout-selected\{[^}]*border-width:2px;[^}]*z-index:100/);
  assert.match(css, /\.hz-layout-canvas\.is-layout-editing \.hz-layout-module\.is-layout-selected,\.hz-layout-canvas\.is-layout-editing \.hz-layout-module\.is-layout-selected>\.hz-resize-handle\{pointer-events:auto/);
  assert.doesNotMatch(css, /\.hz-layout-canvas\.is-layout-editing\{[^}]*(?:--accent|--danger):/);
});

test('editing chrome includes labels, a 32px resize target, guides, conflict stripes, and overlay toolbar', () => {
  for (const selector of [
    'hz-layout-label', 'hz-resize-handle', 'hz-snap-guide',
    'is-conflicting', 'hz-conflict-stripes', 'hz-layout-toolbar',
    'hz-layout-toolbar-hint', 'hz-layout-lock',
  ]) assert.match(css, new RegExp(`\\.${selector}\\{`));
  assert.match(css, /\.hz-layout-label\{position:absolute;left:6px;top:6px/);
  assert.match(css, /\.hz-resize-handle\{position:absolute;width:32px;height:32px;right:-16px;bottom:-16px/);
  assert.match(css, /\.hz-resize-handle:before\{[^}]*width:16px;height:16px/);
  assert.match(css, /\.hz-resize-handle\{[^}]*transform:scale\(var\(--hz-layout-inverse-scale,1\)\);transform-origin:center/);
  assert.match(css, /\.hz-snap-guide\{[^}]*border-color:color-mix\(in srgb,var\(--accent\) 52%,transparent\);border-style:dashed/);
  assert.match(css, /\.hz-conflict-stripes\{[^}]*repeating-linear-gradient\(135deg/);
  assert.match(css, /\.hz-layout-toolbar\{position:sticky;top:12px;left:50%;[^}]*z-index:1000;[^}]*margin-bottom:-48px;[^}]*pointer-events:auto/);
  assert.match(css, /\.hz-layout-toolbar button\{height:32px;min-width:32px/);
  assert.match(css, /\.hz-head-actions\{[^}]*padding-right:48px/);
  assert.match(css, /\.hz-layout-lock\{position:sticky;top:14px;[^}]*margin-left:auto;margin-right:14px;[^}]*z-index:1100;[^}]*width:34px;height:34px/);
  assert.match(css, /\.hz-layout-lock\[data-layout-state="unlocked"\]\{[^}]*color:var\(--accent\);border-color:var\(--line-strong\)/);
  assert.doesNotMatch(css, /hz-long-press-progress|hz-layout-arm/);
});

test('reduced motion removes editing transitions and glow while retaining semantic feedback', () => {
  assert.match(css, /\.hz-reduced-motion \.hz-layout-module\{transition:none!important/);
  assert.match(css, /\.hz-reduced-motion \.hz-layout-content,\.hz-reduced-motion \.hz-layout-label,\.hz-reduced-motion \.hz-snap-guide\{transition:none!important/);
  assert.match(css, /\.hz-reduced-motion \.hz-layout-module\.is-layout-selected\{box-shadow:none!important/);
  assert.match(css, /\.hz-layout-module\.is-conflicting\{[^}]*border-color:var\(--danger\)!important/);
  assert.match(css, /\.hz-conflict-stripes\{/);
  assert.match(css, /\.hz-layout-label\{/);
});

test('responsive workbench stays in flow and hides every editing affordance', () => {
  const responsive = css.slice(css.indexOf('@media(max-width:980px)'));
  assert.match(responsive, /\.hz-app \.hz-layout-label,\.hz-app \.hz-resize-handle,\.hz-app \.hz-snap-guide,\.hz-app \.hz-layout-toolbar,\.hz-app \.hz-conflict-stripes\{display:none!important\}/);
  assert.match(responsive, /\.hz-app\{grid-template-columns:1fr;padding:10px\}/);
  assert.match(responsive, /\.hz-app \.hz-sidebar\{[^}]*position:static/);
  assert.doesNotMatch(responsive, /(?:^|})\.hz-sidebar\{/);
});

test('monthly review panels are scoped, tokenized, keyboard accessible, and vertically scroll on desktop', () => {
  const start = css.indexOf('.hz-month-block{');
  assert.ok(start >= 0, 'monthly review CSS must exist');
  const monthly = css.slice(start, css.indexOf('\n.markdown-source-view', start));
  assert.match(monthly, /\.hz-month-block\{[^}]*background:var\(--background-secondary\)[^}]*color:var\(--text-normal\)/);
  assert.match(monthly, /\.hz-month-task-list,\.hz-month-finance-list\{[^}]*max-height:[^;}]+;[^}]*overflow-y:auto/);
  assert.match(monthly, /\.hz-month-finance-source,\.hz-month-editor-placeholder\{[^}]*appearance:none;[^}]*font:inherit/);
  assert.match(monthly, /\.hz-month-finance-source:focus-visible,\.hz-month-editor-placeholder:focus-visible\{outline:2px solid var\(--interactive-accent\);outline-offset:2px/);
  const usedVariables = [...monthly.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]);
  const allowedVariables = new Set([
    '--background-secondary', '--background-modifier-border', '--text-normal', '--text-muted',
    '--interactive-accent', '--radius-s', '--font-ui-smaller', '--font-ui-small', '--text-on-accent',
  ]);
  assert.deepEqual([...new Set(usedVariables)].filter((name) => !allowedVariables.has(name)), []);
  assert.doesNotMatch(monthly, /(?:^|})\s*(?:button|section|div)\s*\{/m);
  assert.doesNotMatch(monthly, /overflow-x:(?:auto|scroll)/);
  assert.doesNotMatch(css, /filter:\s*grayscale/);
});

test('monthly review rows collapse without horizontal scrolling below 700px', () => {
  const mobile = css.slice(css.lastIndexOf('@media(max-width:700px)'));
  assert.match(mobile, /\.hz-month-task-row,\.hz-month-finance-row\{grid-template-columns:1fr\}/);
  assert.match(mobile, /\.hz-month-task-details,\.hz-month-finance-details\{grid-template-columns:1fr\}/);
  assert.match(mobile, /\.hz-month-summary-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
});

test('monthly mobile grid overrides occur after their equal-specificity base declarations', () => {
  const baseRows = css.indexOf('.hz-month-task-row,.hz-month-finance-row{display:grid;');
  const baseSummary = css.indexOf('.hz-month-summary-grid{display:grid;');
  const mobileRows = css.indexOf('.hz-month-task-row,.hz-month-finance-row{grid-template-columns:1fr}');
  const mobileSummary = css.indexOf('.hz-month-summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}');

  assert.ok(baseRows >= 0 && baseRows < mobileRows, 'mobile row columns must follow the base row columns');
  assert.ok(baseSummary >= 0 && baseSummary < mobileSummary, 'mobile summary columns must follow the base summary columns');
});
