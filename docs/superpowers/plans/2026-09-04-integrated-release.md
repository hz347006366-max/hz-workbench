# Capture, Weather, Carousel, and Prism Integrated Release Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to execute this plan task-by-task.

**Goal:** Integrate the four approved subsystems, verify them against the real Vault without risking user data, update the installable bundle and handoff documentation, and present one final unified result.

**Architecture:** Execute subsystem plans in dependency order: capture, carousel, weather, Prism. Keep each subsystem independently tested and committed. Then run full build/package validation, deploy only the allowlisted plugin artifacts while preserving `data.json`, reload Obsidian, and perform read-only plus UI smoke checks.

**Tech Stack:** Existing Node/esbuild test pipeline, `scripts/run_all_checks.py`, PowerShell read-only Vault checks, Obsidian UI, Git.

**Global Constraints:** Do not alter TickTick tasks; do not overwrite plugin `data.json`; do not mutate existing daily notes during smoke testing unless using an explicitly created disposable test note; no prototype preview until all approved functions are integrated; never copy unlicensed carousel source.

---

## Task 1: Execute subsystem plans

**Files:**
- Follow: `docs/superpowers/plans/2026-09-04-daily-backfill.md`
- Follow: `docs/superpowers/plans/2026-09-04-carousel-inertia.md`
- Follow: `docs/superpowers/plans/2026-09-04-weather-center.md`
- Follow: `docs/superpowers/plans/2026-09-04-prism-blue-gold.md`

1. Execute each plan with its focused red-green-refactor loop and commit boundaries.
2. After each subsystem, run its focused suites and inspect `git diff --check`.
3. Do not deploy intermediate builds to the live Vault.

## Task 2: Cross-feature integration tests

**Files:**
- Modify: `tests/layout-integration.test.js`
- Modify: `tests/production-integration.test.js`
- Modify: `tests/render-lifecycle.test.js`
- Modify: `tests/release-package.test.js`

1. Add failing tests for repeated workbench rerenders: weather requests and carousel frames are canceled, selected weather city and theme persist, historical capture opens its selected journal, and project mode remains functional.
2. Add a test that Prism does not filter carousel images and weather/mobile layout coexists with saved free-layout data.
3. Run: `node --test tests/layout-integration.test.js tests/production-integration.test.js tests/render-lifecycle.test.js tests/release-package.test.js`.
4. Commit: `test: cover integrated workbench features`.

## Task 3: Build, package, and inspect artifacts

**Files:**
- Modify generated: `main.js`
- Sync: `../../install/hz-workbench/main.js`
- Sync: `../../install/hz-workbench/styles.css`
- Sync: `../../install/hz-workbench/manifest.json`
- Sync: `../../install/hz-workbench/logo.png`
- Sync: `../../install/hz-workbench/THIRD_PARTY_NOTICES.md`

1. Run `pnpm build`, syntax check, and all tests.
2. Sync only the five allowlisted artifacts to `install/hz-workbench`; do not copy `data.json`, caches, source maps, tests, or `node_modules`.
3. Set `NODE_BIN` to the bundled Node path and run `python scripts/run_all_checks.py`; require `ALL HZ CHECKS OK`.
4. Inspect package size and contents; run `git diff --check` and `git status --short`.
5. Commit: `build: prepare integrated workbench release`.

## Task 4: Safe live-Vault installation

**Files:**
- Target: `F:/Obsidian/.obsidian/plugins/hz-workbench/`

1. Read and hash the live `data.json`; record its hash and confirm it is outside the copy list.
2. Copy the allowlisted artifacts from `install/hz-workbench` to the live plugin directory.
3. Re-hash `data.json` and require byte identity. Compare deployed artifact hashes with the install bundle.
4. Reload the plugin through Obsidian UI. If reload fails, stop and report rather than editing Vault content.

## Task 5: Unified smoke test

**Files:**
- Read-only scope: `F:/Obsidian/01 日记`, `F:/Obsidian/02 项目`, plugin settings/cache

1. Open the workbench and verify desktop sizing, Jinan weather, city search, 12-hour/7-day expansion, and stale/error copy using safe network toggles only if available.
2. Verify carousel drag/snap, side-click center, centered-click open in a new tab, month filters, colored photos, and no frame/timer leaks after switching tabs.
3. Verify Prism theme across workbench, project cockpit, capture modal, and weather; confirm logo/icons/photos are unfiltered.
4. Verify historical capture form date/time bounds without saving. If an end-to-end write test is needed, create one clearly named disposable past-day fixture, verify it, and move it to Obsidian trash afterward.
5. Verify project dashboard and TickTick read-only panels are unchanged.

## Task 6: Documentation and handoff

**Files:**
- Modify: `F:/Obsidian/09 知识库/Hanzhong-codex.md`
- Modify: `.superpowers/sdd/progress.md`

1. Update the handoff with implemented behavior, settings, exact commit, test totals, deployment hashes, live validation results, known limitations, and Mac/iPhone continuation instructions.
2. Record Open-Meteo public-network dependency, 30-minute cache behavior, Prism attribution, and the no-license carousel constraint.
3. Commit repository documentation changes and leave the worktree clean.

## Final Verification Commands

```powershell
$env:NODE_BIN='C:\Users\瀚中\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
& 'C:\Users\瀚中\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' scripts/run_all_checks.py
git diff --check
git status --short
```

## Acceptance

- All subsystem and integration tests pass from a clean build.
- Install bundle and development artifacts are byte-identical.
- Live `data.json` is unchanged.
- Real Obsidian smoke test passes on workbench, project, capture, weather, carousel, and Prism paths.
- Handoff document enables a context-free Mac/iPhone continuation.

