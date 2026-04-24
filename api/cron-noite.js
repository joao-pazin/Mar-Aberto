import { fetchAllBeaches } from '../lib/openmeteo.js';
import { sendScheduledAlert } from '../lib/telegram.js';
import { getSubscribers } from '../lib/sheets.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    console.log('[CRON NOITE] Iniciando alertas das 19h...');

    const [subscribers, beachData] = await Promise.all([
      getSubscribers(),
      fetchAllBeaches()
    ]);

    let successCount = 0, errorCount = 0;

    for (const subscriber of subscribers) {
      try {
        if (!subscriber.beaches || subscriber.beaches.length === 0) continue;

        await sendScheduledAlert(subscriber, beachData, 'evening');
        successCount++;
        await new Promise(r => setTimeout(r, 100));
      } catch (err) {
        console.error(`[CRON NOITE] Erro para ${subscriber.chatId}:`, err.message);
        errorCount++;
      }
    }

    console.log(`[CRON NOITE] ${successCount} enviados, ${errorCount} erros`);

    return new Response(JSON.stringify({
      success: true, sent: successCount, errors: errorCount,
      type: 'evening', timestamp: new Date().toISOString()
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('[CRON NOITE] Erro geral:', err);
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500 });
  }
}
