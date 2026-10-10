const {
  normalizeLocationResults,
  normalizeWeatherSnapshot,
  weatherCacheKey,
} = require('./weather-model');

const GEOCODING_ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const AIR_QUALITY_ENDPOINT = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const CACHE_TTL_MS = 30 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 10 * 1000;
const WEATHER_UNAVAILABLE_MESSAGE = '天气数据暂时不可用，请稍后重试。';

const CURRENT_FIELDS = [
  'temperature_2m',
  'apparent_temperature',
  'weather_code',
  'wind_speed_10m',
  'wind_direction_10m',
];

const HOURLY_FIELDS = [
  'temperature_2m',
  'apparent_temperature',
  'precipitation_probability',
  'weather_code',
  'wind_speed_10m',
  'uv_index',
];

const DAILY_FIELDS = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_probability_max',
  'uv_index_max',
];

const AIR_QUALITY_FIELDS = ['us_aqi', 'pm2_5'];

function unavailableError() {
  const error = new Error(WEATHER_UNAVAILABLE_MESSAGE);
  error.code = 'WEATHER_UNAVAILABLE';
  return error;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isLocalDate(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return Boolean(match) && isValidDateParts(Number(match[1]), Number(match[2]), Number(match[3]));
}

function isLocalDateTime(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return false;
  const hours = Number(match[4]);
  const minutes = Number(match[5]);
  const seconds = match[6] == null ? 0 : Number(match[6]);
  return isValidDateParts(Number(match[1]), Number(match[2]), Number(match[3]))
    && hours < 24
    && minutes < 60
    && seconds < 60;
}

function isValidDateParts(year, month, day) {
  if (!Number.isInteger(year) || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= monthDays[month - 1];
}

function isMeasurement(value) {
  return isObject(value) && isFiniteNumber(value.value) && typeof value.label === 'string';
}

function isPercentage(value) {
  return isMeasurement(value) && value.value >= 0 && value.value <= 100;
}

function isWeather(value) {
  return isObject(value)
    && isFiniteNumber(value.code)
    && typeof value.label === 'string'
    && typeof value.icon === 'string';
}

function isValidSnapshot(snapshot) {
  if (!isObject(snapshot)
    || !isObject(snapshot.location)
    || !isFiniteNumber(snapshot.location.latitude)
    || !isFiniteNumber(snapshot.location.longitude)
    || typeof snapshot.timezone !== 'string'
    || !snapshot.timezone
    || !isObject(snapshot.current)
    || !isLocalDateTime(snapshot.current.time)) return false;

  const current = snapshot.current;
  if (!isMeasurement(current.temperature)
    || !isMeasurement(current.feelsLike)
    || !isPercentage(current.precipitationProbability)
    || !isWeather(current.weather)
    || !isObject(current.wind)
    || !isFiniteNumber(current.wind.speed)
    || !isFiniteNumber(current.wind.direction)
    || !isObject(current.uv)
    || !isFiniteNumber(current.uv.value)
    || !isObject(current.aqi)
    || !isFiniteNumber(current.aqi.value)
    || !isMeasurement(current.aqi.pm25)) return false;

  if (!Array.isArray(snapshot.hourly) || snapshot.hourly.length !== 12) return false;
  if (!snapshot.hourly.every((row) => isObject(row)
    && isLocalDateTime(row.time)
    && isMeasurement(row.temperature)
    && isMeasurement(row.feelsLike)
    && isPercentage(row.precipitationProbability)
    && isWeather(row.weather)
    && isMeasurement(row.windSpeed)
    && isObject(row.uv)
    && isFiniteNumber(row.uv.value))) return false;

  if (!Array.isArray(snapshot.daily) || snapshot.daily.length !== 7) return false;
  return snapshot.daily.every((row) => isObject(row)
    && isLocalDate(row.date)
    && isWeather(row.weather)
    && isMeasurement(row.temperatureMax)
    && isMeasurement(row.temperatureMin)
    && isPercentage(row.precipitationProbability)
    && isObject(row.uvMax)
    && isFiniteNumber(row.uvMax.value));
}

function normalizeLocationInput(location) {
  if (!isObject(location)) return null;
  return normalizeLocationResults({
    results: [{
      name: location.name,
      admin1: location.admin1,
      country: location.country,
      country_code: location.countryCode ?? location.country_code,
      latitude: location.latitude,
      longitude: location.longitude,
      timezone: location.timezone,
    }],
  })[0] || null;
}

function isValidCacheEntry(entry, currentTime) {
  return isObject(entry)
    && Number.isSafeInteger(entry.fetchedAt)
    && entry.fetchedAt >= 0
    && entry.fetchedAt <= currentTime
    && isValidSnapshot(entry.snapshot);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function cloneCacheEntry(entry) {
  return {
    snapshot: cloneJson(entry.snapshot),
    fetchedAt: entry.fetchedAt,
  };
}

function resultFromEntry(entry, stale) {
  return {
    snapshot: cloneJson(entry.snapshot),
    fetchedAt: entry.fetchedAt,
    stale,
  };
}

function buildUrl(endpoint, parameters) {
  const url = new URL(endpoint);
  for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, String(value));
  return url.toString();
}

function defaultScheduler() {
  return {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  };
}

class WeatherClient {
  constructor({
    requestUrl,
    now = Date.now,
    scheduler = defaultScheduler(),
    timeoutMs = DEFAULT_TIMEOUT_MS,
    store,
  } = {}) {
    if (typeof requestUrl !== 'function') throw new TypeError('requestUrl must be a function');
    if (typeof now !== 'function') throw new TypeError('now must be a function');
    if (!store || typeof store.get !== 'function' || typeof store.set !== 'function') {
      throw new TypeError('store must expose get(key) and set(key, value)');
    }
    if (!scheduler
      || typeof scheduler.setTimeout !== 'function'
      || typeof scheduler.clearTimeout !== 'function') {
      throw new TypeError('scheduler must expose setTimeout and clearTimeout');
    }
    if (!isFiniteNumber(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs must be positive');

    this.requestUrl = requestUrl;
    this.now = now;
    this.scheduler = scheduler;
    this.timeoutMs = timeoutMs;
    this.store = store;
    this.inFlight = new Map();
    this.cacheWriteVersion = new Map();
  }

  async searchLocations(query) {
    const name = String(query ?? '').trim();
    if (name.length < 2) return [];
    const url = buildUrl(GEOCODING_ENDPOINT, {
      name,
      count: 10,
      language: 'zh',
      format: 'json',
    });
    try {
      return normalizeLocationResults(await this.requestJson(url));
    } catch {
      throw unavailableError();
    }
  }

  load(location, { force = false } = {}) {
    const normalizedLocation = normalizeLocationInput(location);
    if (!normalizedLocation) return Promise.reject(unavailableError());
    const key = weatherCacheKey(normalizedLocation);
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const version = (this.cacheWriteVersion.get(key) || 0) + 1;
    this.cacheWriteVersion.set(key, version);
    const operation = this.loadUncached(normalizedLocation, key, Boolean(force), version);
    const tracked = operation.finally(() => {
      if (this.inFlight.get(key) === tracked) this.inFlight.delete(key);
    });
    this.inFlight.set(key, tracked);
    return tracked;
  }

  async loadUncached(location, key, force, version) {
    const fetchedAt = Number(this.now());
    if (!Number.isFinite(fetchedAt)) throw unavailableError();
    const cached = await this.readCache(key, fetchedAt);
    if (!force
      && cached
      && fetchedAt >= cached.fetchedAt
      && fetchedAt - cached.fetchedAt <= CACHE_TTL_MS) {
      return resultFromEntry(cached, false);
    }

    try {
      const coordinates = {
        latitude: location.latitude,
        longitude: location.longitude,
      };
      const forecastUrl = buildUrl(FORECAST_ENDPOINT, {
        ...coordinates,
        current: CURRENT_FIELDS.join(','),
        hourly: HOURLY_FIELDS.join(','),
        daily: DAILY_FIELDS.join(','),
        timezone: 'auto',
        temperature_unit: 'celsius',
        wind_speed_unit: 'kmh',
        precipitation_unit: 'mm',
        forecast_days: 7,
      });
      const airQualityUrl = buildUrl(AIR_QUALITY_ENDPOINT, {
        ...coordinates,
        hourly: AIR_QUALITY_FIELDS.join(','),
        timezone: 'auto',
        forecast_days: 2,
      });
      const [forecast, airQuality] = await Promise.all([
        this.requestJson(forecastUrl),
        this.requestJson(airQualityUrl),
      ]);
      const snapshot = normalizeWeatherSnapshot({ location, forecast, airQuality });
      if (!isValidSnapshot(snapshot)) throw unavailableError();

      const entry = { snapshot, fetchedAt };
      await this.writeCache(key, entry, version);
      return resultFromEntry(entry, false);
    } catch {
      if (cached) return resultFromEntry(cached, true);
      throw unavailableError();
    }
  }

  async requestJson(url) {
    let timer;
    const timeout = new Promise((resolve, reject) => {
      timer = this.scheduler.setTimeout(() => reject(unavailableError()), this.timeoutMs);
    });
    try {
      const response = await Promise.race([
        Promise.resolve().then(() => this.requestUrl(url)),
        timeout,
      ]);
      if (!isObject(response)
        || !isFiniteNumber(response.status)
        || response.status < 200
        || response.status >= 300) {
        throw unavailableError();
      }
      const payload = response.json;
      if (!isObject(payload) || payload.error === true) throw unavailableError();
      return payload;
    } finally {
      this.scheduler.clearTimeout(timer);
    }
  }

  async readCache(key, currentTime) {
    try {
      const entry = await this.store.get(key);
      return isValidCacheEntry(entry, currentTime) ? cloneCacheEntry(entry) : null;
    } catch {
      return null;
    }
  }

  async writeCache(key, entry, version) {
    try {
      if (this.cacheWriteVersion.get(key) !== version) return;
      await this.store.set(key, cloneCacheEntry(entry));
    } catch {
      // A transient persistence failure must not hide fresh public weather data.
    }
  }
}

module.exports = {
  WeatherClient,
  CACHE_TTL_MS,
  WEATHER_UNAVAILABLE_MESSAGE,
};
