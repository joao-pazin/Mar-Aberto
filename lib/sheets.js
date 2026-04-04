/**
 * Google Sheets - usando googleapis + google-auth-library
 * Colunas: A:chatId | B:firstName | C:beaches | D:createdAt | E:active | F:email | G:trialStart | H:paidUntil
 */

import { google } from 'googleapis';

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = 'Subscribers';

function getAuth() {
  return new google.auth.JWT({
    email: process.env.GOOGLE_CLIENT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

function getSheets() {
  return google.sheets({ version: 'v4', auth: getAuth() });
}

async function readSheet() {
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A:H`,
  });
  return res.data.values || [];
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
  const sheets = getSheets();
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
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A:H`,
      valueInputOption: 'RAW',
      requestBody: { values: [rowData] },
    });
  } else {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A${existingIndex + 1}:H${existingIndex + 1}`,
      valueInputOption: 'RAW',
      requestBody: { values: [rowData] },
    });
  }
}

export async function grantAccess(chatId) {
  const sheets = getSheets();
  const rows = await readSheet();
  const index = rows.findIndex(r => r[0] === String(chatId));
  if (index === -1) return false;

  const paidUntil = new Date();
  paidUntil.setDate(paidUntil.getDate() + 30);

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!H${index + 1}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[paidUntil.toISOString()]] },
  });
  return true;
}

export async function findSubscriberByEmailOrId(query) {
  const rows = await readSheet();
  const row = rows.find(r =>
    r[0] === query || (r[5] || '').toLowerCase() === query.toLowerCase()
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
  const sheets = getSheets();
  const rows = await readSheet();
  const index = rows.findIndex(r => r[0] === String(chatId));
  if (index === -1) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!E${index + 1}`,
    valueInputOption: 'RAW',
    requestBody: { values: [['false']] },
  });
}
