import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { userRepo } from '../db/user.repo.js';
import { whatsappClient } from '../services/whatsapp.client.js';
import { taskService } from '../services/task.service.js';
import { habitService } from '../services/habit.service.js';

export async function whatsappRoutes(app: FastifyInstance) {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'fewfeww_wa_verify_secret';

  /**
   * Meta Webhook Verification Endpoint (GET)
   */
  app.get('/webhook/whatsapp', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as Record<string, string>;
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    if (mode === 'subscribe' && token === verifyToken) {
      reply.header('content-type', 'text/plain');
      return reply.code(200).send(challenge);
    }

    return reply.code(403).send('Forbidden: Invalid verification token');
  });

  /**
   * Inbound WhatsApp Message Ingestion Webhook (POST)
   */
  app.post('/webhook/whatsapp', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as any;

    const entry = body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const messages = value?.messages;

    if (!messages || messages.length === 0) {
      return reply.code(200).send({ status: 'ignored_no_messages' });
    }

    for (const msg of messages) {
      const fromPhone = msg.from;
      const contact = value?.contacts?.find((c: any) => c.wa_id === fromPhone);
      const profileName = contact?.profile?.name || 'WhatsApp Friend';
      const text = msg.text?.body || msg.interactive?.button_reply?.title || '';

      if (!fromPhone || !text) continue;

      const { user } = await userRepo.findOrCreateByPhone(fromPhone, profileName);

      // Check if message is a habit log (e.g. "today my weight is 90" or "did 5 lc")
      const weightMatch = text.match(/(?:weight|weigh|wt)\s*(?:is|:)?\s*(\d+(?:\.\d+)?)\s*(kg|lbs)?/i);
      const lcMatch = text.match(/(?:did|solved)?\s*(\d+)\s*(?:lc|leet\s*code)/i);

      if (weightMatch) {
        const val = parseFloat(weightMatch[1]);
        const habitRes = await habitService.logHabit({
          userId: user.id,
          habitName: 'Weight',
          value: val,
          unit: weightMatch[2] || 'kg',
        });
        await whatsappClient.sendMessage(fromPhone, habitRes.formattedText);
        continue;
      }

      if (lcMatch) {
        const count = parseInt(lcMatch[1], 10);
        const habitRes = await habitService.logHabit({
          userId: user.id,
          habitName: 'LeetCode',
          value: count,
          unit: 'problems',
        });
        await whatsappClient.sendMessage(fromPhone, habitRes.formattedText);
        continue;
      }

      // Default: Create task or reminder
      const taskRes = await taskService.createTask({
        userId: user.id,
        title: text,
        userTimezone: user.timezone,
        defaultReminderTime: user.default_reminder_time,
      });

      await whatsappClient.sendMessage(fromPhone, taskRes.text);
    }

    return reply.code(200).send({ status: 'success' });
  });
}
