import { filterDay, getDaytimeData, summarize } from './openmeteo.js';
import { BEACHES } from './beaches.js';

const TG_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

// ─── ENVIO ───────────────────────────────────────────────────────────────────

export async function sendMessage(chatId, text, options = {}) {
  const res = await fetch(`${TG_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, ...options })
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Telegram sendMessage error: ${JSON.stringify(err)}`);
  }
  return res.json();
}

/**
 * Envia alerta agendado para um subscriber.
 * type: 'morning' → previsão de HOJE (06h)
 * type: 'evening' → previsão de AMANHÃ (19h)
 */
export async function sendScheduledAlert(subscriber, allBeachData, type = 'morning') {
  const { chatId, beaches: beachIds, firstName } = subscriber;

  const isMorning = type === 'morning';
  const daysOffset = isMorning ? 0 : 1;

  const refDate = new Date();
  refDate.setDate(refDate.getDate() + daysOffset);
  const dateLabel = refDate.toLocaleDateString('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long',
    timeZone: 'America/Sao_Paulo'
  });

  let header = isMorning
    ? `🌅 *Bom dia, ${firstName || 'surfista'}!*\n`
    : `🌙 *Boa noite, ${firstName || 'surfista'}!*\n`;

  header += isMorning
    ? `📅 Previsão de *hoje* — ${dateLabel}\n`
    : `📅 Previsão de *amanhã* — ${dateLabel}\n`;

  header += `━━━━━━━━━━━━━━━━\n`;

  await sendMessage(chatId, header, { parse_mode: 'Markdown' });

  for (const beachId of beachIds) {
    const beach = BEACHES.find(b => b.id === beachId);
    const data = allBeachData[beachId];
    if (!beach || !data) continue;

    try {
      const msg = formatDayForecast(beach, data, daysOffset);
      await sendMessage(chatId, msg, { parse_mode: 'Markdown' });
      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      console.error(`Erro ao formatar ${beach.name}:`, err.message);
    }
  }

  for (const beachId of beachIds) {
    const beach = BEACHES.find(b => b.id === beachId);
    const data = allBeachData[beachId];
    if (!beach || !data) continue;

    try {
      const msg = formatWeekSummary(beach, data);
      await sendMessage(chatId, msg, { parse_mode: 'Markdown' });
      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      console.error(`Erro ao formatar semana de ${beach.name}:`, err.message);
    }
  }

  await sendMessage(chatId,
    `━━━━━━━━━━━━━━━━\n/previsao — ver previsão de hoje\n/semana — ver previsão da semana\n/praias — alterar praias monitoradas`,
    { parse_mode: 'Markdown' }
  );
}

// ─── FORMATAÇÃO ──────────────────────────────────────────────────────────────

/**
 * Formata previsão de um dia para uma praia.
 * Detecta janela ótima e reporta ela se existir.
 * daysOffset: 0 = hoje, 1 = amanhã
 */
