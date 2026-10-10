const WEATHER_CODE_META = new Map([
  [0, ['晴', 'sun']],
  [1, ['大部晴朗', 'sun']],
  [2, ['局部多云', 'cloud-sun']],
  [3, ['阴', 'cloud']],
  [45, ['雾', 'cloud-fog']],
  [48, ['雾凇', 'cloud-fog']],
  [51, ['小毛毛雨', 'cloud-drizzle']],
  [53, ['毛毛雨', 'cloud-drizzle']],
  [55, ['强毛毛雨', 'cloud-drizzle']],
  [56, ['冻毛毛雨', 'cloud-drizzle']],
  [57, ['强冻毛毛雨', 'cloud-drizzle']],
  [61, ['小雨', 'cloud-rain']],
  [63, ['中雨', 'cloud-rain']],
  [65, ['大雨', 'cloud-rain']],
  [66, ['冻雨', 'cloud-rain']],
  [67, ['强冻雨', 'cloud-rain']],
  [71, ['小雪', 'cloud-snow']],
  [73, ['中雪', 'cloud-snow']],
  [75, ['大雪', 'cloud-snow']],
  [77, ['雪粒', 'cloud-snow']],
  [80, ['阵雨', 'cloud-rain']],
  [81, ['强阵雨', 'cloud-rain']],
  [82, ['暴阵雨', 'cloud-rain']],
  [85, ['阵雪', 'cloud-snow']],
  [86, ['强阵雪', 'cloud-snow']],
  [95, ['雷暴', 'cloud-lightning']],
  [96, ['雷暴伴冰雹', 'cloud-lightning']],
  [99, ['强雷暴伴冰雹', 'cloud-lightning']],
]);

function finiteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : null;
}

function cleanText(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/[<>]/g, '')
    .trim();
}

function formatNumber(value, digits = 1) {
  if (value == null) return '—';
  return Number.isInteger(value) ? String(value) : value.toFixed(digits);
}

function measurement(value, unit, digits = 1) {
  const number = finiteNumber(value);
  return {
    value: number,
    label: number == null ? '—' : `${formatNumber(number, digits)}${unit}`,
  };
}

function percentage(value) {
  const number = finiteNumber(value);
  return {
    value: number,
    label: number == null ? '—' : `${Math.round(number)}%`,
  };
}

function weatherCodeMeta(code) {
  const normalizedCode = finiteNumber(code);
  const publicCode = normalizedCode == null ? null : normalizedCode;
  const [label, icon] = WEATHER_CODE_META.get(publicCode) || ['未知', 'circle-help'];
  return { code: publicCode, label, icon };
}

function weatherCacheKey(location) {
  const latitude = finiteNumber(location?.latitude);
  const longitude = finiteNumber(location?.longitude);
  const timezone = cleanText(location?.timezone) || 'unknown';
  const latKey = latitude == null ? 'unknown' : Number(latitude.toFixed(5)).toString();
  const lonKey = longitude == null ? 'unknown' : Number(longitude.toFixed(5)).toString();
  return `weather:${latKey},${lonKey}:${timezone}`;
}

function locationIdFor(result, normalized) {
  const apiId = cleanText(result?.id);
  const parts = [
    ...(apiId ? [apiId] : []),
    normalized.name,
    normalized.admin1,
    normalized.countryCode,
    normalized.country,
    String(normalized.latitude),
    String(normalized.longitude),
    normalized.timezone,
  ];
  return `location:${parts.join('|')}`;
}

function normalizeLocationResults(payload) {
  return (Array.isArray(payload?.results) ? payload.results : [])
    .map((result) => {
      const latitude = finiteNumber(result?.latitude);
      const longitude = finiteNumber(result?.longitude);
      const timezone = cleanText(result?.timezone);
      if (latitude == null || longitude == null || !timezone) return null;

      const name = cleanText(result?.name);
      const admin1 = cleanText(result?.admin1);
      const country = cleanText(result?.country);
      const countryCode = cleanText(result?.country_code);
      const label = [name, admin1, country].filter(Boolean).join('，');
      const normalized = {
        name,
        admin1,
        country,
        countryCode,
        label,
        latitude,
        longitude,
        timezone,
      };
      return {
        id: locationIdFor(result, normalized),
        ...normalized,
      };
    })
    .filter(Boolean);
}

function arrayAt(source, key, index) {
  const values = source?.[key];
  return Array.isArray(values) && index >= 0 && index < values.length ? values[index] : undefined;
}

function validDateParts(year, month, day) {
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= monthDays[month - 1];
}

function validLocalDate(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return false;
  return validDateParts(Number(match[1]), Number(match[2]), Number(match[3]));
}

function validLocalDateTime(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return false;
  const hours = Number(match[4]);
  const minutes = Number(match[5]);
  const seconds = match[6] == null ? 0 : Number(match[6]);
  return validDateParts(Number(match[1]), Number(match[2]), Number(match[3]))
    && hours < 24
    && minutes < 60
    && seconds < 60;
}

function rowsFromSeries(series, timeKey = 'time', timeType = 'datetime') {
  const times = Array.isArray(series?.[timeKey]) ? series[timeKey] : [];
  const isValid = timeType === 'date' ? validLocalDate : validLocalDateTime;
  return times
    .map((time, index) => (typeof time === 'string' ? { time: time.trim(), index } : null))
    .filter((row) => row && isValid(row.time));
}

function firstIndexAtOrAfter(series, now) {
  return rowsFromSeries(series).find((row) => row.time >= now)?.index ?? -1;
}

function firstHourlyIndexAfter(hourly, now) {
  return rowsFromSeries(hourly).find((row) => row.time > now)?.index ?? -1;
}

