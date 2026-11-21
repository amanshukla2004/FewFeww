# FewFeww MVP — Deep Dive: Search Architecture, Hosting Topology & LLM Strategy

**Document Part:** Technical Architecture Deep-Dives  
**Audience:** Founders, Systems Architects & Core Engineers  
**Scope:** In-depth technical justifications for Search, Always-On Infrastructure, and LLM Provider Selection  

---

## 1. Search Architecture: Why PostgreSQL FTS Over Vector Search (`pgvector`)

### 1.1 The Conflict
- **Alternative Proposal:** Generate 1536-dimensional vector embeddings via OpenAI/Gemini embeddings API and store them in `pgvector` or a dedicated vector database (Pinecone/Qdrant) for semantic search.
- **Adopted Engineering Decision:** Use native PostgreSQL **Full-Text Search (`tsvector` with `simple` dictionary)** combined with the **`pg_trgm` (trigram)** extension for fuzzy typo matching.

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        SEARCH ARCHITECTURE COMPARISON                  │
│                                                                        │
│   VECTOR SEARCH (pgvector / Embeddings)     POSTGRES FTS (Selected)    │
│  ───────────────────────────────────────   ──────────────────────────  │
│  • Requires external embedding API call    • Runs 100% inside Postgres │
│  • Adds 250–400ms latency to every save    • Zero added save latency   │
│  • Struggles with short 4-word notes       • Exact keyword precision   │
│  • Struggles with Hinglish slang tokens    • 'simple' dict keeps slang │
│  • Extra token costs on every task save    • $0.00 cost forever        │
│  • Complex metadata join queries           • Simple SQL JOIN on user_id│
└────────────────────────────────────────────────────────────────────────┘
```

---

### 1.2 The 5 Decisive Reasons for Choosing Postgres FTS

#### 1. The Data Volume Reality
In a 20–100 user beta, an active user will accumulate between **20 and 200 tasks and notes**. 
At this volume, semantic vector clustering is massive premature optimization. If a student asks:
> *"What did I save about DBMS assignment?"*

They want the exact task containing the word **DBMS**, not a probabilistic semantic guess about relational database theory.

#### 2. Latency & External Network Failure Points
With vector search, every time a user saves a note, the backend must make an outbound HTTP call to an embedding API:
```text
User Message ──► Backend ──► LLM Tool Call ──► Embedding API ──► pgvector DB
```
This adds **250–400ms latency** and creates a hard failure dependency. If OpenAI or Gemini embeddings timeout, task creation fails or requires complex retry queues.

With Postgres FTS, the column is a **`GENERATED ALWAYS AS STORED`** column:
```sql
search_vector TSVECTOR GENERATED ALWAYS AS
  (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(details,''))) STORED;
