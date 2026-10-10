# Historical Daily Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to execute this plan task-by-task.

**Goal:** Let photo, quick note, finance, meditation, and manual-time captures target any non-future local date/time, creating the corresponding daily note from the configured template when absent.

**Architecture:** Keep `DailyCaptureService` as the only Vault writer. Add pure date/time validation helpers to the capture model, let the modal collect an immutable target date/time, and route every supported action through date-aware service methods. Live start/finish timer behavior remains unchanged.

**Tech Stack:** CommonJS JavaScript, Obsidian Modal/Vault APIs, Node test runner, jsdom.

**Global Constraints:** No future targets; local timezone only; no Daily Notes plugin dependency; preserve existing managed-marker format; never partially overwrite an existing daily note or photo without the explicit replace/append choice.

---

## Task 1: Define the date/time contract

**Files:**
- Modify: `src/daily-capture-model.js`
- Test: `tests/daily-capture-model.test.js`

1. Add failing tests for `parseCaptureDate`, `combineCaptureDateTime`, and `assertNotFuture`, including leap dates, invalid local dates, DST-safe local construction, and a one-minute future value.
2. Run: `node --test tests/daily-capture-model.test.js` and confirm the new tests fail.
3. Implement pure helpers returning `Date` objects or clear Chinese validation errors. Compare against an injected `now`, never `Date.parse('YYYY-MM-DD')` UTC semantics.
4. Re-run the focused test and commit: `feat: define historical capture date contract`.

## Task 2: Make every supported service write date-aware

**Files:**
- Modify: `src/daily-capture-service.js`
- Test: `tests/daily-capture-service.test.js`

1. Add failing tests proving quick note and meditation write only the selected date, finance uses the selected exact timestamp, manual time stays within valid dates, and missing notes are created from `settings.dailyTemplatePath`.
2. Add tests for future rejection before folder/file mutation and concurrent captures sharing the existing `inFlight` creation lock.
3. Add explicit service entry points or optional `at` parameters without changing live timer semantics. Pass the target into `ensureJournal(at)` and formatters.
4. Re-run: `node --test tests/daily-capture-service.test.js`.
5. Commit: `feat: write captures to selected journal dates`.

## Task 3: Add target controls and photo conflict choice

**Files:**
- Modify: `src/daily-capture-modal.js`
- Modify: `styles.css`
- Test: `tests/daily-capture-ui.test.js`

1. Add failing jsdom tests for a date input on photo/quick-note/finance/meditation, exact time on quick-note/finance/meditation, date-time range on manual-time, default-now values, and `max=today`.
2. Add a reusable compact target-date/time field group. Keep start/finish live timer free of historical selectors.
3. Before photo save, ask the service whether the target photo exists. Show Replace / Append / Cancel; append produces a collision-safe suffix while the daily note embeds the chosen asset.
4. Ensure the submit handler freezes the chosen target before async image compression and passes it to the date-aware service method.
5. Add mobile styles with 44px controls and no horizontal overflow.
6. Run: `node --test tests/daily-capture-ui.test.js tests/daily-capture-service.test.js`.
7. Commit: `feat: add dated capture controls`.

## Task 4: Integration and regression

**Files:**
- Modify: `src/main.js`
- Modify: `tests/production-integration.test.js`
- Modify: `tests/daily-editor-guidance-integration.test.js`

1. Add integration tests proving hub actions open the new form, editor-guidance captures remain locked to the source journal, and protocol/command routes cannot bypass validation.
2. Wire the injected clock consistently into modal and service paths. Keep `openDailyAfterCapture` opening the selected journal, not always today.
3. Run: `node --test tests/daily-*.test.js tests/production-integration.test.js`.
4. Run: `pnpm check`.
5. Commit: `feat: integrate historical daily capture`.

## Acceptance

- All five historical actions default to now and accept past local targets.
- A missing target daily note is created from `07 模板/每日模板.md` or the configured path.
- Future dates/times are rejected before any Vault mutation.
- Existing photos require a replace/append choice.
- Live start/finish timer behavior is unchanged.

