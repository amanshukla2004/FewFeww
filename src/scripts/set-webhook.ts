import { config } from '../config.js';

async function setTelegramWebhook() {
  const webhookUrl = `${config.appBaseUrl}/telegram/webhook/${config.telegram.webhookPath}`;
  console.log(`\n--- Registering Telegram Webhook ---`);
  console.log(`Bot: @${config.telegram.botUsername}`);
  console.log(`Target URL: ${webhookUrl}`);

  const apiUrl = `https://api.telegram.org/bot${config.telegram.botToken}/setWebhook`;

  const payload = {
    url: webhookUrl,
    secret_token: config.telegram.webhookSecret,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: false,
  };

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (data.ok) {
    console.log('✅ Webhook successfully registered with Telegram!');
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.error('❌ Failed to register webhook:');
    console.error(JSON.stringify(data, null, 2));
  }
}

setTelegramWebhook().catch(console.error);
