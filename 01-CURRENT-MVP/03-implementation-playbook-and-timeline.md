# FewFeww MVP — Implementation Playbook & Execution Timeline

**Engineering Cadence:** 6-Week Build (Nov 16 – Dec 27) · 5-Week Beta (Dec 28 – Jan 31) · Decision Gate (Feb 1, 2027)  
**Effort Budget:** Solo Developer / Founder (10–15 hours/week)  
**Target Beta Cohort:** 20 to 50 active users (College students & developers in India)

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        6-WEEK BUILD & BETA TIMELINE                    │
│                                                                        │
│   PHASE 0         PHASE 1          PHASE 2         PHASE 3     PHASE 4 │
│  ┌─────────┐    ┌──────────┐    ┌────────────┐   ┌─────────┐  ┌───────┐│
│  │Ground-  │───►│Capture   │───►│Reminders & │──►│Safety & │─►│Beta   ││
│  │work     │    │End-to-End│    │Nudge Ladder│   │Deploy   │  │Sprint ││
│  └─────────┘    └──────────┘    └────────────┘   └─────────┘  └───────┘│
│   Nov 13–16      Nov 16–29       Nov 30–Dec 13   Dec 14–27    Dec28–J31│
│   • 10 Intvws    • Webhook       • SKIP LOCKED   • Export/Del • 20 usr │
│   • 40 Evals     • Tool LLM      • Snooze Buttons• VPS Caddy  • Metrics│
│   • BotFather    • DateResolver  • Morning Plan  • Backups    • Gate   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 0: Groundwork, User Interviews & Eval Setup (Nov 13 – Nov 16)

### Objective:
Ground the project in real user behavior and build the test harness before writing code.

### Step-by-Step Actions:
1. **10 User Interviews (20 minutes each):**
   - Interview 10 college students. Ask: *"How do you track deadlines today? Show me the last deadline you missed. What forwarded messages do you get in class groups?"*
   - Collect exact raw message text they receive. **Do not pitch FewFeww.**
2. **Build the Initial Eval Dataset:**
   - Create `src/test/resources/evals.jsonl`.
   - Add 40 real user messages from your interviews with expected tool calls and date resolutions.
3. **Register Telegram Bots:**
   - Open `@BotFather` on Telegram.
   - Create `@FewFewwDevBot` (for local development) and `@FewFewwBot` (for production).
   - Set bot commands using `/setcommands`:
     ```text
     today - View today's priorities and overdue tasks
     list - View upcoming tasks for the next 7 days
     settings - Change timezone, default time, and quiet hours
     pause - Pause proactive nudges for 1 to 3 days
     export - Download all your tasks and notes (JSON/CSV)
     deleteme - Permanently delete your account and all data
     help - Quick cheatsheet of examples
     feedback - Send a suggestion or bug report to founder
     ```
4. **Git Repository Setup:**
   - Initialize private repo. Add `.env` to `.gitignore` on Day 1. Enable GitHub secret scanning.

---

## Phase 1: End-to-End Inbound Capture (Nov 16 – Nov 29)

### Objective:
A user sends a text message or forwards an announcement; it is parsed into a task/note in Postgres, and the user receives a confirmation reply with `[Undo]`. (No reminders fired yet).

### Step-by-Step Actions:
1. **Project Scaffolding:**
   - Initialize project (Java 21 LTS + Spring Boot with Maven, or Node.js + Fastify/TypeScript).
   - Add dependencies: Web, JDBC Client, PostgreSQL Driver, Flyway Migration, Actuator.
2. **Local PostgreSQL via Docker:**
   ```yaml
   services:
     db:
       image: postgres:17
       environment:
         POSTGRES_DB: fewfeww
         POSTGRES_USER: fewfeww
         POSTGRES_PASSWORD: devpassword
       ports:
         - "5432:5432"
       volumes:
         - pgdata:/var/lib/postgresql/data
   volumes:
     pgdata:
   ```
3. **Database Migration:**
   - Put DDL schema into `src/main/resources/db/migration/V1__init.sql`. Start app; verify Flyway executes.
