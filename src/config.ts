import dotenv from 'dotenv';

dotenv.config();

export interface AppConfig {
  port: number;
  nodeEnv: string;
  appBaseUrl: string;
  databaseUrl: string;
  telegram: {
    botToken: string;
    botUsername: string;
    webhookSecret: string;
    webhookPath: string;
  };
  llm: {
    provider: string;
    groqApiKey: string;
    model: string;
  };
  defaults: {
    timezone: string;
    reminderTime: string;
    leadMinutes: number;
    quietStart: string;
    quietEnd: string;
  };
  adminChatId?: number;
  allowedTelegramUserIds: string[];
}

export const config: AppConfig = {
  port: parseInt(process.env.PORT || '8080', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:8080',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://fewfeww:devpassword@localhost:5432/fewfeww',
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    botUsername: process.env.TELEGRAM_BOT_USERNAME || 'FewFewwDevBot',
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || '',
    webhookPath: process.env.TELEGRAM_WEBHOOK_PATH || 'webhook-dev-fewfeww',
  },
  llm: {
    provider: process.env.LLM_PROVIDER || 'groq',
    groqApiKey: process.env.GROQ_API_KEY || '',
    model: process.env.LLM_MODEL || 'openai/gpt-oss-120b',
  },
  defaults: {
    timezone: process.env.DEFAULT_TIMEZONE || 'Asia/Kolkata',
    reminderTime: process.env.DEFAULT_REMINDER_TIME || '09:00',
    leadMinutes: parseInt(process.env.DEFAULT_LEAD_MINUTES || '60', 10),
    quietStart: process.env.QUIET_START || '22:00',
    quietEnd: process.env.QUIET_END || '07:00',
  },
  adminChatId: process.env.ADMIN_CHAT_ID ? parseInt(process.env.ADMIN_CHAT_ID, 10) : undefined,
  allowedTelegramUserIds: (process.env.ALLOWED_TELEGRAM_USER_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};
