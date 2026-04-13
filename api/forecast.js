// api/forecast.js
// Edge runtime — busca dados Open-Meteo para uma praia, exige JWT válido
export const config = { runtime: 'edge' };

import { verifyJWT } from '../lib/jwt.js';

const BEACHES = {
  copacabana:     { lat: -22.9711, lon: -43.1823, name: 'Copacabana',     zone: 'Zona Sul',      facing: 'SE' },
  ipanema:        { lat: -22.9838, lon: -43.2096, name: 'Ipanema',         zone: 'Zona Sul',      facing: 'S'  },
  leblon:         { lat: -22.9874, lon: -43.2248, name: 'Leblon',          zone: 'Zona Sul',      facing: 'S'  },
  sao_conrado:    { lat: -23.0101, lon: -43.2791, name: 'São Conrado',     zone: 'Zona Sul',      facing: 'S'  },
  barra:          { lat: -23.0093, lon: -43.3654, name: 'Barra da Tijuca', zone: 'Zona Oeste',    facing: 'S'  },
  recreio:        { lat: -23.0178, lon: -43.4711, name: 'Recreio',         zone: 'Zona Oeste',    facing: 'SW' },
  macumba:        { lat: -23.0228, lon: -43.5021, name: 'Macumba',         zone: 'Zona Oeste',    facing: 'SW' },
  prainha:        { lat: -23.0367, lon: -43.5178, name: 'Prainha',         zone: 'Zona Oeste',    facing: 'W'  },
  grumari:        { lat: -23.0447, lon: -43.5347, name: 'Grumari',         zone: 'Zona Oeste',    facing: 'W'  },
  joaquina:       { lat: -27.6353, lon: -48.4612, name: 'Joaquina',        zone: 'Floripa',       facing: 'L'  },
  praia_mole:     { lat: -27.6034, lon: -48.4370, name: 'Praia Mole',      zone: 'Floripa',       facing: 'L'  },
  barra_da_lagoa: { lat: -27.5726, lon: -48.4277, name: 'Barra da Lagoa',  zone: 'Floripa',       facing: 'NE' },
  campeche:       { lat: -27.6898, lon: -48.4816, name: 'Campeche',        zone: 'Floripa',       facing: 'SE' },
  itamambuca:     { lat: -23.3544, lon: -44.8321, name: 'Itamambuca',      zone: 'Ubatuba',       facing: 'SE' },
  prumirim:       { lat: -23.3880, lon: -44.8654, name: 'Prumirim',        zone: 'Ubatuba',       facing: 'SE' },
  maresias:       { lat: -23.8019, lon: -45.5564, name: 'Maresias',        zone: 'São Sebastião', facing: 'SE' },
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') return cors();
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  const auth  = req.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return json({ error: 'Não autorizado' }, 401);

  const payload = await verifyJWT(token);
  if (!payload) return json({ error: 'Sessão inválida. Faça login novamente.' }, 401);

  const url     = new URL(req.url);
  const beachId = url.searchParams.get('beach');
  const days    = Math.min(parseInt(url.searchParams.get('days') || '7'), 7);

  if (!beachId || !BEACHES[beachId]) return json({ error: 'Praia inválida' }, 400);

  const userBeaches = payload.beaches || [];
  const isPremium   = payload.isPremium;
  const freeBeach   = userBeaches[0];

  if (!isPremium && beachId !== freeBeach) {
    return json({ error: 'Acesso premium necessário para esta praia.' }, 403);
  }

  const beach = BEACHES[beachId];

  const MARINE_VARS  = 'wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,sea_surface_temperature';
  const WEATHER_VARS = 'wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,cloud_cover,temperature_2m';

  const [marineRes, weatherRes] = await Promise.all([
    fetch(`https://marine-api.open-meteo.com/v1/marine?latitude=${beach.lat}&longitude=${beach.lon}&hourly=${MARINE_VARS}&timezone=America/Sao_Paulo&forecast_days=${days}`),
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${beach.lat}&longitude=${beach.lon}&hourly=${WEATHER_VARS}&timezone=America/Sao_Paulo&forecast_days=${days}`),
  ]);

  if (!marineRes.ok || !weatherRes.ok) return json({ error: 'Erro ao buscar dados.' }, 502);

  const [marine, weather] = await Promise.all([marineRes.json(), weatherRes.json()]);

  const times  = marine.hourly.time;
  const hourly = times.map((time, i) => ({
    time,
    waveHeight: marine.hourly.wave_height[i], waveDirection: marine.hourly.wave_direction[i],
    wavePeriod: marine.hourly.wave_period[i], swellHeight: marine.hourly.swell_wave_height[i],
    swellDirection: marine.hourly.swell_wave_direction[i], swellPeriod: marine.hourly.swell_wave_period[i],
    seaTemp: marine.hourly.sea_surface_temperature[i], windSpeed: weather.hourly.wind_speed_10m[i],
    windDirection: weather.hourly.wind_direction_10m[i], windGusts: weather.hourly.wind_gusts_10m[i],
    precipitation: weather.hourly.precipitation[i], cloudCover: weather.hourly.cloud_cover[i],
    airTemp: weather.hourly.temperature_2m[i],
  }));

  const daily = [];
  const today = new Date();

  for (let d = 0; d < days; d++) {
    const date    = new Date(today);
    date.setDate(today.getDate() + d);
    const dateStr = date.toISOString().split('T')[0];

    const dayHours = hourly.filter(h => {
      if (!h.time.startsWith(dateStr)) return false;
      const hour = parseInt(h.time.split('T')[1]);
      return hour >= 6 && hour <= 18;
    });

    if (!dayHours.length) continue;

    const avg = key => { const v = dayHours.map(h => h[key]).filter(v => v != null); return v.length ? v.reduce((a,b)=>a+b,0)/v.length : null; };
    const max = key => { const v = dayHours.map(h => h[key]).filter(v => v != null); return v.length ? Math.max(...v) : null; };
    const modeDir = key => {
      const v = dayHours.map(h => h[key]).filter(v => v != null);
      if (!v.length) return null;
      const freq = {}; v.map(x => Math.round(x/45)*45).forEach(x => { freq[x]=(freq[x]||0)+1; });
      return parseInt(Object.entries(freq).sort((a,b)=>b[1]-a[1])[0][0]);
    };

    daily.push({
      date: dateStr,
      label: d===0?'Hoje':d===1?'Amanhã':date.toLocaleDateString('pt-BR',{weekday:'short',day:'numeric'}),
      waveHeight: {avg:avg('waveHeight'), max:max('waveHeight')}, wavePeriod: {avg:avg('wavePeriod')},
      waveDirection: modeDir('waveDirection'), swellHeight: {avg:avg('swellHeight')},
      swellPeriod: {avg:avg('swellPeriod')}, swellDirection: modeDir('swellDirection'),
      windSpeed: {avg:avg('windSpeed'), max:max('windSpeed')}, windGusts: {max:max('windGusts')},
      windDirection: modeDir('windDirection'), precipitation: avg('precipitation'),
      cloudCover: avg('cloudCover'), seaTemp: avg('seaTemp'), airTemp: avg('airTemp'),
      hourly: dayHours,
    });
  }

  return json({ beach: { id: beachId, ...beach }, daily });
}

function json(data, status=200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type, Authorization' } });
}
function cors() {
  return new Response(null, { status:204, headers: { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization' } });
}
