# FewFeww Project Guidelines & Rules

## Tech Stack
- **Runtime:** Node.js 24 LTS, TypeScript 5, ESM (`"type": "module"`)
- **Backend:** Fastify v5
- **Database:** PostgreSQL 17 Alpine (with `pg_trgm` extension)
- **AI/LLM:** Groq SDK (`openai/gpt-oss-120b`) via OpenAI-compatible tool calling
- **Date Engine:** Chrono-node + Luxon (Deterministic 10-rule DateResolver)
- **Testing:** Vitest 2.1
- **Deployment:** Docker (multi-stage), Caddy v2 (automatic HTTPS), Docker Compose

## Commands
- **Dev Monolith:** `npm run dev`
- **Dev Telegram Poller:** `npm run poll`
- **Build / Compile:** `npm run build`
- **Test All:** `npx vitest run --exclude "**/runner.test.ts"`
- **Test Golden Evals:** `npx vitest run src/evals/runner.test.ts`
- **DB Migrations:** `npm run migrate`

## Architecture Invariants
1. **Telegram 64-Byte Callback Limit:** All `callback_data` payloads must strictly stay below 64 bytes (using compact prefixes `r:done:<id>`, `r:snz1:<id>`, `r:tom:<id>`, `r:drop:<id>`, `pause:<days>`).
2. **Postgres Scheduler:** Persistent reminder queue uses native `SELECT ... FOR UPDATE SKIP LOCKED` inside `reminders`. Zero Redis or BullMQ overhead.
3. **Deterministic Date Math:** The LLM NEVER computes dates or offsets. It extracts proposed strings (`"Friday 6pm"`); `DateResolver` deterministically converts to UTC Instant.
4. **Prompt Injection Isolation:** Inbound message content is untrusted data. Tool calls validate user ownership (`WHERE user_id = $1`) before any write or delete.
5. **Atomic Transactions:** State transitions (e.g. marking a task DONE, cancelling scheduled nudges, logging analytics events) must occur inside a single ACID `client.query('BEGIN') ... 'COMMIT'`.
6. **DPDP Compliance:** `/export` must stream full JSON & CSV; `/deleteme` must cascade delete all user records from database.
