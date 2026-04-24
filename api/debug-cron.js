export const config = { runtime: 'nodejs', maxDuration: 60 };

export default async function handler(req) {
  return new Response(JSON.stringify({
    ok: true,
    env_telegram: !!process.env.TELEGRAM_BOT_TOKEN,
    env_cron: !!process.env.CRON_SECRET,
    timestamp: new Date().toISOString(),
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
