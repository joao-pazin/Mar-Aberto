// api/auth/request-code.js
// Edge runtime — recebe email, gera código de 6 dígitos,
// salva no Sheets e envia pelo Telegram
export const config = { runtime: 'edge' };

const APPS_SCRIPT_URL  = process.env.APPS_SCRIPT_URL;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

export default async function handler(req) {
  if (req.method === 'OPTIONS') return cors();
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body;
  try { body = await req.json(); }
  catch { return json({ error: 'Body inválido' }, 400); }

  const { email } = body;
  if (!email || !email.includes('@')) return json({ error: 'E-mail inválido' }, 400);

  const emailClean = email.toLowerCase().trim();

  // 1. Busca o subscriber no Sheets
  const sheetsRes = await fetch(
    `${APPS_SCRIPT_URL}?action=getByEmail&email=${encodeURIComponent(emailClean)}`,
    { redirect: 'follow' }
  ).catch(() => null);

  if (!sheetsRes?.ok) return json({ error: 'Erro ao verificar cadastro.' }, 500);

  const subscriber = await sheetsRes.json();

  if (!subscriber) {
    return json({ error: 'E-mail não encontrado. Faça o cadastro primeiro.' }, 404);
  }

  if (!subscriber.chatId) {
    return json({
      error: 'Você ainda não ativou o bot no Telegram. Clique no link que recebeu no cadastro para ativar.',
      needsBot: true,
    }, 403);
  }

  // 2. Gera código de 6 dígitos
  const code   = String(Math.floor(100000 + Math.random() * 900000));
  const expiry = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutos

  // 3. Salva no Sheets
  const saveRes = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'saveLoginCode', email: emailClean, code, expiry }),
    redirect: 'follow',
  }).catch(() => null);

  if (!saveRes?.ok) return json({ error: 'Erro ao salvar código.' }, 500);

  // 4. Envia pelo Telegram
  const msg = `🔐 *Seu código de acesso ao dashboard:*\n\n` +
              `\`${code}\`\n\n` +
              `_Válido por 10 minutos. Não compartilhe com ninguém._`;

  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: subscriber.chatId,
      text: msg,
      parse_mode: 'Markdown',
    }),
  });

  return json({ success: true });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

function cors() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
