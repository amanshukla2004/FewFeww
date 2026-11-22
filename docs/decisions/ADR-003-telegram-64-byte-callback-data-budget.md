# ADR-003: Telegram 64-Byte Callback Data Payload Budget and Identity Keys

## Status
Accepted

## Date
2026-11-23

## Context
Telegram Bot API enforces a hard limit of **64 bytes** for inline keyboard `callback_data` payloads.
Interactive bot features (such as 1-tap Done, Snooze, Reschedule Tomorrow, Drop, and Clarification options) require encoding the entity type, operation, and entity ID within this single string.

## Decision
1. **Primary Keys:** Standardize all database primary keys on `BIGINT GENERATED ALWAYS AS IDENTITY`.
2. **Compact Action Prefixes:** Standardize callback payloads using concise single- or two-letter prefixes:
   - `r:done:<id>` (Mark reminder/task done)
   - `r:snz1:<id>` (Snooze 1 hour)
   - `r:tom:<id>` (Reschedule for tomorrow)
   - `r:drop:<id>` (Drop task)
   - `u:task:<id>` / `u:done:<id>` (Undo action)
   - `pause:<days>` (Pause proactive nudges)
   - `c:time:<opt>` (Clarification choice: `skip`, `tom`, `tonight`)

## Alternatives Considered

### UUIDv4 Primary Keys
- **Pros:** Decentralized ID generation, no sequential enumeration vulnerability.
- **Cons:** A standard UUID string requires 36 bytes (`123e4567-e89b-12d3-a456-426614174000`). With action prefix `r:done:`, 43 bytes are consumed, leaving zero headroom for additional context and risking silent Telegram API rejection.
- **Rejected:** Incompatible with compact Telegram callback requirements.

### Server-side session mapping (UUID -> short random token)
- **Pros:** Allows long payloads stored server-side.
- **Cons:** Requires a cache or table for transient button mappings, creating state expiration and cache-eviction issues when users click buttons on older messages.
- **Rejected:** Unnecessary state overhead when `BIGINT` identity keys fit directly inside 64 bytes.

## Consequences
- Inline callback payloads stay well within the 64-byte threshold (typically 10-18 bytes).
- Buttons on historical messages remain actionable indefinitely without relying on transient server state.
- Database index efficiency and query performance are maximized via 64-bit integer indexing.