```
PostgreSQL indexes the text automatically at disk write in **< 1 millisecond**. Zero external dependencies.

#### 3. Hinglish & Colloquial Slang
Standard embedding models (like OpenAI `text-embedding-3-small`) are pre-trained predominantly on clean English web text. Short Hinglish messages like:
> *"Kal subah Amit bhaiya ko call karke fees confirm karni hai"*

frequently produce low-confidence vector clusters. 
In Postgres FTS, using the `'simple'` dictionary tells Postgres: **do not apply English stemming rules** (which would corrupt Hinglish words). It indexes tokens like `Amit`, `bhaiya`, and `fees` as exact matchable keywords.

#### 4. Typo Tolerance via Trigrams (`pg_trgm`)
Students type fast and make typos (*"sping boot"*, *"asignment"*).
By adding `CREATE EXTENSION pg_trgm;`, if exact keyword search yields 0 rows, our query instantly falls back to a trigram similarity query:
```sql
-- Catches 'sping boot' when user typed 'spring boot'
SELECT id, title FROM tasks
WHERE user_id = :uid AND title % :keyword
ORDER BY similarity(title, :keyword) DESC LIMIT 5;
```

#### 5. Search Query Implementation
```sql
-- Prefix matching with rank scoring
SELECT 'TASK' AS type, id, title, ts_rank(search_vector, q) AS rank
FROM tasks, to_tsquery('simple', :q) q
WHERE user_id = :uid AND search_vector @@ q
UNION ALL
SELECT 'NOTE', id, coalesce(title, left(content, 60)), ts_rank(search_vector, q)
FROM notes, to_tsquery('simple', :q) q
WHERE user_id = :uid AND search_vector @@ q
ORDER BY rank DESC LIMIT 5;
```

#### When Do We Switch to Vector Search?
In **Phase 2 / V2**, when users save long-form 2,000-word articles, PDFs, and bookmarks, and want to ask conceptual queries like *"What was that productivity rule about doing the hardest thing first?"* (matching an article titled *"Eat That Frog"*). For the MVP, keyword FTS is 10x faster, more reliable, and completely free.

---

## 2. Hosting Topology: Why Free Serverless Fails vs Always-On VPS

### 2.1 The Fatal Flaw of Free Serverless ("The Sleeping Scheduler Problem")

Many developers attempt to host their first MVP backend on free PaaS tiers like **Render Free, Fly.io (scale-to-zero), or Vercel Serverless Functions**.

For an API or website, sleeping is fine (it wakes up in 30 seconds when someone visits).
**For a reminder product, sleeping is fatal.**

```text
THE SLEEPING SCHEDULER TRAP:

  2:00 PM: User sets reminder for 2:45 PM: "Take medicine"
  2:15 PM: No new Telegram messages arrive.
           Render puts container to sleep to save CPU.
  2:45 PM: ⚠️ THE CONTAINER IS DEAD.
           No CPU is running. The scheduler query NEVER executes.
  3:10 PM: Another user sends a random message.
           Container wakes up after a 30-second cold start.
  3:11 PM: Reminder delivered 26 MINUTES LATE.
           Result: The user loses trust, deletes the bot, and never returns.
