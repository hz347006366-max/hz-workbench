const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const { WeatherController, DEFAULT_WEATHER_LOCATION } = require('../src/weather-controller');

const JINAN = {
  id: 'location:jinan',
  name: '济南',
  admin1: '山东',
  country: '中国',
  countryCode: 'CN',
  label: '济南，山东，中国',
  latitude: 36.6512,
  longitude: 117.1201,
  timezone: 'Asia/Shanghai',
};

const QINGDAO = {
  id: 'location:qingdao',
  name: '青岛',
  admin1: '山东',
  country: '中国',
  countryCode: 'CN',
  label: '青岛，山东，中国',
  latitude: 36.0662,
  longitude: 120.3826,
  timezone: 'Asia/Shanghai',
};

function snapshot(location = JINAN, weather = { code: 61, label: '小雨', icon: 'cloud-rain' }) {
  return {
    location,
    timezone: location.timezone,
    current: {
      time: '2026-09-05T10:30',
      temperature: { value: 28.4, label: '28.4°C' },
      feelsLike: { value: 31.2, label: '31.2°C' },
      humidity: { value: 78, label: '78%' },
      precipitation: { value: 0.4, label: '0.4 mm' },
      precipitationProbability: { value: 55, label: '55%' },
      weather,
      wind: { speed: 18.7, speedLabel: '18.7 km/h', direction: 92, directionLabel: '东风' },
      uv: { value: 5.6, label: '5.6', level: '中等' },
      aqi: { value: 91, label: '91', level: '良', pm25: { value: 28.3, label: '28.3 μg/m³' } },
    },
    hourly: Array.from({ length: 12 }, (_, index) => ({
      time: `2026-09-05T${String(index + 11).padStart(2, '0')}:00`,
      temperature: { value: 28 - index, label: `${28 - index}°C` },
      feelsLike: { value: 29 - index, label: `${29 - index}°C` },
      precipitationProbability: { value: index * 5, label: `${index * 5}%` },
      weather,
      windSpeed: { value: 10, label: '10 km/h' },
      uv: { value: 3, label: '3', level: '中等' },
    })),
    daily: Array.from({ length: 7 }, (_, index) => ({
      date: `2026-09-${String(index + 5).padStart(2, '0')}`,
      weather,
      temperatureMax: { value: 31 - index, label: `${31 - index}°C` },
      temperatureMin: { value: 22 - index, label: `${22 - index}°C` },
      precipitationProbability: { value: 70 - index * 5, label: `${70 - index * 5}%` },
      uvMax: { value: 8, label: '8', level: '很高' },
    })),
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fakeScheduler() {
  let nextId = 1;
  const pending = new Map();
  return {
    pending,
    setTimeout(callback, delay) {
      const id = nextId;
      nextId += 1;
      pending.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) { pending.delete(id); },
    run(id) {
      const timer = pending.get(id);
      pending.delete(id);
      timer?.callback();
    },
  };
}

function mount({ client, settings, saveSettings = async () => {}, scheduler, reducedMotion = false } = {}) {
  const dom = new JSDOM('<section id="weather"><p id="sibling">保留</p></section>');
  const section = dom.window.document.querySelector('#weather');
  const controller = new WeatherController({
    section,
    client,
    settings: settings || { weatherLocation: JINAN, weatherRecentLocations: [] },
    saveSettings,
    scheduler: scheduler || fakeScheduler(),
    reducedMotion,
  });
  controller.mount();
  return { dom, section, controller };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function submit(windowRef, form) {
  form.dispatchEvent(new windowRef.Event('submit', { bubbles: true, cancelable: true }));
}

test('mount renders an accessible loading state and defaults to Jinan', () => {
  const load = deferred();
  const calls = [];
  const context = mount({ client: { load(location) { calls.push(location); return load.promise; }, searchLocations: async () => [] } });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, '济南');
  assert.equal(DEFAULT_WEATHER_LOCATION.name, '济南');
  assert.match(context.section.querySelector('[role="status"]').textContent, /正在获取济南天气/);
  assert.equal(context.section.querySelector('#sibling').textContent, '保留');

  context.controller.destroy();
});

test('renders current conditions first with progressive hourly, daily, and metric details', async () => {
  const context = mount({ client: { load: async () => ({ snapshot: snapshot(), stale: false, fetchedAt: 1_787_000_000_000 }), searchLocations: async () => [] } });
  await settle();

  const root = context.section.querySelector('.hz-weather');
  const current = root.querySelector('.hz-weather-current');
  const details = [...root.querySelectorAll('details')];
  assert.equal(root.firstElementChild.classList.contains('hz-weather-search'), true);
  assert.equal(current.compareDocumentPosition(details[0]) & context.dom.window.Node.DOCUMENT_POSITION_FOLLOWING, 4);
  assert.match(current.textContent, /济南/);
  assert.match(current.textContent, /28.4°C/);
  assert.match(current.textContent, /小雨/);
  assert.equal(details.every((item) => item.open === false), true);
  assert.equal(root.querySelectorAll('.hz-weather-hour').length, 12);
  assert.equal(root.querySelectorAll('.hz-weather-day').length, 7);
  assert.match(root.textContent, /体感 31.2°C/);
  assert.match(root.textContent, /空气质量 91 · 良/);
  assert.match(root.textContent, /风速 18.7 km\/h/);
  assert.match(root.textContent, /紫外线 5.6 · 中等/);
  assert.match(root.textContent, /Open-Meteo/);
  assert.equal(root.querySelector('.hz-weather-scene').classList.contains('is-rain'), true);

  context.controller.destroy();
});

test('marks cached fallback as offline data with its cache time', async () => {
  const context = mount({ client: { load: async () => ({ snapshot: snapshot(), stale: true, fetchedAt: Date.UTC(2026, 8, 5, 2, 30) }), searchLocations: async () => [] } });
  await settle();

  const stale = context.section.querySelector('.hz-weather-stale');
  assert.match(stale.textContent, /离线数据/);
  assert.match(stale.textContent, /缓存时间/);

  context.controller.destroy();
});

test('renders an independent error card with a working retry button', async () => {
  let attempts = 0;
  const client = {
    load: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('天气数据暂时不可用，请稍后重试。');
      return { snapshot: snapshot(), stale: false, fetchedAt: 1 };
    },
    searchLocations: async () => [],
  };
  const context = mount({ client });
  await settle();

  const alert = context.section.querySelector('[role="alert"]');
  assert.match(alert.textContent, /天气数据暂时不可用/);
  assert.equal(alert.querySelector('button').textContent, '重试');
  alert.querySelector('button').click();
  await settle();
  assert.equal(attempts, 2);
  assert.match(context.section.querySelector('.hz-weather-current').textContent, /28.4°C/);

  context.controller.destroy();
});

test('city search is explicit, reports short and empty searches, and never injects result HTML', async () => {
  const calls = [];
  const malicious = { ...QINGDAO, name: '<img src=x>', label: '<img src=x>，山东，中国' };
  const client = {
    load: async () => ({ snapshot: snapshot(), stale: false, fetchedAt: 1 }),
    searchLocations: async (query) => { calls.push(query); return query === '青岛' ? [malicious] : []; },
  };
  const context = mount({ client });
  await settle();
  const input = context.section.querySelector('input[type="search"]');
  const form = input.form;

  input.value = '青';
  input.dispatchEvent(new context.dom.window.Event('input', { bubbles: true }));
  await settle();
  assert.equal(calls.length, 0);
  submit(context.dom.window, form);
  assert.equal(context.section.querySelector('.hz-weather-search-state').textContent, '请输入至少 2 个字符');
  assert.equal(calls.length, 0);

  input.value = '未知';
  submit(context.dom.window, form);
  await settle();
  assert.equal(context.section.querySelector('.hz-weather-search-state').textContent, '未找到匹配城市');

  input.value = '青岛';
  submit(context.dom.window, form);
  await settle();
  const result = context.section.querySelector('.hz-weather-search-result');
  assert.equal(calls.at(-1), '青岛');
  assert.equal(result.textContent, malicious.label);
  assert.equal(result.querySelector('img'), null);

  context.controller.destroy();
});

test('a newer search completion wins over an older query and search errors stay local', async () => {
  const oldSearch = deferred();
  const newSearch = deferred();
  const client = {
    load: async () => ({ snapshot: snapshot(), stale: false, fetchedAt: 1 }),
    searchLocations(query) {
      if (query === '老查询') return oldSearch.promise;
      if (query === '新查询') return newSearch.promise;
      return Promise.reject(new Error('天气数据暂时不可用，请稍后重试。'));
    },
  };
  const context = mount({ client });
  await settle();
  const input = context.section.querySelector('input[type="search"]');

  input.value = '老查询'; submit(context.dom.window, input.form);
  input.value = '新查询'; submit(context.dom.window, input.form);
  newSearch.resolve([QINGDAO]); await settle();
  oldSearch.resolve([JINAN]); await settle();
  assert.match(context.section.querySelector('.hz-weather-search-results').textContent, /青岛/);
  assert.doesNotMatch(context.section.querySelector('.hz-weather-search-results').textContent, /济南/);

  input.value = '失败查询'; submit(context.dom.window, input.form); await settle();
  assert.equal(context.section.querySelector('.hz-weather-search-state').getAttribute('role'), 'alert');
  assert.match(context.section.querySelector('.hz-weather-search-state').textContent, /城市搜索暂时不可用/);
  assert.ok(context.section.querySelector('.hz-weather-current'));

  context.controller.destroy();
});

test('selecting a city persists a bounded deduplicated recent list and ignores the old load', async () => {
  const oldLoad = deferred();
  const newLoad = deferred();
  const saved = [];
  const extra = Array.from({ length: 5 }, (_, index) => ({ ...JINAN, id: `location:${index}`, name: `城市${index}`, label: `城市${index}`, latitude: 30 + index }));
  const settings = { weatherLocation: JINAN, weatherRecentLocations: [JINAN, ...extra] };
  const client = {
    load(location) { return location.id === QINGDAO.id ? newLoad.promise : oldLoad.promise; },
    searchLocations: async () => [QINGDAO],
  };
  const context = mount({ client, settings, saveSettings: async () => { saved.push(settings.weatherLocation.id); } });
  const input = context.section.querySelector('input[type="search"]');
  input.value = '青岛'; submit(context.dom.window, input.form); await settle();
  context.section.querySelector('.hz-weather-search-result').click();
  await settle();

  assert.equal(settings.weatherLocation.id, QINGDAO.id);
  assert.equal(settings.weatherRecentLocations.length, 5);
  assert.deepEqual(settings.weatherRecentLocations.slice(0, 2).map((item) => item.id), [QINGDAO.id, JINAN.id]);
  assert.equal(new Set(settings.weatherRecentLocations.map((item) => item.id)).size, 5);
  assert.ok(saved.includes(QINGDAO.id));

  newLoad.resolve({ snapshot: snapshot(QINGDAO), stale: false, fetchedAt: 2 }); await settle();
  oldLoad.resolve({ snapshot: snapshot(JINAN), stale: false, fetchedAt: 1 }); await settle();
  assert.match(context.section.querySelector('.hz-weather-current').textContent, /青岛/);
  assert.doesNotMatch(context.section.querySelector('.hz-weather-current').textContent, /济南/);

  context.controller.destroy();
});

test('recent-city buttons switch locations without a search request', async () => {
  const loads = [];
  let searches = 0;
  const client = {
    load: async (location) => { loads.push(location.id); return { snapshot: snapshot(location), stale: false, fetchedAt: 1 }; },
    searchLocations: async () => { searches += 1; return []; },
  };
  const context = mount({ client, settings: { weatherLocation: JINAN, weatherRecentLocations: [JINAN, QINGDAO] } });
  await settle();

  const recent = [...context.section.querySelectorAll('.hz-weather-recent')].find((button) => button.textContent === '青岛');
  recent.click();
  await settle();
  assert.equal(loads.at(-1), QINGDAO.id);
  assert.equal(searches, 0);
  assert.match(context.section.querySelector('.hz-weather-current').textContent, /青岛/);

  context.controller.destroy();
});

test('refresh uses force mode and the 30-minute lifecycle timer does not duplicate an in-flight load', async () => {
  const scheduler = fakeScheduler();
  const pendingRefresh = deferred();
  const calls = [];
  const client = {
    load(location, options) {
      calls.push({ location, options });
      if (calls.length === 1) return Promise.resolve({ snapshot: snapshot(), stale: false, fetchedAt: 1 });
      return pendingRefresh.promise;
    },
    searchLocations: async () => [],
  };
  const context = mount({ client, scheduler });
  await settle();
  const timer = [...scheduler.pending.entries()][0];
  assert.equal(timer[1].delay, 30 * 60 * 1000);

  const first = context.controller.refresh({ force: true });
  const second = context.controller.refresh({ force: true });
  assert.equal(first, second);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.force, true);
  pendingRefresh.resolve({ snapshot: snapshot(), stale: false, fetchedAt: 2 });
  await first;

  context.controller.destroy();
});

