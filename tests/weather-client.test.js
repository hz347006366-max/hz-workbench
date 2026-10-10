const test = require('node:test');
const assert = require('node:assert/strict');

const { WeatherClient } = require('../src/weather-client');
const { normalizeWeatherSnapshot, weatherCacheKey } = require('../src/weather-model');

const NOW = Date.UTC(2026, 8, 5, 2, 30);
const THIRTY_MINUTES = 30 * 60 * 1000;
const UNAVAILABLE_MESSAGE = '天气数据暂时不可用，请稍后重试。';

const location = {
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

function forecastFixture() {
  const hourlyTimes = Array.from({ length: 14 }, (_, index) => {
    const hour = String(9 + index).padStart(2, '0');
    return `2026-09-05T${hour}:00`;
  });
  return {
    timezone: 'Asia/Shanghai',
    current: {
      time: '2026-09-05T10:30',
      temperature_2m: 28.4,
      apparent_temperature: 31.2,
      weather_code: 61,
      wind_speed_10m: 18.7,
      wind_direction_10m: 92,
    },
    hourly: {
      time: hourlyTimes,
      temperature_2m: hourlyTimes.map((_, index) => 26 + index),
      apparent_temperature: hourlyTimes.map((_, index) => 27 + index),
      precipitation_probability: hourlyTimes.map((_, index) => index * 5),
      weather_code: hourlyTimes.map(() => 61),
      wind_speed_10m: hourlyTimes.map((_, index) => 9 + index),
      uv_index: hourlyTimes.map((_, index) => index / 2),
    },
    daily: {
      time: Array.from({ length: 7 }, (_, index) => `2026-09-${String(5 + index).padStart(2, '0')}`),
      weather_code: [61, 3, 45, 95, 80, 71, 2],
      temperature_2m_max: [31, 30, 28, 27, 26, 25, 26],
      temperature_2m_min: [22, 21, 20, 19, 18, 17, 18],
      precipitation_probability_max: [70, 40, 20, 80, 55, 35, 10],
      uv_index_max: [8.1, 6.4, 4.2, 3.8, 5, 2.2, 3.1],
    },
  };
}

function airQualityFixture() {
  return {
    timezone: 'Asia/Shanghai',
    hourly: {
      time: ['2026-09-05T10:00', '2026-09-05T11:00', '2026-09-05T12:00'],
      us_aqi: [82, 91, 95],
      pm2_5: [24.1, 28.3, 29.5],
    },
  };
}

function response(json, status = 200) {
  return { status, json };
}

function createStore(initialEntries = []) {
  const values = new Map(initialEntries);
  const calls = [];
  return {
    calls,
    async get(key) {
      calls.push(['get', key]);
      return values.get(key);
    },
    async set(key, value) {
      calls.push(['set', key, value]);
      values.set(key, value);
    },
  };
}

function cachedResult(fetchedAt = NOW - THIRTY_MINUTES - 1) {
  return {
    fetchedAt,
    snapshot: normalizeWeatherSnapshot({
      location,
      forecast: forecastFixture(),
      airQuality: airQualityFixture(),
    }),
  };
}

function assertExactCsv(searchParams, name, expected) {
  assert.deepEqual(searchParams.get(name)?.split(','), expected);
}

test('searches only the official geocoding JSON endpoint with encoded Chinese query parameters', async () => {
  const urls = [];
  const client = new WeatherClient({
    requestUrl: async (url) => {
      urls.push(url);
      return response({
        results: [{
          id: 1805753,
          name: '<b>济南</b>',
          admin1: '山东',
          country: '中国',
          country_code: 'CN',
          latitude: 36.6512,
          longitude: 117.1201,
          timezone: 'Asia/Shanghai',
        }],
      });
    },
    now: () => NOW,
    store: createStore(),
  });

  const results = await client.searchLocations('  济南 市  ');

  assert.equal(urls.length, 1);
  const url = new URL(urls[0]);
  assert.equal(url.origin, 'https://geocoding-api.open-meteo.com');
  assert.equal(url.pathname, '/v1/search');
  assert.deepEqual([...url.searchParams.keys()].sort(), ['count', 'format', 'language', 'name']);
  assert.equal(url.searchParams.get('name'), '济南 市');
  assert.equal(url.searchParams.get('count'), '10');
  assert.equal(url.searchParams.get('language'), 'zh');
  assert.equal(url.searchParams.get('format'), 'json');
  assert.equal(results[0].name, '济南');
  assert.equal(results[0].label.includes('<'), false);
});

test('fans out forecast and AQI requests with exact fields and caches one timestamp-joined snapshot', async () => {
  const urls = [];
  const store = createStore();
  const client = new WeatherClient({
    requestUrl: async (url) => {
      urls.push(url);
      if (url.startsWith('https://api.open-meteo.com/v1/forecast')) return response(forecastFixture());
      if (url.startsWith('https://air-quality-api.open-meteo.com/v1/air-quality')) {
        return response(airQualityFixture());
      }
      throw new Error(`unexpected URL: ${url}`);
    },
    now: () => NOW,
    store,
  });

  const result = await client.load(location);

  assert.equal(urls.length, 2);
  const forecastUrl = new URL(urls.find((url) => url.includes('/v1/forecast')));
  assert.equal(forecastUrl.origin, 'https://api.open-meteo.com');
  assert.deepEqual([...forecastUrl.searchParams.keys()].sort(), [
    'current', 'daily', 'forecast_days', 'hourly', 'latitude', 'longitude',
    'precipitation_unit', 'temperature_unit', 'timezone', 'wind_speed_unit',
  ]);
  assert.equal(forecastUrl.searchParams.get('latitude'), '36.6512');
  assert.equal(forecastUrl.searchParams.get('longitude'), '117.1201');
  assert.equal(forecastUrl.searchParams.get('timezone'), 'auto');
  assert.equal(forecastUrl.searchParams.get('temperature_unit'), 'celsius');
  assert.equal(forecastUrl.searchParams.get('wind_speed_unit'), 'kmh');
  assert.equal(forecastUrl.searchParams.get('precipitation_unit'), 'mm');
  assert.equal(forecastUrl.searchParams.get('forecast_days'), '7');
  assertExactCsv(forecastUrl.searchParams, 'current', [
    'temperature_2m', 'apparent_temperature', 'weather_code', 'wind_speed_10m',
    'wind_direction_10m',
  ]);
  assertExactCsv(forecastUrl.searchParams, 'hourly', [
    'temperature_2m', 'apparent_temperature', 'precipitation_probability',
    'weather_code', 'wind_speed_10m', 'uv_index',
  ]);
  assertExactCsv(forecastUrl.searchParams, 'daily', [
    'weather_code', 'temperature_2m_max', 'temperature_2m_min',
    'precipitation_probability_max', 'uv_index_max',
  ]);

  const airUrl = new URL(urls.find((url) => url.includes('/v1/air-quality')));
  assert.equal(airUrl.origin, 'https://air-quality-api.open-meteo.com');
  assert.deepEqual([...airUrl.searchParams.keys()].sort(), [
    'forecast_days', 'hourly', 'latitude', 'longitude', 'timezone',
  ]);
  assert.equal(airUrl.searchParams.get('timezone'), 'auto');
  assert.equal(airUrl.searchParams.get('forecast_days'), '2');
  assertExactCsv(airUrl.searchParams, 'hourly', ['us_aqi', 'pm2_5']);

  assert.equal(result.stale, false);
  assert.equal(result.fetchedAt, NOW);
  assert.equal(result.snapshot.current.aqi.value, 91);
  assert.equal(result.snapshot.current.aqi.pm25.value, 28.3);
  assert.equal(result.snapshot.hourly[0].time, '2026-09-05T11:00');
  assert.deepEqual(store.calls.map(([method, key]) => [method, key]), [
    ['get', weatherCacheKey(location)],
    ['set', weatherCacheKey(location)],
  ]);
  assert.deepEqual(store.calls[1][2], { snapshot: result.snapshot, fetchedAt: NOW });
});

test('returns a cache entry through only get(key) while it is fresh for 30 minutes', async () => {
  const key = weatherCacheKey(location);
  const entry = cachedResult(NOW - THIRTY_MINUTES);
  const store = createStore([[key, entry]]);
  let requests = 0;
  const client = new WeatherClient({
    requestUrl: async () => {
      requests += 1;
      throw new Error('network should not run');
    },
    now: () => NOW,
    store,
  });

  const result = await client.load(location);

  assert.equal(requests, 0);
  assert.deepEqual(result, { ...entry, stale: false });
  assert.deepEqual(store.calls, [['get', key]]);
});

test('force bypasses a fresh cache and replaces it only after both requests validate', async () => {
  const key = weatherCacheKey(location);
  const oldEntry = cachedResult(NOW - 1000);
  const store = createStore([[key, oldEntry]]);
  let requests = 0;
  const client = new WeatherClient({
    requestUrl: async (url) => {
      requests += 1;
      return response(url.includes('/v1/forecast') ? forecastFixture() : airQualityFixture());
    },
    now: () => NOW,
    store,
  });

  const result = await client.load(location, { force: true });

  assert.equal(requests, 2);
  assert.equal(result.stale, false);
  assert.deepEqual(store.calls.map(([method, callKey]) => [method, callKey]), [
    ['get', key],
    ['set', key],
  ]);
});

test('same-city normal and force loads share one active network call', async () => {
  const store = createStore();
  let requests = 0;
  const resolvers = [];
  const client = new WeatherClient({
    requestUrl: (url) => {
      requests += 1;
      return new Promise((resolve) => resolvers.push(() => resolve(response(
        url.includes('/v1/forecast') ? forecastFixture() : airQualityFixture(),
      ))));
    },
    now: () => NOW,
    store,
  });

  const forced = client.load(location, { force: true });
  const normal = client.load({ ...location });
  for (let tick = 0; tick < 10 && requests < 2; tick += 1) await Promise.resolve();
  assert.equal(requests, 2);
  for (const resolve of resolvers) resolve();
  const [normalResult, forcedResult] = await Promise.all([normal, forced]);

  assert.deepEqual(normalResult, forcedResult);
  assert.equal(store.calls.filter(([method]) => method === 'set').length, 1);
});

test('keeps network results, store entries, fresh reads, and stale reads deeply independent', async () => {
  const store = createStore();
  let offline = false;
  const client = new WeatherClient({
    requestUrl: async (url) => {
      if (offline) throw new Error('offline');
      return response(url.includes('/v1/forecast') ? forecastFixture() : airQualityFixture());
    },
    now: () => NOW,
    store,
  });

  const networkResult = await client.load(location, { force: true });
  const storedEntry = store.calls.find(([method]) => method === 'set')[2];
  assert.notStrictEqual(networkResult.snapshot, storedEntry.snapshot);
  assert.notStrictEqual(networkResult.snapshot.hourly[0], storedEntry.snapshot.hourly[0]);
  networkResult.snapshot.hourly[0].temperature.value = 999;
  assert.equal(storedEntry.snapshot.hourly[0].temperature.value, 28);

  const freshResult = await client.load(location);
  assert.notStrictEqual(freshResult.snapshot, storedEntry.snapshot);
  freshResult.snapshot.daily[0].temperatureMax.value = 999;
  assert.equal(storedEntry.snapshot.daily[0].temperatureMax.value, 31);

  offline = true;
  const staleResult = await client.load(location, { force: true });
  assert.equal(staleResult.stale, true);
  assert.equal(staleResult.snapshot.hourly[0].temperature.value, 28);
  assert.equal(staleResult.snapshot.daily[0].temperatureMax.value, 31);
  staleResult.snapshot.current.aqi.pm25.value = 999;
  assert.equal(storedEntry.snapshot.current.aqi.pm25.value, 28.3);
});

test('returns a stale cache on network failure without rewriting it', async () => {
  const key = weatherCacheKey(location);
  const entry = cachedResult();
  const store = createStore([[key, entry]]);
  const client = new WeatherClient({
    requestUrl: async () => {
      throw new Error('offline');
    },
    now: () => NOW,
    store,
  });

  const result = await client.load(location);

  assert.deepEqual(result, { ...entry, stale: true });
  assert.deepEqual(store.calls, [['get', key]]);
});

test('uses the injected timeout scheduler and throws one normalized Chinese error without cache', async () => {
  const pendingTimers = new Map();
  let timerId = 0;
  const scheduler = {
    setTimeout(callback, delay) {
      const id = ++timerId;
      pendingTimers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      pendingTimers.delete(id);
    },
  };
  const client = new WeatherClient({
    requestUrl: async () => new Promise(() => {}),
    now: () => NOW,
    scheduler,
    timeoutMs: 4321,
    store: createStore(),
  });

  const loading = client.load(location);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(pendingTimers.size, 2);
  assert.deepEqual([...pendingTimers.values()].map(({ delay }) => delay), [4321, 4321]);
  for (const { callback } of [...pendingTimers.values()]) callback();

  await assert.rejects(loading, { message: UNAVAILABLE_MESSAGE });
  assert.equal(pendingTimers.size, 0);
});

test('does not replace a valid stale cache when either endpoint returns an invalid response', async () => {
  const key = weatherCacheKey(location);
  const entry = cachedResult();
  const store = createStore([[key, entry]]);
  const client = new WeatherClient({
    requestUrl: async (url) => response(url.includes('/v1/forecast')
      ? { timezone: 'Asia/Shanghai', current: { time: 'not-a-time' } }
      : airQualityFixture()),
    now: () => NOW,
    store,
  });

  const result = await client.load(location, { force: true });

  assert.deepEqual(result, { ...entry, stale: true });
  assert.deepEqual(store.calls, [['get', key]]);
});

test('normalizes network, HTTP, and invalid-data failures identically when no valid cache exists', async (t) => {
  const cases = [
    ['network', async () => { throw new Error('ECONNRESET'); }],
    ['HTTP', async () => response({ error: true, reason: 'rate limited' }, 429)],
    ['invalid JSON shape', async () => response({})],
  ];

  for (const [name, requestUrl] of cases) {
    await t.test(name, async () => {
      const client = new WeatherClient({
        requestUrl,
        now: () => NOW,
        store: createStore(),
      });
      await assert.rejects(client.load(location), { message: UNAVAILABLE_MESSAGE });
    });
  }
});

test('requires a finite numeric 2xx response status and never caches statusless responses', async (t) => {
  const cases = [
    ['missing status', undefined],
    ['non-numeric status', '200'],
  ];

  for (const [name, status] of cases) {
    await t.test(name, async () => {
      const store = createStore();
      const client = new WeatherClient({
        requestUrl: async (url) => ({
          ...(status === undefined ? {} : { status }),
          json: url.includes('/v1/forecast') ? forecastFixture() : airQualityFixture(),
        }),
        now: () => NOW,
        store,
      });

      await assert.rejects(client.load(location), { message: UNAVAILABLE_MESSAGE });
      assert.equal(store.calls.filter(([method]) => method === 'set').length, 0);
    });
  }
});

test('rejects invalid cached calendar content and fetchedAt instead of returning it stale', async (t) => {
  const cases = [
    ['invalid current calendar date', (entry) => { entry.snapshot.current.time = '2026-02-30T10:30'; }],
    ['invalid hourly calendar date', (entry) => { entry.snapshot.hourly[0].time = '2026-02-30T11:00'; }],
    ['invalid daily calendar date', (entry) => { entry.snapshot.daily[0].date = '2026-02-30'; }],
    ['future fetchedAt', (entry) => { entry.fetchedAt = NOW + 1; }],
    ['negative fetchedAt', (entry) => { entry.fetchedAt = -1; }],
    ['non-finite fetchedAt', (entry) => { entry.fetchedAt = Number.NaN; }],
  ];

  for (const [name, corrupt] of cases) {
    await t.test(name, async () => {
      const key = weatherCacheKey(location);
      const entry = cachedResult();
      corrupt(entry);
      const store = createStore([[key, entry]]);
      const client = new WeatherClient({
        requestUrl: async () => { throw new Error('offline'); },
        now: () => NOW,
        store,
      });

      await assert.rejects(client.load(location), { message: UNAVAILABLE_MESSAGE });
      assert.equal(store.calls.filter(([method]) => method === 'set').length, 0);
    });
  }
});

test('deduplicates simultaneous same-location loads including fan-out and cache write', async () => {
  const store = createStore();
  const resolvers = [];
  let requests = 0;
  const client = new WeatherClient({
    requestUrl: (url) => {
      requests += 1;
      return new Promise((resolve) => resolvers.push(() => resolve(response(
        url.includes('/v1/forecast') ? forecastFixture() : airQualityFixture(),
      ))));
    },
    now: () => NOW,
    store,
  });

  const first = client.load(location, { force: true });
  const second = client.load({ ...location }, { force: true });
  for (let tick = 0; tick < 10 && requests < 2; tick += 1) await Promise.resolve();
  assert.equal(requests, 2);
  for (const resolve of resolvers) resolve();

  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.deepEqual(secondResult, firstResult);
  assert.equal(store.calls.filter(([method]) => method === 'set').length, 1);
});
