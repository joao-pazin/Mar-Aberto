export const config = { runtime: 'edge' };

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;

export default async function handler(req) {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Body inválido' }, 400);
  }

  const { name, email, beaches } = body;

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
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatId: null,
        firstName: name.trim(),
        beaches: validBeaches,
        email: email.toLowerCase().trim(),
      }),
      redirect: 'follow',
    });

    const result = await res.json();

    if (!result.success) {
      throw new Error(result.error || 'Erro no Apps Script');
    }

    const linkCode = btoa(email.toLowerCase().trim()).replace(/=/g, '');
    const botLink = `https://t.me/${process.env.TELEGRAM_BOT_USERNAME}?start=${linkCode}`;

    return json({ success: true, isNew: true, botLink });

  } catch (err) {
    console.error('[SIGNUP] Erro:', err.message);
    return json({ error: 'Erro interno. Tente novamente.' }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    }
  });
}
