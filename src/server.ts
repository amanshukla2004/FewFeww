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

  // Security Headers (CSP, HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy)
  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self';"
    );
  });

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
