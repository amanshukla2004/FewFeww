import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildServer } from '../server.js';
import { whatsappClient } from '../services/whatsapp.client.js';
import { pool } from '../db/pool.js';
import { FastifyInstance } from 'fastify';

describe('WhatsApp Omnichannel Gateway (Step 27)', () => {
  let app: FastifyInstance;
  const testPhone = '919876543210';

  beforeEach(async () => {
    whatsappClient.clearSentMessages();
    await pool.query('DELETE FROM users WHERE phone_number = $1', [testPhone]);
  });

  afterAll(async () => {
    await app.close();
  });

  it('verifies Meta webhook challenge with valid hub.verify_token (GET)', async () => {
    app = buildServer();
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=fewfeww_wa_verify_secret&hub.challenge=test_challenge_12345',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('test_challenge_12345');
  });

  it('rejects verification if token is invalid (GET)', async () => {
    app = buildServer();
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=wrong_token&hub.challenge=123',
    });

    expect(response.statusCode).toBe(403);
  });

  it('ingests task message from WhatsApp and replies to the user phone number (POST)', async () => {
    app = buildServer();
    await app.ready();

    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'wa_biz_1',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                contacts: [{ profile: { name: 'Rohit' }, wa_id: testPhone }],
                messages: [
                  {
                    from: testPhone,
                    id: 'wamid.HBgLM...',
                    timestamp: '1700000000',
                    text: { body: 'Buy fresh groceries tonight' },
                    type: 'text',
                  },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    const response = await app.inject({
      method: 'POST',
      url: '/webhook/whatsapp',
      payload,
    });

    expect(response.statusCode).toBe(200);

    // Verify user created with channel = WHATSAPP
    const userRes = await pool.query('SELECT * FROM users WHERE phone_number = $1', [testPhone]);
    expect(userRes.rowCount).toBe(1);
    expect(userRes.rows[0].channel).toBe('WHATSAPP');
    expect(userRes.rows[0].first_name).toBe('Rohit');

    // Verify task created in database
    const taskRes = await pool.query('SELECT * FROM tasks WHERE user_id = $1', [userRes.rows[0].id]);
    expect(taskRes.rowCount).toBe(1);
    expect(taskRes.rows[0].title).toBe('Buy fresh groceries tonight');

    // Verify outbound reply sent via WhatsApp
    const sent = whatsappClient.getSentMessages();
    expect(sent.length).toBe(1);
    expect(sent[0].to).toBe(testPhone);
    expect(sent[0].text).toContain('Buy fresh groceries tonight');
  });

  it('ingests habit logs like weight tracking from WhatsApp (POST)', async () => {
    app = buildServer();
    await app.ready();

    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                contacts: [{ profile: { name: 'Rohit' }, wa_id: testPhone }],
                messages: [
                  {
                    from: testPhone,
                    id: 'wamid.HBgLM2...',
                    text: { body: 'today my weight is 88 kg' },
                    type: 'text',
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const response = await app.inject({
      method: 'POST',
      url: '/webhook/whatsapp',
      payload,
    });

    expect(response.statusCode).toBe(200);

    const sent = whatsappClient.getSentMessages();
    expect(sent.length).toBe(1);
    expect(sent[0].text).toContain('Weight');
    expect(sent[0].text).toContain('88');
  });
});