export function formatDayForecast(beach, data, daysOffset = 0) {
  const dayData = filterDay(data, daysOffset);
  const daytimeData = getDaytimeData(dayData);
  const sourceData = daytimeData.length ? daytimeData : dayData;

  if (!sourceData.length) return `❌ Sem dados para ${beach.name}`;

  const window = findBestWindow(sourceData, beach);
  const summary = summarize(sourceData);

  const rating = window ? window.rating : getRating(summary, beach);

  let msg;
  if (window) {
    msg = `${rating.emoji} *${beach.name}* — ${rating.label} das ${window.startLabel} às ${window.endLabel}\n`;
  } else {
    msg = `${rating.emoji} *${beach.name}* — ${rating.label}\n`;
  }
  msg += `📍 ${beach.zone}\n`;

  if (window) {
    msg += `_${describeWindow(window, sourceData, beach)}_\n\n`;
  } else {
    const description = getRatingDescription(summary, beach);
    if (description) msg += `_${description}_\n\n`;
  }

  // Dia ruim sem janela — mensagem curta
  if (!window && rating.label !== 'Excelente' && rating.label !== 'Bom') {
    msg += `🌊 Ondas ${fmt(summary.waveHeight.avg)}m · ⏱ ${fmt(summary.wavePeriod.avg)}s\n`;
    msg += `💨 Vento ${fmt(summary.windSpeed.avg)} km/h ${degreesToDir(summary.windDirection)}\n`;
    return msg;
  }

  // Dia bom — detalhamento (da janela se existe, senão do dia)
  const detailSource = window ? window.samples : sourceData;
  const detail = summarize(detailSource);

  msg += `🌊 *Ondas*\n`;
  msg += `   Altura: ${fmt(detail.waveHeight.avg)}m _(pico ${fmt(detail.waveHeight.max)}m)_\n`;
  msg += `   Período: ${fmt(detail.wavePeriod.avg)}s\n`;
  msg += `   Direção: ${degreesToDir(detail.waveDirection)}\n\n`;

  msg += `🌐 *Swell*\n`;
  msg += `   Altura: ${fmt(detail.swellHeight.avg)}m\n`;
  msg += `   Período: ${fmt(detail.swellPeriod.avg)}s\n`;
  msg += `   Direção: ${degreesToDir(detail.swellDirection)}`;

  if (detail.swellDirection !== null && beach?.facing) {
    const facingDeg = dirToDegs(beach.facing);
    if (facingDeg !== null) {
      let diff = Math.abs(detail.swellDirection - facingDeg);
      if (diff > 180) diff = 360 - diff;
      const alignLabel = diff <= 22.5 ? '🎯 direto'
        : diff <= 45  ? '↗ oblíquo'
        : diff <= 90  ? '↔ paralelo'
        : '↙ de costas';
      msg += ` _(${alignLabel})_`;
    }
  }
  msg += '\n\n';

  msg += `💨 *Vento*\n`;
  msg += `   Média: ${fmt(detail.windSpeed.avg)} km/h\n`;
  msg += `   Rajadas: até ${fmt(detail.windGusts.max)} km/h\n`;
  msg += `   Direção: ${degreesToDir(detail.windDirection)}\n\n`;

  msg += `☁️ *Tempo*\n`;
  msg += `   Chuva: ${fmt(detail.precipitation)} mm\n`;
  msg += `   Nuvens: ${fmt(detail.cloudCover)}%\n`;
  msg += `   Temp. ar: ${fmt(detail.airTemp)}°C\n`;
  msg += `   Temp. água: ${fmt(detail.seaTemp)}°C\n`;

  return msg;
}

/**
 * Formata previsão da semana (7 dias) para uma praia.
 * Usa média do dia — visão geral, sem janelas.
 */
export function formatWeekSummary(beach, data) {
  const today = new Date();
  let msg = `📅 *${beach.name} — Previsão da Semana*\n`;
  msg += `📍 ${beach.zone}\n`;
  msg += `━━━━━━━━━━━━━━━━\n\n`;

  for (let i = 0; i < 7; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);

    const dayData = filterDay(data, i);
    const daytime = getDaytimeData(dayData);
    const summary = summarize(daytime.length ? daytime : dayData);

    const label = i === 0 ? 'Hoje' : i === 1 ? 'Amanhã' : date.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric' });
    const rating = summary ? getRating(summary, beach) : { emoji: '❓', label: 'Sem dados' };

    msg += `*${label}* ${rating.emoji} ${rating.label}\n`;

    if (summary) {
      msg += `   🌊 ${fmt(summary.waveHeight.avg)}m · ⏱ ${fmt(summary.wavePeriod.avg)}s · 💨 ${fmt(summary.windSpeed.avg)}km/h ${degreesToDir(summary.windDirection)}\n`;
      if (summary.precipitation > 0.5) {
        msg += `   🌧 Chuva: ${fmt(summary.precipitation)} mm\n`;
      }
    }
    msg += '\n';
  }

  return msg;
}

// ─── JANELAS HORÁRIAS ────────────────────────────────────────────────────────

/**
 * Procura a melhor janela contígua do dia (sequência >= 2h com rating >= Bom).
 * Retorna null se não encontrar.
 */
function findBestWindow(hourlySamples, beach) {
  const MIN_HOURS = 2;

  const rated = hourlySamples.map(h => ({
    sample: h,
    rating: rateHour(h, beach),
    hour: new Date(h.time).getHours(),
  }));

  const sequences = [];
  let current = [];

  for (const r of rated) {
    const isGood = r.rating.label === 'Excelente' || r.rating.label === 'Bom';
    if (isGood) {
      current.push(r);
    } else {
      if (current.length >= MIN_HOURS) sequences.push(current);
      current = [];
    }
  }
  if (current.length >= MIN_HOURS) sequences.push(current);

  if (!sequences.length) return null;

  // Pega a sequência com maior score médio
  const best = sequences.sort((a, b) => {
    const avgA = a.reduce((s, x) => s + x.rating.score, 0) / a.length;
    const avgB = b.reduce((s, x) => s + x.rating.score, 0) / b.length;
    return avgB - avgA;
  })[0];

  // Rating da janela = pior hora da janela (conservador)
  const worstRating = best.reduce((w, r) =>
    r.rating.score < w.rating.score ? r : w
  ).rating;

  const startHour = best[0].hour;
  const endHour = best[best.length - 1].hour + 1;

  return {
    samples: best.map(r => r.sample),
    rating: worstRating,
    startLabel: `${startHour}h`,
    endLabel: `${endHour}h`,
    startHour,
    endHour,
  };
}

