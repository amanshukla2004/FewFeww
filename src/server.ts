import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import cors from '@fastify/cors';
import { config } from './config.js';
import { healthRoutes } from './routes/health.js';
import { webhookRoutes } from './routes/webhook.js';
import { whatsappRoutes } from './routes/whatsapp.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { landingRoutes } from './routes/landing.js';

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

  // Register WhatsApp Webhook Gateway Route
  app.register(whatsappRoutes);

  // Register Interactive Web Dashboard Route
  app.register(dashboardRoutes);

  // Register Landing Website & Transparent Pricing Page
  app.register(landingRoutes);

  return app;
}
