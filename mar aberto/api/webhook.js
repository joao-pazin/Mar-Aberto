import { fetchBeach, fetchAllBeaches } from '../lib/openmeteo.js';
import { formatDayForecast, formatWeekSummary, sendMessage, sendPhoto } from '../lib/telegram.js';
import { addSubscriber, removeSubscriber, getSubscriber, updateSubscriberBeaches } from '../lib/sheets.js';
import { BEACHES } from '../lib/beaches.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const body = await req.json();
  const message = body.message || body.callback_query?.message;
  const callbackQuery = body.callback_query;

  if (!message) return new Response('OK', { status: 200 });

  const chatId = message.chat.id;
  const text = message.text || '';
  const firstName = message.chat.first_name || 'surfista';

  // ─── CALLBACK QUERIES (botões inline) ───────────────────────────────────────
  if (callbackQuery) {
    const data = callbackQuery.data;
    await answerCallbackQuery(callbackQuery.id);

    // Toggle de praia selecionada
    if (data.startsWith('toggle_')) {
      const beachId = data.replace('toggle_', '');
      await handleBeachToggle(chatId, beachId);
      return new Response('OK', { status: 200 });
    }

    // Confirmar seleção de praias
    if (data === 'confirm_beaches') {
      await handleConfirmBeaches(chatId, firstName);
      return new Response('OK', { status: 200 });
    }

    // Ver previsão de uma praia específica
    if (data.startsWith('forecast_')) {
      const beachId = data.replace('forecast_', '');
      await handleForecastRequest(chatId, beachId, 'day');
      return new Response('OK', { status: 200 });
    }

    if (data.startsWith('week_')) {
      const beachId = data.replace('week_', '');
      await handleForecastRequest(chatId, beachId, 'week');
      return new Response('OK', { status: 200 });
    }

    return new Response('OK', { status: 200 });
  }

  // ─── COMANDOS DE TEXTO ───────────────────────────────────────────────────────
  const command = text.split(' ')[0].toLowerCase();

  switch (command) {
    case '/start':
      const payload = text.split(' ')[1] || null;
      await handleStart(chatId, firstName, payload);
      break;

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

    case '/comprovante':
      await handleComprovante(chatId, firstName);
      break;

    case '/liberar': {
      // Comando exclusivo do admin
      const adminId = process.env.ADMIN_CHAT_ID;
      if (String(chatId) !== String(adminId)) {
        await sendMessage(chatId, '❌ Comando não autorizado.');
        break;
      }
      const query = text.split(' ')[1];
      await handleLiberar(chatId, query);
      break;
    }

    case '/parar':
      await handleUnsubscribe(chatId);
      break;

    case '/ajuda':
      await handleHelp(chatId);
      break;

    default:
      await sendMessage(chatId, '❓ Comando não reconhecido. Use /ajuda para ver os comandos disponíveis.');
  }

  return new Response('OK', { status: 200 });
}

// ─── HANDLERS ───────────────────────────────────────────────────────────────────

async function handleStart(chatId, firstName, payload) {
  // Se veio com código de vínculo da landing page (?start=CODIGO)
  if (payload && payload.length > 10) {
    try {
      const email = atob(payload.replace(/-/g, '='));
      const { getSubscriberByEmail, addSubscriber } = await import('../lib/sheets.js');
      const existing = await getSubscriberByEmail(email);

      if (existing && !existing.chatId) {
        // Vincula o chatId ao cadastro existente
        await addSubscriber(chatId, existing.beaches, existing.firstName || firstName, email);
        await sendMessage(chatId,
          `🌊 *Conta vinculada com sucesso, ${existing.firstName || firstName}!*\n\nVocê vai receber alertas para:\n${existing.beaches.map(id => `🏖️ ${id}`).join('\n')}\n\n⏰ Alertas às *06h* e *19h* todo dia.\n\n/praias — alterar praias\n/ajuda — ver comandos`,
          { parse_mode: 'Markdown' }
        );
        return;
      }
    } catch (e) {
      // Código inválido, segue fluxo normal
    }
  }

  // Fluxo normal de /start
  const text = `🌊 *Bem-vindo ao Ondas RJ, ${firstName}!*\n\nVou te enviar previsões diárias de ondas, vento, maré e tempo para as praias da Zona Sul e Zona Oeste do Rio.\n\n*Para começar, escolha suas praias:*`;
  await sendMessage(chatId, text, { parse_mode: 'Markdown' });
  await handleSelectBeaches(chatId);
}

