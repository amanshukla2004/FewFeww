import { pool } from '../src/db/pool.js';
import { telegram } from '../src/services/telegram.client.js';

async function main() {
  const userRes = await pool.query("SELECT * FROM users WHERE telegram_user_id = '6986738528'");
  console.log('User in DB:', userRes.rows);

  const msgsRes = await pool.query("SELECT * FROM messages ORDER BY id DESC LIMIT 5");
  console.log('Recent messages:', msgsRes.rows);

  // Send a test message directly to Rajjo (6986738528) via Telegram Bot
  try {
    const res = await telegram.sendMessage(6986738528, '👋 Hello Rajjo! FewFeww Telegram Bot is online and connected!');
    console.log('Direct test sendMessage result:', res);
  } catch (err: any) {
    console.error('Direct test sendMessage error:', err);
  }

  await pool.end();
}

main();
