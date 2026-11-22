import { buildServer } from './server.js';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { reminderWorker } from './services/reminder.worker.js';
import { morningDigest } from './services/morning.digest.js';
import { resilienceService } from './services/resilience.service.js';

async function start() {
  const app = buildServer();
  let reaperInterval: NodeJS.Timeout | null = null;

  try {
    // Verify DB connectivity on boot
    const dbRes = await pool.query('SELECT current_database(), version()');
    app.log.info(`Connected to PostgreSQL: ${dbRes.rows[0].current_database}`);

    // Start Persistent Scheduler (10s interval)
    reminderWorker.start(10000);

    // Start Daily Morning Plan Poller (60s interval)
    morningDigest.start(60000);

    // Start 1-Minute Stuck Job Reaper
    reaperInterval = setInterval(async () => {
      try {
        const { reapedReminders, reapedInbox } = await resilienceService.runReaperCycle();
        if (reapedReminders > 0 || reapedInbox > 0) {
          app.log.warn(`[StuckJobReaper] Reaped ${reapedReminders} reminders and ${reapedInbox} inbox updates`);
        }
      } catch (e) {
        app.log.error(e, '[StuckJobReaper] Error running reaper cycle');
      }
    }, 60000);

    await app.listen({ port: config.port, host: '0.0.0.0' });
    console.log(`\n🚀 FewFeww Backend running on port ${config.port}`);
    console.log(`👉 Health check: http://localhost:${config.port}/health\n`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // Graceful shutdown
  const closeSignals = ['SIGINT', 'SIGTERM'] as const;
  for (const sig of closeSignals) {
    process.on(sig, async () => {
      console.log(`\nReceived ${sig}, shutting down gracefully...`);
      if (reaperInterval) clearInterval(reaperInterval);
      reminderWorker.stop();
      morningDigest.stop();
      await app.close();
      await pool.end();
      process.exit(0);
    });
  }
}

start();
