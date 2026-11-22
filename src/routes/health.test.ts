import { describe, it, expect, afterAll } from 'vitest';
import { buildServer } from '../server.js';
import { pool } from '../db/pool.js';

describe('Health Check Endpoint', () => {
  const app = buildServer();

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('GET /health returns 200 with database CONNECTED', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('UP');
    expect(body.database.status).toBe('CONNECTED');
    expect(typeof body.database.latencyMs).toBe('number');
    expect(body.database.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
