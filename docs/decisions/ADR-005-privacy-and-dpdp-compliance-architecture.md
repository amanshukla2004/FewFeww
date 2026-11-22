# ADR-005: Privacy, Consent & DPDP Act 2023 Compliance Architecture

## Status
Accepted

## Date
2026-11-23

## Context
FewFeww processes personal productivity data, calendar schedules, private reminders, and meeting notes.
Under the **Digital Personal Data Protection Act 2023 (DPDP Act, India)** and global data protection frameworks (such as GDPR):
1. Users must give informed, explicit consent prior to processing (`onboarding_state = 'AWAITING_CONSENT'`).
2. Users have a statutory **Right to Access & Data Portability** (download all personal data in machine-readable format).
3. Users have a statutory **Right to Erasure / Right to be Forgotten** (unconditional deletion of all personal data upon request).

## Decision
1. **Consent Gate:** Inbound messages from new users are blocked until the user explicitly accepts privacy terms via `/start` inline consent buttons (`user.repo.ts`).
2. **Instant Data Export (`/export`):** `PrivacyService.exportUserData` compiles all user data (tasks, habits, notes, reminders, events, messages) into structured JSON and standard RFC 4180 CSV files, streaming them directly to the user via Telegram's `sendDocument` API.
3. **Hard Erasure (`/deleteme`):** `PrivacyService.deleteUserData` executes a single atomic transaction deleting the user record from PostgreSQL. Foreign key constraints (`ON DELETE CASCADE`) automatically wipe all linked records across tasks, reminders, notes, habit logs, circles, and messages.

## Alternatives Considered

### Soft Deletion (`status = 'DELETED'`)
- **Pros:** Retains analytical history; easy to restore accidental deletes.
- **Cons:** Violates statutory erasure mandates if PII continues to reside on primary tables without strict justification.
- **Rejected:** DPDP Act mandates permanent deletion of personal data when purpose ceases. Hard delete guarantees complete compliance.

### Manual Data Request Support Desk (Email / Ticket)
- **Pros:** No automated export code required initially.
- **Cons:** High operational friction, delays in meeting 72-hour statutory turnaround windows, error-prone manual data gathering.
- **Rejected:** Automation provides immediate self-service compliance with zero staff overhead.

## Consequences
- Zero compliance debt: privacy is an enforced system constraint from Day 1.
- Immediate export delivery (< 2 seconds) directly inside the chat interface.
- Complete hard delete eliminates liability for retained dormant data.
