// api/auth/verify-code.js
// Edge runtime — valida código de 6 dígitos e retorna JWT
export const config = { runtime: 'edge' };


// ── JWT inline (Web Crypto API, Edge Runtime compatível) ─────────────────────
const JWT_SECRET = process.env.CRON_SECRET;
function _b64url(str) { return btoa(str).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,''); }
function _b64dec(str) { str=str.replace(/-/g,'+').replace(/_/g,'/'); while(str.length%4) str+='='; return atob(str); }
async function _getKey() {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(JWT_SECRET),
    {name:'HMAC',hash:'SHA-256'}, false, ['sign','verify']);
}
async function signJWT(payload, days=30) {
  const h = _b64url(JSON.stringify({alg:'HS256',typ:'JWT'}));
  const b = _b64url(JSON.stringify({...payload, exp: Math.floor(Date.now()/1000)+days*86400}));
  const msg = `${h}.${b}`;
  const key = await _getKey();
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return `${msg}.${_b64url(String.fromCharCode(...new Uint8Array(sig)))}`;
}
async function verifyJWT(token) {
  try {
    const [h,b,s] = token.split('.');
    if(!h||!b||!s) return null;
    const key = await _getKey();
    const sigBytes = Uint8Array.from(_b64dec(s), c=>c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(`${h}.${b}`));
    if(!valid) return null;
    const p = JSON.parse(_b64dec(b));
    if(p.exp && p.exp < Math.floor(Date.now()/1000)) return null;
    return p;
  } catch { return null; }
}
// ─────────────────────────────────────────────────────────────────────────────

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
