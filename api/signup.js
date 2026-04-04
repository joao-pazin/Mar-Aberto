import { addSubscriber, getSubscriberByEmail } from '../lib/sheets.js';

export const config = { runtime: 'nodejs' };

export default async function handler(req) {
  // Só aceita POST
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  // Lê o body
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Body inválido' }, 400);
  }

  const { name, email, beaches } = body;

  // Validações
  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    return json({ error: 'Nome inválido' }, 400);
  }

  if (!email || !email.includes('@')) {
    return json({ error: 'E-mail inválido' }, 400);
  }

  if (!beaches || !Array.isArray(beaches) || beaches.length === 0) {
    return json({ error: 'Selecione ao menos uma praia' }, 400);
  }

  const VALID_BEACH_IDS = [
    'copacabana', 'ipanema', 'leblon', 'sao_conrado',
    'barra', 'recreio', 'macumba', 'prainha', 'grumari'
  ];

  const validBeaches = beaches.filter(b => VALID_BEACH_IDS.includes(b));
  if (validBeaches.length === 0) {
    return json({ error: 'Praias inválidas' }, 400);
  }

  try {
    // Verifica se email já existe
    const existing = await getSubscriberByEmail(email.toLowerCase().trim());

    if (existing) {
      // Atualiza praias se já cadastrado
      await addSubscriber(existing.chatId || null, validBeaches, name.trim(), email.toLowerCase().trim());
      return json({ success: true, message: 'Cadastro atualizado!', isNew: false });
    }

    // Novo cadastro — chatId ainda não existe (vem depois via bot)
    await addSubscriber(null, validBeaches, name.trim(), email.toLowerCase().trim());

    // Gera link do bot com parâmetro pra vincular a conta
    const linkCode = btoa(email.toLowerCase().trim()).replace(/=/g, '');
    const botLink = `https://t.me/${process.env.TELEGRAM_BOT_USERNAME}?start=${linkCode}`;

    return json({ success: true, message: 'Cadastro realizado!', isNew: true, botLink });

  } catch (err) {
    console.error('[SIGNUP] Erro:', err);
    return json({ error: 'Erro interno. Tente novamente.' }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*', // permite chamada da landing page
    }
  });
}
