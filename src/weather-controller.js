const REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const MAX_RECENT_LOCATIONS = 5;

const DEFAULT_WEATHER_LOCATION = Object.freeze({
  id: 'location:default-jinan', name: '济南', admin1: '山东', country: '中国', countryCode: 'CN',
  label: '济南，山东，中国', latitude: 36.6512, longitude: 117.1201, timezone: 'Asia/Shanghai',
});

const WEATHER_GLYPHS = Object.freeze({
  sun: '☀', 'cloud-sun': '⛅', cloud: '☁', 'cloud-fog': '≡',
  'cloud-drizzle': '☔', 'cloud-rain': '☔', 'cloud-snow': '❄',
  'cloud-lightning': '⛈', 'circle-help': '○',
});

function defaultScheduler() {
  return { setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis) };
}

function normalizeLocation(location) {
  if (!location || typeof location !== 'object'
    || typeof location.latitude !== 'number' || !Number.isFinite(location.latitude)
    || typeof location.longitude !== 'number' || !Number.isFinite(location.longitude)
    || typeof location.timezone !== 'string' || !location.timezone.trim()) return null;
  const name = String(location.name || '').trim();
  const admin1 = String(location.admin1 || '').trim();
  const country = String(location.country || '').trim();
  return {
    id: String(location.id || `location:${location.latitude},${location.longitude}:${location.timezone}`),
    name, admin1, country, countryCode: String(location.countryCode || '').trim(),
    label: String(location.label || [name, admin1, country].filter(Boolean).join('，')).trim(),
    latitude: location.latitude, longitude: location.longitude, timezone: location.timezone.trim(),
  };
}

function locationKey(location) { return normalizeLocation(location)?.id || ''; }
function displayName(location) { return String(location?.name || location?.label || '未知城市'); }
function sceneKind(icon) {
  const name = String(icon || '');
  if (name === 'sun') return 'sun';
  if (/rain|drizzle|lightning/.test(name)) return 'rain';
  return 'cloud';
}
function hourLabel(value) {
  const match = /T(\d{2}):(\d{2})/.exec(String(value || ''));
  return match ? `${match[1]}:${match[2]}` : '—';
}
function dayLabel(value, index) {
  if (index === 0) return '今天';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  return match ? `${Number(match[2])}月${Number(match[3])}日` : '—';
}
function cacheTimeLabel(value) {
  const date = new Date(Number(value));
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { hour12: false }) : '未知';
}

class WeatherController {
  constructor({ section, client, settings, saveSettings, scheduler = defaultScheduler(), reducedMotion = false } = {}) {
    if (!section?.ownerDocument || typeof section.append !== 'function') throw new TypeError('section must be a DOM element');
    if (!client || typeof client.load !== 'function' || typeof client.searchLocations !== 'function') {
      throw new TypeError('client must expose load and searchLocations');
    }
    if (!settings || typeof settings !== 'object') throw new TypeError('settings must be an object');
    if (typeof saveSettings !== 'function') throw new TypeError('saveSettings must be a function');
    if (!scheduler || typeof scheduler.setTimeout !== 'function' || typeof scheduler.clearTimeout !== 'function') {
      throw new TypeError('scheduler must expose setTimeout and clearTimeout');
    }
    this.section = section;
    this.client = client;
    this.settings = settings;
    this.saveSettings = saveSettings;
    this.scheduler = scheduler;
    this.reducedMotion = Boolean(reducedMotion);
    this.location = normalizeLocation(settings.weatherLocation) || { ...DEFAULT_WEATHER_LOCATION };
    this.recents = this.normalizeRecents(settings.weatherRecentLocations);
    this.listeners = [];
    this.searchLocationsById = new Map();
    this.loadOperation = 0;
    this.searchOperation = 0;
    this.selectionOperation = 0;
    this.activeLoad = null;
    this.refreshTimer = null;
    this.saveState = null;
    this.pendingSaveOperation = 0;
    this.mounted = false;
    this.destroyed = false;
  }

