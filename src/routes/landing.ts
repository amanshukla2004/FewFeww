import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export async function landingRoutes(app: FastifyInstance) {
  const telegramBotUsername = process.env.TELEGRAM_BOT_USERNAME || 'FewFewwDevBot';

  const renderLandingHtml = () => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FewFeww — Universal Productivity Assistant & Habit Tracker</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090a0d;
      --card-bg: #12151a;
      --card-hover: #171b22;
      --border: #222730;
      --border-highlight: #3b82f6;
      --text: #ffffff;
      --text-muted: #94a3b8;
      --primary: #3b82f6;
      --accent: #10b981;
      --badge-bg: #2d3748;
      --radius-lg: 20px;
      --radius-md: 12px;
    }

    :focus-visible {
      outline: 2px solid var(--border-highlight);
      outline-offset: 3px;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }

    /* Navigation Bar */
    header {
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      background: rgba(9, 10, 13, 0.85);
      backdrop-filter: blur(12px);
      z-index: 100;
    }

    .nav-container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 16px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 20px;
      font-weight: 800;
      color: #fff;
      text-decoration: none;
    }

    .brand-icon {
      width: 32px;
      height: 32px;
      background: linear-gradient(135deg, #3b82f6, #6366f1);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
    }

    .nav-links {
      display: flex;
      align-items: center;
      gap: 28px;
    }

    .nav-link {
      color: var(--text-muted);
      text-decoration: none;
      font-size: 14px;
      font-weight: 500;
      transition: color 0.15s ease;
    }

    .nav-link:hover, .nav-link.active {
      color: var(--text);
    }

    .nav-actions {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .btn-nav-outline {
      color: var(--text);
      text-decoration: none;
      font-size: 13px;
      font-weight: 600;
      padding: 8px 16px;
      border: 1px solid var(--border);
      border-radius: 8px;
      transition: all 0.15s ease;
    }

    .btn-nav-outline:hover {
      background: var(--card-bg);
      border-color: #3b4252;
    }

    .btn-nav-primary {
      background: #ffffff;
      color: #000000;
      text-decoration: none;
      font-size: 13px;
      font-weight: 600;
      padding: 8px 18px;
      border-radius: 8px;
      transition: opacity 0.15s ease;
    }

    .btn-nav-primary:hover {
      opacity: 0.9;
    }

    /* Main Container */
    main {
      flex: 1;
      max-width: 1200px;
      margin: 0 auto;
      padding: 60px 24px 80px;
      width: 100%;
    }

    .hero-title {
      text-align: center;
      font-size: 40px;
      font-weight: 800;
      letter-spacing: -0.5px;
      margin-bottom: 12px;
    }

    .hero-subtitle {
      text-align: center;
      color: var(--text-muted);
      font-size: 16px;
      max-width: 580px;
      margin: 0 auto 50px;
    }

    /* Pricing Grid */
    .pricing-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 24px;
      align-items: stretch;
    }

    @media (max-width: 960px) {
      .pricing-grid {
        grid-template-columns: 1fr;
        max-width: 480px;
        margin: 0 auto;
      }
      .nav-links { display: none; }
    }

    .pricing-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: 32px 28px;
      display: flex;
      flex-direction: column;
      position: relative;
      transition: transform 0.2s ease, border-color 0.2s ease;
    }

    .pricing-card:hover {
      border-color: #3b4252;
    }

    .pricing-card.popular {
      border-color: #3b82f6;
      background: linear-gradient(180deg, #161b24 0%, #12151a 100%);
      box-shadow: 0 0 30px rgba(59, 130, 246, 0.15);
    }

    .card-badge {
      position: absolute;
      top: -12px;
      right: 24px;
      background: #3b82f6;
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      padding: 4px 12px;
      border-radius: 20px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .tier-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 12px;
    }

    .tier-name {
      font-size: 20px;
      font-weight: 700;
    }

    .tier-desc {
      color: var(--text-muted);
      font-size: 13px;
      line-height: 1.5;
      min-height: 40px;
      margin-bottom: 24px;
    }

    .tier-price-wrap {
      margin-bottom: 24px;
      padding-bottom: 24px;
      border-bottom: 1px solid var(--border);
    }

    .price-large {
      font-size: 38px;
      font-weight: 800;
      display: inline-flex;
      align-items: baseline;
    }

    .price-period {
      font-size: 14px;
      font-weight: 500;
      color: var(--text-muted);
      margin-left: 4px;
    }

    .price-billed {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 4px;
    }

    .features-list {
      list-style: none;
      margin-bottom: 32px;
      flex: 1;
    }

    .feature-item {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      font-size: 13px;
      color: #e2e8f0;
      margin-bottom: 12px;
      line-height: 1.4;
    }

    .feature-check {
      color: #3b82f6;
      font-weight: bold;
      flex-shrink: 0;
    }

    /* Buttons */
    .btn-group {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-top: auto;
    }

    .btn-channel {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 12px 18px;
      border-radius: var(--radius-md);
      font-size: 13px;
      font-weight: 600;
      text-decoration: none;
      transition: all 0.15s ease;
    }

    .btn-whatsapp {
      background: rgba(37, 211, 102, 0.12);
      color: #25d366;
      border: 1px solid rgba(37, 211, 102, 0.3);
    }

    .btn-whatsapp:hover {
      background: rgba(37, 211, 102, 0.2);
    }

    .btn-telegram {
      background: rgba(41, 182, 246, 0.12);
      color: #29b6f6;
      border: 1px solid rgba(41, 182, 246, 0.3);
    }

    .btn-telegram:hover {
      background: rgba(41, 182, 246, 0.2);
    }

    .btn-enterprise {
      background: #ffffff;
      color: #000000;
      border: 1px solid #ffffff;
    }

    .btn-enterprise:hover {
      opacity: 0.9;
    }

    footer {
      border-top: 1px solid var(--border);
      padding: 24px;
      text-align: center;
      color: var(--text-muted);
      font-size: 13px;
    }
  </style>
</head>
<body>
  <!-- Header / Navigation -->
  <header>
    <div class="nav-container">
      <a href="/" class="brand">
        <div class="brand-icon">⚡</div>
        <span>FewFeww</span>
      </a>

      <nav class="nav-links">
        <a href="#about" class="nav-link">About</a>
        <a href="#changelog" class="nav-link">Changelog</a>
        <a href="#roadmap" class="nav-link">Roadmap</a>
        <a href="/pricing" class="nav-link active" aria-current="page">Pricing</a>
        <a href="#features" class="nav-link">Features</a>
        <a href="#contact" class="nav-link">Contact</a>
      </nav>

      <div class="nav-actions">
        <a href="/dashboard" class="btn-nav-outline">Dashboard</a>
        <a href="https://t.me/${telegramBotUsername}" target="_blank" rel="noopener noreferrer" class="btn-nav-primary">Get started</a>
      </div>
    </div>
  </header>

  <!-- Main Content -->
  <main>
    <h1 class="hero-title">Simple, Transparent Pricing</h1>
    <p class="hero-subtitle">
      Automate your tasks, track everyday habits, and manage schedules seamlessly on WhatsApp & Telegram.
    </p>

    <!-- 3-Tier Grid matching HelloAria -->
    <div class="pricing-grid">
      <!-- 1. Basic Tier -->
      <div class="pricing-card">
        <div class="tier-header">
          <span style="font-size: 20px;" aria-hidden="true">🪄</span>
          <h2 class="tier-name">Basic</h2>
        </div>
        <p class="tier-desc">
          Perfect for individuals getting started with AI productivity assistance and basic WhatsApp automation.
        </p>
        <div class="tier-price-wrap">
          <div class="price-large">₹62<span class="price-period">/month</span></div>
          <div class="price-billed">Billed yearly (₹749)</div>
        </div>
        <ul class="features-list">
          <li class="feature-item"><span class="feature-check" aria-hidden="true">✓</span> Unlimited messages</li>
          <li class="feature-item"><span class="feature-check" aria-hidden="true">✓</span> Unlimited one-time reminders</li>
          <li class="feature-item"><span class="feature-check" aria-hidden="true">✓</span> 100+ languages supported</li>
          <li class="feature-item"><span class="feature-check" aria-hidden="true">✓</span> 5 Voice Notes / Month</li>
          <li class="feature-item"><span class="feature-check" aria-hidden="true">✓</span> 5 Image Analysis / Month</li>
          <li class="feature-item"><span class="feature-check" aria-hidden="true">✓</span> Receive reminders from circles</li>
        </ul>
        <div class="btn-group">
          <a href="/webhook/whatsapp" class="btn-channel btn-whatsapp">💬 Get started on WhatsApp</a>
          <a href="https://t.me/${telegramBotUsername}" target="_blank" rel="noopener noreferrer" class="btn-channel btn-telegram">✈️ Get started on Telegram</a>
        </div>
      </div>

      <!-- 2. Pro Tier (Popular) -->
      <div class="pricing-card popular">
        <span class="card-badge">⚡ Popular • 20,000+ subscribers</span>
        <div class="tier-header">
          <span style="font-size: 20px;" aria-hidden="true">⚡</span>
          <h2 class="tier-name">Pro</h2>
        </div>
        <p class="tier-desc">
          Advanced features for power users including Google integrations, AI memory, and enhanced automation capabilities.
        </p>
        <div class="tier-price-wrap">
          <div class="price-large">₹91<span class="price-period">/month</span></div>
          <div class="price-billed">Billed yearly (₹1089)</div>
        </div>
        <ul class="features-list">
          <li class="feature-item"><span class="feature-check" aria-hidden="true">✓</span> <b>Everything in Basic, plus:</b></li>
          <li class="feature-item"><span class="feature-check" aria-hidden="true">✓</span> Repeat reminders (daily, weekly, monthly)</li>
          <li class="feature-item"><span class="feature-check" aria-hidden="true">✓</span> Drive, Calendar, Gmail and GMeet integrations</li>
          <li class="feature-item"><span class="feature-check" aria-hidden="true">✓</span> Unlimited Voice Notes (Whisper)</li>
          <li class="feature-item"><span class="feature-check" aria-hidden="true">✓</span> Unlimited Image Analysis</li>
          <li class="feature-item"><span class="feature-check" aria-hidden="true">✓</span> Send/receive reminders with circles</li>
          <li class="feature-item"><span class="feature-check" aria-hidden="true">✓</span> Built-in Habit Tracking (Weight, LeetCode, etc.)</li>
          <li class="feature-item"><span class="feature-check" aria-hidden="true">✓</span> AI Memory</li>
          <li class="feature-item"><span class="feature-check" aria-hidden="true">✓</span> 30 Internet Searches / Month</li>
          <li class="feature-item"><span class="feature-check" aria-hidden="true">✓</span> Create & Manage Lists</li>
        </ul>
        <div class="btn-group">
          <a href="/webhook/whatsapp" class="btn-channel btn-whatsapp">💬 Get started on WhatsApp</a>
          <a href="https://t.me/${telegramBotUsername}" target="_blank" rel="noopener noreferrer" class="btn-channel btn-telegram">✈️ Get started on Telegram</a>
        </div>
      </div>

      <!-- 3. Enterprise Tier -->
      <div class="pricing-card">
        <div class="tier-header">
          <span style="font-size: 20px;" aria-hidden="true">🏢</span>
          <h2 class="tier-name">Enterprise</h2>
        </div>
        <p class="tier-desc">
          Unlimited access with custom integrations, dedicated support, and advanced security for teams and organizations.
        </p>
        <div class="tier-price-wrap">
          <div class="price-large">Custom</div>
          <div class="price-billed">Tailored to your team size</div>
        </div>
        <ul class="features-list">
          <li class="feature-item"><span class="feature-check" aria-hidden="true">✓</span> <b>Everything in Pro, plus:</b></li>
          <li class="feature-item"><span class="feature-check" aria-hidden="true">✓</span> Unlimited Minutes of Meeting (MOM)</li>
          <li class="feature-item"><span class="feature-check" aria-hidden="true">✓</span> Custom Cloud & ERP Integrations</li>
          <li class="feature-item"><span class="feature-check" aria-hidden="true">✓</span> Dedicated Account Manager</li>
          <li class="feature-item"><span class="feature-check" aria-hidden="true">✓</span> Advanced Security & Compliance</li>
          <li class="feature-item"><span class="feature-check" aria-hidden="true">✓</span> Custom SLAs & On-Premises Option</li>
        </ul>
        <div class="btn-group">
          <a href="mailto:support@fewfeww.io?subject=Enterprise%20Inquiry" class="btn-channel btn-enterprise">📅 Book a demo</a>
        </div>
      </div>
    </div>
  </main>

  <!-- Footer -->
  <footer>
    <div style="max-width: 1200px; margin: 0 auto; display: flex; justify-content: space-between; align-items: center; flex-wrap: gap;">
      <span>© 2026 FewFeww Inc. Universal Productivity Assistant.</span>
      <div style="display: flex; gap: 16px;">
        <a href="/dashboard" style="color: var(--text-muted); text-decoration: none;">Dashboard</a>
        <a href="https://t.me/${telegramBotUsername}" style="color: var(--text-muted); text-decoration: none;">Telegram</a>
        <a href="/webhook/whatsapp" style="color: var(--text-muted); text-decoration: none;">WhatsApp</a>
      </div>
    </div>
  </footer>
</body>
</html>`;

  // Serve at root and /pricing
  app.get('/', async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.type('text/html');
    return reply.code(200).send(renderLandingHtml());
  });

  app.get('/pricing', async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.type('text/html');
    return reply.code(200).send(renderLandingHtml());
  });
}
