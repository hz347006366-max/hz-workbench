const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeLocationResults,
  normalizeWeatherSnapshot,
  weatherCodeMeta,
  weatherCacheKey,
} = require('../src/weather-model');

const location = {
  name: 'Jinan',
  admin1: 'Shandong',
  country: 'China',
  country_code: 'CN',
  latitude: 36.6512,
  longitude: 117.1201,
  timezone: 'Asia/Shanghai',
};

function forecastFixture() {
  return {
    timezone: 'Asia/Shanghai',
    timezone_abbreviation: 'GMT+8',
    current: {
      time: '2026-09-05T10:30',
      temperature_2m: 28.4,
      apparent_temperature: 31.2,
      weather_code: 61,
      precipitation: 0.4,
      wind_speed_10m: 18.7,
      wind_direction_10m: 92,
      relative_humidity_2m: 78,
    },
    hourly: {
      time: [
        '2026-09-05T09:00',
        '2026-09-05T10:00',
        '2026-09-05T11:00',
        '2026-09-05T12:00',
        '2026-09-05T13:00',
        '2026-09-05T14:00',
        '2026-09-05T15:00',
        '2026-09-05T16:00',
        '2026-09-05T17:00',
        '2026-09-05T18:00',
        '2026-09-05T19:00',
        '2026-09-05T20:00',
        '2026-09-05T21:00',
        '2026-09-05T22:00',
      ],
      temperature_2m: [26, 27, 28, 29, 30, 30, 29, 28, 27, 26, 25, 24, 23, 22],
      apparent_temperature: [27, 28, 30, 31, 32, 32, 31, 29, 28, 27, 26, 25, 24, 23],
      precipitation_probability: [5, 10, 55, 60, 65, 50, 40, 35, 30, 20, 15, 10, 5, 0],
      weather_code: [3, 3, 61, 61, 63, 63, 80, 80, 51, 3, 2, 1, 0, 0],
      wind_speed_10m: [9, 10, 13, 14, 15, 13, 11, 10, 9, 8, 7, 6, 6, 5],
      uv_index: [0, 1, 5.6, 6.2, 7.1, 5.4, 3.2, 1.1, 0.4, 0, 0, 0, 0, 0],
    },
    daily: {
      time: [
        '2026-09-04',
        '2026-09-05',
        '2026-09-06',
        '2026-09-07',
        '2026-09-08',
        '2026-09-09',
        '2026-09-10',
        '2026-09-11',
        '2026-09-12',
      ],
      weather_code: [0, 61, 3, 45, 95, 80, 71, 2, 1],
      temperature_2m_max: [29, 31, 30, 28, 27, 26, 25, 26, 28],
      temperature_2m_min: [20, 22, 21, 20, 19, 18, 17, 18, 19],
      precipitation_probability_max: [0, 70, 40, 20, 80, 55, 35, 10, 5],
      uv_index_max: [7.5, 8.1, 6.4, 4.2, 3.8, 5.0, 2.2, 3.1, 6.0],
    },
  };
}

test('normalizes Chinese city geocoding results without trusting HTML-capable fields', () => {
  const results = normalizeLocationResults({
    results: [
      {
        name: 'Jinan',
        admin1: 'Shandong',
        country: 'China',
        country_code: 'CN',
        latitude: 36.6512,
        longitude: 117.1201,
        timezone: 'Asia/Shanghai',
      },
      {
        name: '<img src=x onerror=alert(1)>',
        latitude: 'bad',
        longitude: 117,
        timezone: 'Asia/Shanghai',
      },
    ],
  });

  assert.deepEqual(results, [{
    id: 'location:Jinan|Shandong|CN|China|36.6512|117.1201|Asia/Shanghai',
    name: 'Jinan',
    admin1: 'Shandong',
    country: 'China',
    countryCode: 'CN',
    label: 'Jinan，Shandong，China',
    latitude: 36.6512,
    longitude: 117.1201,
    timezone: 'Asia/Shanghai',
  }]);
  assert.equal(results[0].label.includes('<'), false);
});

test('preserves distinct location identities for same-coordinate Open-Meteo results', () => {
  const results = normalizeLocationResults({
    results: [
      {
        id: 1805753,
        name: 'Jinan',
        admin1: 'Shandong',
        country: 'China',
        country_code: 'CN',
        latitude: 36.6512,
        longitude: 117.1201,
        timezone: 'Asia/Shanghai',
      },
      {
        id: 11899032,
        name: 'Jinan Shi',
        admin1: 'Shandong',
        country: 'China',
        country_code: 'CN',
        latitude: 36.6512,
        longitude: 117.1201,
        timezone: 'Asia/Shanghai',
      },
      {
        name: 'Broken',
        admin1: 'Shandong',
        country: 'China',
        country_code: 'CN',
        latitude: '',
        longitude: 117.1201,
        timezone: 'Asia/Shanghai',
      },
    ],
  });

  assert.equal(results.length, 2);
  assert.equal(results[0].id, 'location:1805753|Jinan|Shandong|CN|China|36.6512|117.1201|Asia/Shanghai');
  assert.equal(results[1].id, 'location:11899032|Jinan Shi|Shandong|CN|China|36.6512|117.1201|Asia/Shanghai');
  assert.notEqual(results[0].id, results[1].id);
});

