import { inboxRepo } from '../db/inbox.repo.js';

export class UpdateDispatcher {
  /**
   * Dispatches an update asynchronously to avoid blocking the webhook response.
   * Telegram requires webhooks to respond in < 50ms.
   */
  dispatchAsync(updateId: number): void {
    setImmediate(async () => {
      try {
        await this.processUpdate(updateId);
      } catch (err: any) {
        console.error(`[UpdateDispatcher] Error processing update ${updateId}:`, err);
        await inboxRepo.markStatus(updateId, 'FAILED', err?.message || 'Unknown processing error');
      }
    });
  }

  async processUpdate(updateId: number): Promise<void> {
    const record = await inboxRepo.getUpdate(updateId);
    if (!record) return;

    // Transition PENDING -> PROCESSING
    await inboxRepo.markStatus(updateId, 'PROCESSING');

    // Pipeline processing (Onboarding state machine & tool calling engine in Steps 5-7)
    // For Step 04 verification, update transitions cleanly to DONE
    await inboxRepo.markStatus(updateId, 'DONE');
  }
}

export const dispatcher = new UpdateDispatcher();
