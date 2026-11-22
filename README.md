# FewFeww — Telegram-First Personal Follow-Through Assistant

FewFeww is an intelligent, privacy-first personal assistant built for Telegram and WhatsApp that turns spontaneous messages, voice recordings, and photos into actionable commitments. Unlike generic to-do apps that rely on passive task lists, FewFeww drives active execution using an automated 5-Stage Nudge Ladder, deterministic time-zone math, and zero-token full-text search.

---

## ⚡ Quick Start

### 1. Prerequisites
- **Node.js**: `v22` or `v24` LTS
- **PostgreSQL**: `v17` (with `pg_trgm` extension installed)
- **Telegram Bot Token**: Created via [@BotFather](https://t.me/BotFather)
- **Groq API Key**: For low-latency LLM semantic tool-calling and Whisper transcription

### 2. Installation & Setup

```bash
# 1. Clone repository
git clone https://github.com/your-org/fewfeww.git
cd fewfeww

# 2. Install dependencies
npm install

# 3. Configure environment variables
cp .env.example .env
# Edit .env with your DATABASE_URL, TELEGRAM_BOT_TOKEN, and GROQ_API_KEY

# 4. Run database migrations
npm run migrate

# 5. Start development server
npm run dev
```

### 3. Local Development (Telegram Poller)
For local testing without exposing public webhooks:
```bash
npm run poll
```

---

## 🛠️ Commands Reference

| Command | Description |
|---|---|
| `npm run dev` | Starts the Fastify server with hot-reloading via `tsx watch` |
| `npm run poll` | Runs the long-polling Telegram bot runner for local development |
| `npm run build` | Compiles TypeScript source to production JavaScript in `dist/` |
| `npm start` | Launches the production application from compiled `dist/` |
| `npm test` | Executes unit and integration test suites via Vitest |
| `npm run migrate` | Runs pending PostgreSQL schema migrations in `migrations/` |

---

## 🏛️ Architecture & System Invariants

FewFeww is engineered around five fundamental system constraints:

1. **Persistent Row-Level Scheduler (`SKIP LOCKED`):**  
   Scheduled reminders and follow-up nudges are managed natively within PostgreSQL using `SELECT ... FOR UPDATE SKIP LOCKED`. This eliminates Redis/BullMQ infrastructure while ensuring zero duplicate dispatch and strict ACID safety.  
   👉 [ADR-001: Native PostgreSQL Poller with SKIP LOCKED for Task Scheduling](docs/decisions/ADR-001-postgres-skip-locked-scheduler.md)

2. **Deterministic Date Math:**  
   The LLM is strictly confined to intent classification and parameter extraction; it never computes relative calendar dates. Exact UTC instants and user-local timezones are resolved deterministically in code via `chrono-node` and `luxon`.  
   👉 [ADR-002: Deterministic Date Engine vs LLM Computation](docs/decisions/ADR-002-deterministic-date-engine.md)

3. **Telegram 64-Byte Callback Budget:**  
   Telegram enforces a hard 64-byte payload limit on inline keyboard callbacks. All database entities use `BIGINT GENERATED ALWAYS AS IDENTITY` combined with compact action prefixes (`r:done:<id>`, `u:task:<id>`).  
   👉 [ADR-003: Telegram 64-Byte Callback Data Payload Budget](docs/decisions/ADR-003-telegram-64-byte-callback-data-budget.md)

4. **Multimodal Task Ingestion (Voice & Vision):**  
   Whiteboard photos, handwritten notes, and meeting audio recordings are ingested via Groq Whisper and multimodal vision models, automatically populating structured to-dos.  
   👉 [ADR-004: Multimodal Vision & Audio Transcription Pipeline](docs/decisions/ADR-004-multimodal-vision-and-transcription-pipeline.md)

5. **DPDP Act & GDPR Privacy by Design:**  
   Statutory compliance with India's Digital Personal Data Protection Act 2023: self-service `/export` generates streaming JSON & CSV archives, while `/deleteme` cascades a permanent hard-deletion of all user data.  
   👉 [ADR-005: Privacy, Consent & DPDP Act 2023 Compliance Architecture](docs/decisions/ADR-005-privacy-and-dpdp-compliance-architecture.md)

---

## 🗂️ Project Directory Map

```text
FewFeww/
├── 📂 docs/
│   ├── 📂 decisions/              # Architecture Decision Records (ADRs)
│   └── 📂 ideas/                  # Product concept and specification notes
├── 📂 migrations/                 # PostgreSQL incremental SQL migration scripts
├── 📂 src/
│   ├── 📂 db/                     # Connection pool, repositories, and migration runner
│   │   ├── pool.ts                # pg.Pool configuration
│   │   ├── user.repo.ts           # User profiles, onboarding state & preferences
│   │   └── inbox.repo.ts          # Idempotency log for webhook updates
│   ├── 📂 routes/                 # Fastify HTTP route handlers
│   │   ├── webhook.ts             # Telegram webhook ingress with idempotency
│   │   ├── whatsapp.ts            # Meta WhatsApp Cloud API gateway
│   │   ├── dashboard.ts           # Interactive analytics dashboard
│   │   └── landing.ts             # Accessible landing page & pricing grid
│   ├── 📂 services/               # Core business domain services
│   │   ├── task.service.ts        # Task lifecycle, fuzzy matching & reminders
│   │   ├── reminder.worker.ts     # Persistent poller with SKIP LOCKED
│   │   ├── nudge.policy.ts        # 5-Stage Nudge Ladder & quiet hours logic
│   │   ├── date.resolver.ts       # 10-rule deterministic date engine
│   │   ├── dispatcher.ts          # LLM tool-calling execution coordinator
│   │   ├── mom.service.ts         # Meeting Minutes mode & voice note processing
│   │   ├── vision.service.ts      # Image analysis & visual to-do extraction
│   │   ├── habit.service.ts       # Habit streaks & numeric metric tracking
│   │   ├── circle.service.ts      # Social circles & accountability reminders
│   │   └── privacy.service.ts     # /export (JSON/CSV) & /deleteme cascade
│   ├── index.ts                   # Application bootstrap & worker orchestration
│   └── server.ts                  # Fastify HTTP server instantiation
├── 📂 01-CURRENT-MVP/             # Master MVP functional specifications & playbook
├── 📂 02-WORK-LATER-ROADMAP/      # Post-beta roadmap and enterprise features
└── 📂 03-ARCHIVE/                 # Historical drafts and legacy notes
```

---

## 🧪 Testing & Quality Gates

Run the test suite with:
```bash
npm test
```
To run focused unit tests (such as deterministic date resolution):
```bash
npx vitest run src/services/date.resolver.test.ts
```

---

## 🤝 Contributing

1. Create a focused branch for your change (`git checkout -b feature/my-feature`).
2. Keep pull requests focused: separate structural refactoring from behavioral changes.
3. Verify the build and tests pass cleanly before submitting:
   ```bash
   npm run build && npm test
   ```
4. If introducing or altering an architectural pattern, submit an accompanying Architecture Decision Record under `docs/decisions/`.
