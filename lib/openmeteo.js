import { BEACHES } from './beaches.js';

const BASE_URL = 'https://marine-api.open-meteo.com/v1/marine';
const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast';

/**
 * Variáveis marítimas que queremos da API Marine
 */
const MARINE_VARS = [
  'wave_height',           // altura total das ondas (m)
  'wave_direction',        // direção das ondas (°)
  'wave_period',           // período das ondas (s)
  'swell_wave_height',     // altura do swell (m)
  'swell_wave_direction',  // direção do swell (°)
  'swell_wave_period',     // período do swell (s)
  'sea_surface_temperature', // temperatura da água (°C)
  'sea_level_height',      // nível do mar incluindo maré (m acima da média global)
].join(',');

/**
 * Variáveis atmosféricas da API Weather
 */
const WEATHER_VARS = [
  'wind_speed_10m',        // vento em km/h
  'wind_direction_10m',    // direção do vento (°)
  'wind_gusts_10m',        // rajadas (km/h)
  'precipitation',         // chuva (mm)
  'cloud_cover',           // nuvens (%)
  'temperature_2m',        // temperatura do ar (°C)
].join(',');

/**
 * Busca dados de uma praia específica
 */
export async function fetchBeach(beach) {
  const marineUrl = `${BASE_URL}?latitude=${beach.lat}&longitude=${beach.lon}&hourly=${MARINE_VARS}&timezone=America/Sao_Paulo&forecast_days=7`;
  const weatherUrl = `${WEATHER_URL}?latitude=${beach.lat}&longitude=${beach.lon}&hourly=${WEATHER_VARS}&timezone=America/Sao_Paulo&forecast_days=7`;

  const [marineRes, weatherRes] = await Promise.all([
    fetch(marineUrl),
    fetch(weatherUrl)
  ]);

  if (!weatherRes.ok) {
    throw new Error(`Erro ao buscar dados para ${beach.name}`);
  }

  // Se a API marine falhar (ex: sea_level_height indisponível na região),
  // tenta de novo sem a variável de maré
  let marine;
  if (marineRes.ok) {
    marine = await marineRes.json();
  } else {
    const MARINE_VARS_FALLBACK = MARINE_VARS.split(',').filter(v => v !== 'sea_level_height').join(',');
    const fallbackRes = await fetch(`${BASE_URL}?latitude=${beach.lat}&longitude=${beach.lon}&hourly=${MARINE_VARS_FALLBACK}&timezone=America/Sao_Paulo&forecast_days=7`);
    if (!fallbackRes.ok) throw new Error(`Erro ao buscar dados para ${beach.name}`);
    marine = await fallbackRes.json();
    console.warn(`sea_level_height indisponível para ${beach.name}, usando fallback sem maré`);
  }

  const weather = await weatherRes.json();

  return mergeData(marine, weather);
}

/**
 * Busca dados de todas as praias em paralelo (com limite para não sobrecarregar)
 */
