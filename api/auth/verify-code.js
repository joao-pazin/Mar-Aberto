// api/auth/verify-code.js
// Edge runtime — valida código de 6 dígitos e retorna JWT
export const config = { runtime: 'edge' };

import { signJWT } from '../../lib/jwt.js';

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;

export default async function handler(req) {
  if (req.method === 'OPTIONS') return cors();
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body;
  try { body = await req.json(); }
  catch { return json({ error: 'Body inválido' }, 400); }

  const { email, code } = body;
  if (!email || !email.includes('@')) return json({ error: 'E-mail inválido' }, 400);
  if (!code || code.length !== 6)     return json({ error: 'Código inválido' }, 400);

  const emailClean = email.toLowerCase().trim();

  // 1. Busca o subscriber com o código salvo
  const sheetsRes = await fetch(
    `${APPS_SCRIPT_URL}?action=getByEmail&email=${encodeURIComponent(emailClean)}`,
    { redirect: 'follow' }
  ).catch(() => null);

  if (!sheetsRes?.ok) return json({ error: 'Erro ao verificar código.' }, 500);

  const subscriber = await sheetsRes.json();
  if (!subscriber) return json({ error: 'E-mail não encontrado.' }, 404);

  // 2. Valida código
  if (!subscriber.loginCode) {
    return json({ error: 'Nenhum código solicitado. Peça um novo.' }, 400);
  }

  if (String(subscriber.loginCode).trim() !== String(code).trim()) {
    return json({ error: 'Código incorreto.' }, 401);
  }

  // 3. Valida expiração
  if (subscriber.loginCodeExpiry) {
    const expiry = new Date(subscriber.loginCodeExpiry);
    if (expiry < new Date()) {
      return json({ error: 'Código expirado. Peça um novo.' }, 401);
    }
  }

  // 4. Limpa código do Sheets (uso único)
  await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'clearLoginCode', email: emailClean }),
    redirect: 'follow',
  }).catch(() => null);

  // 5. Verifica se é premium
  const isPremium = subscriber.paidUntil
    ? new Date(subscriber.paidUntil) > new Date()
    : false;

  // 6. Gera JWT (válido 30 dias)
  const token = await signJWT({
    email: emailClean,
    chatId: subscriber.chatId,
    firstName: subscriber.firstName,
    beaches: subscriber.beaches,
    isPremium,
  });

  return json({
    success: true,
    token,
    user: {
      email: emailClean,
      firstName: subscriber.firstName,
      beaches: subscriber.beaches,
      isPremium,
    },
  });
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