4. **Webhook Controller & Idempotency Implementation:**
   - Endpoint: `POST /telegram/webhook/{secret}`.
   - Verify `X-Telegram-Bot-Api-Secret-Token` using constant-time comparison (`MessageDigest.isEqual`).
   - Insert update into `inbox_updates` using `ON CONFLICT (update_id) DO NOTHING`.
   - Code:
   ```java
   @RestController
   @RequestMapping("/telegram")
   class WebhookController {
       private final TelegramProps props;
       private final InboxRepository inbox;
       private final UpdateDispatcher dispatcher;

       @PostMapping("/webhook/{path}")
       ResponseEntity<Void> receive(
               @PathVariable String path,
               @RequestHeader(value = "X-Telegram-Bot-Api-Secret-Token", required = false) String token,
               @RequestBody JsonNode update) {
           boolean ok = MessageDigest.isEqual(
                   props.webhookSecret().getBytes(UTF_8),
                   (token == null ? "" : token).getBytes(UTF_8))
                   && props.webhookPath().equals(path);
           if (!ok) return ResponseEntity.status(403).build();

           long updateId = update.get("update_id").asLong();
           boolean isNew = inbox.insertIfAbsent(updateId, extractTelegramUserId(update), update.toString());
           if (isNew) dispatcher.dispatchAsync(updateId); // Hand off to background worker
           return ResponseEntity.ok().build();           // Return 200 OK immediately
       }
   }

   // Idempotent Insert Query:
   boolean insertIfAbsent(long updateId, Long tgUserId, String json) {
       int rows = jdbc.sql("""
           INSERT INTO inbox_updates(update_id, telegram_user_id, payload)
           VALUES (:id, :uid, CAST(:json AS jsonb))
           ON CONFLICT (update_id) DO NOTHING
           """)
           .param("id", updateId).param("uid", tgUserId).param("json", json)
           .update();
       return rows == 1; // 0 means already processed
   }
   ```

5. **Telegram Client Implementation:**
   - Wrap only the 5 methods needed: `sendMessage`, `editMessageText`, `answerCallbackQuery`, `setMyCommands`, `getFile`.
   ```java
   void sendMessage(long chatId, String text, List<List<Button>> keyboard) {
       Map<String, Object> body = new HashMap<>();
       body.put("chat_id", chatId);
       body.put("text", text);
       if (keyboard != null) body.put("reply_markup", Map.of("inline_keyboard", keyboard));
       http.post().uri("/sendMessage").body(body).retrieve().toBodilessEntity();
   }
   record Button(String text, String callback_data) {}
   ```

6. **Local Tunnel & Webhook Registration:**
   - Start Cloudflare Tunnel: `cloudflared tunnel --url http://localhost:8080`.
   - Register webhook:
     ```bash
     curl -X POST https://api.telegram.org/bot<TOKEN>/setWebhook \
       -d url=https://<TUNNEL_HOST>/telegram/webhook/<SECRET_PATH> \
       -d secret_token=<SECRET_TOKEN> \
       -d allowed_updates='["message","callback_query"]'
     ```

7. **Onboarding Flow:**
   - Check `users.onboarding_state`. If new, guide through `/start` -> Consent -> Timezone -> Default Time buttons before allowing LLM calls.

8. **Deterministic DateResolver Implementation:**
   - Code resolves proposed local time into UTC instant using `user.timezone`:
   ```java
   public Resolved resolve(LocalDateTime proposed, boolean timeIsExplicit,
                           ZoneId zone, LocalTime defaultTime) {
       ZonedDateTime now = ZonedDateTime.now(clock.withZone(zone));
       LocalDateTime local = timeIsExplicit
               ? proposed
               : proposed.toLocalDate().atTime(defaultTime);
       ZonedDateTime when = local.atZone(zone);
       if (when.isBefore(now.minusMinutes(1))) return new NeedsClarification("in_the_past");
       if (when.isAfter(now.plusYears(2)))     return new NeedsClarification("too_far");
       return new At(when.toInstant(), timeIsExplicit);
   }
   ```

9. **Phase 1 Acceptance Criteria (Done When):**
   - Sending *"submit DBMS assignment by friday 6pm"* creates task and replies with local time confirmation and `[Undo]` button.
   - Replaying the same webhook payload 5 times creates exactly 1 task in the database.
   - Eval suite runs on at least 40 messages with date accuracy ≥ 90%.

---

## Phase 2: Reminders, Scheduler & Nudge Ladder (Nov 30 – Dec 13)

### Objective:
Reminders fire on time, survive app restarts, and the 5-stage Nudge Ladder executes reliably.