export async function fetchAllBeaches() {
  const results = {};

  // Busca em lotes de 3 para respeitar rate limits
  for (let i = 0; i < BEACHES.length; i += 3) {
    const batch = BEACHES.slice(i, i + 3);
    const batchResults = await Promise.all(
      batch.map(async beach => {
        try {
          const data = await fetchBeach(beach);
          return [beach.id, data];
        } catch (err) {
          console.error(`Erro ao buscar ${beach.name}:`, err.message);
          return [beach.id, null];
        }
      })
    );
    batchResults.forEach(([id, data]) => { results[id] = data; });

    // Delay entre lotes
    if (i + 3 < BEACHES.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  return results;
}

/**
 * Combina dados marine + weather por timestamp
 */
function mergeData(marine, weather) {
  const times = marine.hourly.time;

  return times.map((time, i) => ({
    time,
    // Dados marítimos
    waveHeight: marine.hourly.wave_height[i],
    waveDirection: marine.hourly.wave_direction[i],
    wavePeriod: marine.hourly.wave_period[i],
    swellHeight: marine.hourly.swell_wave_height[i],
    swellDirection: marine.hourly.swell_wave_direction[i],
    swellPeriod: marine.hourly.swell_wave_period[i],
    seaTemp: marine.hourly.sea_surface_temperature[i],
    tideHeight: marine.hourly.sea_level_height?.[i] ?? null,
    // Dados atmosféricos
    windSpeed: weather.hourly.wind_speed_10m[i],
    windDirection: weather.hourly.wind_direction_10m[i],
    windGusts: weather.hourly.wind_gusts_10m[i],
    precipitation: weather.hourly.precipitation[i],
    cloudCover: weather.hourly.cloud_cover[i],
    airTemp: weather.hourly.temperature_2m[i],
  }));
}

/**
 * Filtra dados de um dia específico (padrão: hoje)
 */
export function filterDay(data, daysOffset = 0) {
  const target = new Date();
  target.setDate(target.getDate() + daysOffset);
  const dateStr = target.toISOString().split('T')[0];

  return data.filter(d => d.time.startsWith(dateStr));
}

/**
 * Calcula médias e picos de um conjunto de dados horárias
 */
export function summarize(hourlyData) {
  if (!hourlyData.length) return null;

  const avg = key => {
    const vals = hourlyData.map(d => d[key]).filter(v => v !== null && v !== undefined);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };

  const max = key => {
    const vals = hourlyData.map(d => d[key]).filter(v => v !== null && v !== undefined);
    return vals.length ? Math.max(...vals) : null;
  };

  // Direção mais comum (moda)
  const modeDirection = key => {
    const vals = hourlyData.map(d => d[key]).filter(v => v !== null);
    if (!vals.length) return null;
    const rounded = vals.map(v => Math.round(v / 45) * 45); // agrupa em octantes
    const freq = {};
    rounded.forEach(v => { freq[v] = (freq[v] || 0) + 1; });
    return parseInt(Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0]);
  };

  return {
    waveHeight: { avg: avg('waveHeight'), max: max('waveHeight') },
    wavePeriod: { avg: avg('wavePeriod') },
    swellHeight: { avg: avg('swellHeight'), max: max('swellHeight') },
    swellPeriod: { avg: avg('swellPeriod') },
    swellDirection: modeDirection('swellDirection'),
    waveDirection: modeDirection('waveDirection'),
    windSpeed: { avg: avg('windSpeed'), max: max('windSpeed') },
    windGusts: { max: max('windGusts') },
    windDirection: modeDirection('windDirection'),
    precipitation: avg('precipitation'),
    seaTemp: avg('seaTemp'),
    airTemp: avg('airTemp'),
    cloudCover: avg('cloudCover'),
  };
}

/**
 * Retorna dados horários de pico do dia (6h às 18h)
 */
export function getDaytimeData(dayData) {
  return dayData.filter(d => {
    const hour = parseInt(d.time.split('T')[1]?.split(':')[0] || 0);
    return hour >= 6 && hour <= 18;
  });
}

/**
 * Detecta altas e baixas-mar a partir dos dados horários de tideHeight.
 * Recebe o array já filtrado por dia (saída de filterDay).
 * Retorna ex: [{ time: '06:20', height: '0.1', type: 'baixa' }, ...]
 */
export function getTideExtremes(dayData) {
  const valid = dayData.filter(d => d.tideHeight !== null);
  if (valid.length < 3) return [];

  const extremes = [];

  for (let i = 1; i < valid.length - 1; i++) {
    const prev = valid[i - 1].tideHeight;
    const curr = valid[i].tideHeight;
    const next = valid[i + 1].tideHeight;

    const isHigh = curr > prev && curr > next;
    const isLow  = curr < prev && curr < next;

    if (isHigh || isLow) {
      extremes.push({
        time: valid[i].time.slice(11, 16), // "HH:MM"
        height: curr.toFixed(1),
        type: isHigh ? 'alta' : 'baixa',
      });
    }
  }

  return extremes;
}
