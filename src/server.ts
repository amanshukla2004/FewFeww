import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import cors from '@fastify/cors';
import { config } from './config.js';
import { healthRoutes } from './routes/health.js';
import { webhookRoutes } from './routes/webhook.js';

export function buildServer() {
  const app = Fastify({
    logger: {
      level: config.nodeEnv === 'development' ? 'info' : 'warn',
    },
    trustProxy: true,
  });

  app.register(sensible);
  app.register(cors, { origin: true });

  // Register Core Health Route
  app.register(healthRoutes);

  // Register Telegram Webhook Route
  app.register(webhookRoutes);

  return app;
}