test('repeated renders do not retain listeners for detached weather controls', async () => {
  const client = {
    load: async () => ({ snapshot: snapshot(), stale: false, fetchedAt: 1 }),
    searchLocations: async () => [],
  };
  const context = mount({ client });
  await settle();
  const listenerCount = context.controller.listeners.length;

  await context.controller.refresh({ force: true });
  await context.controller.refresh({ force: true });

  assert.equal(context.controller.listeners.length, listenerCount);
  context.controller.destroy();
});

test('destroy clears timers/listeners, removes only owned UI, and makes late promises inert', async () => {
  const scheduler = fakeScheduler();
  const lateLoad = deferred();
  const lateSearch = deferred();
  const client = { load: () => lateLoad.promise, searchLocations: () => lateSearch.promise };
  const context = mount({ client, scheduler, reducedMotion: true });
  const input = context.section.querySelector('input[type="search"]');
  input.value = '青岛'; submit(context.dom.window, input.form);
  context.controller.destroy();

  lateLoad.resolve({ snapshot: snapshot(), stale: false, fetchedAt: 1 });
  lateSearch.resolve([QINGDAO]);
  await settle();
  assert.equal(scheduler.pending.size, 0);
  assert.equal(context.section.querySelector('.hz-weather'), null);
  assert.equal(context.section.querySelector('#sibling').textContent, '保留');
  assert.doesNotThrow(() => submit(context.dom.window, input.form));
});

test('weather CSS provides bounded rails, semantic controls, accents, and reduced-motion fallbacks', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../styles.css'), 'utf8');
  assert.match(css, /\.hz-weather\s*\{/);
  assert.match(css, /\.hz-weather-hourly[^}]*overflow-x\s*:\s*auto/s);
  assert.match(css, /\.hz-weather-(?:button|search-submit|recent)[^}]*min-height\s*:\s*44px/s);
  assert.match(css, /\.hz-weather-scene\.is-(?:sun|cloud|rain)/);
  assert.match(css, /\.hz-reduced-motion[^}]*\.hz-weather-scene/s);
  assert.match(css, /@media\s*\(prefers-reduced-motion\s*:\s*reduce\)[\s\S]*\.hz-weather-scene/);
  assert.match(css, /@media\s*\(max-width\s*:\s*480px\)[\s\S]*\.hz-weather/);
});