test('maps current weather code to Chinese labels and stable semantic icons', () => {
  assert.deepEqual(weatherCodeMeta(61), { code: 61, label: '小雨', icon: 'cloud-rain' });
  assert.deepEqual(weatherCodeMeta(0), { code: 0, label: '晴', icon: 'sun' });
  assert.deepEqual(weatherCodeMeta(999), { code: 999, label: '未知', icon: 'circle-help' });
});

test('normalizes current conditions, next 12 hourly points, next 7 daily points, AQI, UV, and timezone', () => {
  const snapshot = normalizeWeatherSnapshot({
    location,
    forecast: forecastFixture(),
    airQuality: {
      hourly: {
        time: ['2026-09-05T10:00', '2026-09-05T11:00', '2026-09-05T12:00'],
        us_aqi: [86, 91, 95],
        pm2_5: [24.1, 28.3, 29.5],
      },
    },
    now: '2026-09-05T10:30',
  });

  assert.equal(snapshot.timezone, 'Asia/Shanghai');
  assert.equal(snapshot.current.time, '2026-09-05T10:30');
  assert.equal(snapshot.current.temperature.value, 28.4);
  assert.equal(snapshot.current.feelsLike.label, '31.2°C');
  assert.equal(snapshot.current.precipitationProbability.label, '55%');
  assert.equal(snapshot.current.aqi.label, '91');
  assert.equal(snapshot.current.aqi.level, '良');
  assert.equal(snapshot.current.uv.label, '5.6');
  assert.equal(snapshot.current.uv.level, '中等');
  assert.deepEqual(snapshot.current.wind, {
    speed: 18.7,
    speedLabel: '18.7 km/h',
    direction: 92,
    directionLabel: '东风',
  });
  assert.deepEqual(snapshot.current.weather, { code: 61, label: '小雨', icon: 'cloud-rain' });
  assert.equal(snapshot.hourly.length, 12);
  assert.equal(snapshot.hourly[0].time, '2026-09-05T11:00');
  assert.equal(snapshot.hourly.at(-1).time, '2026-09-05T22:00');
  assert.equal(snapshot.hourly[0].precipitationProbability.label, '55%');
  assert.equal(snapshot.daily.length, 7);
  assert.equal(snapshot.daily[0].date, '2026-09-05');
  assert.equal(snapshot.daily.at(-1).date, '2026-09-11');
  assert.equal(snapshot.daily[0].uvMax.label, '8.1');
});

test('defensively normalizes missing and unequal arrays without host clock or exceptions', () => {
  const snapshot = normalizeWeatherSnapshot({
    location: { ...location, timezone: 'Asia/Shanghai' },
    forecast: {
      timezone: 'Asia/Shanghai',
      current: { time: '2026-09-05T10:00', weather_code: 3 },
      hourly: {
        time: ['2026-09-05T10:00', '2026-09-05T11:00', '2026-09-05T12:00'],
        temperature_2m: [28],
        precipitation_probability: [20, undefined, 40],
      },
      daily: {
        time: ['2026-09-05', '2026-09-06'],
        temperature_2m_max: [31],
      },
    },
    airQuality: null,
  });

  assert.equal(snapshot.current.time, '2026-09-05T10:00');
  assert.equal(snapshot.current.temperature.value, null);
  assert.equal(snapshot.current.aqi.value, null);
  assert.equal(snapshot.hourly.length, 2);
  assert.equal(snapshot.hourly[0].time, '2026-09-05T11:00');
  assert.equal(snapshot.hourly[0].temperature.value, null);
  assert.equal(snapshot.hourly[1].precipitationProbability.value, 40);
  assert.equal(snapshot.daily.length, 2);
  assert.equal(snapshot.daily[1].temperatureMax.value, null);
});