/**
 * Descreve janela de forma fluida: tamanho, período, vento e o que muda depois.
 */
function describeWindow(window, allSamples, beach) {
  const { endHour, samples } = window;

  const avgWave = samples.reduce((s, x) => s + (x.waveHeight || 0), 0) / samples.length;
  const avgPeriod = samples.reduce((s, x) => s + (x.wavePeriod || 0), 0) / samples.length;
  const avgWind = samples.reduce((s, x) => s + (x.windSpeed || 0), 0) / samples.length;
  const windDir = samples[0].windDirection;

  const windType = classifyWind(avgWind, windDir, beach?.facing);

  let desc = `Ondas de ${fmt(avgWave)}m com período de ${fmt(avgPeriod)}s`;
  if (windType.label === 'offshore') desc += ` e vento offshore ${windType.intensity} (${fmt(avgWind)} km/h)`;
  else if (windType.label === 'lateral') desc += ` e vento lateral fraco`;
  else if (windType.label === 'sem_vento') desc += ` e sem vento`;
  else desc += ` e pouco vento`;
  desc += `. `;

  // O que muda depois
  const afterSamples = allSamples.filter(s => new Date(s.time).getHours() >= endHour);
  if (afterSamples.length >= 2) {
    const avgWindAfter = afterSamples.reduce((s, x) => s + (x.windSpeed || 0), 0) / afterSamples.length;
    const dirAfter = afterSamples[Math.floor(afterSamples.length / 2)].windDirection;
    const windAfter = classifyWind(avgWindAfter, dirAfter, beach?.facing);

    if (windAfter.label === 'onshore' && (windAfter.intensity === 'moderado' || windAfter.intensity === 'forte' || windAfter.intensity === 'violento')) {
      desc += `Vento vira onshore a partir das ${endHour}h e o mar piora.`;
    } else if (avgWindAfter > avgWind + 8) {
      desc += `Vento reforça após ${endHour}h.`;
    }
  }

  return desc;
}

// ─── RATING ──────────────────────────────────────────────────────────────────

/**
 * Rating de uma amostra horária única (sem summary agregado).
 */
function rateHour(h, beach) {
  return computeRating({
    waveH: h.waveHeight || 0,
    period: h.wavePeriod || 0,
    wind: h.windSpeed || 0,
    windDir: h.windDirection ?? null,
    rain: h.precipitation || 0,
    swellDir: h.swellDirection ?? null,
    swellPeriod: h.swellPeriod || h.wavePeriod || 0,
  }, beach);
}

/**
 * Rating agregado (usado por /semana e fallback do dia sem janela).
 */
export function getRating(summary, beach = null) {
  return computeRating({
    waveH: summary.waveHeight?.avg || 0,
    period: summary.wavePeriod?.avg || 0,
    wind: summary.windSpeed?.avg || 0,
    windDir: summary.windDirection ?? null,
    rain: summary.precipitation || 0,
    swellDir: summary.swellDirection ?? null,
    swellPeriod: summary.swellPeriod?.avg || summary.wavePeriod?.avg || 0,
  }, beach);
}

/**
 * Motor central — modelo multiplicativo:
 *   scoreMar = alturaScore(praia) + alinhamentoSwell
 *   scoreFinal = scoreMar × periodoMult × ventoMult − chuvaPenalty
 */
