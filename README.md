# FewFeww Project Workspace & Roadmap Guide

Welcome to the **FewFeww** workspace. This repository has been structured into clear phases so you always know **what to build now** and **what to leave for later**.

---

## 🗂️ Workspace Directory Map

```text
FewFeww/
│
├── 📂 01-CURRENT-MVP/              👉 [WORK ON THIS NOW] Active sprint & execution spec
│   ├── README.md                   # MVP overview & executive decisions
│   ├── 01-executive-comparison...  # Conflict audit & architectural decisions
│   ├── 02-final-mvp-specification  # Master PRD, database schema, Nudge Ladder & tools
│   ├── 03-implementation-playbook  # 6-week build plan & day-by-day steps
│   ├── 04-testing-evals-and-runbook# Test harness & golden eval suite
│   └── 05-search-hosting-and-llm...# Postgres FTS, VPS topology, and AI strategy
│
├── 📂 02-WORK-LATER-ROADMAP/       ⏳ [WORK ON LATER] Post-Beta & long-term vision
│   ├── final-product/              # Phase 2+ features, scaling, multi-platform apps
│   └── strategy-and-specs/         # High-level vision, business model & governance
│
├── 📂 03-ARCHIVE/                  📦 [HISTORICAL] Superseded drafts & early notes
│   ├── legacy-mvp-draft-1/         # Deprecated Fastify/BullMQ/Redis draft
│   ├── tech-stack-analysis/        # Initial stack comparisons & notes
│   ├── claude_mvp_specificaltion.md# Legacy raw prompt specification
│   ├── file.md                     # Scratchpad notes
│   └── file.original.md            # Original scratchpad backup
│
└── 📂 assets/                      📁 [ASSETS] Media and peripheral files
    ├── intowebsite-video/          # Product demo / intro video
    └── voice-agent-requirements.txt# Voice agent requirements reference
```

---

## 🚀 Where Do I Start?

Follow this simple 3-step sequence:

1. **Read the Core Architecture Decisions:**
   👉 [01-CURRENT-MVP/01-executive-comparison-and-decisions.md](01-CURRENT-MVP/01-executive-comparison-and-decisions.md)
   *(Understand why we chose Telegram-first, Postgres `SKIP LOCKED` for queueing, and BIGINT keys).*

2. **Understand the Product Specification & Database Schema:**
   👉 [01-CURRENT-MVP/02-final-mvp-specification.md](01-CURRENT-MVP/02-final-mvp-specification.md)
   *(The definitive PRD: tables, user flow, Telegram bot commands, and the 5-stage Nudge Ladder).*

3. **Start Building Phase 0 / Phase 1:**
   👉 [01-CURRENT-MVP/03-implementation-playbook-and-timeline.md](01-CURRENT-MVP/03-implementation-playbook-and-timeline.md)
   *(Your practical step-by-step implementation guide: bot creation, database migration, and capture pipeline).*

---

## 📌 Summary of Core Rules for V1

* **Channel:** Telegram Bot only (Private chats). WhatsApp deferred to post-beta.
* **Database:** PostgreSQL 17 with `BIGINT` primary keys (fits Telegram 64-byte button limits).
* **Scheduler:** Native Postgres `FOR UPDATE SKIP LOCKED` (no Redis/BullMQ complexity).
* **AI Engine:** The LLM interprets intents; code deterministically executes dates and writes DB rows.
* **Core Differentiator:** 5-Stage Nudge Ladder (automated follow-through).
