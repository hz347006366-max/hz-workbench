# Mobile Daily Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the callout-based daily template with a mobile-friendly heading structure and add a safe HZ capture engine for iPhone photos, time tracking, quick notes, and finances.

**Architecture:** Keep Markdown transformation and calculation in a pure CommonJS model, isolate Obsidian Vault effects in an injected service, and keep protocol/modal wiring in focused UI/integration files. iOS Shortcuts only invokes the registered Obsidian protocol; every vault write happens through Obsidian so Remotely Save remains the sole sync layer.

**Tech Stack:** Obsidian Plugin API, CommonJS JavaScript, Node `node:test`, JSDOM, Templater, iOS Shortcuts URI actions, esbuild.

## Global Constraints

- Version is `0.3.0`; plugin id remains `hz-workbench`; `minAppVersion` remains `1.5.0`.
- Do not install QuickAdd, Advanced URI, or any new runtime dependency.
- Do not modify historical journals, TickTickSync, task data, layout data, or prior workbench UI requests.
- New journals use the exact section order and marker names from the design specification.
- TickTick task blocks remain read-only.
- Existing handwritten text outside a managed marker pair must be byte-preserved.
- Missing/duplicate/misordered markers are errors; never guess a write position.
- Live template and plugin are backed up and byte-verified before modification.
- Only source, tests, version metadata, built artifacts, template, styles, and shortcut documentation required by this feature may change.

---

### Task 1: Pure daily capture model

**Files:**
- Create: `development/obsidian-hz-workbench/src/daily-capture-model.js`
- Create: `development/obsidian-hz-workbench/tests/daily-capture-model.test.js`

**Interfaces:**
- Produces `MARKERS`, `replaceManagedBlock`, `appendManagedLine`, `photoVaultPath`, `formatQuickNote`, `formatTimeEntry`, `parseTimeEntries`, `summarizeTimeEntries`, `splitIntervalByLocalDate`, `formatFinanceEntry`, `parseFinanceEntries`, `summarizeFinanceEntries`, and validation helpers.
- Dates crossing module boundaries are local `Date` objects; persisted record dates are `YYYY-MM-DD`; money is integer cents.

- [ ] **Step 1: Write marker and preservation RED tests**

```js
test('replaceManagedBlock changes only the exact marker interior', () => {
  const source = 'before\n<!-- hz:quick-notes:start -->\nold\n<!-- hz:quick-notes:end -->\nafter\n';
  assert.equal(replaceManagedBlock(source, 'quickNotes', ['- 09:00 新内容']),
    'before\n<!-- hz:quick-notes:start -->\n- 09:00 新内容\n<!-- hz:quick-notes:end -->\nafter\n');
});
test('missing duplicate and reversed markers are rejected', () => {
  assert.throws(() => replaceManagedBlock('plain', 'quickNotes', []), /模板结构不完整/);
});
```

- [ ] **Step 2: Run model tests and confirm RED**

Run: `node --test tests/daily-capture-model.test.js`

Expected: fail because `../src/daily-capture-model` does not exist.

- [ ] **Step 3: Implement exact newline-preserving managed blocks**

```js
const MARKERS = Object.freeze({
  photo: 'daily-photo', timeEntries: 'time-entries', timeSummary: 'time-summary',
  quickNotes: 'quick-notes', financeEntries: 'finance-entries', financeSummary: 'finance-summary',
});
function markerPair(key) {
  const name = MARKERS[key];
  if (!name) throw new Error('未知的每日记录区域');
  return [`<!-- hz:${name}:start -->`, `<!-- hz:${name}:end -->`];
}
```

Implementation must count exact start/end occurrences, require start before end, retain CRLF/LF and final-newline state, and replace only interior lines.

- [ ] **Step 4: Add RED tests for formats, summaries, and interval splitting**

Cover exact quick-note text, optional project links, zero-padded times, invalid/end-before-start intervals, start-new-timer equality, midnight split, category order, cents parsing, negative rejection, and income/expense/net summaries.

- [ ] **Step 5: Implement minimal format and calculation functions**

Time entries use `- HH:mm–HH:mm｜类别｜事项` plus optional `｜[[项目]]`. Finance entries use `- HH:mm｜收入|支出｜分类｜事项｜¥1,234.50` plus optional project. Parsers consume only this canonical format and preserve unrecognized manual lines outside calculations.

- [ ] **Step 6: Verify focused and full GREEN**

Run:

```powershell
node --test tests/daily-capture-model.test.js
node --test tests/*.test.js
git diff --check
```

Expected: all tests pass and diff-check is empty.

- [ ] **Step 7: Commit Task 1**

```powershell
git add development/obsidian-hz-workbench/src/daily-capture-model.js development/obsidian-hz-workbench/tests/daily-capture-model.test.js
git commit -m "feat: add daily capture model"
```