async function handleSelectBeaches(chatId) {
  const { isPremium, FREE_BEACH_LIMIT } = await import('../lib/billing.js');
  const subscriber = await getSubscriber(chatId);
  const selectedBeaches = subscriber?.beaches || [];
  const premium = isPremium(subscriber);

  const buttons = BEACHES.map(beach => {
    const isSelected = selectedBeaches.includes(beach.id);
    const isLocked = !premium && !isSelected && selectedBeaches.length >= FREE_BEACH_LIMIT;

    let label;
    if (isSelected) label = `✅ ${beach.name}`;
    else if (isLocked) label = `🔒 ${beach.name}`;
    else label = `🏖️ ${beach.name}`;

    return { text: label, callback_data: `toggle_${beach.id}` };
  });

  const keyboard = [];
  for (let i = 0; i < buttons.length; i += 2) {
    keyboard.push(buttons.slice(i, i + 2));
  }
  keyboard.push([{ text: '✅ Confirmar seleção', callback_data: 'confirm_beaches' }]);

  const subtitle = premium
    ? '_(todas as praias desbloqueadas)_'
    : `_Plano gratuito: 1 praia. 🔒 = Premium_`;

  await sendMessage(chatId, `🏖️ *Selecione sua praia:*\n${subtitle}`, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard }
  });
}

async function handleBeachToggle(chatId, beachId) {
  const { isPremium, buildUpgradeMessage, FREE_BEACH_LIMIT } = await import('../lib/billing.js');
  const subscriber = await getSubscriber(chatId);
  let selectedBeaches = subscriber?.beaches || [];
  const isRemoving = selectedBeaches.includes(beachId);

  // Se está tentando adicionar e já tem o limite e não é premium → bloqueia
  if (!isRemoving && !isPremium(subscriber) && selectedBeaches.length >= FREE_BEACH_LIMIT) {
    const beach = (await import('../lib/beaches.js')).BEACHES.find(b => b.id === beachId);
    await sendMessage(chatId, buildUpgradeMessage(beach?.name || beachId), { parse_mode: 'Markdown' });
    return;
  }

  if (isRemoving) {
    selectedBeaches = selectedBeaches.filter(b => b !== beachId);
  } else {
    selectedBeaches.push(beachId);
  }

  await updateSubscriberBeaches(chatId, selectedBeaches);
}

