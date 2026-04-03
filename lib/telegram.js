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
 * O swell "bate" melhor quando vem de frente (oposto à direção que a praia olha).
 *
 * Ex: praia voltada pro S (facing: 'S') → recebe melhor swell vindo de S (180°)
 * O swell vem DE uma direção, então 180° de swell = vindo do sul = bate em praia voltada pro sul
 *
 * Retorna: 0 (péssimo alinhamento) → 3 (alinhamento perfeito)
 */
function swellAlignmentScore(swellDirectionDeg, beachFacing) {
  if (swellDirectionDeg === null || swellDirectionDeg === undefined) return 1; // sem dados, neutro
  if (!beachFacing) return 1;

  const facingDeg = dirToDegs(beachFacing);
  if (facingDeg === null) return 1;

  // Ângulo entre a direção do swell e a orientação da praia
  // Alinhamento perfeito: swell vem exatamente de frente (diferença ~0°)
  let diff = Math.abs(swellDirectionDeg - facingDeg);
  if (diff > 180) diff = 360 - diff;

  // diff = 0°  → swell direto na praia → score 3
  // diff = 45° → levemente oblíquo   → score 2
  // diff = 90° → paralelo            → score 0
  // diff > 90° → swell de costas     → score -1
  if (diff <= 22.5)  return 3;
  if (diff <= 45)    return 2;
  if (diff <= 67.5)  return 1;
  if (diff <= 90)    return 0;
  return -1; // swell vindo de trás da praia
}

/**
 * Classifica as condições do dia em uma nota qualitativa.
 * Agora inclui alinhamento do swell com a orientação da praia.
 *
 * @param {object} summary - dados resumidos do dia
 * @param {object} beach   - dados da praia (com beach.facing)
 */
export function getRating(summary, beach = null) {
  const waveH  = summary.waveHeight?.avg || 0;
  const period = summary.wavePeriod?.avg || 0;
  const wind   = summary.windSpeed?.avg  || 0;
  const rain   = summary.precipitation   || 0;
  const swellDir = summary.swellDirection ?? null;

  let score = 0;

  // ── Altura da onda ───────────────────────────────────────
  // Ideal entre 0.8m e 2.5m pra surf
  if (waveH >= 0.8 && waveH <= 2.5) score += 3;
  else if (waveH >= 0.5 && waveH < 0.8) score += 1;  // pequeno mas surfável
  else if (waveH > 2.5 && waveH <= 4)   score += 2;  // grande mas possível
  else if (waveH > 4)                    score -= 1;  // grande demais pra maioria

  // ── Período ──────────────────────────────────────────────
  // Quanto maior, mais organizado e potente o swell
  if (period >= 14)      score += 3;
  else if (period >= 12) score += 2;
  else if (period >= 9)  score += 1;
  // < 9s = marola bagunçada, não pontua

  // ── Alinhamento do swell com a praia ─────────────────────
  const alignment = swellAlignmentScore(swellDir, beach?.facing);
  score += alignment;

  // ── Vento ─────────────────────────────────────────────────
  // Terral (offshore) seria ideal mas não temos essa granularidade ainda
  if (wind < 10)       score += 3; // muito calmo
  else if (wind < 20)  score += 2;
  else if (wind < 30)  score += 1;
  else if (wind >= 40) score -= 2; // muito forte, perigoso
  else                 score -= 1;

  // ── Chuva ─────────────────────────────────────────────────
  if (rain > 10)     score -= 3;
  else if (rain > 5) score -= 2;
  else if (rain > 1) score -= 1;

  // ── Classificação final ───────────────────────────────────
  if (score >= 9)  return { emoji: '🔥', label: 'Excelente', score };
  if (score >= 7)  return { emoji: '✅', label: 'Bom',       score };
  if (score >= 4)  return { emoji: '😐', label: 'Regular',   score };
  if (score >= 2)  return { emoji: '😞', label: 'Fraco',     score };
  return                  { emoji: '⛔', label: 'Péssimo',   score };
}
