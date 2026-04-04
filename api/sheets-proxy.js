export const config = { runtime: 'nodejs' };

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  if (req.method === 'GET') {
    const { action, ...params } = req.query;
    const url = new URL(APPS_SCRIPT_URL);
    url.searchParams.set('action', action);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
    
    const response = await fetch(url.toString(), { redirect: 'follow' });
    const data = await response.json();
    res.json(data);
    
  } else if (req.method === 'POST') {
    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
      redirect: 'follow',
    });
    const data = await response.json();
    res.json(data);
  }
}
