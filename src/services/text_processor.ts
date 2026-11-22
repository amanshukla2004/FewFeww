import Groq from 'groq-sdk';
import { config } from '../config.js';

export type RewriteTone = 'FORMAL' | 'CASUAL' | 'CONCISE' | 'PERSUASIVE';

export interface RewriteInput {
  text: string;
  tone: RewriteTone;
}

export interface TranslateInput {
  text: string;
  targetLanguage: string;
}

export class TextProcessor {
  private groq: Groq;

  constructor(apiKey: string = config.llm.groqApiKey) {
    this.groq = new Groq({ apiKey });
  }

  /**
   * Rewrite/rephrase text in a specific tone.
   */
  async rewriteText(input: RewriteInput): Promise<{ result: string; formattedText: string }> {
    const cleanText = input.text.trim();
    const tone = input.tone || 'FORMAL';

    const systemPrompt = `You are an expert writing assistant. Rewrite the user's text to be ${tone.toLowerCase()}.
Maintain the core message, but adapt vocabulary, grammar, and phrasing to fit the requested tone.
Output ONLY the rewritten text without greetings, explanations, or quotes.`;

    const model = 'openai/gpt-oss-20b';
    try {
      const response = await this.groq.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: cleanText },
        ],
        temperature: 0.3,
        max_tokens: 400,
      });

      const rewritten = response.choices[0]?.message?.content?.trim() || cleanText;
      const formattedText =
        `✍️ <b>Rewritten (${tone}):</b>\n\n` +
        `<code>${rewritten}</code>`;

      return { result: rewritten, formattedText };
    } catch {
      // Fallback transformation if offline/mock
      let fallback = cleanText;
      if (tone === 'FORMAL') {
        fallback = `Dear colleague, I would like to convey that ${cleanText.toLowerCase()}.`;
      } else if (tone === 'CASUAL') {
        fallback = `Hey! Just wanted to share: ${cleanText}`;
      } else if (tone === 'CONCISE') {
        fallback = cleanText.split('.')[0];
      }

      const formattedText =
        `✍️ <b>Rewritten (${tone}):</b>\n\n` +
        `<code>${fallback}</code>`;

      return { result: fallback, formattedText };
    }
  }

  /**
   * Translate text into target language.
   */
  async translateText(input: TranslateInput): Promise<{ translated: string; formattedText: string }> {
    const cleanText = input.text.trim();
    const targetLang = input.targetLanguage.trim();

    const systemPrompt = `You are a professional multilingual translator. Translate the given text accurately and naturally into ${targetLang}.
Preserve names, formatting, and tone. Output ONLY the translated text without notes or intro.`;

    const model = 'openai/gpt-oss-20b';
    try {
      const response = await this.groq.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: cleanText },
        ],
        temperature: 0.2,
        max_tokens: 400,
      });

      const translated = response.choices[0]?.message?.content?.trim() || cleanText;
      const formattedText =
        `🌐 <b>Translation (${targetLang}):</b>\n\n` +
        `<code>${translated}</code>`;

      return { translated, formattedText };
    } catch {
      // Fallback
      const formattedText =
        `🌐 <b>Translation (${targetLang}):</b>\n\n` +
        `<code>[${targetLang}] ${cleanText}</code>`;

      return { translated: cleanText, formattedText };
    }
  }
}

export const textProcessor = new TextProcessor();