### Step-by-Step Actions:
1. **PostgreSQL Poller Scheduler Implementation:**
   ```java
   @Component
   class ReminderWorker {
       private static final int[] BACKOFF_MIN = {1, 5, 15, 60, 180};

       @Scheduled(fixedDelay = 10_000)
       void tick() {
           for (Reminder r : reminders.claimDue(25)) {
               try {
                   User u = users.get(r.userId());
                   if (u.status() != ACTIVE) { reminders.cancel(r.id(), "user_inactive"); continue; }
                   if (!policy.maySend(u, r)) { reminders.reschedule(r.id(), policy.nextAllowed(u, r)); continue; }
                   long msgId = telegram.sendMessage(u.chatId(), render(r), keyboardFor(r));
                   reminders.markSent(r.id(), msgId);
                   nudges.scheduleLadder(r);      // stages 1, 3 and 4 rows
                   recurrence.scheduleNext(r);    // recurring tasks only
               } catch (TelegramBlocked e) {
                   users.markBlocked(r.userId());
               } catch (Exception e) {
                   reminders.retryLater(r.id(), BACKOFF_MIN[Math.min(r.attemptCount() - 1, 4)], e.getMessage());
               }
           }
       }
   }

   // Row claiming query:
   List<Reminder> claimDue(int limit) {
       return jdbc.sql("""
           UPDATE reminders SET status = 'SENDING', locked_at = now(), attempt_count = attempt_count + 1
           WHERE id IN (SELECT id FROM reminders
                        WHERE status = 'SCHEDULED' AND fire_at <= now()
                        ORDER BY fire_at LIMIT :limit FOR UPDATE SKIP LOCKED)
           RETURNING *
           """)
           .param("limit", limit)
           .query(Reminder.class).list();
   }
   ```

2. **The 1-Minute Stuck Job Reaper:**
   ```java
   @Scheduled(fixedDelay = 60_000)
   void reapStuckRows() {
       jdbc.sql("""
           UPDATE reminders SET status = 'SCHEDULED', locked_at = NULL
           WHERE status = 'SENDING' AND locked_at < now() - INTERVAL '5 minutes'
           """).update();
   }
   ```

3. **Interactive Inline Callback Router:**
   - Process `callback_query` data (`r:done:<id>`, `r:snz1:<id>`, `r:drop:<id>`):
   ```java
   void handleCallback(CallbackQuery cq) {
       String[] p = cq.data().split(":");
       long userId = users.requireByTelegramId(cq.fromId()).id();
       switch (p[0] + ":" + p[1]) {
           case "r:done" -> reminders.ack(userId, Long.parseLong(p[2]), Ack.DONE);
           case "r:snz1" -> reminders.snooze(userId, Long.parseLong(p[2]), Duration.ofHours(1));
           case "r:drop" -> reminders.ack(userId, Long.parseLong(p[2]), Ack.DROP);
           default -> log.warn("Unknown callback: {}", cq.data());
       }
       telegram.answerCallback(cq.id()); // Stops button spinner
       telegram.editMessageText(cq.chatId(), cq.messageId(), resultText, null);
   }
   ```

4. **Morning Plan Digest Job:**
   - Cron running every minute finding users whose local time passed `morning_plan_time` (08:30 AM):
   ```sql
   SELECT id FROM users
   WHERE status = 'ACTIVE' AND morning_plan_enabled
     AND (last_morning_plan_on IS NULL OR last_morning_plan_on < (now() AT TIME ZONE timezone)::date)
     AND (now() AT TIME ZONE timezone)::time >= morning_plan_time
     AND (now() AT TIME ZONE timezone)::time < morning_plan_time + interval '3 hours';
   ```

5. **Phase 2 Acceptance Criteria (Done When):**
   - Setting a reminder for 2 minutes from now, killing the app, and restarting delivers the reminder on time.
   - Ignoring a reminder produces exactly one Stage-1 follow-up after 2 hours.
   - Proactive nudges are held during quiet hours (22:00–07:00).
   - Reminder lag metric is logged and remains under 60 seconds.

---

## Phase 3: Trust, Safety, Export & Production Deployment (Dec 14 – Dec 27)

### Objective:
Deploy the hardened, observable application to an always-on production VPS.

### Step-by-Step Actions:
1. **Data Control & DPDP Compliance:**
   - Implement `/export`: generates JSON and CSV files and uploads via Telegram `sendDocument`.
   - Implement `/deleteme`: two-tap hard delete wiping user record, tasks, and message history.
2. **Degraded Fallback Mode:**
   - If LLM provider times out or throws 5xx, save raw message as a note in DB and notify user: *"I've saved this thought to your inbox, but couldn't parse dates right now."*
3. **Observability & Health:**
   - Add structured JSON logging with `update_id` correlation IDs.
   - Connect Sentry for automatic exception stack traces.
   - Expose `/health` endpoint and connect free uptime monitor (UptimeRobot / BetterStack).
