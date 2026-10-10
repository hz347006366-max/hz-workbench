# Carousel Inertia Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to execute this plan task-by-task.

**Goal:** Make the journal carousel feel fluid through direct drag, velocity-based inertia, and snapping while preserving reliable note opening and the current journal-card content contract.

**Architecture:** Extend the pure carousel model with continuous offset/velocity math and keep DOM/event ownership in `CarouselController`. Render stable card nodes through CSS variables during drag; commit the discrete index only at snap completion. Existing pause reasons and render lifecycle remain authoritative.

**Tech Stack:** Pointer Events, `requestAnimationFrame`, CSS transforms/variables, CommonJS, Node tests, jsdom.

**Global Constraints:** Independently implement behavior; do not copy unlicensed 3D-card-acrylic code. Side-card first click centers; centered-card second click opens its daily note in a new tab. Keyboard, wheel, autoplay, reduced-motion, and cancellation must remain deterministic.

---

## Task 1: Add continuous carousel physics

**Files:**
- Modify: `src/carousel-model.js`
- Test: `tests/carousel-model.test.js`

1. Write failing table tests for clamped drag offset, sampled velocity, projected destination, circular destination index, snap duration bounds, and reduced-motion zero-duration behavior.
2. Implement pure helpers using pixels-per-card and a bounded projection constant; never depend on DOM or wall-clock globals.
3. Preserve existing exports and semantics for `move`, wheel accumulation, and visible slots.
4. Run: `node --test tests/carousel-model.test.js`.
5. Commit: `feat: add carousel inertia model`.

## Task 2: Drive drag and snap through animation frames

**Files:**
- Modify: `src/carousel-controller.js`
- Test: `tests/carousel-controller.test.js`

1. Add a deterministic fake animation-frame scheduler to controller tests.
2. Write failing tests for pointer samples, live transform updates, inertia projection, snap completion, pointer cancel, destroyed controller, hidden view, autoplay pause during gestures, and exact pointer-capture release.
3. Inject `requestAnimationFrame`, `cancelAnimationFrame`, and clock through `windowRef`. Replace threshold-only movement with pending -> dragging -> settling states.
4. Keep stable card DOM identity; write only transform/opacity CSS variables per frame; commit journal index and ARIA state after settle.
5. Cancel frames on rerender, pause, pointercancel, and destroy. Resume autoplay only when no pause reason remains.
6. Run: `node --test tests/carousel-controller.test.js`.
7. Commit: `feat: add smooth carousel drag and snap`.

## Task 3: Enforce the two-click navigation contract

**Files:**
- Modify: `src/carousel-controller.js`
- Test: `tests/carousel-controller.test.js`
- Test: `tests/layout-integration.test.js`

1. Write failing tests: clicking a side card centers it without opening; clicking that now-centered card opens exactly once; a drag-generated click opens nothing; keyboard Enter on centered card opens once.
2. Implement click intent based on the card path captured at pointer-down and the current centered path after settlement.
3. Retain `WorkbenchView.openJournalInNewTab`, so the workbench leaf remains open.
4. Run both focused suites and commit: `fix: make carousel navigation intentional`.

## Task 4: Refine visuals and accessibility

**Files:**
- Modify: `styles.css`
- Test: `tests/ui.test.js`
- Test: `tests/carousel-controller.test.js`

1. Add failing CSS assertions for grab/grabbing states, CSS variable transforms, will-change only while moving, focus-visible ring, and reduced-motion/static fallback.
2. Tune perspective, side-card scale/opacity, easing, and shadow without changing the confirmed compact footprint. Keep images in color for every theme.
3. Ensure only date plus one-line “每日冥想” summary appears on cards.
4. Run focused tests, then `pnpm check`.
5. Commit: `style: refine journal carousel motion`.

## Acceptance

- Drag follows the pointer, coasts briefly, and snaps without jitter.
- Side click centers; second centered click opens the matching note in a new tab.
- No accidental open after drag.
- Autoplay/pause/destroy behavior has no leaked timers or animation frames.
- Reduced-motion remains immediate and usable.