function computeRating({ waveH, period, wind, windDir, rain, swellDir, swellPeriod }, beach) {
  const heightScore = waveHeightScore(waveH, beach);
  const alignScore = swellAlignmentScore(swellDir, beach?.facing, swellPeriod);
  const scoreBase = heightScore + alignScore;

  const periodMult = periodMultiplier(period);
  const windMult = windMultiplier(wind, windDir, beach?.facing);

  let chuvaPenalty = 0;
  if (rain > 10) chuvaPenalty = 1;
  else if (rain > 5) chuvaPenalty = 0.5;

  const score = (scoreBase * periodMult * windMult) - chuvaPenalty;

  if (score >= 5.5) return { emoji: '🔥', label: 'Excelente', score };
  if (score >= 3.8) return { emoji: '✅', label: 'Bom',       score };
  if (score >= 2.3) return { emoji: '😐', label: 'Regular',   score };
  if (score >= 1.0) return { emoji: '😞', label: 'Fraco',     score };
  return                   { emoji: '⛔', label: 'Péssimo',   score };
}

/**
 * Score de altura praia-específico, usando idealRange [min, magicMin, magicMax, danger].
 */
function waveHeightScore(waveH, beach) {
  const range = beach?.idealRange || [0.5, 0.8, 2.0, 3.0];
  const [min, magicMin, magicMax, danger] = range;

  if (waveH < min) return 0;
  if (waveH < magicMin) return 3 * (waveH - min) / (magicMin - min);
  if (waveH <= magicMax) return 3;
  if (waveH <= danger) return 3 - 2 * (waveH - magicMax) / (danger - magicMax);
  return -1;
}

/**
 * Multiplicador de período.
 */
function periodMultiplier(period) {
  if (period >= 14) return 1.3;
  if (period >= 12) return 1.15;
  if (period >= 10) return 1.0;
  if (period >= 8)  return 0.85;
  if (period >= 6)  return 0.6;
  return 0.4;
}

/**
 * Multiplicador de vento.
 */
function windMultiplier(wind, windDir, facing) {
  const w = classifyWind(wind, windDir, facing);

  if (w.label === 'offshore') {
    if (w.intensity === 'leve')     return 1.2;
    if (w.intensity === 'moderado') return 1.1;
    if (w.intensity === 'forte')    return 1.0;
    return 0.9;
  }

  if (w.label === 'sem_vento') return 1.0;

  if (w.label === 'lateral') {
    if (w.intensity === 'fraco')    return 0.9;
    if (w.intensity === 'moderado') return 0.75;
    return 0.5;
  }

  // onshore
  if (w.intensity === 'fraco')    return 0.7;
  if (w.intensity === 'moderado') return 0.45;
  if (w.intensity === 'forte')    return 0.25;
  return 0.1; // violento
}

/**
 * Classifica vento: direção (offshore/onshore/lateral) e intensidade.
 */
function classifyWind(wind, windDir, facing) {
  if (wind < 3) return { label: 'sem_vento', intensity: null };

  const facingDeg = facing ? dirToDegs(facing) : null;

  if (windDir === null || facingDeg === null) {
    if (wind < 10) return { label: 'lateral', intensity: 'fraco' };
    if (wind < 20) return { label: 'lateral', intensity: 'moderado' };
    return { label: 'lateral', intensity: 'forte' };
  }

  let diff = Math.abs(windDir - facingDeg);
  if (diff > 180) diff = 360 - diff;

  let label;
  if (diff >= 135) label = 'offshore';
  else if (diff <= 45) label = 'onshore';
  else label = 'lateral';

  let intensity;
  if (wind < 10) intensity = 'leve';
  else if (wind < 20) intensity = 'moderado';
  else if (wind < 30) intensity = 'forte';
  else intensity = 'violento';

  if (label !== 'offshore' && intensity === 'leve') intensity = 'fraco';

  return { label, intensity };
}

/**
 * Score de alinhamento entre swell e orientação da praia.
 */
function swellAlignmentScore(swellDir, facing, swellPeriod = 0) {
  if (swellDir === null || swellDir === undefined) return 1;
  if (!facing) return 1;

  const facingDeg = dirToDegs(facing);
  if (facingDeg === null) return 1;

  let diff = Math.abs(swellDir - facingDeg);
  if (diff > 180) diff = 360 - diff;

  let baseScore;
  if (diff <= 22.5)       baseScore = 3;
  else if (diff <= 45)    baseScore = 2;
  else if (diff <= 67.5)  baseScore = 1;
  else if (diff <= 90)    baseScore = 0;
  else                    baseScore = -1;

  if (baseScore === 3 && swellPeriod < 12) baseScore = 2;

  return baseScore;
}

/**
 * Descrição narrativa (usada quando não tem janela — dia ruim ou dia todo bom).
 */