### Task 2: Daily journal Vault service

**Files:**
- Create: `development/obsidian-hz-workbench/src/daily-capture-service.js`
- Create: `development/obsidian-hz-workbench/tests/daily-capture-service.test.js`

**Interfaces:**
- Consumes Task 1 model functions and injected `{ app, settings, saveSettings, now, sleep }`.
- Produces `DailyCaptureService` with `ensureJournal(date)`, `appendQuickNote(text)`, `startTimer(input)`, `finishTimer(at)`, `addManualTime(input)`, `addFinance(input)`, `replacePhoto(binary)`, and `openToday()`.

- [ ] **Step 1: Write service RED tests with an in-memory Vault adapter**

The fake app must record commands, creates, reads, modifies, binary writes, leaves, and notices. Tests require one Markdown modification per affected journal and no modification when markers/validation fail.

- [ ] **Step 2: Verify service RED**

Run: `node --test tests/daily-capture-service.test.js`

Expected: fail because the service module does not exist.

- [ ] **Step 3: Implement journal discovery and creation**

`ensureJournal(today)` first scans `settings.dailyFolder` using `resolveJournalDate`; if missing and the target is local today, execute `daily-notes`, then poll the folder for at most 5 seconds. A non-today missing journal is an error unless it is one of the two dates produced by a running timer; the second date is current today and follows the same creation path.

- [ ] **Step 4: Implement atomic text mutations**

Each operation reads the file once, validates all affected blocks, computes candidate text, then calls `vault.modify` once. `finishTimer` validates every date candidate before modifying either journal. Starting a new timer awaits finishing the previous timer before saving the replacement state.

- [ ] **Step 5: Implement binary replacement and open behavior**

Photo input is already-compressed JPEG bytes. Use `normalizePath(settings.dailyPhotoFolder + '/' + year + '/' + date + '.jpg')`, create parent folders recursively, and `adapter.writeBinary`; update the photo block only after binary write succeeds. `openToday()` uses `workspace.getLeaf('tab').openFile(file)`.

- [ ] **Step 6: Verify focused/full GREEN and commit**

Run:

```powershell
node --test tests/daily-capture-model.test.js tests/daily-capture-service.test.js
node --test tests/*.test.js
git diff --check
```

Commit subject: `feat: add daily journal capture service`.

### Task 3: Mobile-friendly template source and migration

**Files:**
- Modify: `development/obsidian-hz-workbench/src/daily-template.js`
- Modify: `development/obsidian-hz-workbench/tests/daily-template.test.js`
- Create: `development/obsidian-hz-workbench/assets/每日模板.md`

**Interfaces:**
- Produces `NEW_DAILY_TEMPLATE_BODY`, `validateDailyTemplate`, and an idempotent `updateDailyTemplate(source)` that upgrades only the exact current HZ template structure.

- [ ] **Step 1: Replace existing tests with RED coverage for exact new structure**

Tests require frontmatter/navigation preservation; exact heading order; all six marker pairs once; read-only task blocks; no Callout syntax for the six user-entry sections; CRLF and final-newline preservation; idempotence; unrelated template rejection.

- [ ] **Step 2: Run RED**

Run: `node --test tests/daily-template.test.js`

Expected: fail because the old transformer emits callout task sections and no marker pairs.

- [ ] **Step 3: Implement strict template migration and canonical asset**

The transformer recognizes the current template by frontmatter, Templater navigation line, and known callout headings. It replaces only the body after navigation with the canonical ordinary-heading body. If recognition is incomplete, return the original string unchanged. `validateDailyTemplate` returns a readable list of missing/duplicate/order errors.

- [ ] **Step 4: Verify and commit**

Run focused and full suites. Commit subject: `feat: add mobile friendly daily template`.

### Task 4: Obsidian protocol, modals, settings, and production wiring

**Files:**
- Create: `development/obsidian-hz-workbench/src/daily-capture-modal.js`
- Modify: `development/obsidian-hz-workbench/src/main.js`
- Modify: `development/obsidian-hz-workbench/styles.css`
- Create: `development/obsidian-hz-workbench/tests/daily-capture-ui.test.js`
- Modify: `development/obsidian-hz-workbench/tests/production-integration.test.js`
- Modify: `development/obsidian-hz-workbench/tests/ui.test.js`

**Interfaces:**
- Consumes `DailyCaptureService`.
- Registers protocol action `hz-workbench-capture` with `action` values `photo`, `start-time`, `finish-time`, `manual-time`, `quick-note`, `finance`, and `open-today`.
- Produces touch-friendly modal forms and `compressImageToJpeg(file, { maxEdge, quality, documentRef, windowRef })`.

- [ ] **Step 1: Write protocol/command/settings RED tests**

