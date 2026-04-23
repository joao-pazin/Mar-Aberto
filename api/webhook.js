import { fetchBeach } from '../lib/openmeteo.js';
import { formatDayForecast, formatWeekSummary, sendMessage } from '../lib/telegram.js';
import { addSubscriber, removeSubscriber, getSubscriber, updateSubscriberBeaches } from '../lib/sheets.js';
import { BEACHES } from '../lib/beaches.js';

export const config = { runtime: 'nodejs', maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).end('Method not allowed');
    return;
  }

  let body;
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = JSON.parse(Buffer.concat(chunks).toString());
  } catch (e) {
    res.status(200).end('OK');
    return;
  }

  const message = body.message || body.callback_query?.message;
  const callbackQuery = body.callback_query;

  if (!message) {
    res.status(200).end('OK');
    return;
  }

  const chatId = message.chat.id;
  const text = message.text || '';
  const firstName = message.chat.first_name || 'surfista';

  try {
    if (callbackQuery) {
      const data = callbackQuery.data;
      await answerCallbackQuery(callbackQuery.id);

      if (data.startsWith('toggle_')) {
        await handleBeachToggle(chatId, data.replace('toggle_', ''), message.message_id);
      } else if (data === 'confirm_beaches') {
        await handleConfirmBeaches(chatId, firstName);
      } else if (data.startsWith('day_')) {
        await handleForecastRequest(chatId, data.replace('day_', ''), 'day');
      } else if (data.startsWith('week_')) {
        await handleForecastRequest(chatId, data.replace('week_', ''), 'week');
      } else if (data.startsWith('forecast_')) {
        await handleForecastRequest(chatId, data.replace('forecast_', ''), 'day');
      }

      res.status(200).end('OK');
      return;
    }

    const command = text.split(' ')[0].toLowerCase();

    switch (command) {
      case '/start': {
        const payload = text.split(' ')[1] || null;
        await handleStart(chatId, firstName, payload);
        break;
      }
      case '/praias':
        await handleSelectBeaches(chatId);
        break;
      case '/previsao':
        await handleMyBeachesForecast(chatId, 'day');
        break;
      case '/semana':
        await handleMyBeachesForecast(chatId, 'week');
        break;
      case '/status':
        await handleStatus(chatId);
        break;
      case '/parar':
        await removeSubscriber(chatId);
        await sendMessage(chatId, '😢 Você foi removido dos alertas. Use /start se quiser voltar!');
        break;
      case '/ajuda':
        await handleHelp(chatId);
        break;
      default:
        await sendMessage(chatId, '❓ Comando não reconhecido. Use /ajuda para ver os comandos disponíveis.');
    }
  } catch (err) {
    console.error('[WEBHOOK] erro:', err.message);
  }

  res.status(200).end('OK');
}

// ─── HANDLERS ────────────────────────────────────────────────────────────────

async function handleStart(chatId, firstName, payload) {
  if (payload && payload.length > 10) {
    try {
      const email = Buffer.from(payload, 'base64').toString('utf8');
      const existing = await getSubscriberByEmail(email);
      if (existing && !existing.chatId) {
        await addSubscriber(chatId, existing.beaches, existing.firstName || firstName, email);
        const beachNames = existing.beaches.map(id => {
          const b = BEACHES.find(b => b.id === id);
          return b ? `🏖️ ${b.name}` : id;
        }).join('\n');
        await sendMessage(chatId,
          `🌊 *Bem-vindo ao Mar Aberto, ${existing.firstName || firstName}!*\n\nSuas praias monitoradas:\n${beachNames}\n\n⏰ Alertas às *06h* e *19h* todo dia.\n\n/previsao — ver previsão agora\n/praias — alterar praias\n/ajuda — ver comandos`,
          { parse_mode: 'Markdown' }
        );
        return;
      }
    } catch (e) {}
  }

  const subscriber = await getSubscriber(chatId);
  if (subscriber && subscriber.beaches && subscriber.beaches.length > 0) {
    const beachNames = subscriber.beaches.map(id => {
      const b = BEACHES.find(b => b.id === id);
      return b ? `🏖️ ${b.name}` : id;
    }).join('\n');
    await sendMessage(chatId,
      `🌊 *Bem-vindo de volta, ${firstName}!*\n\nSuas praias monitoradas:\n${beachNames}\n\n⏰ Alertas às *06h* e *19h* todo dia.\n\n/previsao — ver previsão agora\n/praias — alterar praias\n/ajuda — ver comandos`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  await sendMessage(chatId,
    `🌊 *Bem-vindo ao Mar Aberto, ${firstName}!*\n\nO mar chama. A gente avisa.\n\nEscolha suas praias:`,
    { parse_mode: 'Markdown' }
  );
  await handleSelectBeaches(chatId);
}

async function handleSelectBeaches(chatId) {
  const subscriber = await getSubscriber(chatId);
  const selectedBeaches = subscriber?.beaches || [];

  const buttons = BEACHES.map(beach => {
    const isSelected = selectedBeaches.includes(beach.id);
    const label = isSelected ? `✅ ${beach.name}` : `🏖️ ${beach.name}`;
    return { text: label, callback_data: `toggle_${beach.id}` };
  });

  const keyboard = [];
  for (let i = 0; i < buttons.length; i += 2) keyboard.push(buttons.slice(i, i + 2));
  keyboard.push([{ text: '✅ Confirmar seleção', callback_data: 'confirm_beaches' }]);

  await sendMessage(chatId, `🏖️ *Selecione suas praias:*\n_Pode escolher quantas quiser — é tudo grátis._`, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard }
  });
}

