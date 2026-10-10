# Weather Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to execute this plan task-by-task.

**Goal:** Replace the empty left rail with an Apple-weather-inspired, read-only weather center for Jinan by default, with city search, recent cities, current/12-hour/7-day details, AQI, caching, and responsive mobile placement.

**Architecture:** Isolate network, normalization, caching, and UI. `WeatherClient` uses injected Obsidian `requestUrl`; pure model functions normalize Open-Meteo responses; `WeatherController` owns refresh/stale state; `WorkbenchView` only mounts/destroys the controller. Persist only selected/recent locations and cached public forecast data.

**Tech Stack:** Obsidian `requestUrl`, Open-Meteo Geocoding/Forecast/Air Quality APIs, CommonJS, Node tests, jsdom, CSS.

**Global Constraints:** No API key, no geolocation permission, no secrets, 30-minute TTL, stale cache on offline failure, request timeout, reduced-motion/mobile animation fallback, no HTML from API data.

---

## Task 1: Normalize Open-Meteo data

**Files:**
- Create: `src/weather-model.js`
- Test: `tests/weather-model.test.js`

1. Write failing tests for Chinese city result normalization, current weather code labels/icons, next 12 hourly points, next 7 daily points, precipitation probability, AQI, UV, feels-like, wind, missing arrays, and timezone preservation.
2. Run the focused test and confirm failure.
3. Implement pure functions: `normalizeLocationResults`, `normalizeWeatherSnapshot`, `weatherCodeMeta`, and `weatherCacheKey`.
4. Run: `node --test tests/weather-model.test.js`.
5. Commit: `feat: add weather data model`.

## Task 2: Add a safe cached client

**Files:**
- Create: `src/weather-client.js`
- Test: `tests/weather-client.test.js`

1. Write failing tests with injected `requestUrl`, clock, and store for URL parameters, forecast/AQI fan-out, 30-minute fresh cache, stale fallback, timeout/error normalization, and no caching of invalid responses.
2. Use official HTTPS endpoints and `timezone=auto`; request only fields named in the design spec.
3. Merge forecast and AQI by timestamp in the normalized snapshot. Return `{snapshot, stale, fetchedAt}`.
4. Run: `node --test tests/weather-client.test.js`.
5. Commit: `feat: add cached open meteo client`.

## Task 3: Build controller and weather UI

**Files:**
- Create: `src/weather-controller.js`
- Modify: `styles.css`
- Test: `tests/weather-ui.test.js`

1. Write failing jsdom tests for loading, data, stale, empty-search, and error states; city search; recent-city selection; 12-hour horizontal strip; 7-day list; and controller cleanup.
2. Implement `WeatherController({section, client, settings, saveSettings, scheduler, reducedMotion})` with `mount`, `refresh`, `selectLocation`, and `destroy`.
3. Render current conditions first, then collapsible details. Add CSS-only rain/cloud/sun accents; disable them under `.hz-reduced-motion` and `prefers-reduced-motion`.
4. Ensure every request completion checks controller liveness before DOM writes.
5. Run: `node --test tests/weather-ui.test.js`.
6. Commit: `feat: render weather center`.

## Task 4: Integrate desktop/mobile layout and settings

**Files:**
- Modify: `src/main.js`
- Modify: `src/layout-model.js`
- Modify: `styles.css`
- Test: `tests/layout-model.test.js`
- Test: `tests/layout-integration.test.js`
- Test: `tests/ui.test.js`

1. Add settings defaults: selected Jinan coordinates/timezone, recent locations, cache, refresh interval. Normalize loaded values and bound recents.
2. Replace `renderReservedRail` with weather mounting. Keep the `agent-panel` layout module id for backward-compatible saved layouts, but relabel it “天气” and adjust module minimum dimensions only if tests demonstrate need.
3. Place a collapsed weather card before stats on mobile; desktop uses the left rail. Destroy the previous controller on rerender/unload.
4. Add settings controls for city search/selection and a manual refresh command; do not expose raw coordinates as the primary UX.
5. Run focused layout/UI tests, then `pnpm check`.
6. Commit: `feat: integrate responsive weather rail`.

## Acceptance

- First run shows Jinan without a key or location prompt.
- User can search/select cities and reopen recent cities.
- Current, 12-hour, 7-day, precipitation, AQI, feels-like, wind, and UV are visible.
- Data refreshes at most every 30 minutes and stale cached data remains usable offline.
- Desktop and iPhone layouts do not overflow; reduced-motion has no decorative animation.

