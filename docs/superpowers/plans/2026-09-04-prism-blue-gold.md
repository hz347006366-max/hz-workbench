# Prism Blue-Gold Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to execute this plan task-by-task.

**Goal:** Add a fixed whole-workbench “棱镜玻璃·蓝金” theme derived from the Apache-2.0 Prism Glass design language, while leaving photos, icons, and the logo unfiltered.

**Architecture:** Introduce one new semantic token set and component-level glass tokens. Existing components continue consuming semantic variables; only true glass surfaces receive controlled backdrop/filter effects. Use feature queries and fallbacks so the theme remains legible without backdrop-filter.

**Tech Stack:** CSS custom properties, gradients, backdrop-filter, existing Obsidian theme switcher, Node source/CSS tests.

**Global Constraints:** Palette is fixed to `#0A1335`, `#163B7A`, `#4B70BE`, `#C89A55`, `#F2D79E`; dark readable contrast; no image/logo/icon filters; no heavy animated refraction; include Apache-2.0 attribution/NOTICE in source and release package.

---

## Task 1: Add theme tokens and selection

**Files:**
- Modify: `src/main.js`
- Modify: `styles.css`
- Modify: `tests/ui.test.js`
- Modify: `tests/production-integration.test.js`

1. Write failing tests for `prism-blue-gold` in `THEME_LABELS`, setting normalization/persistence, root class, exact palette tokens, and theme-cycle reachability.
2. Add the label “棱镜玻璃·蓝金” and semantic primitives for background, three surfaces, borders, text, muted text, accent, warning, and success.
3. Run focused tests and commit: `feat: add prism blue gold theme tokens`.

## Task 2: Apply glass hierarchy across components

**Files:**
- Modify: `styles.css`
- Test: `tests/ui.test.js`
- Test: `tests/project-ui.test.js`

1. Write failing assertions for glass treatment on header actions, stat cards, weather, carousel, task panels, project cockpit, gantt, finance, and capture modal.
2. Add component tokens (`--glass-bg`, `--glass-border`, `--glass-highlight`, `--glass-shadow`, `--glass-blur`) and scoped Prism selectors. Use blur sparingly and preserve existing layout dimensions.
3. Add `@supports not (backdrop-filter: blur(1px))` fallback with opaque surfaces.
4. Explicitly set `.hz-jcard img`, `.hz-brand-logo`, SVG/icon containers to `filter:none` and avoid inherited opacity.
5. Run focused tests and commit: `style: apply prism glass hierarchy`.

## Task 3: Accessibility and motion audit

**Files:**
- Modify: `styles.css`
- Test: `tests/ui.test.js`

1. Add tests for focus-visible borders, readable muted text, reduced-transparency fallback, and `.hz-reduced-motion` disabling decorative transitions.
2. Verify controls retain at least 44px touch targets on mobile and meaningful hover/focus/disabled differentiation.
3. Run: `node --test tests/ui.test.js tests/project-ui.test.js`.
4. Commit: `fix: harden prism theme accessibility`.

## Task 4: Attribution and release inclusion

**Files:**
- Create: `THIRD_PARTY_NOTICES.md`
- Modify: `scripts/run_all_checks.py`
- Modify: `tests/release-package.test.js`

1. Add a concise Prism Glass attribution, repository URL, Apache-2.0 notice, and a statement that HZ implementation is adapted rather than copied wholesale.
2. Add `THIRD_PARTY_NOTICES.md` to the release artifact allowlist and package equality checks.
3. Add failing release tests first, update release synchronization, then run them.
4. Commit: `docs: attribute prism glass design source`.

## Acceptance

- Theme switcher exposes “棱镜玻璃·蓝金” and persists it.
- All workbench/project/weather/modal surfaces share one restrained glass hierarchy.
- Palette matches the confirmed five colors.
- Photos, icons, and logo retain original color and clarity.
- Theme is readable with blur disabled and respects reduced motion.
- Attribution ships with the installable plugin.

