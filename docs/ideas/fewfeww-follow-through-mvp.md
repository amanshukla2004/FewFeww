# Idea One-Pager: FewFeww Personal Follow-Through Assistant

## Problem Statement
**How Might We** help students, busy founders, and knowledge workers actually follow through on deadlines and promises when traditional to-do apps create reminder fatigue and get ignored?

## Recommended Direction
A **Telegram-first conversational assistant** that pairs low-friction conversational capture with an active, polite **5-Stage Follow-Through Nudge Ladder**. Instead of treating reminders as isolated, one-off alarms that get dismissed and forgotten, FewFeww follows up sequentially (+2 hours, next morning, day 3, day 7) with instant 1-tap inline buttons (`[Done]`, `[Snooze 1h]`, `[Tomorrow]`, `[Drop]`).

## Core Business Hypotheses
1. **Hypothesis H1 (Zero-Friction Ingestion):** Users capture 3x more tasks when they can forward chat announcements directly into Telegram rather than opening a dedicated app.
2. **Hypothesis H2 (Follow-Through Ladder):** Polite, multi-stage follow-up nudges increase task completion rates by > 50% compared to standard single-alarm to-do apps.
3. **Hypothesis H3 (Burnout Safeguards):** Strict quiet hours (22:00–07:00), daily proactive caps (max 6), and a 3-strike circuit breaker prevent notification fatigue and maintain long-term retention.

## MVP Scope (What's In)
- Telegram bot interface (`@FewFewwDevBot`) with 4-stage onboarding state machine.
- LLM natural language intent extraction (Groq `openai/gpt-oss-120b`).
- Deterministic 10-rule `DateResolver` supporting Hinglish (*kal subah*, *parson*) and forward-relative dates.
- 5-Stage Nudge Ladder Engine with anti-annoyance circuit breaker.
- Native PostgreSQL 17 `FOR UPDATE SKIP LOCKED` scheduler (zero Redis/worker queues).
- Daily 08:30 AM Morning Plan digest and hybrid `TSVECTOR` + Trigram search.
- Full DPDP privacy compliance (`/export` JSON/CSV and `/deleteme` hard wipe).

## Not Doing (and Why)
- **No Native Mobile Apps (iOS/Android):** Users already spend 2–4 hours daily inside Telegram/WhatsApp. Building an app adds app-store friction, login walls, and push notification fatigue.
- **No Voice Note Transcription in V1:** Adds audio processing latency and API cost before validating the core follow-through hypothesis.
- **No Multi-User Team Collaboration / Shared Boards:** Dilutes focus into project management software (competing with Jira/Trello). FewFeww is strictly a personal follow-through tool.
- **No Two-Way Google Calendar Sync in V1:** Calendar OAuth adds high friction to onboarding.

## Key Assumptions to Validate in Beta
- [ ] Users tap inline callback buttons (`[Done]`, `[Tomorrow]`) rather than ignoring messages.
- [ ] Groq LLM tool-calling maintains ≥ 95% intent extraction accuracy in wild conversations.
- [ ] Nudge mute rate (`/pause`) remains under 15%.