```

FewFeww's entire value proposition is **100% on-time reliability**. A reminder delivered 10 minutes late destroys user trust instantly.

---

### 2.2 The Solution: An Always-On $4–$5/Month VPS

We deploy to a dedicated, unmanaged Linux VPS (e.g., **Hetzner Cloud CX22** at €3.50/mo (~₹320/month) or **DigitalOcean Droplet** at $4–$6/month):
- **Specs:** 2 GB RAM, 1–2 vCPUs, 40 GB NVMe SSD, static public IPv4.
- **Zero Sleep:** The server runs 24 hours a day, 7 days a week, 365 days a year.

```text
┌────────────────────────────────────────────────────────────────────────┐
│                   ALWAYS-ON VPS TOPOLOGY (Docker Compose)              │
│                                                                        │
│   PUBLIC INTERNET                                                      │
│        │                                                               │
│        ▼ HTTPS (Port 443)                                              │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │ CADDY (Reverse Proxy & Automatic SSL Engine)                   │   │
│   │ • Obtains & auto-renews free Let's Encrypt TLS certificates   │   │
│   │ • Terminates HTTPS and proxies to internal port 8080           │   │
│   └──────────────────────────────┬─────────────────────────────────┘   │
│                                  │ Internal Docker Network             │
│                                  ▼                                     │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │ BACKEND SERVICE (Spring Boot or Fastify Container)             │   │
│   │ • Inbound Webhook: /telegram/webhook/{secret}                  │   │
│   │ • In-Process Poller: Runs every 10-15s (FOR UPDATE SKIP LOCKED)│   │
│   │ • Stuck Job Reaper: Runs every 60s                             │   │
│   └──────────────────────────────┬─────────────────────────────────┘   │
│                                  │ Local Unix Socket / Network         │
│                                  ▼                                     │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │ POSTGRESQL 17 CONTAINER                                        │   │
│   │ • Named Docker Volume (pgdata) mounted to host SSD             │   │
│   │ • Nightly automated gzip backup cron (`pg_dump`)               │   │
│   └────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘
```

### 2.3 Why Caddy?
Instead of spending hours writing complex Nginx configs and maintaining Certbot cron jobs for SSL certificates, **Caddy does it in 3 lines**:
```caddy
bot.fewfeww.com {
    reverse_proxy app:8080
}
```
Caddy handles ACME HTTP-01 challenges, provisions the SSL certificate, and auto-renews it with zero manual intervention.

---

## 3. The LLM Strategy: Free Groq vs Gemini Flash vs Multi-Model Architecture

### 3.1 Can We Use the Free Groq API?
**Yes, but with one critical operational constraint.**

Groq is exceptionally fast (it runs models on custom LPU chips at 500–800 tokens/sec), and its free tier offers:
- `llama-3.3-70b-versatile` (Supports function/tool calling).
- `llama-3.1-8b-instant` (Ultra-fast).
- Rate Limits: **30 Requests Per Minute (RPM)**, but **6,000 Tokens Per Minute (TPM)** on 70B.

#### The Problem with Groq's 6,000 TPM Limit:
Our system prompt, Hinglish hints, user context, and list of up to 30 open tasks total roughly **1,200–1,500 tokens per request**.
If 5 students message the bot around the same minute:
```text
5 concurrent requests × 1,500 tokens = 7,500 tokens
Result: HTTP 429 Rate Limit Error!
```

---

### 3.2 The Primary Workhorse: Google Gemini 2.0 Flash

**Google Gemini 2.0 Flash is the undisputed #1 choice for FewFeww MVP:**

| Metric | Google Gemini 2.0 Flash | Groq (Llama 3.3 70B) | OpenAI GPT-4o mini |
|---|---|---|---|
| **Free Tier Allowance** | **15 RPM / 1,000,000 TPM / 1,500 RPD** | 30 RPM / 6,000 TPM | None |
| **Paid Pricing (Input)** | **$0.075 per 1,000,000 tokens** | $0.59 per 1M | $0.15 per 1M |
| **Paid Pricing (Output)**| **$0.30 per 1,000,000 tokens** | $0.79 per 1M | $0.60 per 1M |
| **JSON Schema Enforcement** | **Native `response_schema` (Guaranteed)** | Good | Good |
| **Speed (Time to First Token)**| **~200 ms** | ~250 ms | ~350 ms |

#### Real World Monthly Cost on Gemini 2.0 Flash:
If **20 beta users** send **15 messages per day** for 30 days = **9,000 messages/month**.
- 9,000 messages × 1,500 tokens = 13.5 Million input tokens.
- At $0.075 / 1M tokens = **$1.01 / month (₹85 / month total!)**.
The free tier easily covers this for $0, and even if it overflows into paid usage, your monthly bill is **under ₹100**.

---

### 3.3 Should We Use Multiple LLMs?

**NO, not chained in sequence.**  
Do not build complex chains (e.g., Router Model ──► Classifier Model ──► Validator Model). Every extra chained LLM call adds 1.5 seconds of latency, doubles token burn, and introduces another failure point.

---

### 3.4 The Winning Production Architecture: Single Primary + Automatic Hot Fallback

We wrap all model calls behind a clean `LlmClient` interface with a primary model and an automated fallback:

```text
                        Incoming User Message
                                 │
                                 ▼
                     ┌───────────────────────┐
                     │   LlmClient Router    │
                     └───────────┬───────────┘
                                 │
                ┌────────────────┴────────────────┐
                │ Try Primary                     │ If 5xx / Timeout / Rate Limit
                ▼                                 ▼
   ┌──────────────────────────┐      ┌──────────────────────────┐
   │ Google Gemini 2.0 Flash  │      │ Groq (Llama 3.3 70B)     │
   │ (Primary: 1M TPM, $0.075)│      │ (Instant Hot Fallback)   │
   └──────────────────────────┘      └──────────────────────────┘
                │                                 │
                └────────────────┬────────────────┘
                                 │
                                 ▼
                Valid Tool Call Output ({ tool, args })
```

1. **Primary Model:** **Gemini 2.0 Flash** (via Google AI Studio). It handles 99% of requests with sub-300ms latency, strict JSON Schema guarantees, and negligible cost.
2. **Automatic Fallback:** **Groq (`llama-3.3-70b-versatile`)**. If Google API returns HTTP 500, 503, or times out (> 8s), your code instantly catches the exception and replays the request to Groq.
3. **Voice Note Audio Transcription:** **Groq Whisper API (`whisper-large-v3-turbo`)**. Groq transcribes a 15-second voice note in **< 400ms** at **$0.04 per hour** of audio.

This dual-provider strategy gives you **99.9% uptime, zero hallucination risk, and costs under ₹500/month across your entire beta cohort.**