  mount() {
    if (this.mounted || this.destroyed) return this;
    const document = this.section.ownerDocument;
    this.root = document.createElement('section');
    this.root.className = `hz-weather${this.reducedMotion ? ' hz-reduced-motion' : ''}`;
    this.root.setAttribute('aria-label', '天气中心');
    this.searchForm = document.createElement('form');
    this.searchForm.className = 'hz-weather-search';
    this.searchInput = document.createElement('input');
    this.searchInput.type = 'search';
    this.searchInput.name = 'weather-city';
    this.searchInput.placeholder = '搜索城市';
    this.searchInput.setAttribute('aria-label', '搜索天气城市');
    const searchButton = this.make('button', 'hz-weather-button hz-weather-search-submit', '搜索');
    searchButton.type = 'submit';
    this.searchForm.append(this.searchInput, searchButton);
    this.searchState = this.make('p', 'hz-weather-search-state');
    this.searchState.setAttribute('aria-live', 'polite');
    this.searchResults = this.make('div', 'hz-weather-search-results');
    this.recentStrip = this.make('nav', 'hz-weather-recents');
    this.recentStrip.setAttribute('aria-label', '最近城市');
    this.content = this.make('div', 'hz-weather-content');
    this.root.append(this.searchForm, this.searchState, this.searchResults, this.recentStrip, this.content);
    this.section.append(this.root);

    this.listen(this.searchForm, 'submit', (event) => { event.preventDefault(); this.search(this.searchInput.value); });
    this.listen(this.searchResults, 'click', (event) => {
      const button = event.target.closest?.('button[data-location-id]');
      const location = button ? this.searchLocationsById.get(button.dataset.locationId) : null;
      if (location) this.selectLocation(location);
    });
    this.listen(this.recentStrip, 'click', (event) => {
      const button = event.target.closest?.('button[data-location-id]');
      const location = button ? this.recents.find((item) => locationKey(item) === button.dataset.locationId) : null;
      if (location) this.selectLocation(location);
    });
    this.listen(this.content, 'click', (event) => {
      if (event.target.closest?.('.hz-weather-location')) this.searchInput.focus();
      else if (event.target.closest?.('.hz-weather-refresh')) this.refresh({ force: true });
      else if (event.target.closest?.('.hz-weather-retry')) this.refresh({ force: true });
    });
    this.mounted = true;
    this.renderRecents();
    this.refresh();
    return this;
  }

  refresh({ force = false } = {}) {
    if (!this.isLive()) return Promise.resolve(null);
    const signature = `${locationKey(this.location)}:${Boolean(force)}`;
    if (this.activeLoad?.signature === signature) return this.activeLoad.promise;
    this.clearRefreshTimer();
    const operation = ++this.loadOperation;
    const location = { ...this.location };
    this.renderLoading(location);
    let request;
    try { request = this.client.load(location, { force: Boolean(force) }); }
    catch (error) { request = Promise.reject(error); }
    const promise = Promise.resolve(request)
      .then((result) => {
        if (!this.isCurrentLoad(operation)) return null;
        this.renderSnapshot(result);
        return result;
      })
      .catch((error) => {
        if (!this.isCurrentLoad(operation)) return null;
        this.renderError(error);
        return null;
      })
      .finally(() => {
        if (!this.isCurrentLoad(operation)) return;
        if (this.activeLoad?.operation === operation) this.activeLoad = null;
        this.scheduleRefresh();
      });
    this.activeLoad = { operation, signature, promise };
    return promise;
  }

  selectLocation(candidate) {
    const location = normalizeLocation(candidate);
    if (!location || !this.isLive()) return Promise.resolve(null);
    const operation = ++this.selectionOperation;
    this.searchOperation += 1;
    const previous = this.settings.weatherLocation;
    this.location = location;
    this.recents = this.normalizeRecents([location, previous, ...this.recents]);
    this.settings.weatherLocation = { ...location };
    this.settings.weatherRecentLocations = this.recents.map((item) => ({ ...item }));
    this.searchInput.value = '';
    this.clearSearch();
    this.renderRecents();
    this.queueSave(operation);
    return this.refresh();
  }

  search(rawQuery) {
    if (!this.isLive()) return Promise.resolve([]);
    const operation = ++this.searchOperation;
    const query = String(rawQuery || '').trim();
    this.searchLocationsById.clear();
    this.searchResults.replaceChildren();
    if (query.length < 2) {
      this.setSearchState('请输入至少 2 个字符');
      return Promise.resolve([]);
    }
    this.setSearchState('正在搜索…');
    let request;
    try { request = this.client.searchLocations(query); }
    catch (error) { request = Promise.reject(error); }
    return Promise.resolve(request)
      .then((locations) => {
        if (!this.isCurrentSearch(operation)) return [];
        const normalized = (Array.isArray(locations) ? locations : []).map(normalizeLocation).filter(Boolean);
        this.renderSearchResults(normalized);
        return normalized;
      })
      .catch(() => {
        if (!this.isCurrentSearch(operation)) return [];
        this.setSearchState('城市搜索暂时不可用，请稍后重试。', true);
        return [];
      });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.mounted = false;
    this.loadOperation += 1;
    this.searchOperation += 1;
    this.selectionOperation += 1;
    this.clearRefreshTimer();
    for (const { target, type, handler, options } of this.listeners) target.removeEventListener(type, handler, options);
    this.listeners = [];
    this.searchLocationsById.clear();
    this.root?.remove();
    this.root = null;
    this.activeLoad = null;
  }

