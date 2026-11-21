# FewFeww MVP — CEO & Lead Engineer Conflict Audit & Decision Register

**Author:** Co-Founder & CEO / Principal Systems Architect  
**Scope:** Rigorous comparative analysis between `mvp/MVP_SPECIFICATION.md` and `claude_mvp_specificaltion.md`  
**Mandate:** Resolve all architectural, functional, and operational conflicts to produce a single, bulletproof MVP build plan.

---

## 1. Executive Summary & Verdict

Both documents agree on the foundational business premise:
> **WhatsApp-first Day 1 on a ₹5,000/month budget is suicide.** Meta's 24-hour conversation window and per-message utility fees will exhaust our bootstrap capital in two weeks. **Telegram is the non-negotiable primary wedge.**

However, there are **8 major architectural and strategic conflicts** between the earlier `MVP_SPECIFICATION.md` and the 1,424-line `claude_mvp_specificaltion.md` (written for Aman). 

As CEO and Lead Engineer, here is the executive ruling:

| Area | MVP_SPECIFICATION.md | claude_mvp_specificaltion.md | CEO & Staff Engineer Decision | Why This Decision Wins |
|---|---|---|---|---|
| **1. Scheduler & Queue** | BullMQ + Upstash Redis | Postgres Poller (`SKIP LOCKED`) | **Postgres Poller (`SKIP LOCKED`)** | Eliminates Redis infrastructure, zero third-party network failure points, 100% ACID safety (atomic state transitions), and runs for $0 on the same DB. |
| **2. Primary Key Format** | UUID (`gen_random_uuid()`) | `BIGINT GENERATED ALWAYS AS IDENTITY` | **BIGINT Identity Keys** | Telegram inline button `callback_data` has a strict **64-byte limit**. UUIDs waste 36 bytes per button payload. `r:done:8812` takes 11 bytes. |
| **3. Follow-Through Engine**| Simple 1-time alert + snooze | 5-stage **Nudge Ladder** + Anti-annoyance | **5-Stage Nudge Ladder** | Follow-through is our core differentiator (`Hypothesis H2`). Without the nudge ladder, we are just another commoditized to-do bot. |
| **4. Voice Note Capture** | Included in V1 (Groq Whisper) | Deferred to Post-Beta | **Deferred to Phase 2 (Text-First)** | Pure text capture and reliability must be proven first. Voice audio introduces network timeouts and transcription variance that distract from validating core follow-through. |
| **5. Claude MCP Server** | Built in MVP (Week 4) | Explicitly Out of Scope | **Out of Scope for V1 Beta** | Our beta users are college students and young professionals forwarding messages on Telegram. Zero beta users will use Claude Desktop stdio transport. |
| **6. Language & Runtime** | Node.js (TypeScript) + Fastify | Java 21 (LTS) + Spring Boot | **Java 21 / Spring Boot (or Fastify)** | If Aman's primary skill is Java, building in what he knows maximizes delivery speed. Both architectures follow identical DB/API contracts. |
| **7. Hosting Topology** | Serverless / Cloud PaaS (Render) | Dedicated VPS ($4–$5/mo) + Docker Compose | **Always-On VPS (Docker Compose)** | Serverless and free tiers sleep when idle. A scheduler polling every 10–15 seconds **cannot run on sleeping infrastructure**. |
| **8. Memory & Search** | Vector Embeddings (`pgvector`) | Postgres Full-Text (`tsvector` + trigram) | **Postgres FTS (`tsvector` + `pg_trgm`)** | Vector search is overkill for < 500 personal notes per user. Full-text search with prefix matching and trigrams handles Hinglish/English with zero token cost. |

---

## 2. In-Depth Conflict Analysis & Trade-Off Resolutions

### Conflict 1: Scheduling Architecture (BullMQ/Redis vs Postgres `FOR UPDATE SKIP LOCKED`)
- **The Conflict:** `MVP_SPECIFICATION.md` introduced BullMQ and Redis for delayed jobs. `claude_mvp_specificaltion.md` uses a native PostgreSQL polling query:
  ```sql
  UPDATE reminders r
  SET status = 'SENDING', locked_at = now(), attempt_count = attempt_count + 1
  WHERE r.id IN (
    SELECT id FROM reminders
    WHERE status = 'SCHEDULED' AND fire_at <= now()
    ORDER BY fire_at LIMIT 25
    FOR UPDATE SKIP LOCKED
  ) RETURNING r.*;
  ```
- **Staff Engineer Evaluation:**
  - Introducing Redis creates an unnecessary distributed systems problem: What if Redis accepts the job but Postgres rollback occurs? What if Upstash free tier (10k commands/day) throttles during an alert burst?
  - Postgres `FOR UPDATE SKIP LOCKED` is an industry-standard pattern used by heavyweights (e.g. GitHub, GitLab, Honeycomb). It guarantees that two application instances will **never process the same reminder twice**.
  - Marking a reminder `SENT`, scheduling the next recurrence, and inserting the Stage 1 Nudge row happen in a **single atomic ACID database transaction**.
- **CEO Ruling:** **Adopt Postgres `FOR UPDATE SKIP LOCKED`.** Zero external queue dependencies, zero extra cost.

---

### Conflict 2: Database Primary Keys vs Telegram Callback Limits
- **The Conflict:** `MVP_SPECIFICATION.md` defined table IDs as `UUID PRIMARY KEY DEFAULT gen_random_uuid()`. `claude_mvp_specificaltion.md` specified `BIGINT GENERATED ALWAYS AS IDENTITY`.
- **Staff Engineer Evaluation:**
  - In Telegram Bot API, the `callback_data` string attached to an inline button has a hard limit of **64 bytes**.
  - If you use UUIDs: `snooze:c4a8f9a2-4e2b-4c28-98e3-0d34fa123456:tonight` is **55 bytes**. If you add action metadata or user context, it overflows 64 bytes and Telegram drops the button.
  - A `BIGINT` ID generates small numbers (e.g., `8812`). The callback payload `r:snz1:8812` is only **10 bytes**.