test('treats JSON null and blank numeric fields as missing while preserving actual zero values', () => {
  const snapshot = normalizeWeatherSnapshot({
    location,
    forecast: {
      timezone: 'Asia/Shanghai',
      current: {
        time: '2026-09-05T10:00',
        temperature_2m: null,
        apparent_temperature: '',
        weather_code: null,
        precipitation: null,
        wind_speed_10m: null,
        wind_direction_10m: '',
        relative_humidity_2m: null,
      },
      hourly: {
        time: ['2026-09-05T11:00', '2026-09-05T12:00'],
        temperature_2m: [null, 0],
        apparent_temperature: ['', 0],
        precipitation_probability: [null, 0],
        weather_code: [null, 0],
        wind_speed_10m: [null, 0],
        uv_index: [null, 0],
      },
      daily: {
        time: ['2026-09-05', '2026-09-06'],
        weather_code: [null, 0],
        temperature_2m_max: [null, 0],
        temperature_2m_min: ['', 0],
        precipitation_probability_max: [null, 0],
        uv_index_max: [null, 0],
      },
    },
    airQuality: {
      hourly: {
        time: ['2026-09-05T10:00'],
        us_aqi: [null],
        pm2_5: [''],
      },
    },
  });

  assert.deepEqual(snapshot.current.temperature, { value: null, label: '—' });
  assert.deepEqual(snapshot.current.feelsLike, { value: null, label: '—' });
  assert.deepEqual(snapshot.current.precipitation, { value: null, label: '—' });
  assert.deepEqual(snapshot.current.weather, { code: null, label: '未知', icon: 'circle-help' });
  assert.deepEqual(snapshot.current.wind, {
    speed: null,
    speedLabel: '—',
    direction: null,
    directionLabel: '未知',
  });
  assert.deepEqual(snapshot.current.aqi, {
    value: null,
    label: '—',
    level: '未知',
    pm25: { value: null, label: '—' },
  });
  assert.deepEqual(snapshot.current.uv, { value: null, label: '—', level: '未知' });
  assert.deepEqual(snapshot.hourly[0].temperature, { value: null, label: '—' });
  assert.deepEqual(snapshot.hourly[0].precipitationProbability, { value: null, label: '—' });
  assert.deepEqual(snapshot.hourly[0].weather, { code: null, label: '未知', icon: 'circle-help' });
  assert.deepEqual(snapshot.hourly[0].uv, { value: null, label: '—', level: '未知' });
  assert.deepEqual(snapshot.hourly[1].temperature, { value: 0, label: '0°C' });
  assert.deepEqual(snapshot.hourly[1].precipitationProbability, { value: 0, label: '0%' });
  assert.deepEqual(snapshot.hourly[1].weather, { code: 0, label: '晴', icon: 'sun' });
  assert.deepEqual(snapshot.hourly[1].windSpeed, { value: 0, label: '0 km/h' });
  assert.deepEqual(snapshot.hourly[1].uv, { value: 0, label: '0', level: '低' });
  assert.deepEqual(snapshot.daily[0].temperatureMax, { value: null, label: '—' });
  assert.deepEqual(snapshot.daily[0].uvMax, { value: null, label: '—', level: '未知' });
  assert.deepEqual(snapshot.daily[1].temperatureMax, { value: 0, label: '0°C' });
  assert.deepEqual(snapshot.daily[1].precipitationProbability, { value: 0, label: '0%' });
  assert.deepEqual(snapshot.daily[1].uvMax, { value: 0, label: '0', level: '低' });
});

test('skips malformed hourly and daily time rows without mutating inputs', () => {
  const input = {
    location,
    forecast: {
      timezone: 'Asia/Shanghai',
      current: { time: '2026-09-05T10:00', weather_code: 0 },
      hourly: {
        time: [null, '', 'not-a-time', '2026-09-05', '2026-09-05T11:00', '2026-09-05T12:30'],
        temperature_2m: [99, 98, 97, 96, 28, 29],
      },
      daily: {
        time: [null, '', 'bad-date', '2026-09-05T00:00', '2026-09-05', '2026-09-06'],
        temperature_2m_max: [99, 98, 97, 96, 31, 32],
      },
    },
    airQuality: {
      hourly: {
        time: [null, 'bad', '2026-09-05T10:00'],
        us_aqi: [1, 2, 50],
      },
    },
  };
  const before = structuredClone(input);

  const snapshot = normalizeWeatherSnapshot(input);

  assert.deepEqual(input, before);
  assert.deepEqual(snapshot.hourly.map((row) => row.time), ['2026-09-05T11:00', '2026-09-05T12:30']);
  assert.deepEqual(snapshot.hourly.map((row) => row.temperature.value), [28, 29]);
  assert.deepEqual(snapshot.daily.map((row) => row.date), ['2026-09-05', '2026-09-06']);
  assert.deepEqual(snapshot.daily.map((row) => row.temperatureMax.value), [31, 32]);
  assert.equal(snapshot.current.aqi.value, 50);
});

test('builds stable weather cache keys from coordinates and timezone', () => {
  assert.equal(weatherCacheKey({
    latitude: 36.65123456,
    longitude: 117.12019876,
    timezone: 'Asia/Shanghai',
  }), 'weather:36.65123,117.1202:Asia/Shanghai');
  assert.equal(weatherCacheKey({
    latitude: '36.65123456',
    longitude: '117.12019876',
    timezone: 'Asia/Shanghai',
  }), 'weather:36.65123,117.1202:Asia/Shanghai');
});