async function handleConfirmBeaches(chatId, firstName) {
  const subscriber = await getSubscriber(chatId);
  const selectedBeaches = subscriber?.beaches || [];

  if (selectedBeaches.length === 0) {
    await sendMessage(chatId, '⚠️ Selecione ao menos uma praia antes de confirmar!');
    return;
  }

  // Garante que o subscriber está salvo na Sheet
  await addSubscriber(chatId, selectedBeaches, firstName);

  const beachNames = selectedBeaches
    .map(id => BEACHES.find(b => b.id === id)?.name)
    .filter(Boolean)
    .join(', ');

  await sendMessage(chatId,
    `✅ *Perfeito!* Você receberá alertas diários às 7h para:\n\n🏖️ ${beachNames}\n\n*Comandos disponíveis:*\n/previsao — previsão de hoje\n/semana — previsão da semana\n/praias — alterar praias\n/parar — cancelar alertas`,
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

  await sendMessage(chatId, '⏳ Buscando previsão, aguarde...');

  // Botões para escolher qual praia ver
  const keyboard = selectedBeaches.map(beachId => {
    const beach = BEACHES.find(b => b.id === beachId);
    return [{
      text: `🌊 ${beach?.name}`,
      callback_data: `${type}_${beachId}`
    }];
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

    if (type === 'week') {
      const msg = formatWeekSummary(beach, data);
      await sendMessage(chatId, msg, { parse_mode: 'Markdown' });
    } else {
      // 'day' = hoje, 'tomorrow' = amanhã
      const daysOffset = type === 'tomorrow' ? 1 : 0;
      const msg = formatDayForecast(beach, data, daysOffset);
      await sendMessage(chatId, msg, { parse_mode: 'Markdown' });
    }
  } catch (err) {
    await sendMessage(chatId, `❌ Erro ao buscar dados: ${err.message}`);
  }
}

async function handleStatus(chatId) {
  const { getSubscriber } = await import('../lib/sheets.js');
  const { buildStatusMessage } = await import('../lib/billing.js');
  const subscriber = await getSubscriber(chatId);

  if (!subscriber) {
    await sendMessage(chatId, '⚠️ Você ainda não está cadastrado. Use /start.');
    return;
  }

  await sendMessage(chatId, buildStatusMessage(subscriber), { parse_mode: 'Markdown' });
}

async function handleComprovante(chatId, firstName) {
  const ADMIN_ID = process.env.ADMIN_CHAT_ID;

  // Avisa o usuário
  await sendMessage(chatId,
    `✅ *Comprovante recebido!*\n\nVamos verificar seu pagamento e liberar seu acesso em breve. Normalmente leva até algumas horas.\n\nDúvidas? Entre em contato com o suporte.`,
    { parse_mode: 'Markdown' }
  );

  // Notifica o admin
  if (ADMIN_ID) {
    await sendMessage(ADMIN_ID,
      `💰 *Novo comprovante recebido!*\n\n👤 ${firstName}\n🆔 chatId: \`${chatId}\`\n\nPara liberar o acesso:\n/liberar ${chatId}`,
      { parse_mode: 'Markdown' }
    );
  }
}

async function handleLiberar(adminChatId, query) {
  if (!query) {
    await sendMessage(adminChatId, '⚠️ Use: /liberar <chatId ou email>');
    return;
  }

  const { findSubscriberByEmailOrId, grantAccess } = await import('../lib/sheets.js');
  const subscriber = await findSubscriberByEmailOrId(query);

  if (!subscriber || !subscriber.chatId) {
    await sendMessage(adminChatId, `❌ Subscriber não encontrado: ${query}`);
    return;
  }

  await grantAccess(subscriber.chatId);

  // Notifica o admin
  await sendMessage(adminChatId,
    `✅ Acesso liberado por 30 dias para:\n👤 ${subscriber.firstName}\n📧 ${subscriber.email}\n🆔 ${subscriber.chatId}`,
    { parse_mode: 'Markdown' }
  );

  // Notifica o usuário
  await sendMessage(subscriber.chatId,
    `🎉 *Pagamento confirmado, ${subscriber.firstName}!*\n\nSeu acesso foi reativado por 30 dias. Os alertas voltam a partir do próximo envio.\n\n🌊 Boas ondas!`,
    { parse_mode: 'Markdown' }
  );
}

async function handleHelp(chatId) {
  await sendMessage(chatId,
    `🌊 *Ondas RJ — Comandos*\n\n/start — iniciar ou reiniciar o bot\n/praias — escolher praias monitoradas\n/previsao — ver previsão de hoje\n/semana — ver previsão da semana\n/status — ver status da sua assinatura\n/comprovante — enviar comprovante de pagamento\n/parar — cancelar alertas\n/ajuda — mostrar esta mensagem\n\n⏰ Alertas automáticos às *06h* e *19h*`,
    { parse_mode: 'Markdown' }
  );
}

async function answerCallbackQuery(callbackQueryId) {
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId })
  });
}