- **CEO Ruling:** **Adopt `BIGINT` identity keys across all user-facing tables.** This is an essential technical constraint.

---

### Conflict 3: The Follow-Through "Nudge Ladder" vs Simple Reminders
- **The Conflict:** `MVP_SPECIFICATION.md` treated reminders as isolated 1-time alerts. `claude_mvp_specificaltion.md` recognized that **follow-through is the entire business hypothesis (H2)** and designed an automated 5-stage Nudge Ladder:
  - **Stage 0 (Due Time):** Reminder fires with `[Done]`, `[Snooze 1h]`, `[Tomorrow]`, `[Drop]`.
  - **Stage 1 (2 Hours Later):** If unacknowledged: *"Still planning to do this?"*
  - **Stage 2 (Next Morning):** Appears as an overdue item in the Morning Plan digest.
  - **Stage 3 (Day 3):** *"Open for 3 days. Reschedule or drop?"*
  - **Stage 4 (Day 7):** *"Want me to archive this?"*
  - **Anti-Annoyance Guard:** If 3 consecutive nudges are ignored, prompt user: *"Want fewer nudges?"*
- **CEO Ruling:** **The Nudge Ladder is mandatory.** It is the single feature that elevates FewFeww from a toy reminder bot into an active personal management system.

---

### Conflict 4: In-Scope Scope Creep (Voice Notes & Claude MCP Server)
- **The Conflict:** `MVP_SPECIFICATION.md` attempted to ship voice transcription (Groq Whisper) and Claude MCP integration in Week 4. `claude_mvp_specificaltion.md` explicitly cut them from V1.
- **CEO Evaluation:**
  - **Wedge Focus:** Our target wedge is college students and young professionals whose deadlines arrive in WhatsApp/Telegram groups. They forward or paste these messages.
  - Adding audio processing in V1 adds file-download latency, ffmpeg dependencies, and transcription failure edge cases.
  - Claude MCP requires building, testing, and distributing an npm package that 95% of beta users (mobile Telegram users) will never touch.
- **CEO Ruling:**
  - **V1 (Dec 28 Beta):** Strictly text and forwarded messages. Validate hypotheses H1 to H5.
  - **V1.1 (Immediate Post-Beta):** Groq Whisper voice capture (code is trivial once the text pipeline is rock-solid).
  - **V2:** Claude MCP Server and Web Dashboard.

---

### Conflict 5: Search Architecture (pgvector vs Postgres Full-Text Search)
- **The Conflict:** Earlier docs proposed `pgvector` for semantic search. `claude_mvp_specificaltion.md` uses Postgres Full-Text Search (`tsvector` with `pg_trgm` trigram similarity).
- **Staff Engineer Evaluation:**
  - A user in beta will save 20 to 200 notes/tasks.
  - Generating and storing 1536-dimensional embeddings for every task adds external API calls, latency, and costs.
  - Postgres `tsvector` with `simple` dictionary handles mixed English and Hinglish seamlessly. Adding `pg_trgm` allows fuzzy search (*"sping"* matches *"Spring"*).
- **CEO Ruling:** **Use Postgres FTS (`tsvector` + `pg_trgm`).** Do not introduce vector databases until user query logs prove keyword search is failing.

---

### Conflict 6: Hosting & Scheduler Reliability
- **The Conflict:** `MVP_SPECIFICATION.md` suggested free PaaS tiers (Render/Fly.io). `claude_mvp_specificaltion.md` specified an always-on VPS ($4–$5/mo) running Docker Compose.
- **Staff Engineer Evaluation:**
  - Render free tier sleeps after 15 minutes of inactivity. When asleep, internal schedulers do not execute. A user who sets a reminder for 3:00 PM will never receive it if no webhook wakes the server!
  - A $4/month VPS (e.g. Hetzner Cloud CX22 / DigitalOcean Droplet) provides 2GB RAM, 1 vCPU, 40GB SSD, and guaranteed 100% uptime with Docker Compose running App + Postgres + Caddy.
- **CEO Ruling:** **Deploy to an always-on VPS with Docker Compose.** Total cost is ~₹400/month, well within our ₹5,000 budget.

---

## 3. The 5 Core Hypotheses & The Feb 1, 2027 Gate

The MVP exists to answer 5 commercial hypotheses before spending significant time or money:

| ID | Hypothesis | Metric | Target for Go-Decision |
|---|---|---|---|
| **H1** | Capture is frictionless | First-session capture rate; clarification rate | **≥ 70%** capture; **< 15%** need clarification |
| **H2** | Follow-through increases completion | Completion rate: Nudged vs Un-nudged tasks | **Nudged tasks statistically higher** |
| **H3** | Users trust the bot's accuracy | On-time reminder delivery (< 60s); extraction accuracy | **≥ 95%** on-time; **≥ 90%** eval accuracy |
| **H4** | It forms an enduring habit | Week-4 cohort retention | **≥ 25% to 30%** active users at Day 28 |
| **H5** | Users find commercial value | "Very disappointed" if gone; willingness to pay ₹99/mo | **≥ 3 of 20** disappointed; **≥ 5 of 20** would pay |

> **Hard Gate (Feb 1, 2027):** If targets are met, proceed to Phase 2 (Web app, Voice notes, and WhatsApp). If retention is weak, stop or pivot. No emotional decision-making.

