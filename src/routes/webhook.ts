import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { config } from '../config.js';
import { inboxRepo } from '../db/inbox.repo.js';
import { dispatcher } from '../services/dispatcher.js';

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a || '', 'utf8');
  const bufB = Buffer.from(b || '', 'utf8');
  if (bufA.length === 0 || bufB.length === 0 || bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export function extractTelegramUserId(update: any): number | null {
  if (update?.message?.from?.id) return update.message.from.id;
  if (update?.callback_query?.from?.id) return update.callback_query.from.id;
  if (update?.edited_message?.from?.id) return update.edited_message.from.id;
  if (update?.my_chat_member?.from?.id) return update.my_chat_member.from.id;
  return null;
}

export async function webhookRoutes(app: FastifyInstance) {
  app.post<{
    Params: { path: string };
  }>('/telegram/webhook/:path', async (request, reply) => {
    const { path } = request.params;
    const incomingToken = request.headers['x-telegram-bot-api-secret-token'] as string | undefined;

    // 1. Validate Secret Path and Token with constant-time equality
    const isPathValid = path === config.telegram.webhookPath;
    const isTokenValid = incomingToken ? timingSafeEqual(incomingToken, config.telegram.webhookSecret) : false;

    if (!isPathValid || !isTokenValid) {
      app.log.warn({ path, ip: request.ip }, 'Unauthorized webhook request attempt');
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const update = request.body as any;
    if (!update || typeof update.update_id !== 'number') {
      return reply.code(400).send({ error: 'Invalid update payload: update_id missing' });
    }

    const updateId = update.update_id;
    const telegramUserId = extractTelegramUserId(update);

    // 2. Idempotent insert into inbox_updates
    const isNew = await inboxRepo.insertIfAbsent(updateId, telegramUserId, update);

    // 3. If newly received, dispatch asynchronously without blocking the 200 OK response
    if (isNew) {
      dispatcher.dispatchAsync(updateId);
    } else {
      app.log.info({ updateId }, 'Duplicate Telegram update received, ignoring handoff');
    }

    // 4. Return 200 OK immediately (< 50ms)
    return reply.code(200).send({ ok: true, isNew });
  });
}
