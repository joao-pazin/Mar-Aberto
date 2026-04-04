/**
 * Gerencia subscribers numa Google Sheet com as colunas:
 * A: chatId | B: firstName | C: beaches (JSON) | D: createdAt | E: active | F: email | G: trialStart | H: paidUntil
 */

import { createSign } from 'crypto';

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = 'Subscribers';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

async function getAccessToken() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);

  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })).toString('base64url');

  const signingInput = `${header}.${payload}`;

  const sign = createSign('RSA-SHA256');
  sign.update(signingInput);
  sign.end();
  const signature = sign.sign(credentials.private_key, 'base64url');

  const jwt = `${signingInput}.${signature}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error(`Falha ao obter token: ${JSON.stringify(tokenData)}`);
  }
  return tokenData.access_token;
}

async function readSheet() {
  const token = await getAccessToken();
  const res = await fetch(
    `${SHEETS_API}/${SHEET_ID}/values/${SHEET_NAME}!A:H`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  return data.values || [];
}

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

export async function getSubscribers() {
  const rows = await readSheet();
  return rows
    .slice(1)
    .filter(r => r[0] && r[4] !== 'false')
    .map(r => ({
      chatId: r[0],
      firstName: r[1] || '',
      beaches: JSON.parse(r[2] || '[]'),
      createdAt: r[3] || '',
      active: true,
      email: r[5] || '',
      paidUntil: r[7] || null,
    }))
    .filter(s => s.beaches.length > 0);
}

export async function addSubscriber(chatId, beaches, firstName = '', email = '', trialStart = null) {
  const token = await getAccessToken();
  const rows = await readSheet();

  let existingIndex = chatId
    ? rows.findIndex(r => r[0] === String(chatId))
    : email ? rows.findIndex(r => (r[5] || '').toLowerCase() === email.toLowerCase()) : -1;

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

export async function updateSubscriberBeaches(chatId, beaches) {
  const existing = await getSubscriber(chatId);
  if (existing) {
    await addSubscriber(chatId, beaches, existing.firstName, existing.email);
  } else {
    await addSubscriber(chatId, beaches, '');
  }
}

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
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [['false']] })
    }
  );
}
