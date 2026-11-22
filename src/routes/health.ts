import { FastifyInstance } from 'fastify';
import { pool } from '../db/pool.js';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async (request, reply) => {
    const start = Date.now();
    try {
      const dbRes = await pool.query('SELECT 1 AS ok');
      const latencyMs = Date.now() - start;

      return reply.code(200).send({
        status: 'UP',
        timestamp: new Date().toISOString(),
        database: {
          status: 'CONNECTED',
          latencyMs,
        },
      });
    } catch (err: any) {
      return reply.code(503).send({
        status: 'DOWN',
        timestamp: new Date().toISOString(),
        database: {
          status: 'DISCONNECTED',
          error: err.message,
        },
      });
    }
  });
}
