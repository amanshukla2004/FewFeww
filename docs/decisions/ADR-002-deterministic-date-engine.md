# ADR-002: Deterministic Date Engine (Chrono-Node + Luxon) vs LLM Computation

## Status
Accepted

## Date
2026-11-23

## Context
Users provide natural language deadlines in varied formats ("tomorrow 5pm", "Friday morning", "day after tomorrow at 10", "in 20 mins").
Key requirements:
- Absolute mathematical determinism and time-zone precision.
- Prevention of LLM hallucinations regarding the current calendar date, leap years, daylight saving, and timezone offsets.
- Predictable handling of ambiguous time inputs with systematic fallback policies.

## Decision
Isolate date extraction and date calculation strictly:
1. The LLM is restricted to semantic extraction: it only extracts the proposed string (e.g., `"tomorrow 5pm"`) and flags whether the time was explicitly mentioned.
2. The core date resolution is handled deterministically in code by `DateResolver` (`src/services/date.resolver.ts`), combining `chrono-node` for parsing and `luxon` for time-zone calculations and business rules.

## Alternatives Considered

### Prompting the LLM to calculate UTC timestamps directly
- **Pros:** Requires less application code for custom date parsing rules.
- **Cons:** LLMs consistently hallucinate relative offsets, struggle with timezones, fail on edge-case dates (e.g., month boundaries, leap years), and increase token consumption.
- **Rejected:** Follow-through requires 100% precision; sending a reminder at the wrong hour destroys user trust.

### Standard JavaScript `Date` object
- **Pros:** Built-in runtime support.
- **Cons:** Notoriously error-prone timezone conversion, lack of clean duration math, and reliance on host machine locale.
- **Rejected:** Luxon `DateTime` provides immutable, timezone-explicit conversions essential for user-specific timezones (e.g. `Asia/Kolkata`).

## Consequences
- Zero date calculation hallucinations from LLMs.
- Strict 10-rule deterministic resolution contract that can be unit-tested without network or model variability.
- Clear separation of concerns: LLM parses natural intent; deterministic code computes timeline instants.
