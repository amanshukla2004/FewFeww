# Architecture Decision Records (ADRs)

This directory documents the significant technical and architectural decisions for the **FewFeww** platform, capturing the context, options evaluated, decisions made, and operational consequences.

## Index of Decisions

| ADR | Title | Status | Date | Decision Summary |
|---|---|---|---|---|
| [ADR-001](ADR-001-postgres-skip-locked-scheduler.md) | Native PostgreSQL Poller with SKIP LOCKED for Task Scheduling | **Accepted** | 2026-11-23 | Use PostgreSQL 17 `SELECT ... FOR UPDATE SKIP LOCKED` for zero-cost, persistent, ACID-safe job dispatch instead of Redis/BullMQ. |
| [ADR-002](ADR-002-deterministic-date-engine.md) | Deterministic Date Engine (Chrono-Node + Luxon) vs LLM Computation | **Accepted** | 2026-11-23 | LLM semantic extraction only; deterministic code (`DateResolver`) calculates UTC timestamps and timezones to eliminate hallucinations. |
| [ADR-003](ADR-003-telegram-64-byte-callback-data-budget.md) | Telegram 64-Byte Callback Data Payload Budget & Identity Keys | **Accepted** | 2026-11-23 | Standardize on `BIGINT GENERATED ALWAYS AS IDENTITY` and compact prefixes (`r:done:<id>`, `u:task:<id>`) to stay within Telegram's 64-byte limit. |
| [ADR-004](ADR-004-multimodal-vision-and-transcription-pipeline.md) | Multimodal Vision & Audio Transcription Pipeline | **Accepted** | 2026-11-23 | Leverage Groq Whisper and vision LLM tool calling to convert whiteboard photos and audio recordings into structured tasks atomically. |
| [ADR-005](ADR-005-privacy-and-dpdp-compliance-architecture.md) | Privacy, Consent & DPDP Act 2023 Compliance Architecture | **Accepted** | 2026-11-23 | Implement automated streaming data portability (`/export` JSON & CSV) and transactional hard delete cascade (`/deleteme`) to satisfy statutory data privacy rights. |

---

## ADR Lifecycle

```
PROPOSED → ACCEPTED → (SUPERSEDED or DEPRECATED)
```

1. **Immutable Records:** Never delete historical ADRs.
2. **Superseding Decisions:** When architectural trade-offs evolve, create a new ADR referencing and superseding the previous record.
