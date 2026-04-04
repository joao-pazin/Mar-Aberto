const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;

async function getRedirectUrl(url) {
  const res = await fetch(url, { redirect: 'manual' });
  return res.headers.get('location') || url;
}

async function get(action, params = {}) {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set('action', action);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  
  const finalUrl = await getRedirectUrl(url.toString());
  const res = await fetch(finalUrl);
  return res.json();
}

async function post(data) {
  const finalUrl = await getRedirectUrl(APPS_SCRIPT_URL);
  const res = await fetch(finalUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function getSubscriber(chatId) {
  return get('getByChatId', { chatId: String(chatId) });
}

export async function getSubscriberByEmail(email) {
  return get('getByEmail', { email });
}

export async function getSubscribers() {
  return get('getAll');
}

export async function addSubscriber(chatId, beaches, firstName = '', email = '', trialStart = null) {
  return post({ action: 'upsert', chatId, beaches, firstName, email, trialStart });
}

export async function updateSubscriberBeaches(chatId, beaches) {
  return post({ action: 'upsert', chatId, beaches });
}

export async function removeSubscriber(chatId) {
  return post({ action: 'remove', chatId });
}

export async function grantAccess(chatId) {
  return post({ action: 'grantAccess', chatId });
}

export async function findSubscriberByEmailOrId(query) {
  const byChatId = await get('getByChatId', { chatId: query });
  if (byChatId) return byChatId;
  return get('getByEmail', { email: query });
}
