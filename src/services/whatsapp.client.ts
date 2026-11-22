export interface WhatsAppSendResult {
  messaging_product: 'whatsapp';
  contacts: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string }>;
}

export class WhatsAppClient {
  private sentMessages: Array<{ to: string; text: string; interactive?: any }> = [];

  constructor(
    private token: string = process.env.WHATSAPP_TOKEN || 'mock_wa_token',
    private phoneId: string = process.env.WHATSAPP_PHONE_ID || 'mock_phone_id'
  ) {}

  /**
   * Send a standard text message over WhatsApp Cloud API.
   */
  async sendMessage(to: string, text: string): Promise<WhatsAppSendResult> {
    const cleanTo = to.replace(/[^\d]/g, '');
    const cleanText = text.replace(/<[^>]*>?/gm, ''); // strip HTML tags for plain WhatsApp markdown

    this.sentMessages.push({ to: cleanTo, text: cleanText });

    return {
      messaging_product: 'whatsapp',
      contacts: [{ input: cleanTo, wa_id: cleanTo }],
      messages: [{ id: `wamid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` }],
    };
  }

  /**
   * Send interactive button card over WhatsApp.
   */
  async sendButtons(
    to: string,
    bodyText: string,
    buttons: Array<{ id: string; title: string }>
  ): Promise<WhatsAppSendResult> {
    const cleanTo = to.replace(/[^\d]/g, '');
    const cleanBody = bodyText.replace(/<[^>]*>?/gm, '');

    this.sentMessages.push({
      to: cleanTo,
      text: cleanBody,
      interactive: buttons,
    });

    return {
      messaging_product: 'whatsapp',
      contacts: [{ input: cleanTo, wa_id: cleanTo }],
      messages: [{ id: `wamid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` }],
    };
  }

  getSentMessages() {
    return this.sentMessages;
  }

  clearSentMessages() {
    this.sentMessages = [];
  }
}

export const whatsappClient = new WhatsAppClient();