Require exact protocol registration, seven action routes, consumed promise rejections, no task-write/sync command, detached default arrays, `activeTimer: null`, and version-safe settings normalization.

- [ ] **Step 2: Write modal RED tests**

Use JSDOM to require labeled controls, 44px minimum action targets, category options from settings, optional project, decimal amount parsing, one submit call, disabled duplicate submit, accessible error text, and cleanup on close.

- [ ] **Step 3: Implement settings and service factory**

Add exact defaults from the specification. Normalize comma/Chinese-comma lists into unique comma-separated strings on load/save. Never put live service instances into settings.

- [ ] **Step 4: Implement protocol routing and commands**

Register the protocol once during `onload`; instantiate a fresh service per action. Add commands `记录今日`, `打开今日日记`, and `结束当前计时`. Every async boundary uses one catch path that logs `[HZ Workbench]` and shows a Chinese Notice.

- [ ] **Step 5: Implement modal forms and photo compression**

Use Obsidian `Modal` and `Setting`. Photo input accepts `image/*`; decode, orientation-correct through browser image APIs, scale to 2048 longest edge, encode JPEG 0.85, and pass ArrayBuffer to the service. Do not persist object URLs or File references.

- [ ] **Step 6: Add scoped mobile CSS**

All selectors begin `.hz-daily-capture-`; controls have at least 44px height, use Obsidian theme tokens, fit a 320px viewport, support dark/light themes and reduced motion, and do not alter workbench geometry.

- [ ] **Step 7: Verify and commit**

Run UI focused tests, production boundary tests, full suite, syntax, and diff-check. Commit subject: `feat: add mobile daily capture actions`.

### Task 5: Release 0.3.0, live template, installation, and shortcut guide

**Files:**
- Modify: `development/obsidian-hz-workbench/package.json`
- Modify: `development/obsidian-hz-workbench/manifest.json`
- Modify: `install/hz-workbench/manifest.json`
- Modify: `development/obsidian-hz-workbench/tests/release-package.test.js`
- Create: `development/obsidian-hz-workbench/docs/iphone-record-today-shortcut.md`
- Build/sync: `development/obsidian-hz-workbench/main.js`, `install/hz-workbench/main.js`, `install/hz-workbench/styles.css`
- Safely modify after backup: `F:/Obsidian/07 模板/每日模板.md`
- Safely install after backup: `F:/Obsidian/.obsidian/plugins/hz-workbench/{main.js,manifest.json,styles.css}`

**Interfaces:**
- Release version is exactly `0.3.0` in package/development/install manifests.
- Guide provides the seven menu branches and percent-encoded `obsidian://hz-workbench-capture?action=...` examples; quick-note text uses URL query `text`.

- [ ] **Step 1: Write version/release RED tests**

Change expected version to `0.3.0` and require the canonical template asset and shortcut guide in the release test. Run to confirm version mismatch RED.

- [ ] **Step 2: Update version metadata and documentation**

Write exact iOS Shortcuts steps for menu, Ask for Input, Dictate Text, URL Encode, Open URLs, and the photo/time/finance actions. State that Remotely Save must finish before switching devices.

- [ ] **Step 3: Fresh pre-live verification**

Run `npm run check`, `npm run build`, sync install artifacts, then run `npm run check` and release tests again. Require zero failures and development/install byte equality.

- [ ] **Step 4: Back up and verify live state**

Create timestamped backups under `D:/Chat GPT/HZ--工作平台/备份` for the complete five-file HZ live plugin and `每日模板.md`. Record SHA-256 and byte lengths; require every backup to equal its source before writes. Record protected hashes for HZ `data.json`/logo, Daily Notes and Templater configuration, all journals, TickTickSync, and layout.

- [ ] **Step 5: Modify the live template once**

Read live UTF-8 text, run the tested `updateDailyTemplate`, require changed output and `validateDailyTemplate(output).length === 0`, then write with the same newline/final-newline style. Re-read and verify exact equality to the candidate. Do not touch journals.

- [ ] **Step 6: Install plugin release files**

Copy only `main.js`, `manifest.json`, and `styles.css` to the live plugin. Preserve `data.json` and `logo.png`. Verify development/install/live SHA-256 equality for installed files and unchanged hashes for protected plugin files.

- [ ] **Step 7: Desktop Obsidian acceptance**

Reload Obsidian. Verify plugin loads, settings render, protocol command is registered, current workbench and read-only task blocks remain functional. Test transformations against a detached temporary copy outside the real journal folder; delete only that explicitly created temporary file after verification.

- [ ] **Step 8: Final verification and commit**

Run a final fresh full suite, release suite, syntax, diff-check, artifact hashes, template validation, protected-state audit, and `git status`. Commit release files with subject `release: install mobile daily capture 0.3.0`. Write a verification report under `.superpowers/sdd/mobile-daily-capture-report.md`.
