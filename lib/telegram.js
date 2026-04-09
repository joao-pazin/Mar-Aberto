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
  const daysOffset = isMorning ? 0 : 1; // hoje ou amanhã

  // Data de referência para o cabeçalho
  const refDate = new Date();
  refDate.setDate(refDate.getDate() + daysOffset);
  const dateLabel = refDate.toLocaleDateString('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long',
    timeZone: 'America/Sao_Paulo'
  });

  // Cabeçalho diferente por turno
  let header = isMorning
    ? `🌅 *Bom dia, ${firstName || 'surfista'}!*\n`
    : `🌙 *Boa noite, ${firstName || 'surfista'}!*\n`;

  header += isMorning
    ? `📅 Previsão de *hoje* — ${dateLabel}\n`
    : `📅 Previsão de *amanhã* — ${dateLabel}\n`;

  header += `━━━━━━━━━━━━━━━━\n`;

  await sendMessage(chatId, header, { parse_mode: 'Markdown' });

  // Uma mensagem por praia selecionada
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

  // Previsão da semana logo abaixo
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

  // Rodapé
  await sendMessage(chatId,
    `━━━━━━━━━━━━━━━━\n/previsao — ver previsão de hoje\n/semana — ver previsão da semana\n/praias — alterar praias monitoradas`,
    { parse_mode: 'Markdown' }
  );
}

// ─── FORMATAÇÃO ──────────────────────────────────────────────────────────────

/**
 * Formata previsão de um dia para uma praia
 * daysOffset: 0 = hoje, 1 = amanhã
 */
export function formatDayForecast(beach, data, daysOffset = 0) {
  const todayData = filterDay(data, daysOffset);
  const daytimeData = getDaytimeData(todayData);
  const summary = summarize(daytimeData.length ? daytimeData : todayData);

  if (!summary) return `❌ Sem dados para ${beach.name}`;

  const rating = getRating(summary, beach);

  let msg = `${rating.emoji} *${beach.name}* ${rating.label}\n`;
  msg += `📍 ${beach.zone}\n\n`;

  // Ondas
  msg += `🌊 *Ondas*\n`;
  msg += `   Altura: ${fmt(summary.waveHeight.avg)}m _(pico ${fmt(summary.waveHeight.max)}m)_\n`;
  msg += `   Período: ${fmt(summary.wavePeriod.avg)}s\n`;
  msg += `   Direção: ${degreesToDir(summary.waveDirection)}\n\n`;

  // Swell
  msg += `🌐 *Swell*\n`;
  msg += `   Altura: ${fmt(summary.swellHeight.avg)}m\n`;
  msg += `   Período: ${fmt(summary.swellPeriod.avg)}s\n`;
  msg += `   Direção: ${degreesToDir(summary.swellDirection)}`;

  // Indica alinhamento com a praia
  if (summary.swellDirection !== null && beach?.facing) {
    const facingMap = { N:0, NE:45, L:90, SE:135, S:180, SO:225, O:270, NO:315 };
    const facingDeg = facingMap[beach.facing] ?? null;
    if (facingDeg !== null) {
      let diff = Math.abs(summary.swellDirection - facingDeg);
      if (diff > 180) diff = 360 - diff;
      const alignLabel = diff <= 22.5 ? '🎯 direto'
        : diff <= 45  ? '↗ oblíquo'
        : diff <= 90  ? '↔ paralelo'
        : '↙ de costas';
      msg += ` _(${alignLabel})_`;
    }
  }
  msg += '\n\n';

  // Vento
  msg += `💨 *Vento*\n`;
  msg += `   Média: ${fmt(summary.windSpeed.avg)} km/h\n`;
  msg += `   Rajadas: até ${fmt(summary.windGusts.max)} km/h\n`;
  msg += `   Direção: ${degreesToDir(summary.windDirection)}\n\n`;

  // Condições gerais
  msg += `☁️ *Tempo*\n`;
  msg += `   Chuva: ${fmt(summary.precipitation)} mm\n`;
  msg += `   Nuvens: ${fmt(summary.cloudCover)}%\n`;
  msg += `   Temp. ar: ${fmt(summary.airTemp)}°C\n`;
  msg += `   Temp. água: ${fmt(summary.seaTemp)}°C\n`;

  return msg;
}

/**
 * Formata previsão da semana para uma praia (resumo por dia)
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

/**
 * Converte direção cardinal (ex: 'S', 'NE') para graus
 */
function dirToDegs(dir) {
  const map = { N: 0, NE: 45, L: 90, SE: 135, S: 180, SO: 225, O: 270, NO: 315 };
  return map[dir] ?? null;
}

/**
 * Calcula o score de alinhamento entre a direção do swell e a orientação da praia.
 * Retorna: -1 (de costas) → 3 (alinhamento perfeito)
 */
function swellAlignmentScore(swellDirectionDeg, beachFacing, swellPeriod = 0) {
  if (swellDirectionDeg === null || swellDirectionDeg === undefined) return 1;
  if (!beachFacing) return 1;

  const facingDeg = dirToDegs(beachFacing);
  if (facingDeg === null) return 1;

  let diff = Math.abs(swellDirectionDeg - facingDeg);
  if (diff > 180) diff = 360 - diff;

  let baseScore;
  if (diff <= 22.5)  baseScore = 3;  // direto
  else if (diff <= 45)    baseScore = 2;  // levemente oblíquo
  else if (diff <= 67.5)  baseScore = 1;  // oblíquo
  else if (diff <= 90)    baseScore = 0;  // paralelo
  else                    baseScore = -1; // de costas

  // Swell direto só vale score máximo com período longo (≥12s)
  // Com período curto a onda quebra em cima, sem parede — cap em 2
  if (baseScore === 3 && swellPeriod < 12) baseScore = 2;

  return baseScore;
}

