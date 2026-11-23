# FewFeww — Project TODO & Backlog

## Pending Features & Enhancements

### 1. Admin Panel & Tester Approval Gate
- **Database Schema:**
  - Add `is_allowed BOOLEAN DEFAULT FALSE` or `access_status VARCHAR(32) DEFAULT 'PENDING'` (`'PENDING'`, `'ALLOWED'`, `'REJECTED'`) to the `users` table.
- **Telegram 1-Tap Mobile Approval:**
  - When an unapproved user starts `@FewFewwDevBot`, reply with a polite private-beta notice.
  - Forward an approval card to `ADMIN_CHAT_ID` with inline buttons `[✅ Approve]` and `[❌ Reject]`.
  - Tapping `[✅ Approve]` unlocks the user immediately and sends them an onboarding greeting.
  - Add admin commands: `/admin` (overview), `/approve <userId>`, `/revoke <userId>`.
- **Web Admin Dashboard (`/admin`):**
  - Fastify route at `/admin` protected by `ADMIN_SECRET` / signed token.
  - Visual table of all registered users with their Telegram handles, creation date, message count, and an Approve/Revoke toggle switch.

### 2. Post-MVP Features (Deferred)
- **WhatsApp Cloud API Outbound Gateway:** Complete live Meta token and approved reminder templates.
- **Twilio Outbound Voice Calling:** Production outbound automated phone call escalation (prototype in `VOICE_CALLING-demo/`).
