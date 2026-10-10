# Windows Tooling Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 0.2.0 repository's documented `pnpm check` workflow and release artifact byte checks deterministic on Windows without changing plugin runtime behavior.

**Architecture:** Replace shell-dependent source globs with a small Node syntax-check runner, and enforce LF through repository attributes so checkout and build artifacts remain byte-identical across macOS and Windows. Keep the fix limited to developer tooling, tests, and repository metadata.

**Tech Stack:** Node.js, node:test, pnpm, Git attributes, PowerShell verification.

## Global Constraints

- Do not change plugin runtime behavior or version `0.2.0`.
- Do not change the user's global Git configuration.
- Use test-first RED → GREEN for both regressions.
- Keep `main.js`, `manifest.json`, `styles.css`, and `logo.png` byte-identical between development and `install/hz-workbench` after build synchronization.
- Do not install into Obsidian during this plan.

---

### Task 1: Cross-platform source syntax checking

**Files:**
- Create: `tests/windows-tooling.test.js`
- Create: `scripts/check-syntax.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: Node executable at `process.execPath`; source directory `src/`.
- Produces: `scripts/check-syntax.js`, which exits `0` only when every top-level `src/*.js` file passes `node --check`.

- [ ] **Step 1: Write the failing Windows tooling test**

Add assertions that `package.json` no longer contains `node --check src/*.js`, that its `check` script invokes `node scripts/check-syntax.js`, and that executing the new runner succeeds.

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```powershell
node --test .\tests\windows-tooling.test.js
```

Expected: FAIL because `scripts/check-syntax.js` does not exist and `package.json` still contains the shell glob.

- [ ] **Step 3: Implement the minimal syntax runner**

Create a CommonJS script that enumerates sorted top-level `.js` files in `src`, calls `spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' })` for each, and exits immediately with the first nonzero status. Change `package.json` to:

```json
"check": "node scripts/check-syntax.js && node --test tests/*.test.js"
```

- [ ] **Step 4: Verify GREEN and the actual package command**

Run:

```powershell
node --test .\tests\windows-tooling.test.js
pnpm check
```

Expected: focused test passes and the complete suite reports all tests passing.

- [ ] **Step 5: Commit Task 1**

```powershell
git add package.json scripts/check-syntax.js tests/windows-tooling.test.js docs/superpowers/plans/2026-08-11-windows-tooling-compatibility.md
git commit -m "fix: make source checks portable on Windows"
```

### Task 2: Deterministic LF release bytes

**Files:**
- Modify: `tests/windows-tooling.test.js`
- Create: repository root `.gitattributes`
- Regenerate: `development/obsidian-hz-workbench/main.js`
- Synchronize: `install/hz-workbench/main.js`
- Normalize tracked text files through Git attributes.

**Interfaces:**
- Consumes: Git checkout, esbuild output, four release artifact paths.
- Produces: LF-normalized text checkout and byte-identical development/install artifacts on Windows.

- [ ] **Step 1: Add the failing LF policy test**

Assert that repository root `.gitattributes` contains `* text=auto eol=lf`, explicitly marks `*.png binary` and `*.bundle binary`, and that all text release artifacts contain no CRLF bytes.

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```powershell
node --test .\tests\windows-tooling.test.js
```

Expected: FAIL because `.gitattributes` is missing and checked-out release text files contain CRLF.

- [ ] **Step 3: Add repository LF policy and normalize safely**

Create root `.gitattributes`:

```gitattributes
* text=auto eol=lf
*.png binary
*.bundle binary
```

Run `git add --renormalize .`, commit the policy, verify no unrelated content diff, then refresh the tracked checkout using the committed attributes. Do not change global `core.autocrlf`.

- [ ] **Step 4: Rebuild and synchronize release artifacts**

Run `pnpm build`, then copy the four release artifacts from `development/obsidian-hz-workbench/` to `install/hz-workbench/`.

- [ ] **Step 5: Verify GREEN and full release baseline**

Run:

```powershell
pnpm check
pnpm build
node --check .\main.js
pnpm check
git diff --check
```

Expected: all tests pass, release artifact byte equality passes after build, no whitespace errors, and Git shows only intentional commits.

- [ ] **Step 6: Commit synchronized release output if needed**

```powershell
git add .gitattributes main.js ../../install/hz-workbench
git commit -m "build: normalize release artifacts across platforms"
```

Skip this commit if rebuilding produces no tracked byte changes after LF normalization.
