import { config } from '../config.js';
import { inboxRepo } from '../db/inbox.repo.js';
import { dispatcher } from '../services/dispatcher.js';
import { extractTelegramUserId } from '../routes/webhook.js';
import { reminderWorker } from '../services/reminder.worker.js';
import { morningDigest } from '../services/morning.digest.js';
import { resilienceService } from '../services/resilience.service.js';
import { pool } from '../db/pool.js';

async function startPolling() {
  console.log(`\n======================================================`);
  console.log(`🤖 Starting FewFeww Dev Long-Poller for @${config.telegram.botUsername}...`);
  console.log(`======================================================\n`);

  // Verify DB connection
  await pool.query('SELECT current_database()');
  console.log('✅ Connected to PostgreSQL database');

  // 1. Delete any existing webhook to enable long-polling
  try {
    const delRes = await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/deleteWebhook`);
    const delJson = await delRes.json();
    console.log(`ℹ️  Webhook cleared:`, delJson);
  } catch (err: any) {
    console.warn('⚠️  Could not clear webhook:', err.message);
  }

  // 2. Start background worker engines
  reminderWorker.start(10000);
  morningDigest.start(60000);

  const reaperInterval = setInterval(async () => {
    try {
      const { reapedReminders, reapedInbox } = await resilienceService.runReaperCycle();
      if (reapedReminders > 0 || reapedInbox > 0) {
        console.log(`[StuckJobReaper] Reaped ${reapedReminders} reminders and ${reapedInbox} inbox updates`);
      }
    } catch {}
  }, 60000);

  let offset = 0;
  try {
    const maxRes = await pool.query('SELECT MAX(update_id) as max_id FROM inbox_updates');
    if (maxRes.rows[0]?.max_id) {
      offset = Number(maxRes.rows[0].max_id) + 1;
      console.log(`ℹ️  Resuming polling from update offset: ${offset}`);
    }
  } catch (err: any) {
    console.warn('⚠️  Could not read max update_id:', err.message);
  }

  console.log(`\n🚀 FEWFEWW IS LIVE & LISTENING!`);
  console.log(`👉 Open Telegram on your phone/PC and message: @${config.telegram.botUsername}`);
  console.log(`👉 Send "/start" to begin onboarding!\n`);

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\nShutting down dev poller gracefully...');
    clearInterval(reaperInterval);
    reminderWorker.stop();
    morningDigest.stop();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  while (true) {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${config.telegram.botToken}/getUpdates?offset=${offset}&timeout=20`,
        { signal: AbortSignal.timeout(30000) }
      );
      const data = (await res.json()) as any;

      if (data.ok && Array.isArray(data.result)) {
        for (const update of data.result) {
          offset = update.update_id + 1;
          const uid = extractTelegramUserId(update);
          const isNew = await inboxRepo.insertIfAbsent(update.update_id, uid, update);
          if (isNew) {
            console.log(`📥 Received update #${update.update_id} from Telegram`);
            await dispatcher.processUpdate(update.update_id);
          }
        }
      } else if (!data.ok) {
        console.warn('Telegram API response error:', data);
        await new Promise((r) => setTimeout(r, 3000));
      }
    } catch (err: any) {
      console.error('Long-polling error:', err.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

startPolling();
