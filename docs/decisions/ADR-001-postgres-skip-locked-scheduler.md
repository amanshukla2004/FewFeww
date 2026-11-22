# ADR-001: Native PostgreSQL Poller with SKIP LOCKED for Task Scheduling

## Status
Accepted

## Date
2026-11-23

## Context
FewFeww requires a reliable reminder scheduler and proactive nudge engine to deliver notifications and follow-through prompts to users at precise instants.
Key requirements:
- Low infrastructure complexity and minimal operating overhead on a bootstrap budget.
- Atomic state transitions: marking a reminder `SENT`, scheduling follow-up nudges, and updating task status must happen under strict ACID guarantees.
- Zero duplicate processing across distributed instances or restarts.
- High resilience without relying on multi-tier queue services that can drop state or fail independently.

## Decision
Use PostgreSQL 17 native row-level locking via `SELECT ... FOR UPDATE SKIP LOCKED` inside a lightweight worker loop (`src/services/reminder.worker.ts`) against the `reminders` table.

## Alternatives Considered

### BullMQ + Upstash Redis
- **Pros:** Mature Node.js delayed job queue with built-in dashboard tooling.
- **Cons:** Introduces a distributed systems dual-write problem (e.g. database commits but Redis enqueue fails, or vice versa). Free-tier command limits (10,000 commands/day) risk throttling during alert surges.
- **Rejected:** Adds external network points of failure and operational complexity for zero additional functional benefit.

### Node.js in-memory `setTimeout` / cron timers
- **Pros:** Zero setup.
- **Cons:** Volatile. Any application restart, deployment, or crash drops scheduled reminders permanently.
- **Rejected:** Completely violates persistence and follow-through reliability invariants.

## Consequences
- Single source of truth in PostgreSQL (`reminders` table) eliminates distributed transaction inconsistency.
- Worker queries claim batches of due reminders (`WHERE status = 'SCHEDULED' AND fire_at <= now() LIMIT 25 FOR UPDATE SKIP LOCKED`) and advance state to `SENDING` in an atomic query.
- Eliminates Redis infrastructure costs ($0 extra cost).
- Zero risk of race conditions or duplicate dispatch when multiple bot instances poll simultaneously.
