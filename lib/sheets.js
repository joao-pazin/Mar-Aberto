/**
 * Gerencia subscribers numa Google Sheet com as colunas:
 * A: chatId | B: firstName | C: praias (JSON) | D: createdAt | E: active | F: email | G: trialStart | H: paidUntil
 *
 * Usa a Google Sheets API v4 com Service Account
 */

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = 'Subscribers';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

/**
 * Obtém access token via Service Account (JWT)
 */
async function getAccessToken() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);

  const now = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));

  const signingInput = `${header}.${payload}`;

  // Assina com a chave privada usando Web Crypto API (compatível com Edge Runtime)
  const key = await importPrivateKey(credentials.private_key);
  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    new TextEncoder().encode(signingInput)
  );

  const jwt = `${signingInput}.${btoa(String.fromCharCode(...new Uint8Array(signature)))}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });

  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

async function importPrivateKey(pem) {
  const pemContents = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\n/g, '');

  const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));

  return crypto.subtle.importKey(
    'pkcs8',
    binaryDer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

/**
 * Lê todas as linhas da sheet
 */
async function readSheet() {
  const token = await getAccessToken();
  const res = await fetch(
    `${SHEETS_API}/${SHEET_ID}/values/${SHEET_NAME}!A:H`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  return data.values || [];
}

/**
 * Busca um subscriber pelo chatId
 */
export async function getSubscriber(chatId) {
  const rows = await readSheet();
  const row = rows.find(r => r[0] === String(chatId));
  if (!row) return null;

  return {
    chatId: row[0],
    firstName: row[1] || '',
    beaches: JSON.parse(row[2] || '[]'),
    createdAt: row[3] || '',
    active: row[4] !== 'false',
    email: row[5] || '',
    trialStart: row[6] || null,
    paidUntil: row[7] || null,
  };
}

/**
 * Busca um subscriber pelo email
 */
export async function getSubscriberByEmail(email) {
  const rows = await readSheet();
  const row = rows.find(r => (r[5] || '').toLowerCase() === email.toLowerCase());
  if (!row) return null;

  return {
    chatId: row[0] || null,
    firstName: row[1] || '',
    beaches: JSON.parse(row[2] || '[]'),
    createdAt: row[3] || '',
    active: row[4] !== 'false',
    email: row[5] || '',
    trialStart: row[6] || null,
    paidUntil: row[7] || null,
  };
}

/**
 * Retorna todos os subscribers ativos
 */
export async function getSubscribers() {
  const rows = await readSheet();

  return rows
    .slice(1) // pula header
    .filter(r => r[0] && r[4] !== 'false')
    .map(r => ({
      chatId: r[0],
      firstName: r[1] || '',
      beaches: JSON.parse(r[2] || '[]'),
      createdAt: r[3] || '',
      active: true,
    }))
    .filter(s => s.beaches.length > 0);
}

/**
 * Adiciona ou atualiza um subscriber
 */
export async function addSubscriber(chatId, beaches, firstName = '', email = '', trialStart = null) {
  const token = await getAccessToken();
  const rows = await readSheet();

  let existingIndex = chatId
    ? rows.findIndex(r => r[0] === String(chatId))
    : rows.findIndex(r => (r[5] || '').toLowerCase() === email.toLowerCase());

  // Preserva trialStart existente se não foi passado novo
  const existingRow = existingIndex !== -1 ? rows[existingIndex] : null;
  const finalTrialStart = trialStart || existingRow?.[6] || new Date().toISOString();
  const existingPaidUntil = existingRow?.[7] || '';

  const rowData = [
    chatId ? String(chatId) : (existingRow?.[0] || ''),
    firstName,
    JSON.stringify(beaches),
    existingRow?.[3] || new Date().toISOString(),
    'true',
    email || existingRow?.[5] || '',
    finalTrialStart,
    existingPaidUntil,
  ];

  if (existingIndex === -1) {
    await fetch(
      `${SHEETS_API}/${SHEET_ID}/values/${SHEET_NAME}!A:H:append?valueInputOption=RAW`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [rowData] })
      }
    );
  } else {
    const range = `${SHEET_NAME}!A${existingIndex + 1}:H${existingIndex + 1}`;
    await fetch(
      `${SHEETS_API}/${SHEET_ID}/values/${range}?valueInputOption=RAW`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [rowData] })
      }
    );
  }
}

/**
 * Libera acesso pago por 30 dias (chamado manualmente via /liberar)
 */
export async function grantAccess(chatId) {
  const token = await getAccessToken();
  const rows = await readSheet();
  const index = rows.findIndex(r => r[0] === String(chatId));
  if (index === -1) return false;

  const paidUntil = new Date();
  paidUntil.setDate(paidUntil.getDate() + 30);

  const range = `${SHEET_NAME}!H${index + 1}`;
  await fetch(
    `${SHEETS_API}/${SHEET_ID}/values/${range}?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [[paidUntil.toISOString()]] })
    }
  );
  return true;
}

/**
 * Busca subscriber por email (para comando /liberar)
 */
export async function findSubscriberByEmailOrId(query) {
  const rows = await readSheet();
  const row = rows.find(r =>
    r[0] === query ||
    (r[5] || '').toLowerCase() === query.toLowerCase()
  );
  if (!row) return null;
  return {
    chatId: row[0],
    firstName: row[1] || '',
    email: row[5] || '',
    trialStart: row[6] || null,
    paidUntil: row[7] || null,
  };
}

/**
 * Atualiza apenas as praias de um subscriber (durante seleção)
 */
export async function updateSubscriberBeaches(chatId, beaches) {
  const existing = await getSubscriber(chatId);
  if (existing) {
    await addSubscriber(chatId, beaches, existing.firstName);
  } else {
    // Cria registro temporário (sem firstName ainda)
    await addSubscriber(chatId, beaches, '');
  }
}

/**
 * Marca subscriber como inativo (soft delete)
 */
export async function removeSubscriber(chatId) {
  const token = await getAccessToken();
  const rows = await readSheet();
  const index = rows.findIndex(r => r[0] === String(chatId));

  if (index === -1) return;

  const range = `${SHEET_NAME}!E${index + 1}`;
  await fetch(
    `${SHEETS_API}/${SHEET_ID}/values/${range}?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ values: [['false']] })
    }
  );
}