function aqiLevel(value) {
  const number = finiteNumber(value);
  if (number == null) return '未知';
  if (number <= 50) return '优';
  if (number <= 100) return '良';
  if (number <= 150) return '轻度污染';
  if (number <= 200) return '中度污染';
  if (number <= 300) return '重度污染';
  return '严重污染';
}

function uvLevel(value) {
  const number = finiteNumber(value);
  if (number == null) return '未知';
  if (number < 3) return '低';
  if (number < 6) return '中等';
  if (number < 8) return '高';
  if (number < 11) return '很高';
  return '极高';
}

function windDirectionLabel(degrees) {
  const number = finiteNumber(degrees);
  if (number == null) return '未知';
  const labels = ['北风', '东北风', '东风', '东南风', '南风', '西南风', '西风', '西北风'];
  const index = Math.round((((number % 360) + 360) % 360) / 45) % 8;
  return labels[index];
}

function airQualityValue(airQuality, now) {
  const hourly = airQuality?.hourly;
  const index = firstIndexAtOrAfter(hourly, now);
  if (index < 0) return { value: null, pm25: null };
  const value = finiteNumber(arrayAt(hourly, 'us_aqi', index) ?? arrayAt(hourly, 'european_aqi', index));
  return { value, pm25: finiteNumber(arrayAt(hourly, 'pm2_5', index)) };
}

function normalizeWeatherSnapshot({ location, forecast, airQuality, now } = {}) {
  const timezone = cleanText(forecast?.timezone) || cleanText(location?.timezone);
  const currentTime = cleanText(now) || cleanText(forecast?.current?.time);
  const hourly = forecast?.hourly || {};
  const daily = forecast?.daily || {};
  const currentHourIndex = firstIndexAtOrAfter(hourly, currentTime);
  const currentPrecipitationProbability = currentHourIndex < 0
    ? null
    : finiteNumber(arrayAt(hourly, 'precipitation_probability', currentHourIndex));
  const currentUv = currentHourIndex < 0 ? null : finiteNumber(arrayAt(hourly, 'uv_index', currentHourIndex));
  const aqi = airQualityValue(airQuality, currentTime);

  const hourlyStart = firstHourlyIndexAfter(hourly, currentTime);
  const hourlyRows = hourlyStart < 0 ? [] : rowsFromSeries(hourly)
    .filter((row) => row.index >= hourlyStart)
    .slice(0, 12)
    .map(({ time, index }) => ({
      time,
      temperature: measurement(arrayAt(hourly, 'temperature_2m', index), '°C'),
      feelsLike: measurement(arrayAt(hourly, 'apparent_temperature', index), '°C'),
      precipitationProbability: percentage(arrayAt(hourly, 'precipitation_probability', index)),
      weather: weatherCodeMeta(arrayAt(hourly, 'weather_code', index)),
      windSpeed: measurement(arrayAt(hourly, 'wind_speed_10m', index), ' km/h'),
      uv: {
        value: finiteNumber(arrayAt(hourly, 'uv_index', index)),
        label: formatNumber(finiteNumber(arrayAt(hourly, 'uv_index', index))),
        level: uvLevel(arrayAt(hourly, 'uv_index', index)),
      },
    }));

  const today = currentTime.slice(0, 10);
  const dailyRows = rowsFromSeries(daily, 'time', 'date')
    .filter((row) => row.time >= today)
    .slice(0, 7)
    .map(({ time, index }) => ({
      date: time,
      weather: weatherCodeMeta(arrayAt(daily, 'weather_code', index)),
      temperatureMax: measurement(arrayAt(daily, 'temperature_2m_max', index), '°C'),
      temperatureMin: measurement(arrayAt(daily, 'temperature_2m_min', index), '°C'),
      precipitationProbability: percentage(arrayAt(daily, 'precipitation_probability_max', index)),
      uvMax: {
        value: finiteNumber(arrayAt(daily, 'uv_index_max', index)),
        label: formatNumber(finiteNumber(arrayAt(daily, 'uv_index_max', index))),
        level: uvLevel(arrayAt(daily, 'uv_index_max', index)),
      },
    }));

  return {
    location: location ? normalizeLocationResults({ results: [location] })[0] || null : null,
    timezone,
    current: {
      time: currentTime,
      temperature: measurement(forecast?.current?.temperature_2m, '°C'),
      feelsLike: measurement(forecast?.current?.apparent_temperature, '°C'),
      humidity: percentage(forecast?.current?.relative_humidity_2m),
      precipitation: measurement(forecast?.current?.precipitation, ' mm'),
      precipitationProbability: percentage(currentPrecipitationProbability),
      weather: weatherCodeMeta(forecast?.current?.weather_code),
      wind: {
        speed: finiteNumber(forecast?.current?.wind_speed_10m),
        speedLabel: measurement(forecast?.current?.wind_speed_10m, ' km/h').label,
        direction: finiteNumber(forecast?.current?.wind_direction_10m),
        directionLabel: windDirectionLabel(forecast?.current?.wind_direction_10m),
      },
      uv: {
        value: currentUv,
        label: formatNumber(currentUv),
        level: uvLevel(currentUv),
      },
      aqi: {
        value: aqi.value,
        label: aqi.value == null ? '—' : String(Math.round(aqi.value)),
        level: aqiLevel(aqi.value),
        pm25: measurement(aqi.pm25, ' μg/m³'),
      },
    },
    hourly: hourlyRows,
    daily: dailyRows,
  };
}

module.exports = {
  normalizeLocationResults,
  normalizeWeatherSnapshot,
  weatherCodeMeta,
  weatherCacheKey,
};
