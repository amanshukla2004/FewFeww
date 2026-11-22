# Step 02: Database Provisioning & Schema Migrations

**Status:** Completed ✅  
**Completion Timestamp:** 2026-11-22T12:56:30+05:30  
**Database:** PostgreSQL 17 (via Docker Compose `postgres:17-alpine`)  
**Port:** `5432`  
**Migration File:** `migrations/001_init_schema.sql`  

---

## 1. What We Did

1. **Dockerized PostgreSQL 17 Setup:**
   - Authored `docker-compose.yml` deploying `postgres:17-alpine` with persistent volume `fewfeww_pgdata` and mapped port `5432:5432`.
   - Bootstrapped and started container `fewfeww-db`.

2. **Schema Definition (`migrations/001_init_schema.sql`):**
   - Enabled `pg_trgm` extension for typo-tolerant trigram similarity search.
   - Created all 10 core tables defined in `01-CURRENT-MVP/02-final-mvp-specification.md`:
     1. `users` — stores user preferences (timezone, default reminder time, quiet hours, onboarding state).
     2. `inbox_updates` — webhook idempotency log with primary key `update_id` to guarantee zero duplicate processing.
     3. `messages` — raw conversational audit trail with sender metadata.
     4. `tasks` — user tasks with `search_vector` generated column (`simple` dictionary) and trigram index.
     5. `reminders` — target table for the `FOR UPDATE SKIP LOCKED` scheduler and 5-stage Nudge Ladder.
     6. `notes` — unstructured user notes, thoughts, and bookmarks.
     7. `conversation_state` — short-lived state machine for clarifications.
     8. `llm_calls` — token, latency, and cost audit log.
     9. `events` — product analytics and hypothesis tracking (`H1` to `H5`).
     10. `feedback` — user feedback and bug reports.

3. **Node.js Migration Runner & Schema Verifier:**
   - Created `src/db/pool.ts` using connection pool (`pg`).
   - Created `src/db/migrate.ts` executing migrations wrapped in strict ACID transactions (`BEGIN` ... `COMMIT`).
   - Created `src/db/verify-schema.ts` confirming data types, generated columns, and index configurations.

---

## 2. Verification Results

Ran automated schema verification (`npx tsx src/db/verify-schema.ts`):

```text
--- Verifying Schema Details ---
Primary Key Types (Expected: bigint):
  - notes.id -> bigint
  - reminders.id -> bigint
  - tasks.id -> bigint
  - users.id -> bigint

Tasks search_vector (Expected: ALWAYS):
  - tasks.search_vector -> is_generated: ALWAYS

Indexes verified (10):
  - idx_inbox_pending (WHERE status IN ('PENDING', 'PROCESSING'))
  - idx_reminders_due (WHERE status = 'SCHEDULED')
  - idx_reminders_stuck (WHERE status = 'SENDING')
  - idx_reminders_task
  - idx_tasks_search (GIN on search_vector)
  - idx_tasks_title_trgm (GIN on title gin_trgm_ops)
  - idx_tasks_user_status_due
  - inbox_updates_pkey
  - reminders_pkey
  - tasks_pkey

✅ All Schema Constraints & Indexes Verified!
```

---

## 3. Exit Criteria / Sign-off

- [x] PostgreSQL 17 container healthy and listening on port 5432.
- [x] `pg_trgm` extension enabled.
- [x] All 10 tables created with `BIGINT GENERATED ALWAYS AS IDENTITY`.
- [x] `search_vector` generated TSVECTOR column active.
- [x] Step 02 documentation committed.

**Next Step:** **Step 03: Application Scaffolding & Health Check**.
