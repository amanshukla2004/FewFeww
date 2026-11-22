import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { buildServer } from '../server.js';
import { pool } from '../db/pool.js';
import { config } from '../config.js';

describe('Telegram Webhook & Idempotency Engine', () => {
  const app = buildServer();

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  const validPath = `/telegram/webhook/${config.telegram.webhookPath}`;
  const validSecret = config.telegram.webhookSecret;

  it('rejects request with missing secret token (403)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: validPath,
      payload: { update_id: 10001 },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'Forbidden' });
  });

  it('rejects request with incorrect secret token (403)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: validPath,
      headers: {
        'x-telegram-bot-api-secret-token': 'wrong-secret-token-xyz',
      },
      payload: { update_id: 10002 },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'Forbidden' });
  });

  it('rejects request with incorrect path (403)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/telegram/webhook/wrong-path',
      headers: {
        'x-telegram-bot-api-secret-token': validSecret,
      },
      payload: { update_id: 10003 },
    });

    expect(res.statusCode).toBe(403);
  });

  it('accepts valid update and stores in inbox_updates (200 OK)', async () => {
    const testUpdateId = 880001;

    // Clean up any existing row for this test ID
    await pool.query('DELETE FROM inbox_updates WHERE update_id = $1', [testUpdateId]);

    const res = await app.inject({
      method: 'POST',
      url: validPath,
      headers: {
        'x-telegram-bot-api-secret-token': validSecret,
      },
      payload: {
        update_id: testUpdateId,
        message: {
          message_id: 42,
          from: { id: 12345678, first_name: 'Aman' },
          chat: { id: 12345678 },
          text: 'submit DBMS assignment by Friday 6pm',
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.isNew).toBe(true);

    // Verify row in database
    const dbRes = await pool.query('SELECT * FROM inbox_updates WHERE update_id = $1', [testUpdateId]);
    expect(dbRes.rowCount).toBe(1);
    expect(Number(dbRes.rows[0].telegram_user_id)).toBe(12345678);
  });

  it('guarantees idempotency when replaying the same update 5 times', async () => {
    const replayUpdateId = 880002;

    await pool.query('DELETE FROM inbox_updates WHERE update_id = $1', [replayUpdateId]);

    const payload = {
      update_id: replayUpdateId,
      message: {
        message_id: 99,
        from: { id: 98765432, first_name: 'Rahul' },
        chat: { id: 98765432 },
        text: 'buy milk kal subah',
      },
    };

    // Send 5 identical requests consecutively
    const responses = [];
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: 'POST',
        url: validPath,
        headers: {
          'x-telegram-bot-api-secret-token': validSecret,
        },
        payload,
      });
      responses.push(res);
    }

    // All 5 requests must receive 200 OK
    for (const res of responses) {
      expect(res.statusCode).toBe(200);
    }

    // First request is new; next 4 are recognized as duplicates
    expect(responses[0].json().isNew).toBe(true);
    expect(responses[1].json().isNew).toBe(false);
    expect(responses[2].json().isNew).toBe(false);
    expect(responses[3].json().isNew).toBe(false);
    expect(responses[4].json().isNew).toBe(false);

    // Exactly 1 record in database
    const countRes = await pool.query('SELECT COUNT(*) AS total FROM inbox_updates WHERE update_id = $1', [replayUpdateId]);
    expect(parseInt(countRes.rows[0].total, 10)).toBe(1);
  });
});