/**
 * Calcula o score do vento considerando direção em relação à praia.
 * Offshore (terral) = bônus, onshore (maresia) = penaliza.
 * Retorna: -2 (onshore forte) → +3 (offshore calmo)
 */
function windScore(windSpeedKmh, windDirectionDeg, beachFacing) {
  // Se não temos direção do vento ou facing da praia, usa só velocidade (neutro)
  if (windDirectionDeg === null || !beachFacing) {
    if (windSpeedKmh < 10)      return 2;
    if (windSpeedKmh < 20)      return 1;
    if (windSpeedKmh < 30)      return 0;
    if (windSpeedKmh >= 40)     return -2;
    return -1;
  }

  const facingDeg = dirToDegs(beachFacing);
  if (facingDeg === null) {
    if (windSpeedKmh < 10)  return 2;
    if (windSpeedKmh < 20)  return 1;
    if (windSpeedKmh < 30)  return 0;
    return -1;
  }

  // Diferença angular entre vento e orientação da praia
  // Vento vindo da mesma direção que a praia olha = onshore
  // Vento vindo da direção oposta = offshore (terral)
  let diff = Math.abs(windDirectionDeg - facingDeg);
  if (diff > 180) diff = 360 - diff;

  // diff ≈ 0°   → vento vindo de frente (onshore)
  // diff ≈ 180° → vento vindo de trás (offshore/terral)
  const isOffshore = diff >= 135; // 135°–180° = offshore ou quase
  const isOnshore  = diff <= 45;  // 0°–45°   = onshore

  if (isOffshore) {
    // Terral: quanto mais calmo, melhor
    if (windSpeedKmh < 10)  return 3;  // offshore leve → perfeito
    if (windSpeedKmh < 20)  return 2;  // offshore moderado → bom
    if (windSpeedKmh < 30)  return 1;  // offshore forte → ainda ok
    return 0;                          // offshore muito forte → neutro
  }

  if (isOnshore) {
    // Maresia: penaliza progressivamente
    if (windSpeedKmh < 10)  return 0;  // onshore fraco → neutro (não pontua)
    if (windSpeedKmh < 20)  return -1; // onshore moderado → penaliza
    if (windSpeedKmh < 30)  return -2; // onshore forte → penaliza mais
    return -3;                         // onshore muito forte → péssimo
  }

  // Vento lateral (45°–135°) → neutro a levemente negativo
  if (windSpeedKmh < 15)  return 1;
  if (windSpeedKmh < 25)  return 0;
  if (windSpeedKmh < 35)  return -1;
  return -2;
}

/**
 * Classifica as condições do dia em uma nota qualitativa.
 * Considera: altura, período, alinhamento swell, vento com direção, chuva.
 *
 * @param {object} summary - dados resumidos do dia
 * @param {object} beach   - dados da praia (com beach.facing)
 */
export function getRating(summary, beach = null) {
  const waveH    = summary.waveHeight?.avg  || 0;
  const period   = summary.wavePeriod?.avg  || 0;
  const wind     = summary.windSpeed?.avg   || 0;
  const windDir  = summary.windDirection    ?? null;
  const rain     = summary.precipitation    || 0;
  const swellDir = summary.swellDirection   ?? null;

  let score = 0;

  // ── Altura da onda ───────────────────────────────────────
  if (waveH >= 0.8 && waveH <= 2.5) score += 3;       // ideal
  else if (waveH >= 0.5)             score += 1;       // pequeno mas surfável
  else if (waveH > 2.5 && waveH <= 4) score += 2;     // grande
  else if (waveH > 4)                 score -= 1;      // grande demais

  // ── Período ──────────────────────────────────────────────
  if (period >= 14)      score += 3;
  else if (period >= 12) score += 2;
  else if (period >= 9)  score += 1;
  // < 9s = marola bagunçada, não pontua

  // ── Alinhamento swell × praia ────────────────────────────
  score += swellAlignmentScore(swellDir, beach?.facing, summary.swellPeriod?.avg || 0);

  // ── Vento com direção ────────────────────────────────────
  score += windScore(wind, windDir, beach?.facing);

  // ── Chuva ─────────────────────────────────────────────────
  if (rain > 10)     score -= 3;
  else if (rain > 5) score -= 2;
  else if (rain > 1) score -= 1;

  // ── Cap para onda grande: nunca pode ser Excelente ────────
  // Onda >2.5m é perigosa pra maioria → teto em Bom
  const bigWave = waveH > 2.5;

  // ── Classificação final ───────────────────────────────────
  // Escala apertada: Excelente exige ≥11 (era ≥9)
  if (!bigWave && score >= 11) return { emoji: '🔥', label: 'Excelente', score };
  if (score >= 8)              return { emoji: '✅', label: 'Bom',       score };
  if (score >= 4)              return { emoji: '😐', label: 'Regular',   score };
  if (score >= 2)              return { emoji: '😞', label: 'Fraco',     score };
  return                              { emoji: '⛔', label: 'Péssimo',   score };
}