4. **VPS Provisioning & Production Container Files:**
   - Provision $4–$5/month VPS (Hetzner CX22 or DigitalOcean Droplet, 2GB RAM).
   - **`Dockerfile`:**
     ```dockerfile
     FROM eclipse-temurin:21-jre
     WORKDIR /app
     COPY target/fewfeww.jar app.jar
     EXPOSE 8080
     ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "app.jar"]
     ```
   - **`docker-compose.yml`:**
     ```yaml
     services:
       app:
         build: .
         restart: unless-stopped
         environment:
           SPRING_DATASOURCE_URL: jdbc:postgresql://db:5432/fewfeww
           DB_USER: fewfeww
           DB_PASSWORD: ${DB_PASSWORD}
           TELEGRAM_BOT_TOKEN: ${TELEGRAM_BOT_TOKEN}
           TELEGRAM_WEBHOOK_SECRET: ${TELEGRAM_WEBHOOK_SECRET}
           TELEGRAM_WEBHOOK_PATH: ${TELEGRAM_WEBHOOK_PATH}
           LLM_API_KEY: ${LLM_API_KEY}
           LLM_MODEL: ${LLM_MODEL:-gemini-2.0-flash}
         depends_on:
           - db
         ports:
           - "8080:8080"

       db:
         image: postgres:17
         restart: unless-stopped
         environment:
           POSTGRES_DB: fewfeww
           POSTGRES_USER: fewfeww
           POSTGRES_PASSWORD: ${DB_PASSWORD}
         volumes:
           - pgdata:/var/lib/postgresql/data

       caddy:
         image: caddy:2-alpine
         restart: unless-stopped
         ports:
           - "80:80"
           - "443:443"
         volumes:
           - ./Caddyfile:/etc/caddy/Caddyfile
           - caddy_data:/data
           - caddy_config:/config
         depends_on:
           - app

     volumes:
       pgdata:
       caddy_data:
       caddy_config:
     ```
   - **`Caddyfile`:**
     ```caddy
     bot.yourdomain.com {
         reverse_proxy app:8080
     }
     ```
   - **GitHub Actions CI (`.github/workflows/ci.yml`):**
     ```yaml
     name: ci
     on: [push, pull_request]
     jobs:
       build:
         runs-on: ubuntu-latest
         steps:
           - uses: actions/checkout@v4
           - uses: actions/setup-java@v4
             with:
               distribution: temurin
               java-version: 21
               cache: maven
           - run: mvn -B verify
     ```

5. **Automated Database Backups (`/opt/fewfeww/backup.sh`):**
   ```bash
   #!/bin/bash
   BACKUP_DIR="/backups"
   mkdir -p $BACKUP_DIR
   docker exec fewfeww-db pg_dump -U fewfeww fewfeww | gzip > "$BACKUP_DIR/fewfeww-$(date +%F).sql.gz"
   find $BACKUP_DIR -name "*.sql.gz" -mtime +14 -delete
   ```
   - Add to cron: `0 3 * * * /opt/fewfeww/backup.sh` (runs nightly at 3:00 AM).
   - Test a full restore into a fresh database once before launching beta.

---

## Phase 4: Beta Sprint & Weekly Rhythm (Dec 28 – Jan 31)

### Objective:
Run a controlled 5-week beta with 20 to 50 active users to validate hypotheses H1 to H5.

### Weekly Operating Cadence:
- **Monday Morning:** Export events table; calculate weekly metrics (captures, completion rates, nudge response rate, reminder lag).
- **Wednesday Afternoon:** Conduct three 15-minute 1-on-1 calls with active users. Ask what they loved and what failed.
- **Friday Afternoon:** Ship code fixes addressing the top 2 failure modes identified during the week.
- **Week 2 Survey:** Send one-question poll: *"How would you feel if you could no longer use FewFeww? [Very disappointed | Somewhat | Not disappointed]"*.
- **Week 4 Pricing Test:** Poll cohort: *"If FewFeww became a paid tool at ₹99/month, would you subscribe? [Yes | Maybe | No]"*.

---

## Phase 5: The Go / No-Go Decision Gate (Feb 1, 2027)

Review actual metrics against targets:

| Metric | Target | Actual | Decision Action |
|---|---|---|---|
| **Beta Users Onboarded** | ≥ 20 | | If < 20: Wedge marketing failed. |
| **Day-28 Retention** | ≥ 25% | | If < 25%: Habit formation failed. |
| **On-Time Reminders** | ≥ 95% | | If < 95%: Technical reliability failed. |
| **Eval Extraction Accuracy** | ≥ 90% | | If < 90%: Prompt/LLM pipeline needs rework. |
| **Follow-Through Lift** | Nudged > Un-nudged | | Proves value proposition of Nudge Ladder. |
| **Willingness to Pay (₹99/mo)** | ≥ 5 of 20 | | Proves commercial product-market fit. |

**Verdict Rules:**
- **Green (5+ targets met):** Proceed to V2 (Web dashboard, Groq Whisper voice capture, scoped WhatsApp integration, and Razorpay subscription billing).
- **Yellow (Retention strong, willingness to pay weak):** Pivot target wedge or pricing tier.
- **Red (Retention and completion both weak):** Stop gracefully, publish code as a technical showcase.