async function handleBeachToggle(chatId, beachId, messageId) {
  const subscriber = await getSubscriber(chatId);
  let selectedBeaches = subscriber?.beaches || [];
  const isRemoving = selectedBeaches.includes(beachId);

  if (isRemoving) selectedBeaches = selectedBeaches.filter(b => b !== beachId);
  else selectedBeaches.push(beachId);

  await updateSubscriberBeaches(chatId, selectedBeaches);

  // Remontar o teclado com o novo estado e editar a mensagem
  const buttons = BEACHES.map(beach => {
    const isSelected = selectedBeaches.includes(beach.id);
    const label = isSelected ? `✅ ${beach.name}` : `🏖️ ${beach.name}`;
    return { text: label, callback_data: `toggle_${beach.id}` };
  });
  const keyboard = [];
  for (let i = 0; i < buttons.length; i += 2) keyboard.push(buttons.slice(i, i + 2));
  keyboard.push([{ text: '✅ Confirmar seleção', callback_data: 'confirm_beaches' }]);

  await editMessageReplyMarkup(chatId, messageId, keyboard);
}

async function handleConfirmBeaches(chatId, firstName) {
  const subscriber = await getSubscriber(chatId);
  const selectedBeaches = subscriber?.beaches || [];

  if (selectedBeaches.length === 0) {
    await sendMessage(chatId, '⚠️ Selecione ao menos uma praia antes de confirmar!');
    return;
  }

  await addSubscriber(chatId, selectedBeaches, firstName);
  const beachNames = selectedBeaches.map(id => BEACHES.find(b => b.id === id)?.name).filter(Boolean).join(', ');
  await sendMessage(chatId,
    `✅ *Perfeito!* Praias monitoradas: *${beachNames}*\n\n⏰ Alertas às *06h* e *19h* todo dia.\n\n/previsao — ver previsão agora`,
    { parse_mode: 'Markdown' }
  );
}

async function handleMyBeachesForecast(chatId, type) {
  const subscriber = await getSubscriber(chatId);
  const selectedBeaches = subscriber?.beaches || [];

  if (selectedBeaches.length === 0) {
    await sendMessage(chatId, '⚠️ Você ainda não selecionou praias. Use /praias para escolher.');
    return;
  }

  const keyboard = selectedBeaches.map(beachId => {
    const beach = BEACHES.find(b => b.id === beachId);
    return [{ text: `🌊 ${beach?.name}`, callback_data: `${type}_${beachId}` }];
  });

  await sendMessage(chatId, '📍 *Escolha a praia:*', {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard }
  });
}

async function handleForecastRequest(chatId, beachId, type) {
  const beach = BEACHES.find(b => b.id === beachId);
  if (!beach) {
    await sendMessage(chatId, '❌ Praia não encontrada.');
    return;
  }

  await sendMessage(chatId, `⏳ Buscando dados para ${beach.name}...`);

  try {
    const data = await fetchBeach(beach);
    const daysOffset = type === 'tomorrow' ? 1 : 0;
    const msg = type === 'week'
      ? formatWeekSummary(beach, data)
      : formatDayForecast(beach, data, daysOffset);
    await sendMessage(chatId, msg, { parse_mode: 'Markdown' });
  } catch (err) {
    await sendMessage(chatId, `❌ Erro ao buscar dados: ${err.message}`);
  }
}

async function handleStatus(chatId) {
  const subscriber = await getSubscriber(chatId);
  if (!subscriber) {
    await sendMessage(chatId, '⚠️ Você ainda não está cadastrado. Use /start.');
    return;
  }

  const beaches = subscriber.beaches || [];
  const beachNames = beaches
    .map(id => BEACHES.find(b => b.id === id)?.name)
    .filter(Boolean)
    .map(n => `🏖️ ${n}`)
    .join('\n') || '—';

  await sendMessage(chatId,
    `🌊 *Seu cadastro*\n\nPraias monitoradas (${beaches.length}):\n${beachNames}\n\n⏰ Alertas às *06h* e *19h*\n\n/praias — alterar praias\n/parar — cancelar alertas`,
    { parse_mode: 'Markdown' }
  );
}

async function handleHelp(chatId) {
  await sendMessage(chatId,
    `🌊 *Mar Aberto — Comandos*\n\n/previsao — previsão de hoje\n/semana — previsão da semana\n/praias — alterar praias monitoradas\n/status — ver suas praias\n/parar — cancelar alertas\n/ajuda — esta mensagem\n\n⏰ Alertas automáticos às *06h* e *19h*\n\n100% grátis. Sempre.`,
    { parse_mode: 'Markdown' }
  );
}

async function getSubscriberByEmail(email) {
  const { getSubscriberByEmail: fn } = await import('../lib/sheets.js');
  return fn(email);
}

async function editMessageReplyMarkup(chatId, messageId, keyboard) {
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/editMessageReplyMarkup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: keyboard } })
  });
}

async function answerCallbackQuery(id) {
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: id })
  });
}
