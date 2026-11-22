import { buildServer } from './server.js';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { reminderWorker } from './services/reminder.worker.js';
import { morningDigest } from './services/morning.digest.js';

async function start() {
  const app = buildServer();

  try {
    // Verify DB connectivity on boot
    const dbRes = await pool.query('SELECT current_database(), version()');
    app.log.info(`Connected to PostgreSQL: ${dbRes.rows[0].current_database}`);

    // Start Persistent Scheduler (10s interval)
    reminderWorker.start(10000);

    // Start Daily Morning Plan Poller (60s interval)
    morningDigest.start(60000);

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
      reminderWorker.stop();
      morningDigest.stop();
      await app.close();
      await pool.end();
      process.exit(0);
    });
  }
}

start();
