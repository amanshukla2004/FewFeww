# ADR-004: Multimodal Vision & Audio Transcription Pipeline

## Status
Accepted

## Date
2026-11-23

## Context
Users capture thoughts, tasks, and commitments opportunistically across multiple media channels:
1. Handwritten notes, whiteboard brainstorming sessions, and physical receipts photographed via camera.
2. Long voice notes, audio messages, and meeting discussions recorded in-situ.

Key requirements:
- Zero friction: users should simply take a photo or record audio and forward it to the Telegram bot or WhatsApp gateway.
- Accurate extraction of decisions, deadlines, and actionable tasks.
- Immediate conversion of extracted items into structured database entities (tasks, reminders, meeting minutes).

## Decision
1. **Audio Transcription:** Route audio voice notes through Groq Whisper (`whisper-large-v3`) via `mom.service.ts` to transcribe speech with high fidelity across English and Indian regional accents.
2. **Multimodal Vision:** Process inbound image attachments using vision models (`vision.service.ts`) to extract actionable checklist items and tabular data.
3. **Automated Task Ingestion:** Parse extracted items and feed them directly into `TaskService.createTask` within the user's active timezone.

## Alternatives Considered

### Dedicated external SaaS integrations (Otter.ai, Fireflies, Google Vision API)
- **Pros:** Out-of-the-box UI for meeting summarization.
- **Cons:** High subscription costs, multi-tenant privacy concerns, data residency conflicts, and API rate limits.
- **Rejected:** Increases external dependency footprint and operational costs on bootstrap budget.

### Client-side mobile OCR
- **Pros:** Offloads processing from backend.
- **Cons:** Infeasible in Telegram/WhatsApp chatbot architecture where processing occurs server-side upon receiving media attachments.
- **Rejected:** Incompatible with chatbot delivery model.

## Consequences
- Single unified capture flow: text, voice, and photos all funnel into the same deterministic task engine.
- Meeting Minutes (`MOM_MODE`) can auto-populate action items into user to-do lists in real-time.
- Minimal latency via Groq's high-speed inference engine.