  make(tag, className = '', text = '') {
    const element = this.section.ownerDocument.createElement(tag);
    if (className) element.className = className;
    element.textContent = String(text);
    return element;
  }
  listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    this.listeners.push({ target, type, handler, options });
  }
  isLive() { return this.mounted && !this.destroyed; }
  isCurrentLoad(operation) { return this.isLive() && operation === this.loadOperation; }
  isCurrentSearch(operation) { return this.isLive() && operation === this.searchOperation; }

  normalizeRecents(values) {
    const seen = new Set();
    const result = [];
    for (const value of Array.isArray(values) ? values : []) {
      const location = normalizeLocation(value);
      const key = locationKey(location);
      if (!location || !key || seen.has(key)) continue;
      seen.add(key);
      result.push(location);
      if (result.length === MAX_RECENT_LOCATIONS) break;
    }
    return result;
  }

  queueSave(operation) {
    this.pendingSaveOperation = operation;
    if (this.saveState) return;
    let request;
    try { request = this.saveSettings(); }
    catch (error) { request = Promise.reject(error); }
    const state = { operation };
    this.saveState = state;
    Promise.resolve(request).catch(() => null).finally(() => {
      if (!this.isLive() || this.saveState !== state || operation > this.selectionOperation) return;
      this.saveState = null;
      if (this.pendingSaveOperation !== operation) this.queueSave(this.pendingSaveOperation);
    });
  }

  clearRefreshTimer() {
    if (this.refreshTimer != null) this.scheduler.clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }
  scheduleRefresh() {
    this.clearRefreshTimer();
    if (!this.isLive()) return;
    this.refreshTimer = this.scheduler.setTimeout(() => {
      this.refreshTimer = null;
      if (this.isLive()) this.refresh();
    }, REFRESH_INTERVAL_MS);
  }
  clearSearch() {
    this.searchLocationsById.clear();
    this.searchResults.replaceChildren();
    this.setSearchState('');
  }
  setSearchState(message, alert = false) {
    this.searchState.textContent = message;
    if (alert) this.searchState.setAttribute('role', 'alert');
    else this.searchState.removeAttribute('role');
  }

  renderSearchResults(locations) {
    this.searchResults.replaceChildren();
    if (!locations.length) { this.setSearchState('未找到匹配城市'); return; }
    this.setSearchState(`找到 ${locations.length} 个城市`);
    const fragment = this.section.ownerDocument.createDocumentFragment();
    for (const location of locations) {
      this.searchLocationsById.set(locationKey(location), location);
      const button = this.make('button', 'hz-weather-button hz-weather-search-result', location.label || displayName(location));
      button.type = 'button';
      button.dataset.locationId = locationKey(location);
      fragment.append(button);
    }
    this.searchResults.append(fragment);
  }

  renderRecents() {
    const fragment = this.section.ownerDocument.createDocumentFragment();
    for (const location of this.recents) {
      const button = this.make('button', 'hz-weather-button hz-weather-recent', displayName(location));
      button.type = 'button';
      button.dataset.locationId = locationKey(location);
      if (locationKey(location) === locationKey(this.location)) button.setAttribute('aria-current', 'true');
      fragment.append(button);
    }
    this.recentStrip.replaceChildren(fragment);
    this.recentStrip.hidden = this.recents.length === 0;
  }

  renderLoading(location) {
    const status = this.make('div', 'hz-weather-state hz-weather-loading', `正在获取${displayName(location)}天气…`);
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    this.content.replaceChildren(status);
  }
  renderError(error) {
    const card = this.make('section', 'hz-weather-state hz-weather-error');
    card.setAttribute('role', 'alert');
    const title = this.make('h2', '', '天气暂时不可用');
    const message = this.make('p', '', String(error?.message || '天气数据暂时不可用，请稍后重试。'));
    const retry = this.make('button', 'hz-weather-button hz-weather-retry', '重试');
    retry.type = 'button';
    card.append(title, message, retry);
    this.content.replaceChildren(card);
  }

  renderSnapshot(result) {
    const snapshot = result?.snapshot;
    if (!snapshot?.current || !Array.isArray(snapshot.hourly) || !Array.isArray(snapshot.daily)) {
      this.renderError(new Error('天气数据暂时不可用，请稍后重试。'));
      return;
    }
    const current = snapshot.current;
    const currentCard = this.make('article', 'hz-weather-current');
    const scene = this.make('div', `hz-weather-scene is-${sceneKind(current.weather?.icon)}`);
    scene.setAttribute('aria-hidden', 'true');
    const locationButton = this.make('button', 'hz-weather-location', displayName(snapshot.location || this.location));
    locationButton.type = 'button';
    locationButton.setAttribute('aria-label', '更换天气城市');
    const temperature = this.make('p', 'hz-weather-temperature', current.temperature?.label || '—');
    const condition = this.make('p', 'hz-weather-condition', current.weather?.label || '未知');
    const today = snapshot.daily[0];
    const range = this.make('p', 'hz-weather-range', today
      ? `最高 ${today.temperatureMax?.label || '—'} · 最低 ${today.temperatureMin?.label || '—'}` : '');
    const refresh = this.make('button', 'hz-weather-button hz-weather-refresh', '刷新');
    refresh.type = 'button';
    currentCard.append(scene, locationButton, temperature, condition, range, refresh);
    const nodes = [currentCard];
    if (result.stale) nodes.push(this.make('p', 'hz-weather-stale', `离线数据 · 缓存时间 ${cacheTimeLabel(result.fetchedAt)}`));
    nodes.push(this.renderHourly(snapshot.hourly), this.renderDaily(snapshot.daily), this.renderMetrics(current));
    this.content.replaceChildren(...nodes);
  }

  renderHourly(rows) {
    const details = this.make('details', 'hz-weather-details');
    details.append(this.make('summary', '', '12 小时预报'));
    const strip = this.make('div', 'hz-weather-hourly');
    strip.setAttribute('role', 'list');
    for (const row of rows.slice(0, 12)) {
      const item = this.make('article', 'hz-weather-hour');
      item.setAttribute('role', 'listitem');
      item.append(this.make('time', '', hourLabel(row.time)),
        this.make('span', 'hz-weather-icon', WEATHER_GLYPHS[row.weather?.icon] || WEATHER_GLYPHS['circle-help']),
        this.make('strong', '', row.temperature?.label || '—'),
        this.make('small', '', `降水 ${row.precipitationProbability?.label || '—'}`));
      strip.append(item);
    }
    details.append(strip);
    return details;
  }

  renderDaily(rows) {
    const details = this.make('details', 'hz-weather-details');
    details.append(this.make('summary', '', '7 日预报'));
    const list = this.make('div', 'hz-weather-daily');
    list.setAttribute('role', 'list');
    rows.slice(0, 7).forEach((row, index) => {
      const item = this.make('article', 'hz-weather-day');
      item.setAttribute('role', 'listitem');
      item.append(this.make('time', '', dayLabel(row.date, index)),
        this.make('span', 'hz-weather-icon', WEATHER_GLYPHS[row.weather?.icon] || WEATHER_GLYPHS['circle-help']),
        this.make('span', '', row.weather?.label || '未知'),
        this.make('small', '', `降水 ${row.precipitationProbability?.label || '—'}`),
        this.make('strong', '', `${row.temperatureMin?.label || '—'} / ${row.temperatureMax?.label || '—'}`));
      list.append(item);
    });
    details.append(list);
    return details;
  }

  renderMetrics(current) {
    const details = this.make('details', 'hz-weather-details hz-weather-metrics');
    details.append(this.make('summary', '', '体感与空气'));
    const grid = this.make('dl', 'hz-weather-metric-grid');
    const metrics = [
      ['体感', current.feelsLike?.label || '—'],
      ['降水概率', current.precipitationProbability?.label || '—'],
      ['空气质量', `${current.aqi?.label || '—'} · ${current.aqi?.level || '未知'}`],
      ['PM2.5', current.aqi?.pm25?.label || '—'],
      ['风速', `${current.wind?.speedLabel || '—'} · ${current.wind?.directionLabel || '未知'}`],
      ['紫外线', `${current.uv?.label || '—'} · ${current.uv?.level || '未知'}`],
    ];
    for (const [label, value] of metrics) grid.append(this.make('dt', '', label), this.make('dd', '', `${label} ${value}`));
    const source = this.make('p', 'hz-weather-source');
    source.append(this.make('span', '', '数据来源：'));
    const link = this.make('a', '', 'Open-Meteo');
    link.href = 'https://open-meteo.com/';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    source.append(link);
    details.append(grid, source);
    return details;
  }
}

module.exports = { WeatherController, DEFAULT_WEATHER_LOCATION, MAX_RECENT_LOCATIONS, REFRESH_INTERVAL_MS };
