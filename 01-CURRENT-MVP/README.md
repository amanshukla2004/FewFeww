# FewFeww Final MVP Documentation & Execution Blueprint

**Author:** Co-Founder & CEO / Principal Systems Architect  
**Status:** Approved for Implementation (Nov 16, 2026 – Feb 1, 2027)  
**Channel Scope:** Telegram-First (Private Chats) + Always-On Backend Monolith  

---

## Master Directory

This directory contains the synthesized, battle-tested blueprint created by comparing, resolving conflicts, and fusing `claude_mvp_specificaltion.md` with `mvp/MVP_SPECIFICATION.md`:

```
FewFeww/01-CURRENT-MVP/
├── README.md                                   # This directory index
├── 01-executive-comparison-and-decisions.md    # 🔍 CEO conflict audit & 8 architectural decisions
├── 02-final-mvp-specification.md               # 📖 Master PRD, database schema, Nudge Ladder & tools
├── 03-implementation-playbook-and-timeline.md  # 📅 6-week build plan, 5-week beta sprint, & Feb 1 gate
├── 04-testing-evals-and-runbook.md             # 🧪 100-message eval harness, test suite & ops runbook
└── 05-search-hosting-and-llm-strategy.md       # 🔬 Deep Dive: Postgres FTS, VPS Topology & Gemini/Groq
```

---

## Executive Summary of Core Decisions

1. **Telegram-First Wedge:** WhatsApp is deferred to post-beta as a paid tier to protect our ₹5,000/month budget ceiling. Telegram is 100% free with zero 24-hour message restrictions.
2. **Postgres Poller (`FOR UPDATE SKIP LOCKED`):** Redis and BullMQ have been replaced with a native PostgreSQL poller running every 10–15 seconds. This eliminates extra infrastructure, avoids data drift, and provides 100% transactional ACID safety.
3. **`BIGINT` Primary Keys:** Replaced UUIDs with `BIGINT` identities so button callback payloads (`r:done:8812`) strictly stay within Telegram's **64-byte limit**.
4. **The 5-Stage Nudge Ladder:** Follow-through is our core differentiator (`Hypothesis H2`). Automated polite follow-ups, overdue morning digests, quiet hours (22:00–07:00), and an anti-annoyance circuit breaker are built into the core engine.
5. **Deterministic Date Resolver & Golden Eval Suite:** The LLM interprets; code executes. A 100-message golden eval suite guarantees ≥ 90% extraction accuracy on every deployment.
6. **Always-On VPS Deployment:** Deploying on an always-on $4–$5/month VPS with Docker Compose (App + Postgres 17 + Caddy) ensures the scheduler never sleeps and reminders are never missed.

