export const config = { runtime: 'nodejs', maxDuration: 60 };

export default async function handler(req) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const report = { step: 'start', timestamp: new Date().toISOString() };

  try {
    report.step = 'import_sheets';
    const { getSubscribers } = await import('../lib/sheets.js');

    report.step = 'get_subscribers';
    const subscribers = await getSubscribers();
    report.subscribers_count = subscribers.length;
    report.first_subscriber = subscribers[0]
      ? { chatId: subscribers[0].chatId, beaches: subscribers[0].beaches }
      : null;

    report.step = 'import_openmeteo';
    const { fetchAllBeaches } = await import('../lib/openmeteo.js');

    report.step = 'fetch_beaches';
    const beachData = await fetchAllBeaches();
    report.beaches_fetched = Object.keys(beachData).length;
    report.beaches_ok = Object.values(beachData).filter(v => v !== null).length;

    report.step = 'import_telegram';
    const { sendScheduledAlert } = await import('../lib/telegram.js');

    report.step = 'success';
    report.duration_ms = Date.now() - new Date(report.timestamp).getTime();

    return new Response(JSON.stringify(report, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    report.error = err.message;
    report.error_stack = err.stack?.split('\n').slice(0, 5).join('\n');
    report.duration_ms = Date.now() - new Date(report.timestamp).getTime();

    return new Response(JSON.stringify(report, null, 2), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
