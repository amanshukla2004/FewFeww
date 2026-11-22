import { describe, it, expect, afterAll } from 'vitest';
import { buildServer } from '../server.js';
import { FastifyInstance } from 'fastify';

describe('Landing Website & Transparent Pricing Page (Step 29)', () => {
  let app: FastifyInstance;

  afterAll(async () => {
    if (app) await app.close();
  });

  it('serves landing homepage at GET / with 200 OK and pricing tiers', async () => {
    app = buildServer();
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('Simple, Transparent Pricing');
    expect(res.body).toContain('Basic');
    expect(res.body).toContain('₹62');
    expect(res.body).toContain('Pro');
    expect(res.body).toContain('₹91');
    expect(res.body).toContain('Enterprise');
    expect(res.body).toContain('Get started on WhatsApp');
    expect(res.body).toContain('Get started on Telegram');
  });

  it('serves dedicated pricing page at GET /pricing', async () => {
    app = buildServer();
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/pricing',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('20,000+ subscribers');
    expect(res.body).toContain('FewFeww');
  });
});