export function getRatingDescription(summary, beach = null) {
  const waveH = summary.waveHeight?.avg || 0;
  const period = summary.wavePeriod?.avg || 0;
  const wind = summary.windSpeed?.avg || 0;
  const windDir = summary.windDirection ?? null;
  const rain = summary.precipitation || 0;
  const swellDir = summary.swellDirection ?? null;

  const parts = [];

  if (beach?.idealRange) {
    const [min, magicMin, magicMax, danger] = beach.idealRange;
    if (waveH < min)          parts.push(`Mar muito pequeno pra ${beach.name} (${fmt(waveH)}m)`);
    else if (waveH < magicMin) parts.push(`Ondas menores que o ideal (${fmt(waveH)}m)`);
    else if (waveH <= magicMax) parts.push(`Ondas em tamanho ideal (${fmt(waveH)}m)`);
    else if (waveH <= danger)   parts.push(`Mar grande (${fmt(waveH)}m) — pra surfistas experientes`);
    else                        parts.push(`Mar muito grande (${fmt(waveH)}m) — perigoso`);
  } else {
    parts.push(`Ondas de ${fmt(waveH)}m`);
  }

  if (period >= 14)      parts.push(`período longo (${fmt(period)}s) traz potência`);
  else if (period >= 12) parts.push(`período de ${fmt(period)}s garante ondas organizadas`);
  else if (period >= 10) parts.push(`período moderado (${fmt(period)}s)`);
  else if (period >= 8)  parts.push(`período curto (${fmt(period)}s) — onda fraca`);
  else                   parts.push(`período muito curto (${fmt(period)}s) — marola`);

  if (swellDir !== null && beach?.facing) {
    const facingDeg = dirToDegs(beach.facing);
    if (facingDeg !== null) {
      let diff = Math.abs(swellDir - facingDeg);
      if (diff > 180) diff = 360 - diff;
      const swellLabel = degreesToDir(swellDir);
      if (diff <= 22.5)      parts.push(`swell ${swellLabel} direto na praia`);
      else if (diff <= 45)   parts.push(`swell ${swellLabel} em ângulo favorável`);
      else if (diff <= 90)   parts.push(`swell ${swellLabel} chegando de lado`);
      else                   parts.push(`swell ${swellLabel} desfavorável`);
    }
  }

  const w = classifyWind(wind, windDir, beach?.facing);
  if (w.label === 'sem_vento') {
    parts.push(`sem vento`);
  } else if (w.label === 'offshore') {
    if (w.intensity === 'leve')     parts.push(`vento offshore leve (${fmt(wind)} km/h) — condições perfeitas`);
    else if (w.intensity === 'moderado') parts.push(`vento offshore (${fmt(wind)} km/h) favorece`);
    else parts.push(`vento offshore forte (${fmt(wind)} km/h)`);
  } else if (w.label === 'onshore') {
    if (w.intensity === 'fraco')    parts.push(`vento onshore fraco (${fmt(wind)} km/h)`);
    else if (w.intensity === 'moderado') parts.push(`vento onshore (${fmt(wind)} km/h) atrapalha`);
    else if (w.intensity === 'forte') parts.push(`vento onshore forte (${fmt(wind)} km/h) prejudica as condições`);
    else parts.push(`vento onshore violento (${fmt(wind)} km/h) destrói as ondas`);
  } else {
    if (w.intensity === 'fraco') parts.push(`vento lateral fraco (${fmt(wind)} km/h)`);
    else parts.push(`vento lateral de ${fmt(wind)} km/h`);
  }

  if (rain > 10)     parts.push(`chuva intensa (${fmt(rain)} mm)`);
  else if (rain > 5) parts.push(`chuva moderada (${fmt(rain)} mm)`);
  else if (rain > 1) parts.push(`chuva fraca (${fmt(rain)} mm)`);

  if (parts.length === 0) return '';
  const [first, ...rest] = parts;
  return first.charAt(0).toUpperCase() + first.slice(1)
    + (rest.length ? ', ' + rest.join(', ') : '') + '.';
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function fmt(value, decimals = 1) {
  if (value === null || value === undefined || isNaN(value)) return '—';
  return Number(value).toFixed(decimals);
}

function degreesToDir(degrees) {
  if (degrees === null || degrees === undefined) return '—';
  const dirs = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'];
  const index = Math.round(degrees / 45) % 8;
  return dirs[index];
}

function dirToDegs(dir) {
  const map = { N: 0, NE: 45, L: 90, SE: 135, S: 180, SO: 225, O: 270, NO: 315 };
  return map[dir] ?? null;
}
